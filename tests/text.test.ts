import { expect, test } from "bun:test";
import { ChatCompletionTextModel } from "../src/models/text.ts";
import { textRequestSchema, textResponseSchema } from "../src/models/text-schema.ts";
import { desktopFixture, windowFixture } from "./fixtures.ts";

const URL_TOKEN_BUDGET = 128;
const SEARCH_TOKEN_BUDGET = 256;
const DOCUMENT_TOKEN_BUDGET = 1024;

test("asks the text provider for field content with the task and session context", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = textRequestSchema.parse(await request.json());
      expect(body.model).toBe("writer");
      expect(body.max_tokens).toBe(DOCUMENT_TOKEN_BUDGET);
      expect(body.messages.at(-1)?.content).toContain("previous request");
      expect(body.messages.at(-1)?.content).toContain("Search");
      return Response.json({ choices: [{ message: { content: "Alex" }, finish_reason: "stop" }] });
    },
  });
  try {
    const model = new ChatCompletionTextModel(server.url.href, "writer");
    expect(
      await model.generate({
        task: "Find recent texts",
        context: "previous request",
        observation: { desktop: desktopFixture(), window: windowFixture() },
        purpose: "text",
        field: { kind: "general", role: "textbox", label: "Search", value: "" },
      }),
    ).toBe("Alex");
  } finally {
    await server.stop(true);
  }
});

test("asks for only an item query in an observed search field", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = textRequestSchema.parse(await request.json());
      expect(body.max_tokens).toBe(SEARCH_TOKEN_BUDGET);
      expect(body.messages[0]?.content).toContain("shortest search query");
      expect(body.messages[1]?.content).toContain("AXSearchField");
      return Response.json({
        choices: [{ message: { content: "Playback Test.mp4" }, finish_reason: "stop" }],
      });
    },
  });
  try {
    const model = new ChatCompletionTextModel(server.url.href, "writer");
    const result = await model.generate({
      task: "Open Playback Test.mp4 in a folder on my Desktop using the player",
      context: "",
      observation: { desktop: desktopFixture(), window: windowFixture() },
      purpose: "text",
      field: {
        kind: "search",
        role: "AXTextField",
        subrole: "AXSearchField",
        label: "search field",
        value: "",
      },
    });
    expect(result).toBe("Playback Test.mp4");
  } finally {
    await server.stop(true);
  }
});

test("a revised search sees the prior query and changed result scene", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = textRequestSchema.parse(await request.json());
      expect(body.messages[0]?.content).toContain("different, shorter distinctive part");
      expect(body.messages[1]?.content).toContain("Morgn Vale");
      expect(body.messages[1]?.content).toContain("No matching item");
      return Response.json({
        choices: [{ message: { content: "Vale" }, finish_reason: "stop" }],
      });
    },
  });
  try {
    const window = {
      ...windowFixture(),
      elements: [
        {
          element_index: 1,
          element_token: "search",
          role: "AXTextField",
          subrole: "AXSearchField",
          label: "Search",
          value: "Morgn Vale",
          editable: true,
        },
        {
          element_index: 2,
          element_token: "result",
          role: "AXStaticText",
          label: "No matching item",
        },
      ],
    };
    const model = new ChatCompletionTextModel(server.url.href, "writer");
    const result = await model.generate({
      task: "Find the recent conversation with Morgn Vale",
      context: "",
      observation: { desktop: desktopFixture(), window },
      purpose: "text",
      field: {
        kind: "search",
        role: "AXTextField",
        subrole: "AXSearchField",
        label: "Search",
        value: "Morgn Vale",
      },
    });
    expect(result).toBe("Vale");
  } finally {
    await server.stop(true);
  }
});

test("rejects truncated text before it can become input", () => {
  expect(() =>
    textResponseSchema.parse({
      choices: [{ message: { content: "unfinished" }, finish_reason: "length" }],
    }),
  ).toThrow("Text model response was incomplete");
});

test("supplies observed link destinations to the URL argument writer", async () => {
  const destination = "https://example.test/doc/opaque-72";
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = textRequestSchema.parse(await request.json());
      expect(body.messages.at(-1)?.content).toContain(destination);
      expect(body.max_tokens).toBe(URL_TOKEN_BUDGET);
      return Response.json({
        choices: [{ message: { content: destination }, finish_reason: "stop" }],
      });
    },
  });
  try {
    const window = windowFixture();
    const model = new ChatCompletionTextModel(server.url.href, "writer");
    const url = await model.generate({
      task: "Open the budget document",
      context: "",
      purpose: "url",
      observation: {
        desktop: desktopFixture(),
        window: {
          ...window,
          elements: [
            {
              element_index: 1,
              element_token: "link",
              role: "link",
              label: "Budget",
              href: destination,
              actions: ["AXPress"],
            },
          ],
        },
      },
    });
    expect(url).toBe(destination);
  } finally {
    await server.stop(true);
  }
});
