import { z } from "zod";
import { CodexControlsSession } from "../codex-controls/app-server.ts";
import type { ApprovalRelay } from "../codex-controls/protocol.ts";

const PREFIX = "S1DATA:";
const ERROR_CHARS = 300;
function decodeResult(encoded: string, title: string): unknown {
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as unknown;
  } catch {
    throw new Error(`Codex Chrome returned invalid JSON for ${title}. Observe the tab again.`);
  }
}
const CHROME_SETUP = `var { setupBrowserRuntime } = await import("/Applications/ChatGPT.app/Contents/Resources/plugins/openai-bundled/plugins/chrome/scripts/browser-client.mjs");
var s1Agent = await setupBrowserRuntime();
var s1Chrome = await s1Agent.browsers.get("chrome");
await s1Chrome.nameSession("System One");
var s1Tab;
nodeRepl.write(await s1Chrome.documentation());`;

interface ChromeWireOptions {
  readonly approval: ApprovalRelay;
  readonly session?: Pick<CodexControlsSession, "invoke" | "close">;
  readonly signal?: Readonly<AbortSignal>;
}

class ChromeWire {
  private readonly session: Pick<CodexControlsSession, "invoke" | "close">;
  private readonly owned: boolean;
  private readonly approval: ApprovalRelay;
  private readonly signal: Readonly<AbortSignal> | undefined;
  private booted = false;
  private booting: Promise<void> | undefined;

  public constructor(options: Readonly<ChromeWireOptions>) {
    this.session = options.session ?? new CodexControlsSession();
    this.owned = options.session === undefined;
    this.approval = options.approval;
    this.signal = options.signal;
  }

  private async call(code: string, title: string): Promise<string> {
    const result = await this.session.invoke({
      server: "node_repl",
      code,
      title,
      relay: this.approval,
      ...(this.signal === undefined ? {} : { signal: this.signal }),
    });
    const output = result.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    if (result.isError === true) {
      throw new TypeError(`Codex Chrome control failed: ${output.slice(0, ERROR_CHARS)}`);
    }
    return output;
  }

  public async ready(): Promise<void> {
    if (this.booted) {
      return;
    }
    this.booting ??= this.bootstrap();
    await this.booting;
  }

  private async bootstrap(): Promise<void> {
    try {
      await this.call(CHROME_SETUP, "Connect Chrome controls");
      this.booted = true;
    } finally {
      this.booting = undefined;
    }
  }

  public async read<Output>(
    code: string,
    schema: z.ZodType<Output>,
    title: string,
  ): Promise<Output> {
    await this.ready();
    const marker = `${PREFIX}${crypto.randomUUID()}:`;
    const wrapped = `nodeRepl.write(${JSON.stringify(marker)} + Buffer.from(JSON.stringify(await (async () => { ${code} })()), "utf8").toString("base64"));`;
    const output = await this.call(wrapped, title);
    const matches = [...output.matchAll(new RegExp(`${marker}(?<data>[A-Za-z0-9+/=]+)`, "gu"))];
    const encoded = matches[0]?.groups?.["data"];
    if (matches.length !== 1 || encoded === undefined) {
      throw new Error("Codex Chrome did not return structured data.");
    }
    const checked = schema.safeParse(decodeResult(encoded, title));
    if (!checked.success) {
      const [issue] = checked.error.issues;
      const field = issue?.path.join(".") ?? "response";
      throw new Error(
        `Codex Chrome returned invalid ${title} data at ${field}: ${issue?.message ?? "invalid value"}. Observe the tab again.`,
      );
    }
    return checked.data;
  }

  public async act(code: string, title: string): Promise<void> {
    await this.read(`${code}; return true;`, z.literal(true), title);
  }

  public async close(): Promise<void> {
    if (this.owned) {
      await this.session.close();
    }
  }
}

export { ChromeWire };
export type { ChromeWireOptions };
