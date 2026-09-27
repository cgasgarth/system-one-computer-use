import os from "node:os";

const MAX_STATUS_CHARS = 3000;
interface MachineProfile {
  readonly chip: string;
  readonly ramBytes: number;
  readonly logicalCpuCount: number;
  readonly platform: string;
  readonly architecture: string;
  readonly powerSource: string;
  readonly powerSettings: string;
  readonly thermalStatus: string;
}
async function readCommand(args: readonly string[]): Promise<string> {
  const process = Bun.spawn([...args], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, output] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Could not read ${args[0]} status for the benchmark manifest.`);
  }
  return output.trim().slice(0, MAX_STATUS_CHARS);
}
async function machineProfile(): Promise<MachineProfile> {
  const [powerSource, powerSettings, thermalStatus] = await Promise.all([
    readCommand(["pmset", "-g", "ps"]),
    readCommand(["pmset", "-g"]),
    readCommand(["pmset", "-g", "therm"]),
  ]);
  return {
    chip: os.cpus()[0]?.model ?? "unavailable",
    ramBytes: os.totalmem(),
    logicalCpuCount: os.cpus().length,
    platform: process.platform,
    architecture: process.arch,
    powerSource,
    powerSettings,
    thermalStatus,
  };
}
export { machineProfile };
export type { MachineProfile };
