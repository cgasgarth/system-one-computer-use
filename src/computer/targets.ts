import type { Desktop } from "../agent/contracts.ts";

const INTERNAL_BUNDLES = new Set(["com.trycua.driver", "com.cgasgarth.system-one-computer-use"]);
const INTERNAL_NAMES = new Set([
  "Cua Driver",
  "CuaDriver",
  "System One Computer Use",
  "ChatGPT Computer Use",
]);

function taskDesktop(desktop: Desktop): Desktop {
  const blocked = new Set(
    desktop.apps
      .filter((app) => INTERNAL_BUNDLES.has(app.bundle_id ?? "") || INTERNAL_NAMES.has(app.name))
      .map((app) => app.pid),
  );
  return {
    apps: desktop.apps.filter((app) => !blocked.has(app.pid)),
    windows: desktop.windows.filter(
      (window) => !blocked.has(window.pid) && !INTERNAL_NAMES.has(window.app_name),
    ),
  };
}

export { taskDesktop, INTERNAL_NAMES };
