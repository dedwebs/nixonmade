import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

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
 * Names are `ip:<hash>`, `session:<checkout session id>`, `pi:<payment intent id>`,
 * and `stripe:global` for Checkout Session lookups.
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
}
