import { z } from "zod";

const webUrlSchema = z.url({ protocol: /^https?$/u });
const WRAPPERS = [
  ['"', '"'],
  ["'", "'"],
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["<", ">"],
] as const;

function unwrap(candidate: string): string | undefined {
  const wrapper = WRAPPERS.find(
    ([open, close]) => candidate.startsWith(open) && candidate.endsWith(close),
  );
  return wrapper === undefined ? undefined : candidate.slice(wrapper[0].length, -wrapper[1].length);
}
function tokenUrl(token: string): string | undefined {
  let candidate = token;
  for (;;) {
    const parsed = webUrlSchema.safeParse(candidate);
    if (parsed.success) {
      return new URL(parsed.data).href;
    }
    const unwrapped = unwrap(candidate);
    if (unwrapped === undefined) {
      return undefined;
    }
    candidate = unwrapped;
  }
}
function normalizedHttpUrl(value: string): string | undefined {
  const parsed = webUrlSchema.safeParse(value);
  return parsed.success ? new URL(parsed.data).href : undefined;
}

function taskUrls(task: string): readonly string[] {
  return [
    ...new Set(
      task.split(/\s+/u).flatMap((token) => {
        const url = tokenUrl(token);
        return url === undefined ? [] : [url];
      }),
    ),
  ];
}

export { normalizedHttpUrl, taskUrls };
