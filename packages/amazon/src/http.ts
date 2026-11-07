import { USER_AGENT } from "./user-agent";

/**
 * One line per request to Amazon. Deliberately no URL, seller id, SKU, body or token: the path
 * carries seller data, and none of that may reach the logs.
 */
export type AmazonRequestLog = {
  service: "lwa" | "sp-api";
  operation: string;
  method: string;
  /** Undefined when the request never got a response. */
  status?: number;
  /** 1 for the first try; higher after backing off from a 429. */
  attempt: number;
  durationMs: number;
  userAgent: string;
  /** Amazon's x-amzn-RequestId, for support cases. */
  requestId?: string;
};

export type AmazonLogger = (entry: AmazonRequestLog) => void;

export const consoleLogger: AmazonLogger = (entry) => console.info("[amazon]", JSON.stringify(entry));

export type Fetch = typeof globalThis.fetch;

export type AmazonRequest = {
  service: AmazonRequestLog["service"];
  operation: string;
  attempt: number;
  url: string;
  init: RequestInit & { method: string };
};

/** The only way this package reaches Amazon: sets the user agent on every request and logs it. */
export async function amazonFetch(request: AmazonRequest, fetch: Fetch, logger: AmazonLogger, now: () => number): Promise<Response> {
  const headers = new Headers(request.init.headers);
  headers.set("user-agent", USER_AGENT);
  const started = now();
  const entry = { service: request.service, operation: request.operation, method: request.init.method, attempt: request.attempt, userAgent: USER_AGENT };
  let response: Response;
  try {
    response = await fetch(request.url, { ...request.init, headers });
  } catch (error) {
    logger({ ...entry, durationMs: now() - started });
    throw error;
  }
  const requestId = response.headers.get("x-amzn-requestid") ?? undefined;
  logger({ ...entry, status: response.status, durationMs: now() - started, ...(requestId ? { requestId } : {}) });
  return response;
}
