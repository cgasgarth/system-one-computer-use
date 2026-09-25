import type { ManagedComputer } from "../../computer/types.ts";
import type { Surface } from "./schema.ts";

async function restoreSurface(
  computer: Readonly<ManagedComputer>,
  surface: Surface,
): Promise<{ readonly pid: number; readonly windowId: number } | undefined> {
  if (surface.kind === "browser") {
    if (computer.restore === undefined) {
      throw new Error("This driver cannot restore the saved browser tab");
    }
    await computer.restore(surface);
    return undefined;
  }
  const desktop = await computer.desktop();
  const exact = desktop.windows.find(
    (window) =>
      window.pid === surface.pid &&
      window.window_id === surface.windowId &&
      window.app_name === surface.app,
  );
  const candidates = desktop.windows.filter(
    (window) => window.app_name === surface.app && window.title === surface.title,
  );
  const target = exact ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (target !== undefined) {
    await computer.window(target.pid, target.window_id);
    return { pid: target.pid, windowId: target.window_id };
  }
  return undefined;
}
export { restoreSurface };
