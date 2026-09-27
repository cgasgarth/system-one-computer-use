import { createInterface } from "node:readline";
import { z } from "zod";
import { ModelHost } from "./host.ts";
import { ModelIngress } from "./ingress.ts";
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
await host.boot();
const ingress = new ModelIngress(host);
await ingress.start();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let closing = false;
function isClosing(): boolean {
  return closing;
}
async function close(): Promise<void> {
  if (closing) {
    return;
  }
  closing = true;
  input.close();
  await ingress.close();
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
    if (isClosing()) {
      break;
    }
    await execute(line);
    if (isClosing()) {
      break;
    }
  }
} finally {
  await close();
}
