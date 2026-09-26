# Native menu discovery: read-only probe

On 2026-09-26, a Swift CLI under ignored `runs/qa/overnight/` read macOS
Accessibility menu trees for an arbitrary running PID or app name. It called
`AXIsProcessTrusted`, then read `AXMenuBar`, child roles, titles, enabled state,
and shortcut attributes. It did not open a menu, press a key, invoke a command,
or change focus. The CLI host was Accessibility-trusted. This does not confirm
the installed app's pending Accessibility grant.

| App      | Top menus | AX rows | Menu items | Enabled leaf paths with at least two labels | Shortcut items |
| -------- | --------: | ------: | ---------: | ------------------------------------------: | -------------: |
| Calendar |         7 |     257 |        233 |                                          95 |             65 |
| Finder   |         8 |     337 |        296 |                                         107 |            117 |

The artifacts `runs/qa/overnight/menu-calendar.json` and `menu-finder.json`
contain the local paths. The counts show that these two apps expose many menu
items without a UI action. They do not prove that every path remains available
after a state change or that another app exposes its menu in the same way.
Finder also returned AX read errors on some non-menu descendants; a consumer
must use only complete, enabled menu-item paths from the current read.

CUA Driver 0.28.2 already offers `invoke_menu(pid, window_id, path, session)`.
It resolves an **exact immediate-child path** one live level at a time. Labels
are case-sensitive after trimming surrounding whitespace. Missing, ambiguous,
disabled, or structurally mismatched segments fail closed, with no pixel
fallback. CUA exposes no read-only menu enumeration tool: its desktop read
lists apps and windows, while `get_window_state` is scoped to one window.
The current harness offers `open_document` in every selected desktop app and
implements it as Command+O. The existing CUA menu tool alone cannot ground a
replacement path.

## Smallest safe integration to evaluate

1. Add a bounded, read-only menu subcommand to
   `native/NativeAccess/MenuItems.swift` and `main.swift`. Return exact path,
   enabled state, role, and shortcut metadata through a strict boundary schema.
2. Attach only current, complete menu paths to the native observation. Offer
   them as explicit `invoke_menu` actions. Validate the selected path against
   that observation before calling CUA's existing `invoke_menu` tool.
3. Remove unconditional `open_document`/Command+O once the observed menu
   action is usable. Keep CUA's live fail-closed path check at execution.

Before that change is accepted, test disabled, ambiguous, stale, and missing
paths; exact path transport; read-only discovery in more than one app; and a
supervised menu action that does not change user data after the installed app's
Accessibility grant is confirmed. No production code or installed app was
changed during this probe.
