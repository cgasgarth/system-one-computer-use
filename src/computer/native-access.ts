import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { ReadonlyDeep } from "type-fest";
import { windowSchema } from "../agent/contracts.ts";
import type { Window } from "../agent/contracts.ts";
import { CuaError } from "./errors.ts";

const DEFAULT_NATIVE_ACCESS = path.join(
  os.homedir(),
  "Applications",
  "System One Computer Use.app",
  "Contents",
  "MacOS",
  "NativeAccess",
);
const TIMEOUT_MS = 5000;
const ERROR_CHARS = 400;
const MAX_LABEL_LENGTH = 200;
const eventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("ready") }),
  z.object({ event: z.enum(["available", "created", "unavailable", "timeout"]) }),
  z.object({ event: z.literal("error"), message: z.string() }),
]);
type NativeEvent = z.infer<typeof eventSchema>;
type EndEvent = Exclude<NativeEvent, { event: "ready" }>;
const fieldsSchema = z.object({
  complete: z.boolean(),
  fields: z.array(
    z.object({
      role: z.enum(["AXTextArea", "AXTextField", "AXComboBox"]),
      frame: windowSchema.shape.elements.element.shape.frame.unwrap(),
      editable: z.boolean(),
      subrole: z.string().optional(),
      value: z.string().optional(),
      placeholder: z.string().optional(),
      focused: z.boolean().optional(),
    }),
  ),
  labels: z.array(
    z.object({
      role: z.enum(["AXRow", "AXCell"]),
      frame: windowSchema.shape.elements.element.shape.frame.unwrap(),
      label: z.string().min(1).max(MAX_LABEL_LENGTH),
    }),
  ),
});
const menuReportSchema = z.strictObject({
  pid: z.number().int().positive(),
  menus: windowSchema.shape.menus.unwrap(),
});
const documentSchema = z.strictObject({ url: z.url().optional() });
interface WindowWait {
  readonly binary: string;
  readonly application: string;
  readonly mode: "available" | "created";
  readonly act: () => Promise<void>;
}

async function waitForNativeWindow(input: WindowWait): Promise<void> {
  const child = Bun.spawn([input.binary, "watch", input.application, input.mode], {
    stdout: "pipe",
    stderr: "ignore",
    timeout: TIMEOUT_MS,
  });
  const ready = Promise.withResolvers<NativeEvent>();
  const ended = Promise.withResolvers<EndEvent>();
  const accept = (event: NativeEvent): void => {
    ready.resolve(event);
    if (event.event !== "ready") {
      ended.resolve(event);
    }
  };
  const reading = (async (): Promise<void> => {
    let buffer = "";
    try {
      for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
        buffer += chunk;
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          accept(eventSchema.parse(JSON.parse(buffer.slice(0, newline))));
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
        }
      }
      accept({
        event: "error",
        message: "The native window observer stopped before reporting a result.",
      });
    } catch (error) {
      accept({
        event: "error",
        message: error instanceof Error ? error.message : "Native window observation failed.",
      });
    }
  })();
  try {
    const start = await ready.promise;
    if (start.event === "error") {
      throw new CuaError(start.message);
    }
    await input.act();
    const result = await ended.promise;
    if (result.event === "error") {
      throw new CuaError(result.message);
    }
  } finally {
    child.kill();
    await child.exited;
    await reading;
  }
}

async function readWritableFields(
  binary: string,
  window: Window,
): Promise<ReadonlyDeep<z.infer<typeof fieldsSchema>>> {
  const root = window.elements.find((element) => element.role === "AXWindow")?.frame;
  if (root === undefined) {
    throw new CuaError("The window bounds are unavailable for checking text input.");
  }
  const child = Bun.spawn([binary, "fields", String(window.pid), JSON.stringify(root)], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: TIMEOUT_MS,
  });
  const [code, output, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) {
    throw new CuaError(
      error.trim().slice(0, ERROR_CHARS) || "Could not inspect native text inputs.",
    );
  }
  return fieldsSchema.parse(JSON.parse(output));
}

async function readNativeMenus(binary: string, pid: number): Promise<NonNullable<Window["menus"]>> {
  const child = Bun.spawn([binary, "menus", String(pid)], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: TIMEOUT_MS,
  });
  const [code, output, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) {
    throw new CuaError(error.trim().slice(0, ERROR_CHARS) || "Could not inspect native menus.");
  }
  const report = menuReportSchema.parse(JSON.parse(output));
  if (report.pid !== pid) {
    throw new CuaError("Native menu inspection returned another application.");
  }
  return report.menus;
}

async function readNativeDocument(binary: string, window: Window): Promise<string | undefined> {
  const root = window.elements.find((element) => element.role === "AXWindow")?.frame;
  if (root === undefined) {
    throw new CuaError("The window bounds are unavailable for checking its document URL.");
  }
  const child = Bun.spawn([binary, "document", String(window.pid), JSON.stringify(root)], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: TIMEOUT_MS,
  });
  const [code, output, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) {
    throw new CuaError(
      error.trim().slice(0, ERROR_CHARS) || "Could not inspect native document URL.",
    );
  }
  return documentSchema.parse(JSON.parse(output)).url;
}

export {
  DEFAULT_NATIVE_ACCESS,
  readNativeDocument,
  readNativeMenus,
  readWritableFields,
  waitForNativeWindow,
};
