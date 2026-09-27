import { statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const BYTES_PER_GIB = 1_073_741_824;
const MAX_NEW_DISK_GIB = 80;
const MIN_FREE_DISK_GIB = 200;
const MIN_FREE_BEFORE_LOAD_PERCENT = 25;
const MIN_FREE_AFTER_LOAD_PERCENT = 10;
const PERCENT_MAX = 100;
const FREE_PERCENT = /System-wide memory free percentage:\s*(?<value>\d+)%/u;
class ResourceLimitError extends Error {
  public override readonly name = "ResourceLimitError";
}

async function command(
  args: readonly string[],
): Promise<{ readonly status: number; readonly output: string }> {
  const process = Bun.spawn([...args], { stdout: "pipe", stderr: "pipe" });
  const [status, output] = await Promise.all([process.exited, new Response(process.stdout).text()]);
  return { status, output };
}
async function ensureInstalledHostStopped(): Promise<void> {
  const socket = path.join(
    os.homedir(),
    "Library/Application Support/SystemOneComputerUse/ipc/model.sock",
  );
  const result = await command(["lsof", "-nP", "-t", socket]);
  if (result.status === 0 && result.output.trim().length > 0) {
    throw new Error("Quit the installed System One app before the serial model benchmark.");
  }
}
async function freeDiskGiB(location: string): Promise<number> {
  const state = await statfs(location);
  return (state.bavail * state.bsize) / BYTES_PER_GIB;
}
async function freeMemoryPercent(): Promise<number> {
  const result = await command(["memory_pressure", "-Q"]);
  if (result.status !== 0) {
    throw new Error("Could not read macOS memory pressure before loading a model.");
  }
  const value = FREE_PERCENT.exec(result.output)?.groups?.["value"];
  return z.coerce.number().int().min(0).max(PERCENT_MAX).parse(value);
}
async function requireMemory(phase: "before" | "after"): Promise<number> {
  const free = await freeMemoryPercent();
  const minimum = phase === "before" ? MIN_FREE_BEFORE_LOAD_PERCENT : MIN_FREE_AFTER_LOAD_PERCENT;
  if (free < minimum) {
    throw new ResourceLimitError(
      `Memory pressure is too high for a safe serial load: ${free}% free, need ${minimum}% (${phase}).`,
    );
  }
  return free;
}
async function requireDisk(location: string, initialFreeGiB: number): Promise<number> {
  const free = await freeDiskGiB(location);
  if (free < MIN_FREE_DISK_GIB || initialFreeGiB - free > MAX_NEW_DISK_GIB) {
    throw new ResourceLimitError(
      `Model cache limit reached: ${free.toFixed(1)} GiB free, ${(initialFreeGiB - free).toFixed(1)} GiB used by this run. Stop before another download.`,
    );
  }
  return free;
}

export {
  ensureInstalledHostStopped,
  freeDiskGiB,
  freeMemoryPercent,
  requireDisk,
  requireMemory,
  MAX_NEW_DISK_GIB,
  MIN_FREE_DISK_GIB,
  ResourceLimitError,
};
