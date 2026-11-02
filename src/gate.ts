import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { PAYMENT_INTENT_RE, SESSION_ID_RE } from "./sign";

/**
 * One PurchaseGate object is a single-threaded SQLite database.
 *
 * A download cap cannot use KV. KV has no atomic increment: two requests can
 * both read "4" and both write "5", so a limit of 5 becomes 6. This object
 * does the read, the check, and the write inside `storage.transactionSync`.
 * That callback is synchronous, so the isolate cannot interleave another
 * request inside it, and SQLite commits the writes as one transaction.
 *
 * The same transaction is used for per-IP and per-session rate windows.
 * Names are `ip:<hash>`, `stripe-ip:<hash>`, `session:<checkout session id>`,
 * `pi:<payment intent id>`, and `stripe:global` for Checkout Session lookups.
 *
 * `stripe:global` also stores the shared lookup window, a one-hour note when
 * Stripe refuses the expanded charge read, and a 10-minute cache of session
 * ids already found valid or invalid. Durable Object storage has no TTL
 * option, so each cached row carries its own expiry. A read drops an expired
 * row. Later writes and the alarm sweep the rest.
 */

type TokenUse = { retryUsed: boolean };
type Seen = Record<string, TokenUse>;

function readSeen(raw: unknown): Seen {
  if (!raw || typeof raw !== "object") return {};
  const seen: Seen = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value && typeof value === "object" && "retryUsed" in value) {
      seen[key] = { retryUsed: (value as { retryUsed?: unknown }).retryUsed === true };
    }
  }
  return seen;
}

export class PurchaseGate extends DurableObject<Env> {
  hit(limit: number, windowMs: number, now = Date.now()): boolean {
    if (!Number.isSafeInteger(limit) || limit < 1) return false;
    if (!Number.isSafeInteger(windowMs) || windowMs < 1) return false;
    return this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.kv.get<number[]>("hits") ?? [];
      const hits = existing.filter((stamp) => typeof stamp === "number" && now - stamp < windowMs);
      if (hits.length >= limit) {
        this.ctx.storage.kv.put("hits", hits);
        return false;
      }
      hits.push(now);
      this.ctx.storage.kv.put("hits", hits);
      return true;
    });
  }

  remaining(limit: number): number {
    return this.ctx.storage.transactionSync(() => {
      const count = this.ctx.storage.kv.get<number>("count") ?? 0;
      if (typeof count !== "number") return limit;
      return Math.max(0, limit - count);
    });
  }

  /**
   * Count a file transfer. Each token gets one free retry (a browser double
   * fetch) and every later transfer counts. A 30 second window is not used:
   * waiting and clicking the same button again must not mint another free copy.
   */
  consume(jti: string, limit: number, now = Date.now()): "ok" | "duplicate" | "limit" {
    void now;
    if (!Number.isSafeInteger(limit) || limit < 1) return "limit";
    return this.ctx.storage.transactionSync(() => {
      const seen = readSeen(this.ctx.storage.kv.get("seen"));
      const prior = seen[jti];
      if (prior && !prior.retryUsed) {
        seen[jti] = { retryUsed: true };
        this.ctx.storage.kv.put("seen", seen);
        return "duplicate";
      }
      const count = this.ctx.storage.kv.get<number>("count") ?? 0;
      const used = typeof count === "number" ? count : 0;
      if (used >= limit) return "limit";
      if (!prior) seen[jti] = { retryUsed: false };
      const entries = Object.entries(seen);
      const trimmed =
        entries.length > 32 ? Object.fromEntries(entries.slice(entries.length - 32)) : seen;
      this.ctx.storage.kv.put("count", used + 1);
      this.ctx.storage.kv.put("seen", trimmed);
      return "ok";
    });
  }

  rollback(jti: string): void {
    this.ctx.storage.transactionSync(() => {
      const seen = readSeen(this.ctx.storage.kv.get("seen"));
      const prior = seen[jti];
      if (!prior) return;
      if (!prior.retryUsed) delete seen[jti];
      const count = this.ctx.storage.kv.get<number>("count") ?? 0;
      this.ctx.storage.kv.put("seen", seen);
      this.ctx.storage.kv.put("count", typeof count === "number" ? Math.max(0, count - 1) : 0);
    });
  }

  markRefunded(): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.kv.put("refunded", 1);
    });
  }

  isRefunded(): boolean {
    return this.ctx.storage.transactionSync(() => this.ctx.storage.kv.get<number>("refunded") === 1);
  }

  /**
   * Session ids already checked against Stripe. `exp` is unix millis.
   * A missing or expired row is a cache miss. Callers skip Stripe on a hit.
   */
  readSessionCache(sessionId: string, now = Date.now()): SessionCacheRecord | null {
    const key = sessionCacheKey(sessionId);
    if (!key) return null;
    return this.ctx.storage.transactionSync(() => {
      const raw = this.ctx.storage.kv.get<unknown>(key);
      if (raw === undefined) return null;
      const parsed = parseStoredSession(raw, now);
      if (!parsed) this.ctx.storage.kv.delete(key);
      return parsed;
    });
  }

  async writeSessionCache(
    sessionId: string,
    record: SessionCacheRecord,
    ttlMs: number,
    now = Date.now(),
  ): Promise<void> {
    const key = sessionCacheKey(sessionId);
    if (!key || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || !validCacheRecord(record)) return;
    const exp = now + ttlMs;
    this.ctx.storage.transactionSync(() => {
      this.pruneSessionCache(now, 128);
      this.ctx.storage.kv.put(key, { ...record, exp });
    });
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null || existing > exp) await this.ctx.storage.setAlarm(exp);
  }

  /** True when an expanded charge read was refused and the note is still fresh. */
  expandForbidden(now = Date.now()): boolean {
    return this.ctx.storage.transactionSync(() => {
      const until = this.ctx.storage.kv.get<number>("expandForbiddenUntil");
      if (typeof until !== "number") return false;
      if (until <= now) {
        this.ctx.storage.kv.delete("expandForbiddenUntil");
        return false;
      }
      return true;
    });
  }

  noteExpandForbidden(ttlMs: number, now = Date.now()): void {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) return;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.kv.put("expandForbiddenUntil", now + ttlMs);
    });
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const more = this.ctx.storage.transactionSync(() => this.pruneSessionCache(now, 200));
    if (more) {
      await this.ctx.storage.setAlarm(now + 1_000);
      return;
    }
    const until = this.ctx.storage.transactionSync(() => {
      const stamp = this.ctx.storage.kv.get<number>("expandForbiddenUntil");
      if (typeof stamp === "number" && stamp <= now) this.ctx.storage.kv.delete("expandForbiddenUntil");
      return this.nextCacheExpiry(now);
    });
    if (until !== null) await this.ctx.storage.setAlarm(until);
  }

  /**
   * Drop expired `sv:` rows, a page at a time, and remember where the scan
   * stopped. Returns true when this pass did not reach the end of the keyspace.
   */
  private pruneSessionCache(now: number, budget: number): boolean {
    let cursor = this.ctx.storage.kv.get<string>("svCursor");
    let scanned = 0;
    while (scanned < budget) {
      const page = [
        ...this.ctx.storage.kv.list<{ exp?: unknown }>({
          prefix: "sv:",
          limit: 32,
          ...(typeof cursor === "string" && cursor.startsWith("sv:") ? { startAfter: cursor } : {}),
        }),
      ];
      if (page.length === 0) {
        this.ctx.storage.kv.delete("svCursor");
        return false;
      }
      for (const [key, value] of page) {
        scanned += 1;
        cursor = key;
        const exp = value && typeof value === "object" ? value.exp : undefined;
        if (typeof exp !== "number" || exp <= now) this.ctx.storage.kv.delete(key);
      }
      if (page.length < 32) {
        this.ctx.storage.kv.delete("svCursor");
        return false;
      }
    }
    if (typeof cursor === "string") this.ctx.storage.kv.put("svCursor", cursor);
    return true;
  }

  private nextCacheExpiry(now: number): number | null {
    let next: number | null = null;
    for (const [, value] of this.ctx.storage.kv.list<{ exp?: unknown }>({ prefix: "sv:" })) {
      const exp = value && typeof value === "object" ? value.exp : undefined;
      if (typeof exp !== "number" || exp <= now) continue;
      if (next === null || exp < next) next = exp;
    }
    const until = this.ctx.storage.kv.get<number>("expandForbiddenUntil");
    if (typeof until === "number" && until > now && (next === null || until < next)) next = until;
    return next;
  }
}

