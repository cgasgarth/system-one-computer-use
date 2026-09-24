import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_LINES = 600;
const root = fileURLToPath(new URL("../", import.meta.url));
const patterns = [
  "{src,tests,scripts}/**/*.{ts,tsx,js,mjs,html,css}",
  "integrations/clm-mlx/src/**/*.py",
];
const groups = await Promise.all(
  patterns.map(async (pattern) => Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: root }))),
);
const files = groups.flat();
if (files.length === 0) {
  throw new Error("No source files matched the size check");
}

async function checkFile(file: string): Promise<void> {
  const content = await Bun.file(path.join(root, file)).text();
  const lines = content.split("\n").length - Number(content.endsWith("\n"));
  if (lines > MAX_LINES) {
    throw new Error(`${file}: ${lines} lines; maximum ${MAX_LINES}`);
  }
}

await Promise.all(files.map(async (file) => checkFile(file)));
console.log(`Source size: ${files.length} files within ${MAX_LINES} lines.`);
