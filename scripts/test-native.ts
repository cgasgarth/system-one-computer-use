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
const permissionBinary = `${directory}/permissions`;
await run([
  "xcrun",
  "swiftc",
  "-swift-version",
  "6",
  "-O",
  "native/SystemOne/Permissions.swift",
  "tests/native/permission-checks.swift",
  "-o",
  permissionBinary,
]);
await run([permissionBinary]);
const runnerApp = `${directory}/RunnerTests.app/Contents`;
const runnerData = `${directory}/runner-data`;
await mkdir(`${runnerApp}/MacOS`, { recursive: true });
await mkdir(`${runnerApp}/Resources/runtime`, { recursive: true });
await mkdir(runnerData, { recursive: true });
await run([
  process.execPath,
  "build",
  "--target=bun",
  "tests/fixtures/task-runner-worker.ts",
  "--outfile",
  `${runnerApp}/Resources/runtime/worker.js`,
]);
await Bun.write(
  `${runnerApp}/Info.plist`,
  JSON.stringify({
    CFBundleIdentifier: "com.system-one.runner-tests",
    CFBundleExecutable: "RunnerTests",
    AppDataPath: `${process.cwd()}/${runnerData}`,
    BunPath: process.execPath,
  }),
);
await run(["plutil", "-convert", "xml1", `${runnerApp}/Info.plist`]);
await run([
  "xcrun",
  "swiftc",
  "-swift-version",
  "6",
  "-O",
  "native/SystemOne/TaskRunner.swift",
  "native/SystemOne/SessionMenu.swift",
  "tests/native/task-runner.swift",
  "-o",
  `${runnerApp}/MacOS/RunnerTests`,
]);
await run([`${runnerApp}/MacOS/RunnerTests`]);
