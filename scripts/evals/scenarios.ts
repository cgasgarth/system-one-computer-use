import type { DecisionInput } from "../../src/models/system-one.ts";
import type { Observation, Window } from "../../src/agent/contracts.ts";
import { options } from "../../src/agent/options.ts";

interface Scenario {
  readonly name: string;
  readonly input: DecisionInput;
  readonly complete: boolean;
}
interface ScenarioState {
  readonly name: string;
  readonly task: string;
  readonly title: string;
  readonly content: string;
  readonly complete: boolean;
  readonly draft?: boolean;
  readonly url?: string;
  readonly context?: string;
  readonly feedback?: string;
}
function scenario(state: ScenarioState): Scenario {
  const mode = state.url === undefined ? "desktop" : "browser";
  const window: Window = {
    app_name: mode === "browser" ? "Google Chrome" : "Document Editor",
    pid: 1,
    window_id: 1,
    snapshot_id: "fixture",
    window_title: state.title,
    ...(state.url === undefined ? {} : { url: state.url }),
    elements: [
      { element_index: 1, element_token: "content", role: "AXStaticText", label: state.content },
      {
        element_index: 2,
        element_token: "search",
        role: "AXTextField",
        label: "Search",
        value: "",
        actions: ["AXSetValue"],
      },
      ...(state.draft === true
        ? [
            { element_index: 3, element_token: "dialog", role: "AXDialog", label: "New document" },
            {
              element_index: 4,
              element_token: "body",
              role: "AXTextArea",
              label: "Body",
              value: "hello",
              actions: ["AXSetValue"],
            },
            {
              element_index: 5,
              element_token: "save",
              role: "AXButton",
              label: "Save",
              actions: ["AXPress"],
            },
          ]
        : []),
    ],
  };
  const observation: Observation = {
    desktop: {
      apps: [{ name: window.app_name, pid: 1 }],
      windows: [{ app_name: window.app_name, pid: 1, window_id: 1, title: state.title }],
    },
    window,
  };
  return {
    name: state.name,
    complete: state.complete,
    input: {
      task: state.task,
      mode,
      observation,
      context: state.context ?? "",
      feedback: state.feedback ?? "",
      actions: options({ mode, observation, applications: ["Document Editor", "Google Chrome"] }),
    },
  };
}
const scenarios: readonly Scenario[] = [
  scenario({
    name: "blank-browser",
    task: "Open the Wikipedia article about Chicago",
    title: "New Tab",
    content: "",
    url: "about:blank",
    complete: false,
  }),
  scenario({
    name: "wrong-article",
    task: "Open the Wikipedia article about Chicago",
    title: "Boston - Wikipedia",
    content: "Boston is the capital of Massachusetts.",
    url: "https://en.wikipedia.org/wiki/Boston",
    complete: false,
  }),
  scenario({
    name: "correct-article",
    task: "Open the Wikipedia article about Chicago",
    title: "Chicago - Wikipedia",
    content: "Chicago is the most populous city in Illinois.",
    url: "https://en.wikipedia.org/wiki/Chicago",
    complete: true,
  }),
  scenario({
    name: "search-results-not-item",
    task: "Find and open the document called Winter Budget",
    title: "Document Editor",
    content: "Search results: Winter Budget, Summer Budget. No document selected.",
    complete: false,
  }),
  scenario({
    name: "document-open",
    task: "Find and open the document called Winter Budget",
    title: "Winter Budget",
    content: "Winter Budget. January expenses: 1200. February expenses: 1400.",
    complete: true,
  }),
  scenario({
    name: "unsaved-draft",
    task: "Create and save a document with the text hello",
    title: "New document",
    content: "Unsaved changes",
    draft: true,
    complete: false,
  }),
  scenario({
    name: "saved-document",
    task: "Create and save a document with the text hello",
    title: "hello",
    content: "hello. All changes saved.",
    feedback: "Recent tool results: Save returned. The current screen reports All changes saved.",
    complete: true,
  }),
  scenario({
    name: "followup-context",
    task: "Open that document again",
    title: "Document Editor",
    content: "No document selected.",
    context:
      "Previous request (historical context only): Find and open Winter Budget. Current request: Open that document again.",
    complete: false,
  }),
];

// Additional development checks. These are not a held-out accuracy benchmark.
const validationScenarios: readonly Scenario[] = [
  scenario({
    name: "wrong-city-weather",
    task: "Show the weather forecast for Seattle",
    title: "Weather",
    content: "Weather for Miami: 84 F and sunny",
    url: "https://example.org/weather/miami",
    complete: false,
  }),
  scenario({
    name: "correct-city-weather",
    task: "Show the weather forecast for Seattle",
    title: "Seattle weather forecast",
    content: "Seattle: today 58 F and rain, tomorrow 60 F and cloudy",
    url: "https://example.org/weather/seattle",
    complete: true,
  }),
  scenario({
    name: "wrong-amount",
    task: "Change the invoice amount to 450 and save it",
    title: "Invoice",
    content: "Amount: 400. Saved.",
    complete: false,
  }),
  scenario({
    name: "saved-amount",
    task: "Change the invoice amount to 450 and save it",
    title: "Invoice",
    content: "Amount: 450. Saved.",
    complete: true,
  }),
  scenario({
    name: "wrong-file-followup",
    task: "Open it again",
    title: "Spring Plan",
    content: "Spring Plan: garden maintenance",
    context:
      "Previous request (historical context only): Open Autumn Plan. Current request: Open it again.",
    complete: false,
  }),
  scenario({
    name: "correct-file-followup",
    task: "Open it again",
    title: "Autumn Plan",
    content: "Autumn Plan: harvest schedule",
    context:
      "Previous request (historical context only): Open Autumn Plan. Current request: Open it again.",
    complete: true,
  }),
  scenario({
    name: "open-editor-without-save",
    task: "Show the new document editor and leave it open without saving.",
    title: "New document",
    content: "Unsaved changes",
    draft: true,
    complete: true,
  }),
  scenario({
    name: "fill-draft-without-save",
    task: "Enter hello in the new document body and leave the draft unsaved.",
    title: "New document",
    content: "Unsaved changes",
    draft: true,
    complete: true,
  }),
];
export { scenarios, validationScenarios };
export type { Scenario };
