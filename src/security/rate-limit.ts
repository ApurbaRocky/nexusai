/**
 * Lightweight in-memory sliding-window rate limiter.
 * Suitable for a single-instance deployment; production multi-instance
 * deployments should replace this with a shared store (e.g. Redis, Upstash)
 * behind the same interface.
 */
import { audit, type AuditContext } from "@/security/audit";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  /** Max number of requests allowed in the window. */
  limit: number;
  windowMs: number;
  /** Key prefix to scope different endpoints. */
  prefix?: string;
}

function prune() {
  const now = Date.now();
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

export async function rateLimit(
  key: string,
  options: RateLimitOptions,
  ctx?: AuditContext,
): Promise<{ ok: boolean; retryAfterSeconds: number; remaining: number; limit: number }> {
  prune();
  const bucketKey = `${options.prefix ?? "rl"}:${options.prefix === "global" ? key : key}`;
  const now = Date.now();
  const existing = buckets.get(bucketKey);

  if (!existing || existing.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + options.windowMs });
    return { ok: true, retryAfterSeconds: 0, remaining: options.limit - 1, limit: options.limit };
  }

  existing.count += 1;
  const remaining = Math.max(0, options.limit - existing.count);
  if (existing.count > options.limit) {
    await audit("security.rate_limited", ctx, { key, limit: options.limit }).catch(() => {});
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
      remaining,
      limit: options.limit,
    };
  }
  return { ok: true, retryAfterSeconds: 0, remaining, limit: options.limit };
}

export function rateLimitHeaders(result: { retryAfterSeconds: number; remaining: number; limit: number }) {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "Retry-After": String(result.retryAfterSeconds),
  };
}