import { z } from "zod";
import { amazonEnvironment, spApiEndpoint, type AmazonEnvironment, type SpApiRegion } from "./endpoints";
import { amazonFetch, consoleLogger, type AmazonLogger, type Fetch } from "./http";
import type { AccessTokenProvider } from "./lwa";
import { backoffDelay, createRateLimiter, DEFAULT_RETRY, systemClock, type Clock, type RateLimit, type RateLimiter, type RetryOptions } from "./rate-limit";

export const SpApiErrorDetailSchema = z.object({ code: z.string(), message: z.string(), details: z.string().optional() });
export type SpApiErrorDetail = z.infer<typeof SpApiErrorDetailSchema>;

const ErrorListSchema = z.object({ errors: z.array(SpApiErrorDetailSchema) });

/** Amazon answered with an error, or with something this client couldn't read. */
export class SpApiError extends Error {
  override name = "SpApiError";
  constructor(
    readonly operation: string,
    readonly status: number,
    readonly errors: SpApiErrorDetail[],
    readonly requestId?: string,
  ) {
    const first = errors[0];
    super(`${operation} failed with ${status}${first ? `: ${first.code}: ${first.message}` : ""}`);
  }
}

type QueryValue = string | number | boolean | readonly string[] | undefined;

/** One SP-API call, described by an operation module. */
export type SpApiCall<T> = {
  operation: string;
  rateLimit: RateLimit;
  /** Whose access token signs the call, and whose bucket it draws from. */
  sellerId: string;
  method: "GET" | "PATCH";
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  schema: z.ZodType<T>;
};

export type SpApiRequest = <T>(call: SpApiCall<T>) => Promise<T>;

export type SpApiClientOptions = {
  region: SpApiRegion;
  accessTokens: AccessTokenProvider;
  /** Defaults to the sandbox unless AMAZON_ENV=production. */
  environment?: AmazonEnvironment;
  fetch?: Fetch;
  logger?: AmazonLogger;
  clock?: Clock;
  /** Shared across clients so every caller for a seller draws from the same buckets. */
  limiter?: RateLimiter;
  retry?: Partial<RetryOptions>;
  /** Jitter source for backoff; tests pin it. */
  random?: () => number;
};

/** Arrays go comma-separated, as SP-API expects. */
function queryString(query: Record<string, QueryValue> = {}): string {
  const parts = Object.entries(query).flatMap(([name, value]) => {
    if (value === undefined) return [];
    const values = typeof value === "object" ? value : [String(value)];
    return [`${encodeURIComponent(name)}=${values.map(encodeURIComponent).join(",")}`];
  });
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

/**
 * Sends calls the way Amazon wants them: a token from the seller's bucket first, their access
 * token, the app's user agent (set by amazonFetch), and backoff on 429 until the retries run out.
 */
export function createSpApiRequest(options: SpApiClientOptions): SpApiRequest {
  const {
    region,
    accessTokens,
    environment = amazonEnvironment(),
    fetch = globalThis.fetch,
    logger = consoleLogger,
    clock = systemClock,
    random = Math.random,
  } = options;
  const limiter = options.limiter ?? createRateLimiter(clock);
  const retry = { ...DEFAULT_RETRY, ...options.retry };
  const endpoint = spApiEndpoint(region, environment);

  return async function request<T>(call: SpApiCall<T>): Promise<T> {
    const url = `${endpoint}${call.path}${queryString(call.query)}`;
    for (let attempt = 1; ; attempt += 1) {
      await limiter.acquire(call.sellerId, call.operation, call.rateLimit);
      const accessToken = await accessTokens.get(call.sellerId);
      const response = await amazonFetch(
        {
          service: "sp-api",
          operation: call.operation,
          attempt,
          url,
          init: {
            method: call.method,
            headers: {
              "x-amz-access-token": accessToken,
              accept: "application/json",
              ...(call.body === undefined ? {} : { "content-type": "application/json" }),
            },
            ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
          },
        },
        fetch,
        logger,
        () => clock.now(),
      );
      const requestId = response.headers.get("x-amzn-requestid") ?? undefined;

      if (response.status === 429 && attempt <= retry.maxRetries) {
        await response.body?.cancel();
        // Amazon's count of our calls disagrees with the bucket's; start this one from empty.
        limiter.drain(call.sellerId, call.operation);
        await clock.sleep(backoffDelay(attempt - 1, retry, random));
        continue;
      }

      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) accessTokens.invalidate(call.sellerId);
        const errors = ErrorListSchema.safeParse(payload);
        throw new SpApiError(call.operation, response.status, errors.success ? errors.data.errors : [], requestId);
      }
      const parsed = call.schema.safeParse(payload);
      if (!parsed.success) {
        throw new SpApiError(call.operation, response.status, [{ code: "UnexpectedResponse", message: z.prettifyError(parsed.error) }], requestId);
      }
      return parsed.data;
    }
  };
}
