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
 * Names are `ip:<hash>`, `session:<checkout session id>`, and `pi:<payment intent id>`.
 */
export const DOWNLOAD_DEDUPE_MS = 30_000;

type Seen = Record<string, number>;

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
   * Count a file transfer. The same token inside DOWNLOAD_DEDUPE_MS is a retry
   * and does not count again. A later transfer of that token counts again.
   */
  consume(jti: string, limit: number, now = Date.now()): "ok" | "duplicate" | "limit" {
    if (!Number.isSafeInteger(limit) || limit < 1) return "limit";
    return this.ctx.storage.transactionSync(() => {
      const seen = this.ctx.storage.kv.get<Seen>("seen") ?? {};
      const countedAt = seen[jti];
      if (typeof countedAt === "number" && now - countedAt < DOWNLOAD_DEDUPE_MS) {
        return "duplicate";
      }
      const count = this.ctx.storage.kv.get<number>("count") ?? 0;
      if (typeof count === "number" && count >= limit) return "limit";
      const next = (typeof count === "number" ? count : 0) + 1;
      const updated: Seen = { ...seen, [jti]: now };
      const entries = Object.entries(updated);
      const trimmed =
        entries.length > 32 ? Object.fromEntries(entries.slice(entries.length - 32)) : updated;
      this.ctx.storage.kv.put("count", next);
      this.ctx.storage.kv.put("seen", trimmed);
      return "ok";
    });
  }

  rollback(jti: string): void {
    this.ctx.storage.transactionSync(() => {
      const seen = this.ctx.storage.kv.get<Seen>("seen") ?? {};
      if (!(jti in seen)) return;
      const rest = { ...seen };
      delete rest[jti];
      const count = this.ctx.storage.kv.get<number>("count") ?? 0;
      this.ctx.storage.kv.put("seen", rest);
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
