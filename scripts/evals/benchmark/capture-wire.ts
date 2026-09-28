import { runTask } from "../../../src/agent/loop.ts";
import { CodexChromeComputer } from "../../../src/computer/codex-chrome/computer.ts";
import { terminalApproval } from "../../../src/app/terminal-approval.ts";
import { SystemOneDecisionModel } from "../../../src/models/system-one.ts";
import { ChatCompletionTextModel } from "../../../src/models/text.ts";
import { restrictedBrowser } from "../restricted-browser.ts";
import { startWorkspace } from "../workspace.ts";

const CLI_ARGUMENT_OFFSET = 2;
const [output] = Bun.argv.slice(CLI_ARGUMENT_OFFSET);
if (output === undefined) {
  throw new Error("Pass an ignored output directory for the synthetic wire capture.");
}
const workspace = startWorkspace();
const computer = new CodexChromeComputer({ approval: terminalApproval });
const browser = restrictedBrowser(computer, workspace.origin);
async function captureRequest(policy: "browser-only" | "auto"): Promise<string> {
  const abort = new AbortController();
  const capture: { bodyJson?: string } = {};
  await browser.navigate?.(`${workspace.origin}/`);
  try {
    await runTask({
      task: "Open the Roadmap Review document.",
      context: "",
      preferredSurface: "browser",
      ...(policy === "browser-only" ? { availableSurfaces: ["browser"] as const } : {}),
      applications: [],
      decision: new SystemOneDecisionModel(
        "unix:///tmp/system-one-wire-capture.sock?role=decision",
        "clm-latest",
      ),
      text: new ChatCompletionTextModel(
        "unix:///tmp/system-one-wire-capture.sock?role=text",
        "qwen-text-latest",
      ),
      signal: abort.signal,
      computer(mode) {
        if (mode !== "browser") {
          throw new Error("The wire capture permits only its private browser.");
        }
        return browser;
      },
      onDecisionWire(event) {
        if (capture.bodyJson === undefined && event.phase === "operation") {
          capture.bodyJson = JSON.stringify(event.body);
          abort.abort(new Error("Captured the first operation request before transport."));
        }
      },
    });
  } catch (error) {
    if (capture.bodyJson === undefined) {
      throw error;
    }
  }
  if (capture.bodyJson === undefined) {
    throw new Error(`No ${policy} operation request body was captured.`);
  }
  return capture.bodyJson;
}
let bodies: readonly { readonly policy: string; readonly json: string }[] = [];
try {
  await browser.desktop();
  bodies = [
    { policy: "browser-only", json: await captureRequest("browser-only") },
    { policy: "auto", json: await captureRequest("auto") },
  ];
} finally {
  await Promise.allSettled([computer.close(), workspace.close()]);
}
const saved = await Promise.all(
  bodies.map(async ({ policy, json }) => {
    const sha256 = new Bun.CryptoHasher("sha256").update(json).digest("hex");
    const file = `${output}/frozen-open-${policy}-paired.json`;
    await Bun.write(file, json);
    return { path: file, sha256, bytes: Buffer.byteLength(json), noInferenceSent: true };
  }),
);
for (const item of saved) {
  console.log(JSON.stringify(item));
}
