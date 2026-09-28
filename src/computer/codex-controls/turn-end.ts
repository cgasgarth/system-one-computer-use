import { homedir } from "node:os";
import path from "node:path";

const NOTIFY_TIMEOUT_MS = 3000;
const client = path.join(
  homedir(),
  ".codex/computer-use/Codex Computer Use.app/Contents/SharedSupport",
  "SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
);

async function endNativeTurn(threadId: string, turnId: string): Promise<void> {
  const child = Bun.spawn(
    [
      client,
      "turn-ended",
      JSON.stringify({
        type: "agent-turn-complete",
        "thread-id": threadId,
        "turn-id": turnId,
      }),
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const timer = setTimeout(() => {
    child.kill();
  }, NOTIFY_TIMEOUT_MS);
  try {
    const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    if (code !== 0) {
      throw new Error(`Native control cleanup failed: ${error.trim() || code}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export { endNativeTurn };