const LINK_RE = /^plink_[A-Za-z0-9]{8,200}$/;
const PRICE_RE = /^price_[A-Za-z0-9]{8,200}$/;

export type SessionCacheRecord =
  | { state: "invalid" }
  | {
      state: "valid";
      livemode: boolean;
      paymentIntentId: string;
      paymentLinkId: string | null;
      priceIds: string[];
    };

function sessionCacheKey(sessionId: string): string | null {
  if (!SESSION_ID_RE.test(sessionId)) return null;
  return `sv:${sessionId}`;
}

function validCacheRecord(record: SessionCacheRecord): boolean {
  if (record.state === "invalid") return true;
  if (record.state !== "valid") return false;
  if (typeof record.livemode !== "boolean") return false;
  if (!PAYMENT_INTENT_RE.test(record.paymentIntentId)) return false;
  if (record.paymentLinkId !== null && !LINK_RE.test(record.paymentLinkId)) return false;
  if (!Array.isArray(record.priceIds) || record.priceIds.length > 32) return false;
  return record.priceIds.every((id) => PRICE_RE.test(id));
}

function parseStoredSession(raw: unknown, now: number): SessionCacheRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.exp !== "number" || record.exp <= now) return null;
  if (record.state === "invalid") return { state: "invalid" };
  if (record.state !== "valid" || typeof record.livemode !== "boolean") return null;
  if (typeof record.paymentIntentId !== "string" || !Array.isArray(record.priceIds)) return null;
  if (record.paymentLinkId !== null && typeof record.paymentLinkId !== "string") return null;
  const candidate: SessionCacheRecord = {
    state: "valid",
    livemode: record.livemode,
    paymentIntentId: record.paymentIntentId,
    paymentLinkId: typeof record.paymentLinkId === "string" ? record.paymentLinkId : null,
    priceIds: record.priceIds.filter((id): id is string => typeof id === "string"),
  };
  if (candidate.priceIds.length !== record.priceIds.length) return null;
  if (!validCacheRecord(candidate)) return null;
  return candidate;
}
