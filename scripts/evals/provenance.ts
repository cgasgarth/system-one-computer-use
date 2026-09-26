const fixtureFiles = [
  "scripts/evals/browser-tasks.ts",
  "scripts/evals/workspace.ts",
  "scripts/evals/restricted-browser.ts",
] as const;

async function digestFiles(paths: readonly string[]): Promise<string> {
  const hash = new Bun.CryptoHasher("sha256");
  for (const path of paths.toSorted()) {
    hash.update(path);
    // The file list is ordered so this digest is stable across filesystem scans.
    // eslint-disable-next-line no-await-in-loop
    hash.update(await Bun.file(path).arrayBuffer());
  }
  return hash.digest("hex");
}
async function sourceHash(): Promise<string> {
  const files: string[] = [];
  for await (const path of new Bun.Glob("**/*").scan({ cwd: "src", onlyFiles: true })) {
    files.push(`src/${path}`);
  }
  return digestFiles(files);
}
async function fixtureHash(): Promise<string> {
  return digestFiles(fixtureFiles);
}
async function effectFixtureHash(): Promise<string> {
  return digestFiles([
    "scripts/evals/effect-latch.ts",
    "scripts/evals/effect-workspace.ts",
    "scripts/evals/restricted-browser.ts",
  ]);
}
export { sourceHash, fixtureHash, effectFixtureHash };
