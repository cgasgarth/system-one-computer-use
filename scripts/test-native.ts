import { mkdir } from "node:fs/promises";

const directory = "runs/native-tests";
const binary = `${directory}/status-activity`;
const OUTPUT_LIMIT = 4000;
async function run(args: readonly string[]): Promise<void> {
  const child = Bun.spawn([...args], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) {
    throw new Error(`${args[0]} failed: ${(stderr || stdout).slice(-OUTPUT_LIMIT)}`);
  }
  if (stdout.trim().length > 0) {
    console.log(stdout.trim());
  }
}
await mkdir(directory, { recursive: true });
await run([
  "xcrun",
  "swiftc",
  "-swift-version",
  "6",
  "-O",
  "native/SystemOne/StatusActivity.swift",
  "tests/native/status-activity.swift",
  "-o",
  binary,
]);
await run([binary]);
