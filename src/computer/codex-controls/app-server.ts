/* oxlint-disable typescript/prefer-readonly-parameter-types -- SDK and AbortSignal types are mutable external contracts. */
/* oxlint-disable promise/avoid-new -- JSON-RPC replies resolve from the child stdout event. */
/* oxlint-disable unicorn/no-null -- The upstream approval protocol uses JSON null on cancellation. */
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Interface } from "node:readline";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { endNativeTurn } from "./turn-end.ts";
import { controlConfigOverrides } from "./config-scope.ts";
import {
  approvalRequestSchema,
  rpcMessageSchema,
  startedSchema,
  toolResultSchema,
} from "./protocol.ts";
import type { RpcMessage } from "./protocol.ts";

const CODEX_CLI =
  "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
const RPC_TIMEOUT_MS = 30_000;
const EXIT_TIMEOUT_MS = 2000;
const MAX_LINE_LENGTH = 25_165_824;
const BLOCKED_ENV = /CODEX|CUA|SKY|BROWSER|MCP|NODE_REPL/iu;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout> | undefined;
  method: string;
  releaseAbort?: () => void;
}
type InvokeRequest = Readonly<{
  server: "cua_repl" | "node_repl";
  code: string;
  title: string;
  signal?: AbortSignal | undefined;
}>;
interface AppServerOptions {
  executable?: string;
  environment?: Readonly<NodeJS.ProcessEnv>;
  timeoutMs?: number;
  configPath?: string;
  notifyNativeTurn?: (threadId: string, turnId: string) => Promise<void>;
}

