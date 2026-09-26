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
  "StatusActivity",
  "TaskMenu",
  "TaskRunner",
  "VoiceShortcut",
  "HandyBehavior",
  "HandyCommands",
  "SessionMenu",
  "SettingsMenu",
  "ModelTypes",
  "LocalModels",
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
  BunPath: path.join(contents, "MacOS", "bun"),
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
  path.join(root, "src/app/models/daemon.ts"),
]);
await Promise.all(
  ["@playwright/mcp", "playwright", "playwright-core"].map(async (name) =>
    cp(path.join(root, "node_modules", name), path.join(runtime, "node_modules", name), {
      recursive: true,
    }),
  ),
);
const uv = Bun.which("uv");
if (uv === null) {
  throw new Error("uv is required to package the managed MLX runtime");
}
await cp(process.execPath, path.join(contents, "MacOS", "bun"));
await cp(uv, path.join(contents, "MacOS", "uv"));
await Promise.all(
  ["clm-mlx", "kev-mlx"].map(async (project) => {
    const destination = path.join(contents, "Resources", "integrations", project);
    await mkdir(destination, { recursive: true });
    await Promise.all(
      ["pyproject.toml", "uv.lock"].map(async (file) =>
        cp(path.join(root, "integrations", project, file), path.join(destination, file)),
      ),
    );
  }),
);
await cp(
  path.join(root, "integrations/clm-mlx/src"),
  path.join(contents, "Resources", "integrations/clm-mlx/src"),
  { recursive: true },
);
await cp(
  path.join(root, "integrations/kev-mlx/download.py"),
  path.join(contents, "Resources", "integrations/kev-mlx/download.py"),
);
const environment = path.join(data, ".env");
if (!(await Bun.file(environment).exists())) {
  await cp(path.join(root, ".env"), environment);
  await chmod(environment, PRIVATE_FILE_MODE);
}
await command(["xcrun", "swiftc", "-swift-version", "6", "-O", ...sources, "-o", binary]);
await command([
  "xcrun",
  "swiftc",
  "-swift-version",
  "6",
  "-O",
  ...["main", "WindowEvents", "WritableFields"].map((name) =>
    path.join(root, "native", "NativeAccess", `${name}.swift`),
  ),
  "-o",
  path.join(contents, "MacOS", "NativeAccess"),
]);
const plist = path.join(contents, "Info.plist");
await Bun.write(plist, JSON.stringify(info));
await command(["plutil", "-convert", "xml1", plist]);
await command(["codesign", "--force", "--sign", "-", app]);
console.log(`Installed ${app}\nOpen the app. Click its cursor icon or press Command–Option–C.`);
