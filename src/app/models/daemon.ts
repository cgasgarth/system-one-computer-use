import { createInterface } from "node:readline";
import { z } from "zod";
import { ModelHost } from "./host.ts";
import { commandSchema } from "./protocol.ts";
import { readPreferences } from "./preferences.ts";

const environment = z
  .object({ SYSTEM_ONE_INTEGRATIONS: z.string().min(1), SYSTEM_ONE_UV: z.string().min(1) })
  .parse(Bun.env);
const host = new ModelHost({
  paths: {
    integrations: environment.SYSTEM_ONE_INTEGRATIONS,
    data: process.cwd(),
    uv: environment.SYSTEM_ONE_UV,
  },
  preferences: await readPreferences(),
});
const DECISION_PORT = 8700;
const TEXT_PORT = 8080;
const IDLE_SECONDS = 255;
const BAD_GATEWAY = 502;
function gateway(port: number, role: "decision" | "text"): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    idleTimeout: IDLE_SECONDS,
    async fetch(request) {
      try {
        return await host.forward(request, host[role]);
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : "Model request failed" },
          { status: BAD_GATEWAY },
        );
      }
    },
  });
}
const servers = [gateway(DECISION_PORT, "decision"), gateway(TEXT_PORT, "text")];
await host.boot();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let closing = false;
async function close(): Promise<void> {
  if (closing) {
    return;
  }
  closing = true;
  input.close();
  await Promise.all(servers.map(async (server) => server.stop(true)));
  await host.close();
}
input.once("close", () => {
  void close();
});
process.once("SIGTERM", () => {
  void close();
});
process.once("SIGINT", () => {
  void close();
});
async function execute(line: string): Promise<void> {
  try {
    const parsed = commandSchema.safeParse(JSON.parse(line));
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? "Check the model settings and try again.");
    }
    const command = parsed.data;
    switch (command.operation) {
      case "warm": {
        await host.warm();
        break;
      }
      case "configure": {
        await host.configure(command.preferences);
        break;
      }
      case "prepare": {
        await host.prepare(command.requestId);
        break;
      }
      case "release": {
        host.release();
        break;
      }
      case "status": {
        host.snapshot();
        break;
      }
      case "shutdown": {
        await close();
        break;
      }
    }
  } catch (error) {
    if (!closing) {
      ModelHost.report(error);
    }
  }
}
try {
  for await (const line of input) {
    await execute(line);
  }
} finally {
  await close();
}
