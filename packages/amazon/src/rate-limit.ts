/** Time, injectable so tests don't wait. */
export type Clock = { now(): number; sleep(ms: number): Promise<void> };

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Amazon's usage plan for an operation: a steady rate (requests per second) and a burst. */
export type RateLimit = { rate: number; burst: number };

/** Starts full, refills `rate` tokens a second up to `burst`. */
export class TokenBucket {
  private tokens: number;
  private refilledAt: number;

  constructor(
    private readonly limit: RateLimit,
    private readonly now: () => number,
  ) {
    this.tokens = limit.burst;
    this.refilledAt = now();
  }

  /** Takes a token and returns 0, or returns how many milliseconds until one is free. */
  take(): number {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }
    return Math.ceil(((1 - this.tokens) / this.limit.rate) * 1000);
  }

  /** Empties the bucket, after Amazon throttled us anyway. */
  drain(): void {
    this.refill();
    this.tokens = Math.min(this.tokens, 0);
  }

  private refill(): void {
    const at = this.now();
    this.tokens = Math.min(this.limit.burst, this.tokens + ((at - this.refilledAt) / 1000) * this.limit.rate);
    this.refilledAt = at;
  }
}

/** One token bucket per seller and operation, as Amazon counts them. */
export type RateLimiter = {
  acquire(sellerId: string, operation: string, limit: RateLimit): Promise<void>;
  drain(sellerId: string, operation: string): void;
};

export function createRateLimiter(clock: Clock = systemClock): RateLimiter {
  const buckets = new Map<string, TokenBucket>();
  const keyOf = (sellerId: string, operation: string) => `${sellerId}:${operation}`;
  return {
    async acquire(sellerId, operation, limit) {
      const key = keyOf(sellerId, operation);
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, (bucket = new TokenBucket(limit, () => clock.now())));
      for (let wait = bucket.take(); wait > 0; wait = bucket.take()) await clock.sleep(wait);
    },
    drain(sellerId, operation) {
      buckets.get(keyOf(sellerId, operation))?.drain();
    },
  };
}

export type RetryOptions = { maxRetries: number; baseDelayMs: number; maxDelayMs: number };

export const DEFAULT_RETRY: RetryOptions = { maxRetries: 5, baseDelayMs: 1_000, maxDelayMs: 30_000 };

/**
 * Exponential backoff with jitter: between half and all of base × 2^retry, capped, so callers
 * throttled together don't retry together. `retry` counts from 0.
 */
export function backoffDelay(retry: number, options: RetryOptions, random: () => number = Math.random): number {
  const ceiling = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** retry);
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}
