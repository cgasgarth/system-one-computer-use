/* oxlint-disable typescript/prefer-readonly-parameter-types -- Injected SDK session methods own mutable transport state. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CodexControlsSession } from "./app-server.ts";
import type { CodexComputerOptions } from "./protocol.ts";

const ERROR_CHARS = 400;
const appSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().optional(),
  isRunning: z.boolean().optional(),
});
const appsSchema = z.array(appSchema);
const stateSchema = z.object({ text: z.string() });
type AppInfo = z.infer<typeof appSchema>;
type ToolSession = Readonly<Pick<CodexControlsSession, "invoke" | "close">>;
function decodeResult(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    throw new Error("Codex returned malformed native control data. Observe the app again.", {
      cause: error,
    });
  }
}

class NativeWire {
  private readonly session: ToolSession;
  private readonly options: Readonly<CodexComputerOptions>;
  private ready: Promise<readonly string[]> | undefined;

  public constructor(
    options: Readonly<CodexComputerOptions>,
    session: ToolSession = new CodexControlsSession(),
  ) {
    this.options = options;
    this.session = session;
  }

  private async setup(): Promise<void> {
    this.ready ??= this.invoke("await cua.getState();", "Read Codex computer inventory");
    await this.ready;
  }

  private async invoke(code: string, title: string): Promise<readonly string[]> {
    this.options.signal?.throwIfAborted();
    const result = await this.session.invoke({
      server: "cua_repl",
      code,
      title,
      ...(this.options.signal === undefined ? {} : { signal: this.options.signal }),
    });
    this.options.signal?.throwIfAborted();
    const texts = result.content.filter((item) => item.type === "text").map((item) => item.text);
    if (result.isError === true) {
      // oxlint-disable-next-line unicorn/prefer-type-error -- An upstream tool error is not a type error.
      throw new Error(`Codex computer control failed: ${texts.join(" ").slice(0, ERROR_CHARS)}`);
    }
    return texts;
  }

  private async json<Result>(
    expression: string,
    title: string,
    schema: z.ZodType<Result>,
  ): Promise<Result> {
    await this.setup();
    const marker = `SYSTEM_ONE:${randomUUID()}:`;
    const code = `nodeRepl.write(${JSON.stringify(marker)} + JSON.stringify(${expression}));`;
    const texts = await this.invoke(code, title);
    const matches = texts.flatMap((text) =>
      text.startsWith(marker) ? [text.slice(marker.length)] : [],
    );
    const [body] = matches;
    if (matches.length !== 1 || body === undefined) {
      throw new TypeError("Codex did not return one structured computer result.");
    }
    const parsed = schema.safeParse(decodeResult(body));
    if (!parsed.success) {
      throw new Error("Codex returned incomplete native control data. Observe the app again.", {
        cause: parsed.error,
      });
    }
    return parsed.data;
  }

  public async listApps(): Promise<readonly AppInfo[]> {
    return this.json("await cua.listApps({emit:false})", "List Codex native apps", appsSchema);
  }

  public async bindApp(appId: string): Promise<void> {
    await this.setup();
    await this.invoke(
      `var systemOneApp = await cua.getApp(${JSON.stringify(appId)});`,
      "Bind native app",
    );
  }

  public async readState(): Promise<string> {
    const result = await this.json(
      "{text:await systemOneApp.getAXState({emit:false,disableDiffing:true})}",
      "Read bound native app",
      stateSchema,
    );
    return result.text;
  }

  public async click(index: number): Promise<void> {
    await this.setup();
    await this.invoke(`await systemOneApp.click(${index});`, "Click observed native control");
  }

  public async setValue(index: number, value: string): Promise<void> {
    await this.setup();
    await this.invoke(
      `await systemOneApp.setValue(${index},${JSON.stringify(value)});`,
      "Set observed native field",
    );
  }

  public async pressKey(key: string): Promise<void> {
    await this.setup();
    await this.invoke(
      `await systemOneApp.pressKey(${JSON.stringify(key)});`,
      "Press key in bound native app",
    );
  }

  public async close(): Promise<void> {
    await this.session.close();
  }
}

export { NativeWire };
export type { AppInfo, ToolSession };