function parseResponse(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

class CodexControlsSession {
  private readonly options: Readonly<AppServerOptions>;
  private child: ChildProcessWithoutNullStreams | undefined;
  private lines: Interface | undefined;
  private directory: string | undefined;
  private threadId: string | undefined;
  private operationId = crypto.randomUUID();
  private sequence = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly usedServers = new Set<"cua_repl" | "node_repl">();
  private active = false;
  private closed = false;
  private closing: Promise<void> | undefined;
  private booting: Promise<void> | undefined;

  public constructor(options: Readonly<AppServerOptions> = {}) {
    this.options = options;
  }

  public async start(): Promise<void> {
    if (this.closed) {
      throw new Error("Controls session is closed");
    }
    if (this.threadId !== undefined) {
      return;
    }
    this.booting ??= this.startProcess();
    await this.booting;
  }

  private async startProcess(): Promise<void> {
    const configOverrides = await controlConfigOverrides(this.options.configPath);
    this.directory = await mkdtemp(path.join(tmpdir(), "system-one-codex-controls-"));
    if (this.closed) {
      await rm(this.directory, { recursive: true, force: true });
      throw new Error("Controls session was cancelled during setup");
    }
    const environment = Object.fromEntries(
      Object.entries(this.options.environment ?? Bun.env).filter(([key]) => !BLOCKED_ENV.test(key)),
    );
    const child = spawn(
      this.options.executable ?? CODEX_CLI,
      ["app-server", "--listen", "stdio://", ...configOverrides],
      {
        cwd: this.directory,
        env: environment,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child = child;
    child.stderr.resume();
    child.once("error", (error) => {
      this.failAll(error);
    });
    child.once("exit", () => {
      this.failAll(new Error("Codex controls process exited"));
    });
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", (line) => {
      this.receive(line);
    });
    try {
      await this.request("initialize", {
        clientInfo: { name: "system-one-codex-controls", version: "0.1.0" },
        capabilities: { experimentalApi: true, mcpServerOpenaiFormElicitation: true },
      });
      this.send({ method: "initialized" });
      const started = startedSchema.parse(
        await this.request("thread/start", {
          ephemeral: true,
          cwd: this.directory,
          approvalPolicy: "on-request",
        }),
      );
      this.threadId = started.thread.id;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  public async invoke(request: InvokeRequest): Promise<CallToolResult> {
    if (request.signal?.aborted === true) {
      throw new Error("Controls call was cancelled");
    }
    const onAbort = (): void => {
      void this.closeAfterFailure();
    };
    request.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await this.invokeStarted(request);
    } finally {
      request.signal?.removeEventListener("abort", onAbort);
    }
  }

  private async invokeStarted(request: InvokeRequest): Promise<CallToolResult> {
    await this.start();
    if (this.closed) {
      throw new Error("Controls session is closed");
    }
    if (this.active) {
      throw new Error("Another controls call is active");
    }
    if (this.threadId === undefined) {
      throw new Error("Controls thread is unavailable");
    }
    if (request.signal?.aborted === true) {
      await this.close();
      throw new Error("Controls call was cancelled");
    }
    this.active = true;
    this.usedServers.add(request.server);
    try {
      const result = await this.request(
        "mcpServer/tool/call",
        {
          threadId: this.threadId,
          server: request.server,
          tool: "js",
          arguments: {
            code: request.code,
            title: request.title,
            timeout_ms: this.options.timeoutMs ?? RPC_TIMEOUT_MS,
          },
          _meta: {
            "x-codex-turn-metadata": JSON.stringify({
              session_id: this.threadId,
              turn_id: this.operationId,
            }),
          },
        },
        request.signal,
      );
      return toolResultSchema.parse(result);
    } finally {
      this.active = false;
    }
  }

  public async reset(): Promise<void> {
    if (this.active) {
      throw new Error("Cannot reset during a controls call");
    }
    if (this.threadId === undefined) {
      return;
    }
    await this.endGroup();
    this.operationId = crypto.randomUUID();
    this.usedServers.clear();
  }

  // eslint-disable-next-line typescript/promise-function-async
  public close(): Promise<void> {
    this.closed = true;
    this.closing ??= this.closeSession();
    return this.closing;
  }

  private async closeAfterFailure(): Promise<void> {
    try {
      await this.close();
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : "Control cleanup failed"}\n`,
      );
    }
  }

  private async closeSession(): Promise<void> {
    let cleanupError: Error | undefined = undefined;
    this.failAll(new Error("Controls call was cancelled"));
    const { child } = this;
    if (child !== undefined) {
      if (this.threadId !== undefined) {
        try {
          await this.endGroup();
        } catch (error) {
          cleanupError = new Error(
            `Could not release native computer control: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        await this.request("thread/unsubscribe", { threadId: this.threadId }).catch(() => false);
      }
      await CodexControlsSession.stopProcess(child);
    }
    this.failAll(new Error("Controls session closed"));
    this.lines?.close();
    if (this.directory !== undefined) {
      await rm(this.directory, { recursive: true, force: true });
    }
    if (cleanupError !== undefined) {
      throw cleanupError;
    }
  }

  private static async stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
    const exited = child.exitCode === null ? once(child, "exit") : Promise.resolve();
    child.stdin.end();
    child.kill("SIGTERM");
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, EXIT_TIMEOUT_MS);
    timer.unref();
    child.once("exit", () => {
      clearTimeout(timer);
    });
    await exited.catch(() => false);
  }

  private async endGroup(): Promise<void> {
    if (this.threadId === undefined) {
      return;
    }
    const { threadId } = this;
    const nativeEnd =
      this.usedServers.size > 0
        ? (this.options.notifyNativeTurn ?? endNativeTurn)(threadId, this.operationId)
        : Promise.resolve();
    const cleanup = await Promise.allSettled([
      nativeEnd,
      Promise.all(
        [...this.usedServers].map(async (server) => {
          const base = { threadId: this.threadId, server };
          await this.request("mcpServer/tool/call", {
            ...base,
            tool: "turn_ended",
            arguments: {
              hook_event_name: "turn_ended",
              session_id: this.threadId,
              turn_id: this.operationId,
            },
          }).catch(() => false);
          await this.request("mcpServer/tool/call", {
            ...base,
            tool: "js_reset",
            arguments: {},
          }).catch(() => false);
        }),
      ),
    ]);
    const failed = cleanup.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") {
      throw failed.reason;
    }
  }

  private async request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted === true) {
      throw new Error("Controls call was cancelled");
    }
    this.sequence += 1;
    const id = this.sequence;
    return new Promise<unknown>((resolve, reject) => {
      const timer = this.armTimeout(id, method, reject);
      const abort = (): void => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error("Controls call was cancelled"));
        void this.closeAfterFailure();
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, {
        resolve,
        reject,
        timer,
        method,
        ...(signal === undefined
          ? {}
          : {
              releaseAbort: (): void => {
                signal.removeEventListener("abort", abort);
              },
            }),
      });
      this.send({ id, method, params });
    });
  }

  private armTimeout(
    id: number,
    method: string,
    reject: (error: Error) => void,
  ): ReturnType<typeof setTimeout> {
    return setTimeout(
      () => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
        void this.closeAfterFailure();
      },
      this.closed
        ? Math.min(this.options.timeoutMs ?? RPC_TIMEOUT_MS, EXIT_TIMEOUT_MS)
        : (this.options.timeoutMs ?? RPC_TIMEOUT_MS),
    );
  }

  private send(message: unknown): void {
    if (this.child?.stdin.writable !== true) {
      throw new Error("Codex controls process is unavailable");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string): void {
    if (line.length > MAX_LINE_LENGTH) {
      this.failAll(new Error("Codex controls response is too large"));
      void this.closeAfterFailure();
      return;
    }
    const body = parseResponse(line);
    if (body === undefined) {
      this.failAll(new Error("Codex controls response is invalid JSON"));
      void this.closeAfterFailure();
      return;
    }
    const parsed = rpcMessageSchema.safeParse(body);
    if (!parsed.success) {
      return;
    }
    this.dispatch(parsed.data);
  }

  private dispatch(message: RpcMessage): void {
    if ("method" in message && "id" in message) {
      this.answerRequest(message.id, message.method, message.params);
      return;
    }
    if (!("id" in message)) {
      return;
    }
    const pending = this.pending.get(Number(message.id));
    if (pending === undefined) {
      return;
    }
    this.pending.delete(Number(message.id));
    if (pending.timer !== undefined) {
      clearTimeout(pending.timer);
    }
    pending.releaseAbort?.();
    if ("error" in message) {
      pending.reject(new Error(message.error.message));
    } else if ("result" in message) {
      pending.resolve(message.result);
    }
  }

  private answerRequest(id: string | number, method: string, params: unknown): void {
    const parsed =
      method === "mcpServer/elicitation/request"
        ? approvalRequestSchema.safeParse(params)
        : undefined;
    const accepted =
      parsed?.success === true &&
      parsed.data.threadId === this.threadId &&
      this.active &&
      !this.closed;
    this.send({
      id,
      result: accepted ? { action: "accept", content: {} } : { action: "cancel", content: null },
    });
  }

  private failAll(error: Readonly<Error>): void {
    for (const pending of this.pending.values()) {
      if (pending.timer !== undefined) {
        clearTimeout(pending.timer);
      }
      pending.releaseAbort?.();
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export { CodexControlsSession };
export type { AppServerOptions };
