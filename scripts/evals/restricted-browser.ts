import type { Window } from "../../src/agent/contracts.ts";
import type { ManagedComputer } from "../../src/computer/types.ts";

function allowed(url: string, origin: string): boolean {
  return url === "about:blank" || new URL(url).origin === origin;
}
function restrictedBrowser(computer: ManagedComputer, origin: string): ManagedComputer {
  let observed: Window | undefined = undefined;
  const inspectField = computer.inspectField?.bind(computer);
  return {
    desktop: async () => computer.desktop(),
    async window(pid, windowId) {
      const window = await computer.window(pid, windowId);
      if (window.url !== undefined && !allowed(window.url, origin)) {
        throw new Error("The model left the disposable localhost fixture; the evaluation stopped.");
      }
      observed = window;
      return window;
    },
    launchApp: () => {
      throw new Error("The evaluation cannot launch applications.");
    },
    async clickElement(action) {
      const target = observed?.elements.find(
        (element) => element.element_token === action.element_token,
      );
      if (target?.href !== undefined && !allowed(target.href, origin)) {
        throw new Error("The model selected a link outside the disposable localhost fixture.");
      }
      await computer.clickElement(action);
    },
    inspectClick: computer.inspectClick.bind(computer),
    ...(inspectField === undefined ? {} : { inspectField }),
    typeText: async (action) => computer.typeText(action),
    pressKey: async (action) => computer.pressKey(action),
    navigate: async (url) => {
      if (!allowed(url, origin)) {
        throw new Error("The model selected a URL outside the disposable localhost fixture.");
      }
      await computer.navigate?.(url);
    },
    bookmark: async () => {
      if (computer.bookmark === undefined) {
        throw new Error("Browser bookmarks are unavailable.");
      }
      return computer.bookmark();
    },
    restore: async (surface) => {
      if (!allowed(surface.url, origin)) {
        throw new Error("The saved browser target is outside the disposable localhost fixture.");
      }
      await computer.restore?.(surface);
    },
    close: async () => computer.close(),
  };
}
export { restrictedBrowser };
