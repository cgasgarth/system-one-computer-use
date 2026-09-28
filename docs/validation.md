# Validation

Validation separates the controller connection, the System One model's choice,
and the visible result. Passing a transport check does not prove that a model
completed the user's task.

## Control adapters

The native adapter was checked against real Calculator accessibility output,
including the separate menu-open view, nested menu entries, and a disabled
command. It binds actions to the selected app and observed active window.
Opening a menu changes the UI. No read-only full-menu-inventory claim is made.

The Chrome adapter was checked on a disposable local form through Codex's Chrome
connection. It entered the expected text, selected a native dropdown value,
identified a POST submit, and verified one save. No standalone Playwright MCP
connection was used.

The external MCP bridge also completed Calculator arithmetic and a public browser
link navigation. Tool approvals are accepted in the owned active session. Reset clears its
JavaScript state and closes unmarked owned test tabs.

## Sessions

Conversation history retains the last three sessions. Live browser tasks keep
their current control connection. Exact browser/tab identity is saved; the driver
does not select an unrelated user tab by matching its URL.

Cross-process restoration passed a live disposable-draft check. The bookmark stores
the browser extension instance and the opaque provider tab ID returned by Codex.
A fresh controller matches those IDs plus the saved title and URL against the
current user-tab listing before claiming that exact returned tab. The test
retained an unsubmitted draft, edited it after reconnect, and recorded no submit.
A changed, missing, or ambiguous identity fails closed.

## Release checks

Run `bun run check`, `bun run test`, and `bun run test:native`. Native checks need
Xcode Command Line Tools. Validate the signed installed app separately: setup
labels, automatic tool access, cancellation, model selection, and visible task
results. Keep raw traces and screenshots private under ignored `runs/`.

Unit tests cover driver state, scope, automatic tool access and cancellation contracts. They
do not establish broad task reliability or speed improvements. New end-to-end
benchmarks are needed before making claims about the Codex-based task path.

Installed-app checks reached Wikipedia through the Codex Chrome connection and
completed a single requested Calculator button press through native controls.
The arithmetic request `23 times 7` still led
Kev 4B to choose Blocked. This is not counted as a completed arithmetic task.

The control child uses temporary configuration overrides to start only the
Codex native and Chrome control tools. A live inventory and process-tree check
confirmed no standalone Playwright process. Calculator observation and Chrome
setup passed with this restricted configuration. Global Codex settings were
not changed.
