import { expect, test } from "bun:test";
import { verifyCommit } from "../src/models/commit-verification.ts";
import { desktopFixture } from "./fixtures.ts";
import type { Window } from "../src/agent/contracts.ts";
import type { BinaryAnswer } from "../src/models/system-one-schema.ts";

const yes: BinaryAnswer = { choice: "A0", probabilities: { A0: 0.98, A1: 0.02 } };
const no: BinaryAnswer = { choice: "A1", probabilities: { A0: 0.02, A1: 0.98 } };
const window: Window = {
  app_name: "Google Chrome",
  pid: 0,
  window_id: 0,
  window_title: "Editor",
  snapshot_id: "s1",
  elements: [
    {
      element_index: 0,
      element_token: "field",
      role: "textbox",
      label: "Name",
      value: "Draft",
      editable: true,
    },
    {
      element_index: 1,
      element_token: "save",
      role: "button",
      label: "Save",
      actions: ["AXPress"],
    },
  ],
};
const action = {
  kind: "click_element",
  pid: 0,
  window_id: 0,
  element_token: "save",
  reason: "Activate Save",
} as const;

test("rejects a persistent click when a task asks to leave a draft open", async () => {
  const instructions: string[] = [];
  const result = await verifyCommit({
    action,
    input: {
      task: "Leave the draft open without saving",
      observation: { desktop: desktopFixture(), window },
      actions: [action],
    },
    model: "test",
    async judge(request) {
      instructions.push(request.questions.next_action.instructions);
      return instructions.length === 1 ? yes : no;
    },
  });
  expect(result.allowed).toBe(false);
  expect(result.checks.map((check) => check.phase)).toEqual([
    "commit-classification",
    "commit-authorization",
  ]);
});

test("form submit semantics override a model that would call Save nonpersistent", async () => {
  let questions = 0;
  const result = await verifyCommit({
    action,
    input: {
      task: "Open the editor and leave it unsaved",
      observation: { desktop: desktopFixture(), window },
      actions: [action],
      async inspectClick() {
        return { kind: "form_submit" };
      },
    },
    model: "test",
    async judge() {
      questions += 1;
      return no;
    },
  });
  expect(result.allowed).toBe(false);
  expect(questions).toBe(1);
  expect(result.checks[0]).toMatchObject({ phase: "form-semantics", source: "dom" });
});

test("rejects Save while a requested field change is missing", async () => {
  const result = await verifyCommit({
    action,
    input: {
      task: "Change Name to Final and save",
      observation: { desktop: desktopFixture(), window },
      actions: [action],
    },
    model: "test",
    async judge() {
      return yes;
    },
  });
  expect(result.allowed).toBe(false);
  expect(result.checks.at(-1)?.phase).toBe("field-readiness");
});

test("allows Save after a requested field change is observed", async () => {
  const result = await verifyCommit({
    action,
    input: {
      task: "Set Name to Draft and save",
      observation: { desktop: desktopFixture(), window },
      actions: [action],
    },
    model: "test",
    async judge(request) {
      return request.questions.next_action.instructions.startsWith("Is a user-requested")
        ? no
        : yes;
    },
  });
  expect(result.allowed).toBe(true);
  expect(result.checks.at(-1)?.answer.choice).toBe("A1");
});
