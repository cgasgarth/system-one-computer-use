import type { DecisionRequest } from "./system-one-schema.ts";

const MAX_REQUEST_BYTES = 7600;
const MAX_CONTEXT_CHARS = 3000;
const SHORTENED = "\n[Context shortened]\n";
const HALF = 2;
const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function boundedContext(sections: readonly string[], budget: number): string[] {
  const present = sections.filter((section) => section.length > 0);
  if (budget <= 0 || present.length === 0) {
    return [];
  }
  const allowance = Math.floor(budget / present.length);
  return present
    .map((section) => {
      const chars = [...segments.segment(section)].map((part) => part.segment);
      if (chars.length <= allowance) {
        return section;
      }
      if (allowance <= SHORTENED.length) {
        return "";
      }
      const head = Math.ceil((allowance - SHORTENED.length) / HALF);
      const tail = Math.floor((allowance - SHORTENED.length) / HALF);
      const end = tail === 0 ? "" : chars.slice(-tail).join("");
      return `${chars.slice(0, head).join("")}${SHORTENED}${end}`;
    })
    .filter(Boolean);
}

// Only summary context is reduced. Instructions and criteria stay intact.
function size(request: DecisionRequest): number {
  return Buffer.byteLength(JSON.stringify(request));
}

function budgetRequest(
  build: (contextChars: number) => DecisionRequest,
  maxBytes = MAX_REQUEST_BYTES,
): DecisionRequest {
  const full = build(MAX_CONTEXT_CHARS);
  if (size(full) <= maxBytes) {
    return full;
  }
  let result = build(0);
  if (size(result) > maxBytes) {
    throw new Error(
      "capacity_choices: The task instructions and choice descriptions exceed the request budget even without screen summaries or history. No task or choice was shortened.",
    );
  }
  let low = 0;
  let high = MAX_CONTEXT_CHARS;
  while (low < high) {
    const middle = Math.ceil((low + high) / HALF);
    const candidate = build(middle);
    if (size(candidate) <= maxBytes) {
      result = candidate;
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

export { boundedContext, budgetRequest, MAX_REQUEST_BYTES };
