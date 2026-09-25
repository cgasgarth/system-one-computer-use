import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { INTERNAL_NAMES } from "./targets.ts";

const APP_SUFFIX = ".app";

async function installedApplications(): Promise<readonly string[]> {
  const directories = [
    "/Applications",
    "/System/Applications",
    "/System/Applications/Utilities",
    path.join(os.homedir(), "Applications"),
  ];
  const results = await Promise.allSettled(
    directories.map(async (directory) => {
      const entries = await readdir(directory, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
        .map((entry) => entry.name.slice(0, -APP_SUFFIX.length));
    }),
  );
  return [
    ...new Set(results.flatMap((result) => (result.status === "fulfilled" ? result.value : []))),
  ]
    .filter((name) => !INTERNAL_NAMES.has(name))
    .toSorted();
}
export { installedApplications };
