import { expect, test } from "bun:test";
import { verifyCommit } from "../src/models/commit-verification.ts";
import { desktopFixture } from "./fixtures.ts";
import type { Window } from "../src/agent/contracts.ts";
import type { BinaryAnswer } from "../src/models/system-one-schema.ts";

const yes: BinaryAnswer = { choice: "A0", probabilities: { A0: 0.98, A1: 0.02 } };
const no: BinaryAnswer = { choice: "A1", probabilities: { A0: 0.02, A1: 0.98 } };
const LOW_YES = 0.51;
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
  let authorizationState = "";
  const result = await verifyCommit({
    action,
    input: {
      task: "Set Name to Draft and save",
      observation: { desktop: desktopFixture(), window },
      actions: [action],
    },
    model: "test",
    async judge(request) {
      if (request.questions.next_action.instructions.startsWith("Should the assistant activate")) {
        authorizationState = request.state;
      }
      return request.questions.next_action.instructions.startsWith("Is a user-requested")
        ? no
        : yes;
    },
  });
  expect(result.allowed).toBe(true);
  expect(result.checks.at(-1)?.answer.choice).toBe("A1");
  expect(authorizationState).toContain("Current request: Set Name to Draft and save");
  expect(authorizationState).toContain('button "Save"');
  expect(authorizationState).toContain('current value "Draft"');
});
test("grounds a repeated Save check in the observed receipt and prior tool return", async () => {
  const savedWindow: Window = {
    ...window,
    url: "https://example.test/editor?saved=1",
    elements: [
      ...window.elements,
      { element_index: 2, element_token: "receipt", role: "status", value: "Draft saved." },
      {
        element_index: 3,
        element_token: "named-receipt",
        role: "status",
        label: "Saved to account",
        value: "",
      },
    ],
  };
  const result = await verifyCommit({
    action,
    input: {
      task: "Save the draft once",
      observation: { desktop: desktopFixture(), window: savedWindow },
      actions: [action],
      recentActions: [{ action, result: "returned" }],
    },
    model: "test",
    async judge(request, phase) {
      if (phase === "commit-authorization") {
        expect(request.state).toContain("https://example.test/editor?saved=1");
        expect(request.state).toContain("Draft saved.");
        expect(request.state).toContain("Saved to account");
        expect(request.state).toContain("Activate Save: tool returned; effect needs observation");
        return no;
      }
      return yes;
    },
  });
  expect(result.allowed).toBe(false);
  expect(result.checks.map((check) => check.phase)).toEqual([
    "commit-classification",
    "commit-authorization",
  ]);
});
test("permits a distinct requested second write after an observed Save", async () => {
  const publish = { ...action, element_token: "publish", reason: "Activate Publish" };
  const publishWindow: Window = {
    ...window,
    url: "https://example.test/editor?saved=1",
    elements: [
      ...window.elements,
      {
        element_index: 2,
        element_token: "publish",
        role: "button",
        label: "Publish",
        actions: ["AXPress"],
      },
      { element_index: 3, element_token: "receipt", role: "status", value: "Draft saved." },
    ],
  };
  const result = await verifyCommit({
    action: publish,
    input: {
      task: "Save the draft, then publish it",
      observation: { desktop: desktopFixture(), window: publishWindow },
      actions: [publish],
      recentActions: [{ action, result: "returned" }],
    },
    model: "test",
    async judge(_request, phase) {
      return phase === "field-readiness" ? no : yes;
    },
  });
  expect(result.allowed).toBe(true);
  expect(result.checks.at(-1)?.phase).toBe("field-readiness");
});

test("authorization binds duplicate Save controls to their observed rows", async () => {
  const rows: Window = {
    ...window,
    elements: [
      { element_index: 0, element_token: "row-roadmap", role: "row", label: "Roadmap" },
      {
        element_index: 1,
        parent_index: 0,
        element_token: "save-roadmap",
        role: "button",
        label: "Save",
        actions: ["AXPress"],
      },
      {
        element_index: 2,
        parent_index: 0,
        element_token: "name-roadmap",
        role: "textbox",
        label: "Name",
        value: "Draft",
        editable: true,
      },
      { element_index: 3, element_token: "row-release", role: "row", label: "Release" },
      {
        element_index: 4,
        parent_index: 3,
        element_token: "save-release",
        role: "button",
        label: "Save",
        actions: ["AXPress"],
      },
      {
        element_index: 5,
        parent_index: 3,
        element_token: "name-release",
        role: "textbox",
        label: "Name",
        value: "Existing",
        editable: true,
      },
    ],
  };
  let authorizationState = "";
  const fieldStates: string[] = [];
  const result = await verifyCommit({
    action: { ...action, element_token: "save-roadmap" },
    input: {
      task: "Save the Roadmap draft",
      observation: { desktop: desktopFixture(), window: rows },
      actions: [{ ...action, element_token: "save-roadmap" }],
    },
    model: "test",
    async judge(request, phase) {
      if (phase === "commit-authorization") {
        authorizationState = request.state;
      }
      if (phase === "field-readiness") {
        fieldStates.push(request.state);
      }
      return phase === "field-readiness" ? no : yes;
    },
  });
  expect(result.allowed).toBe(true);
  expect(authorizationState).toContain(
    'Proposed action: activate button "Save" inside row "Roadmap"',
  );
  expect(
    fieldStates.some((state) =>
      state.includes('textbox "Name"; observed context inside row "Roadmap"'),
    ),
  ).toBe(true);
  expect(
    fieldStates.some((state) =>
      state.includes('textbox "Name"; observed context inside row "Release"'),
    ),
  ).toBe(true);
});

test.each(["A0", "A1"] as const)(
  "uses categorical authorization and field-readiness answers (%s)",
  async (fieldChoice) => {
    const result = await verifyCommit({
      action,
      input: {
        task: "Set Name to Draft and save",
        observation: { desktop: desktopFixture(), window },
        actions: [action],
      },
      model: "test",
      async judge(_request, phase) {
        if (phase === "commit-classification") {
          return yes;
        }
        if (phase === "commit-authorization") {
          return { choice: "A0", probabilities: { A0: LOW_YES, A1: 1 - LOW_YES } };
        }
        return fieldChoice === "A0"
          ? { choice: "A0", probabilities: { A0: LOW_YES, A1: 1 - LOW_YES } }
          : { choice: "A1", probabilities: { A0: LOW_YES, A1: 1 - LOW_YES } };
      },
    });
    expect(result.allowed).toBe(fieldChoice === "A1");
    expect(result.checks.map((check) => check.phase)).toEqual([
      "commit-classification",
      "commit-authorization",
      "field-readiness",
    ]);
  },
);
