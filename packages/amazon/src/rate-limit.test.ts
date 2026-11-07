import { describe, expect, it } from "vitest";
import { backoffDelay, createRateLimiter, DEFAULT_RETRY, TokenBucket } from "./rate-limit";
import { fakeClock } from "./test-support";

describe("token bucket", () => {
  it("allows a burst, then one request per 1/rate seconds", () => {
    const { clock, advance } = fakeClock();
    const bucket = new TokenBucket({ rate: 5, burst: 2 }, clock.now);
    expect(bucket.take()).toBe(0);
    expect(bucket.take()).toBe(0);
    expect(bucket.take()).toBe(200);
    advance(100);
    expect(bucket.take()).toBe(100);
    advance(100);
    expect(bucket.take()).toBe(0);
  });

  it("refills no further than the burst", () => {
    const { clock, advance } = fakeClock();
    const bucket = new TokenBucket({ rate: 5, burst: 2 }, clock.now);
    advance(60_000);
    expect([bucket.take(), bucket.take(), bucket.take()]).toEqual([0, 0, 200]);
  });

  it("starts over from empty when drained", () => {
    const { clock } = fakeClock();
    const bucket = new TokenBucket({ rate: 5, burst: 10 }, clock.now);
    bucket.drain();
    expect(bucket.take()).toBe(200);
  });
});

describe("rate limiter", () => {
  it("keeps one bucket per seller and operation", async () => {
    const { clock, sleeps } = fakeClock();
    const limiter = createRateLimiter(clock);
    const limit = { rate: 5, burst: 1 };
    await limiter.acquire("A1SELLER000001", "getListingsItem", limit);
    await limiter.acquire("A1SELLER000002", "getListingsItem", limit);
    await limiter.acquire("A1SELLER000001", "patchListingsItem", limit);
    expect(sleeps).toEqual([]);
    await limiter.acquire("A1SELLER000001", "getListingsItem", limit);
    expect(sleeps).toEqual([200]);
  });
});

describe("backoff", () => {
  it("doubles each retry, with jitter, up to the cap", () => {
    expect([0, 1, 2, 3].map((retry) => backoffDelay(retry, DEFAULT_RETRY, () => 1))).toEqual([1_000, 2_000, 4_000, 8_000]);
    expect([0, 1, 2, 3].map((retry) => backoffDelay(retry, DEFAULT_RETRY, () => 0))).toEqual([500, 1_000, 2_000, 4_000]);
    expect(backoffDelay(10, DEFAULT_RETRY, () => 1)).toBe(30_000);
  });
});
