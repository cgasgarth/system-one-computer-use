import { createInterface } from "node:readline/promises";
import type { ReadonlyDeep } from "type-fest";
import type { ApprovalRequest, ApprovalResult } from "../computer/codex-controls/protocol.ts";

async function terminalApproval(
  request: ReadonlyDeep<ApprovalRequest>,
  signal?: Readonly<AbortSignal>,
): Promise<ApprovalResult> {
  if (!process.stdin.isTTY || !process.stderr.isTTY || signal?.aborted === true) {
    return { action: "cancel" };
  }
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const question = `\n${request.message}\nAllow this control action? [y/N] `;
    const answer =
      signal === undefined
        ? await prompt.question(question)
        : await prompt.question(question, { signal });
    return ["y", "yes"].includes(answer.trim().toLowerCase())
      ? { action: "accept", content: {} }
      : { action: "decline" };
  } catch {
    return { action: "cancel" };
  } finally {
    prompt.close();
  }
}

export { terminalApproval };
