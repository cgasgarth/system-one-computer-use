import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, rename, rm } from "node:fs/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const applications = path.join(os.homedir(), "Applications");
const installedApp = path.join(applications, "System One Computer Use.app");
const stageRoot = path.join(applications, `.system-one-stage-${crypto.randomUUID()}`);
const app = path.join(stageRoot, "System One Computer Use.app");
const contents = path.join(app, "Contents");
const binary = path.join(contents, "MacOS", "SystemOne");
const runtime = path.join(contents, "Resources", "runtime");
const data = path.join(os.homedir(), "Library", "Application Support", "SystemOneComputerUse");
const PRIVATE_FILE_MODE = 0o600;
const SHA1_IDENTITY = /^[0-9a-f]{40}$/iu;
const MINIMUM_MACOS = "15.0";
const swiftTarget = `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macosx${MINIMUM_MACOS}`;
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
  "Permissions",
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
  LSMinimumSystemVersion: MINIMUM_MACOS,
  NSHighResolutionCapable: true,
  AppDataPath: data,
  BunPath: path.join(installedApp, "Contents", "MacOS", "bun"),
  ToolSearchPath: Bun.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin",
};

async function command(
  args: readonly string[],
  environment?: Readonly<NodeJS.ProcessEnv>,
): Promise<{ stdout: string; stderr: string }> {
  const child = Bun.spawn([...args], {
    stderr: "pipe",
    stdout: "pipe",
    ...(environment === undefined ? {} : { env: environment }),
  });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (status !== 0) {
    throw new Error(`${args[0]} failed: ${stderr || stdout}`);
  }
  return { stdout, stderr };
}

