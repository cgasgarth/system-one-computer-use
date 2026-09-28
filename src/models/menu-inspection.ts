import type { MenuInspection } from "../agent/contracts.ts";

const MAX_INSPECTION_BYTES = 7600;

function serializeMenuInspection(inspection: MenuInspection): string {
  const grouped = new Map<
    string,
    {
      path: readonly string[];
      commands: { leaf: string; label: string; enabled: boolean; keyCharacter?: string }[];
    }
  >();
  for (const menu of inspection.menus) {
    const parent = menu.path.slice(0, -1);
    const key = JSON.stringify(parent);
    const group = grouped.get(key) ?? { path: parent, commands: [] };
    group.commands.push({
      leaf: menu.path.at(-1) ?? "",
      label: menu.label,
      enabled: menu.enabled,
      ...(menu.shortcut === undefined ? {} : { keyCharacter: menu.shortcut }),
    });
    grouped.set(key, group);
  }
  const result = `Observed application menu ${JSON.stringify(inspection.topLevel)} opened for view while window ${inspection.window_id} was selected (Codex menu coverage complete: ${inspection.complete}; enabled flags reflect current app menu state; commands may be omitted when false): ${JSON.stringify([...grouped.values()])}`;
  if (Buffer.byteLength(result) > MAX_INSPECTION_BYTES) {
    throw new Error(
      "capacity_menu: The inspected menu cannot fit the model state without dropping commands.",
    );
  }
  return result;
}

export { serializeMenuInspection };
