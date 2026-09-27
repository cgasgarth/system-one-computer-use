# Native menu capability

The native adapter reads enabled menu paths from the selected application's macOS Accessibility menu tree. It offers a path as an `invoke_menu` action only when the current read provides a complete, unique enabled path. Before invocation, it reads the same application's menu paths again. CUA Driver then resolves each exact immediate-child path; missing, ambiguous, disabled, or changed paths fail closed. This replaces guessed app-wide keyboard commands.

The read-only development probe found menu trees in Calendar and Finder, with 95 and 107 enabled leaf paths respectively. Those counts show that menu discovery can work without opening a menu. They do not show that every app exposes its menus or that a discovered command will perform the intended task. The native helper is scoped to a PID and the selected window; a failed menu read leaves other observed controls usable.

This capability is intentionally generic. The harness does not name a particular app's menu command in its task policy. Exact menu paths can still change between observation and execution, and some native controls are absent from Accessibility. A supervised task must verify the effect after invocation.
