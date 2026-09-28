# Native menu controls

The Codex native adapter exposes menu names from the selected app's current
accessibility text. Inspecting a menu clicks that observed header and reads the
visible submenu. This can change focus and screen state; it is not a read-only
inventory of all app commands.

Only an exact enabled command in the fresh observed menu can be invoked. Hidden
submenus remain unobserved until opened. Menu completeness is unknown when the
runtime does not provide it. The model can also use ordinary observed controls
or change surfaces. The adapter does not guess app-specific keyboard shortcuts.
