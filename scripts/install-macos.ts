import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chmod, cp, mkdir } from "node:fs/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const app = path.join(os.homedir(), "Applications", "System One Computer Use.app");
const contents = path.join(app, "Contents");
const binary = path.join(contents, "MacOS", "SystemOne");
const runtime = path.join(contents, "Resources", "runtime");
const data = path.join(os.homedir(), "Library", "Application Support", "SystemOneComputerUse");
const PRIVATE_FILE_MODE = 0o600;
const sources = [
  "main",
  "AppDelegate",
  "TaskMenu",
  "TaskRunner",
  "VoiceShortcut",
  "SettingsMenu",
].map((name) => path.join(root, "native", "SystemOne", `${name}.swift`));
const info = {
  CFBundleIdentifier: "com.cgasgarth.system-one-computer-use",
  CFBundleName: "System One Computer Use",
  CFBundleDisplayName: "System One Computer Use",
  CFBundleExecutable: "SystemOne",
  CFBundlePackageType: "APPL",
  CFBundleShortVersionString: "0.1.0",
  CFBundleVersion: "1",
  LSUIElement: true,
  NSHighResolutionCapable: true,
  AppDataPath: data,
  BunPath: process.execPath,
  ToolSearchPath: Bun.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin",
};

async function command(args: readonly string[]): Promise<void> {
  const child = Bun.spawn([...args], { stderr: "pipe", stdout: "pipe" });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (status !== 0) {
    throw new Error(`${args[0]} failed: ${stderr || stdout}`);
  }
}

await mkdir(path.dirname(binary), { recursive: true });
await mkdir(data, { recursive: true });
await command([
  process.execPath,
  "build",
  "--target=bun",
  "--outdir",
  runtime,
  path.join(root, "src/app/worker.ts"),
  path.join(root, "src/app/settings.ts"),
]);
await Promise.all(
  ["@playwright/mcp", "playwright", "playwright-core"].map(async (name) =>
    cp(path.join(root, "node_modules", name), path.join(runtime, "node_modules", name), {
      recursive: true,
    }),
  ),
);
const environment = path.join(data, ".env");
if (!(await Bun.file(environment).exists())) {
  await cp(path.join(root, ".env"), environment);
  await chmod(environment, PRIVATE_FILE_MODE);
}
await command(["xcrun", "swiftc", "-swift-version", "6", "-O", ...sources, "-o", binary]);
const plist = path.join(contents, "Info.plist");
await Bun.write(plist, JSON.stringify(info));
await command(["plutil", "-convert", "xml1", plist]);
await command(["codesign", "--force", "--sign", "-", app]);
console.log(`Installed ${app}\nOpen the app. Click its cursor icon or press Command–Option–C.`);
