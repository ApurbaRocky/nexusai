import { describe, expect, it } from "vitest";
import { rateLimit } from "@/security/rate-limit";

describe("in-memory rate limiter", () => {
  it("allows requests under the limit", async () => {
    const r1 = await rateLimit(`unit:${Math.random()}`, { limit: 3, windowMs: 5000, prefix: "t" });
    expect(r1.ok).toBe(true);
    expect(r1.remaining).toBe(2);
  });

  it("blocks once the limit is exceeded and reports retry seconds", async () => {
    const key = `unit:${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      const r = await rateLimit(key, { limit: 3, windowMs: 5000, prefix: "t" });
      expect(r.ok).toBe(true);
    }
    const blocked = await rateLimit(key, { limit: 3, windowMs: 5000, prefix: "t" });
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.remaining).toBe(0);
  });

  it("keeps separate buckets per prefix/key", async () => {
    const a = await rateLimit(`x:${Math.random()}`, { limit: 1, windowMs: 5000, prefix: "p1" });
    const b = await rateLimit(`x:${Math.random()}`, { limit: 1, windowMs: 5000, prefix: "p2" });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});