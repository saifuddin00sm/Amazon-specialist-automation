import { LWA_TOKEN_URL } from "./endpoints";
import sandbox from "./fixtures/sandbox-responses.json";
import type { AmazonRequestLog, Fetch } from "./http";
import type { Clock } from "./rate-limit";

// Test support, for this package's tests and, as @app/amazon/testing, for code that calls Amazon.

/** A clock that only moves when slept on or advanced. */
export function fakeClock(start = Date.parse("2026-11-06T09:00:00.000Z")) {
  let at = start;
  const sleeps: number[] = [];
  const clock: Clock = {
    now: () => at,
    sleep: async (ms) => {
      sleeps.push(ms);
      at += ms;
    },
  };
  return { clock, sleeps, advance: (ms: number) => (at += ms) };
}

export type RecordedRequest = { url: URL; method: string; headers: Headers; body?: string };

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-amzn-RequestId": "request-1", ...headers } });
}

export const lwaTokenResponse = (accessToken = "Atza|access-1", refreshToken = "Atzr|refresh-1") =>
  json(200, { access_token: accessToken, refresh_token: refreshToken, token_type: "bearer", expires_in: 3600 });

/** A stand-in for Amazon: records every request and answers LWA, then `handler` for SP-API. */
export function fakeAmazon(handler: (request: RecordedRequest) => Response = () => json(200, {})) {
  const requests: RecordedRequest[] = [];
  const fetch: Fetch = async (input, init) => {
    const request: RecordedRequest = {
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    };
    requests.push(request);
    return request.url.href === LWA_TOKEN_URL ? lwaTokenResponse() : handler(request);
  };
  return { fetch, requests, spApiRequests: () => requests.filter((request) => request.url.href !== LWA_TOKEN_URL) };
}

/**
 * Answers like Amazon's sandbox: its own static examples, by operation. Like the sandbox, writes match
 * any body, and the restrictions example (a used condition) comes back for any ASIN.
 */
export function sandboxExamples(request: RecordedRequest): Response {
  const { pathname } = request.url;
  if (pathname.startsWith("/listings/2021-08-01/items/")) {
    const segments = pathname.split("/").length;
    if (segments === 5) return json(200, sandbox.searchListingsItems_200_0);
    const sku = decodeURIComponent(pathname.split("/").at(-1)!);
    if (sku === "BadSKU") return json(400, request.method === "GET" ? sandbox.getListingsItem_400_0 : sandbox.patchListingsItem_400_0);
    if (request.method === "PATCH" || request.method === "PUT") {
      const examples =
        request.method === "PATCH"
          ? [sandbox.patchListingsItem_200_0, sandbox.patchListingsItem_200_1, sandbox.patchListingsItem_200_2]
          : [sandbox.putListingsItem_200_0, sandbox.putListingsItem_200_1, sandbox.putListingsItem_200_2];
      if (sku === "VALIDATION_VALID") return json(200, examples[1]);
      if (sku === "VALIDATION_INVALID") return json(200, examples[2]);
      return json(200, examples[0]);
    }
    return json(200, sandbox.getListingsItem_200_0);
  }
  if (pathname === "/listings/2021-08-01/restrictions") return json(200, sandbox.getListingsRestrictions_200_0);
  if (pathname === "/definitions/2020-09-01/productTypes") return json(200, sandbox.searchDefinitionsProductTypes_200_0);
  if (pathname.startsWith("/definitions/2020-09-01/productTypes/")) return json(200, sandbox.getDefinitionsProductType_200_0);
  return json(404, { errors: [{ code: "NotFound", message: "No such operation" }] });
}

export function recordingLogger() {
  const entries: AmazonRequestLog[] = [];
  return { entries, logger: (entry: AmazonRequestLog) => void entries.push(entry) };
}
