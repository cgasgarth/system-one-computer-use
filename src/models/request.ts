import type { z } from "zod";
import type { ReadonlyDeep } from "type-fest";

const ERROR_DETAIL_LIMIT = 600;

interface JsonRequest<Body, Result> {
  readonly apiKey: string | undefined;
  readonly body: ReadonlyDeep<Body>;
  readonly endpoint: string;
  readonly label: string;
  readonly schema: z.ZodType<Result>;
  readonly timeoutMs: number;
}

async function requestJson<Body, Result>(request: JsonRequest<Body, Result>): Promise<Result> {
  const headers = new Headers({ "content-type": "application/json" });
  if (request.apiKey !== undefined) {
    headers.set("authorization", `Bearer ${request.apiKey}`);
  }
  const response = await fetch(request.endpoint, {
    body: JSON.stringify(request.body),
    headers,
    method: "POST",
    signal: AbortSignal.timeout(request.timeoutMs),
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