async function signingIdentity(): Promise<string> {
  const selected = Bun.env["SYSTEM_ONE_CODESIGN_IDENTITY"]?.trim();
  if (selected === undefined || !SHA1_IDENTITY.test(selected)) {
    throw new Error(
      "Set SYSTEM_ONE_CODESIGN_IDENTITY to a valid 40-character code-signing certificate fingerprint before installing. The installed app was not changed.",
    );
  }
  const child = Bun.spawn(["security", "find-identity", "-v", "-p", "codesigning"], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [status, output, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (status !== 0) {
    throw new Error(`Could not check code-signing identities: ${error.trim()}`);
  }
  const valid = [...output.matchAll(/^\s*\d+\)\s+(?<fingerprint>[0-9a-f]{40})\s+/gimu)].some(
    (match) => match.groups?.["fingerprint"]?.toLowerCase() === selected.toLowerCase(),
  );
  if (!valid) {
    throw new Error(
      `Code-signing identity ${selected} is not valid in the keychain. The installed app was not changed.`,
    );
  }
  return selected;
}

async function designatedRequirement(target: string): Promise<string> {
  const { stdout, stderr } = await command(["codesign", "-d", "-r-", target]);
  const requirement = /(?<requirement>designated => .+)/u.exec(`${stdout}\n${stderr}`)?.groups?.[
    "requirement"
  ];
  if (requirement === undefined) {
    throw new Error(`Could not read the designated requirement for ${target}`);
  }
  return requirement;
}

async function signedProbe(identity: string, temporary: string, version: string): Promise<string> {
  const source = path.join(temporary, `${version}.swift`);
  const executable = path.join(temporary, version);
  await Bun.write(source, `print(${JSON.stringify(version)})\n`);
  await command(["xcrun", "swiftc", "-target", swiftTarget, source, "-o", executable]);
  await command([
    "codesign",
    "--force",
    "--sign",
    identity,
    "--identifier",
    "com.cgasgarth.system-one-computer-use.signing-probe",
    executable,
  ]);
  await command(["codesign", "--verify", "--strict", executable]);
  const requirement = await designatedRequirement(executable);
  if (!/\b(?:anchor|certificate)\b/u.test(requirement)) {
    throw new Error("The selected identity produced no certificate-bound designated requirement.");
  }
  return requirement;
}

function signerRule(requirement: string): string {
  return requirement.replace(/identifier "[^"]+"/u, 'identifier "<app>"');
}

async function validateStableRequirement(identity: string): Promise<string> {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "system-one-signing-"));
  try {
    const first = await signedProbe(identity, temporary, "one");
    const second = await signedProbe(identity, temporary, "two");
    if (first !== second) {
      throw new Error("Two probe versions did not retain the same designated requirement.");
    }
    return first;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

// Check signing before writing any part of the installed bundle.
const identity = await signingIdentity();
const probeRequirement = await validateStableRequirement(identity);
// The destination is a directory; check it before the staged build.
// eslint-disable-next-line node/no-sync
const hadInstall = existsSync(installedApp);
if (hadInstall) {
  const previous = await designatedRequirement(installedApp);
  if (
    /\b(?:anchor|certificate)\b/u.test(previous) &&
    signerRule(previous) !== signerRule(probeRequirement)
  ) {
    throw new Error(
      "The selected signer differs from the installed app's certificate-bound requirement. The installed app was not changed.",
    );
  }
}

async function prepareRuntime(): Promise<void> {
  await mkdir(path.dirname(binary), { recursive: true });
  await mkdir(data, { recursive: true });
  await command([
    process.execPath,
    "build",
    "--target=bun",
    "--outdir",
    runtime,
    path.join(root, "src/app/worker.ts"),
    path.join(root, "src/app/models/daemon.ts"),
    path.join(root, "src/app/permission-status.ts"),
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
    ["clm-mlx", "kev-mlx", "julia-cpu"].map(async (project) => {
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
  await cp(
    path.join(root, "integrations/julia-cpu/download.py"),
    path.join(contents, "Resources", "integrations/julia-cpu/download.py"),
  );
  await cp(
    path.join(root, "integrations/julia-cpu/src"),
    path.join(contents, "Resources", "integrations/julia-cpu/src"),
    { recursive: true },
  );
  await mkdir(path.join(contents, "Resources", "integrations/local-bridge"), { recursive: true });
  await cp(
    path.join(root, "integrations/local-bridge/serve.py"),
    path.join(contents, "Resources", "integrations/local-bridge/serve.py"),
  );
  const environment = path.join(data, ".env");
  if (!(await Bun.file(environment).exists())) {
    await cp(path.join(root, ".env"), environment);
    await chmod(environment, PRIVATE_FILE_MODE);
  }
}

async function buildSignedApp(selectedIdentity: string): Promise<void> {
  await command([
    "xcrun",
    "swiftc",
    "-target",
    swiftTarget,
    "-swift-version",
    "6",
    "-O",
    ...sources,
    "-o",
    binary,
  ]);
  await command([
    "xcrun",
    "swiftc",
    "-target",
    swiftTarget,
    "-swift-version",
    "6",
    "-O",
    ...["main", "WindowEvents", "WritableFields", "MenuItems"].map((name) =>
      path.join(root, "native", "NativeAccess", `${name}.swift`),
    ),
    "-o",
    path.join(contents, "MacOS", "NativeAccess"),
  ]);
  const plist = path.join(contents, "Info.plist");
  await Bun.write(plist, JSON.stringify(info));
  await command(["plutil", "-convert", "xml1", plist]);
  await command([
    "codesign",
    "--force",
    "--sign",
    selectedIdentity,
    path.join(contents, "MacOS", "NativeAccess"),
  ]);
  await command(["codesign", "--force", "--sign", selectedIdentity, app]);
  await command(["codesign", "--verify", "--deep", "--strict", app]);
}

async function syncManagedRuntimes(): Promise<void> {
  const uv = path.join(installedApp, "Contents", "MacOS", "uv");
  const projects = [
    { directory: "clm-mlx", packageName: "system-one-clm-mlx" },
    { directory: "kev-mlx", packageName: "system-one-kev-mlx" },
    { directory: "julia-cpu", packageName: "system-one-julia-cpu" },
  ] as const;
  const results = await Promise.allSettled(
    projects.map(async (project) =>
      command(
        [
          uv,
          "sync",
          "--project",
          path.join(installedApp, "Contents", "Resources", "integrations", project.directory),
          "--frozen",
          "--no-editable",
          "--reinstall-package",
          project.packageName,
          "--quiet",
        ],
        {
          ...Bun.env,
          UV_PROJECT_ENVIRONMENT: path.join(data, "runtimes", project.directory),
        },
      ),
    ),
  );
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    throw failed.reason;
  }
}

async function swapInstalledApp(previousInstall: boolean): Promise<void> {
  const backup = path.join(applications, `.system-one-backup-${crypto.randomUUID()}.app`);
  if (previousInstall) {
    await rename(installedApp, backup);
  }
  try {
    await rename(app, installedApp);
    await command(["codesign", "--verify", "--deep", "--strict", installedApp]);
    await syncManagedRuntimes();
    await command(["codesign", "--verify", "--deep", "--strict", installedApp]);
  } catch (error) {
    await rm(installedApp, { recursive: true, force: true });
    if (previousInstall) {
      await rename(backup, installedApp);
    }
    throw error;
  }
  if (previousInstall) {
    await rm(backup, { recursive: true, force: true });
  }
}

async function installBundle(): Promise<void> {
  await prepareRuntime();
  await buildSignedApp(identity);
  await swapInstalledApp(hadInstall);
  console.log(
    `Installed ${installedApp}\nOpen the app. Click its cursor icon or press Command–Option–C.`,
  );
}

try {
  await installBundle();
} finally {
  await rm(stageRoot, { recursive: true, force: true });
}
