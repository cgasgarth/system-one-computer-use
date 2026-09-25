import { expect, test } from "bun:test";
import type { Client } from "@modelcontextprotocol/client";
import { z } from "zod";
import { CuaConnection } from "../src/computer/connection.ts";
import { desktopFixture, expectFailure, windowFixture } from "./fixtures.ts";

type CuaClient = Readonly<Pick<Client, "connect" | "callTool" | "close">>;
interface Fixture {
  readonly client: CuaClient;
  readonly calls: readonly string[];
  readonly expire: () => void;
}
const sessionArgument = z.object({ session: z.string().optional() });
const SESSION_COUNT = 2;
function fixture(): Fixture {
  const calls: string[] = [];
  const active = new Set<string>();
  const client: CuaClient = {
    async connect() {
      calls.push("connect");
    },
    async close() {
      calls.push("close");
    },
    async callTool(request) {
      const { session = "transport" } = sessionArgument.parse(request.arguments ?? {});
      calls.push(request.name);
      if (request.name === "start_session") {
        active.add(session);
        return { content: [], structuredContent: { active: true, session } };
      }
      if (request.name === "end_session") {
        active.delete(session);
        return { content: [], structuredContent: { active: false, session } };
      }
      if (!active.has(session)) {
        return { isError: true, content: [{ type: "text", text: "The CUA session has ended" }] };
      }
      switch (request.name) {
        case "set_agent_cursor_enabled": {
          return { content: [], structuredContent: { session, enabled: false } };
        }
        case "get_accessibility_tree": {
          return { content: [], structuredContent: desktopFixture() };
        }
        case "list_windows": {
          return {
            content: [],
            structuredContent: {
              windows: [
                { app_name: "Messages", pid: 7, window_id: 9, title: "Messages", layer: 0 },
              ],
            },
          };
        }
        case "get_window_state": {
          return { content: [], structuredContent: windowFixture() };
        }
        case "bring_to_front": {
          return { content: [], structuredContent: { status: "ok" } };
        }
        default: {
          throw new Error(`Unexpected test tool ${request.name}`);
        }
      }
    },
  };
  return {
    client,
    calls,
    expire() {
      active.clear();
    },
  };
}

test("starts discovery and input sessions once before concurrent reads", async () => {
  const state = fixture();
  const connection = new CuaConnection("unused-test-driver", state.client);
  try {
    const reads = await Promise.all([connection.desktop(), connection.desktop()]);
    expect(reads.map((read) => read.apps)).toEqual([desktopFixture().apps, desktopFixture().apps]);
    expect(state.calls.slice(0, SESSION_COUNT + SESSION_COUNT)).toEqual([
      "connect",
      "start_session",
      "start_session",
      "set_agent_cursor_enabled",
    ]);
    const target = windowFixture();
    const window = await connection.window(target.pid, target.window_id);
    expect(window).toEqual(windowFixture());
    expect(state.calls.filter((name) => name === "start_session")).toHaveLength(SESSION_COUNT);
  } finally {
    await connection.close();
  }
  expect(state.calls.slice(-SESSION_COUNT - 1)).toEqual(["end_session", "end_session", "close"]);
});

test("does not revive a stopped run and starts a fresh connection for the next task", async () => {
  const stopped = fixture();
  const first = new CuaConnection("unused-test-driver", stopped.client);
  await first.desktop();
  stopped.expire();
  await expectFailure(first.desktop(), "session has ended");
  expect(stopped.calls.filter((name) => name === "start_session")).toHaveLength(SESSION_COUNT);
  await first.close();
  const next = fixture();
  const second = new CuaConnection("unused-test-driver", next.client);
  try {
    const desktop = await second.desktop();
    expect(desktop.apps).toEqual(desktopFixture().apps);
  } finally {
    await second.close();
  }
  expect(next.calls.filter((name) => name === "start_session")).toHaveLength(SESSION_COUNT);
});
