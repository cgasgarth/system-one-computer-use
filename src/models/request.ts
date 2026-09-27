import type { z } from "zod";
import type { ReadonlyDeep } from "type-fest";
import { localEndpoint } from "./transport/endpoint.ts";
import { requestUnix } from "./transport/unix.ts";

const ERROR_DETAIL_LIMIT = 600;

interface JsonRequest<Body, Result> {
  readonly apiKey: string | undefined;
  readonly body: ReadonlyDeep<Body>;
  readonly endpoint: string;
  readonly label: string;
  readonly schema: z.ZodType<Result>;
  readonly timeoutMs: number;
  readonly signal?: Readonly<AbortSignal>;
}

async function requestJson<Body extends object, Result>(
  request: JsonRequest<Body, Result>,
): Promise<Result> {
  const timeout = AbortSignal.timeout(request.timeoutMs);
  const signal =
    request.signal === undefined ? timeout : AbortSignal.any([timeout, request.signal]);
  const local = localEndpoint(request.endpoint);
  if (local !== undefined) {
    return requestUnix({
      path: local.path,
      message: { role: local.role, body: request.body },
      schema: request.schema,
      signal,
    });
  }
  const headers = new Headers({ "content-type": "application/json" });
  if (request.apiKey !== undefined) {
    headers.set("authorization", `Bearer ${request.apiKey}`);
  }
  const response = await fetch(request.endpoint, {
    body: JSON.stringify(request.body),
    headers,
    method: "POST",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `${request.label} HTTP ${response.status}: ${detail.slice(0, ERROR_DETAIL_LIMIT)}`,
    );
  }
  return request.schema.parse(await response.json());
}

export { requestJson };
