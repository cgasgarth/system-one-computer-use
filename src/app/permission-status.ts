import { z } from "zod";
import { loadConfig } from "./config.ts";

const responseSchema = z.object({
  accessibility: z.boolean(),
  screen_recording: z.boolean(),
  source: z.object({
    attribution: z.literal("driver-daemon"),
    bundle_id: z.literal("com.trycua.driver"),
  }),
});

const config = loadConfig();
const child = Bun.spawn([config.CUA_DRIVER_BIN, "permissions", "status", "--json"], {
  stdout: "pipe",
  stderr: "ignore",
  timeout: 2000,
  killSignal: "SIGKILL",
});
const [exit, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
if (exit !== 0) {
  throw new Error("Could not check CUA Driver permissions.");
}
const result = responseSchema.parse(JSON.parse(stdout));
console.log(JSON.stringify(result));
