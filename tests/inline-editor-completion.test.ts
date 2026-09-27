import { expect, test } from "bun:test";
import { SystemOneHttpDecisionModel } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";
import { desktopFixture, windowFixture } from "./fixtures.ts";

const COMPLETE_CONFIDENCE = 0.95;
const COMMIT_CONFIDENCE = 0.95;

function response(choice: "A0" | "A1", yesProbability: number): Response {
  return Response.json({
    answers: {
      next_action: {
        choice,
        probabilities: { A0: yesProbability, A1: 1 - yesProbability },
      },
    },
  });
}

async function decide(
  task: string,
  persistentResultMissing: boolean,
  options: { readonly commitConfidence?: number; readonly saved?: boolean } = {},
): Promise<{
  readonly kind: string;
  readonly commitChoice: string | undefined;
  readonly commitChecked: boolean;
}> {
  let commitChecked = false;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const instruction = body.questions.next_action.instructions;
      if (instruction.startsWith("Has this user request")) {
        return response("A0", COMPLETE_CONFIDENCE);
      }
      if (instruction.startsWith("Is a requested persistent result")) {
        commitChecked = true;
        const confidence = options.commitConfidence ?? COMMIT_CONFIDENCE;
        return persistentResultMissing
          ? response("A0", confidence)
          : response("A1", 1 - confidence);
      }
      return response("A0", 1);
    },
  });
  try {
    const window = {
      ...windowFixture(),
      window_title: "Inline editor",
      elements: [
        {
          element_index: 1,
          element_token: "text",
          role: "textbox",
          label: "Document text",
          value: "New text",
          editable: true,
        },
        ...(options.saved === true
          ? [{ element_index: 2, element_token: "saved", role: "heading", label: "Saved" }]
          : []),
      ],
    };
    const result = await new SystemOneHttpDecisionModel(server.url.href, "test").choose({
      task,
      observation: { desktop: desktopFixture(), window },
      actions: [
        {
          kind: "press_key",
          pid: window.pid,
          window_id: window.window_id,
          key: "tab",
          modifiers: [],
          reason: "Press tab",
        },
        { kind: "finish", reason: "Finish", summary: "Done" },
        { kind: "blocked", reason: "Stop" },
      ],
    });
    return {
      kind: result.action.kind,
      commitChoice: result.completionCommit?.choice,
      commitChecked,
    };
  } finally {
    await server.stop(true);
  }
}

test("a filled inline editor cannot finish before its requested save is observed", async () => {
  const result = await decide("Change the document text to New text and save it", true);
  expect(result.kind).toBe("press_key");
  expect(result.commitChoice).toBe("A0");
  expect(result.commitChecked).toBe(true);
});

test("a selected pending-result Yes blocks Finish even at modest confidence", async () => {
  const result = await decide("Change the document text to New text and save it", true, {
    commitConfidence: 0.55,
  });
  expect(result.kind).toBe("press_key");
  expect(result.commitChoice).toBe("A0");
});

test("an observed saved inline result accepts a selected No without a secondary score floor", async () => {
  const result = await decide("Change the document text to New text and save it", false, {
    commitConfidence: 0.5706,
    saved: true,
  });
  expect(result.kind).toBe("finish");
  expect(result.commitChoice).toBe("A1");
});

test.each([
  "Show the document text without changing it",
  "Enter New text in the draft and leave it unsaved",
])("a view or unsaved draft can finish with an editable field (%s)", async (task) => {
  const result = await decide(task, false);
  expect(result.kind).toBe("finish");
  expect(result.commitChoice).toBe("A1");
  expect(result.commitChecked).toBe(true);
});
