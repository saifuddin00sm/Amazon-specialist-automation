import { LWA_TOKEN_URL } from "./endpoints";
import type { AmazonRequestLog, Fetch } from "./http";
import type { Clock } from "./rate-limit";

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

export function recordingLogger() {
  const entries: AmazonRequestLog[] = [];
  return { entries, logger: (entry: AmazonRequestLog) => void entries.push(entry) };
}
