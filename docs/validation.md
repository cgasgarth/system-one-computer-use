# Validation

## Checks for the decision-owned loop (2026-09-25)

- 53 automated tests pass, with strict type-aware lint and the 600-line source limit.
- Swift 6 release compilation passes. The task and Settings views were rendered and inspected. Rendered views do not prove physical keyboard or speech behavior.
- The installed dropdown accepted typed text, enabled Start, selected desktop tools, showed live metrics, and accepted Stop. The stopped session was saved with status `stopped`.
- CUA lifecycle checks reproduce rejection after an ended transport session. The fix starts both the implicit discovery session and the named input session before reading state, then closes both with the task. Three fresh live connections each passed repeated desktop reads. Installed Start → Stop → Start checks passed live observation on both runs; both turns were saved as stopped. This check does not establish task-completion accuracy.
- Session tests cover the one-hour boundary, process restart, explicit resume/new selection, three-session retention, and concurrent turn updates.
- Loop tests cover switching after observation failure, switching after saved-tab restoration failure, terminal choices on both surfaces, and Stop before a pending decision starts its action.
- Warm-up tests cover draft retention under the cold policy and unloading after an actual task releases the models.
- The Handy state machine passes Hold, Auto threshold, Toggle, repeat-edge, and cancellation checks. The installed Handy setting was Hold. Physical dictation and final transcript delivery still need an end-to-end check.
- Dictate was tested during a running task and again after cancellation. Handy logs confirmed microphone samples on both starts and return to idle on both cancellations. The user confirmed that the physical global shortcut starts listening on its second use while a task runs.

## Live model and driver results

CLM selected the expected initial surface for six prompts against a captured desktop listing: Messages, Calendar, and Finder selected desktop; OpenTable, Wikipedia, and Google search selected Chrome. This is a small routing check, not a general task-success benchmark.

A supervised live run opened Messages. It did not complete the requested conversation lookup: CLM repeated application-opening choices. Earlier app-selection tests opened unrelated apps; those tests were stopped and their apps closed. The current loop must not be described as reliable for arbitrary native workflows.

The earlier installed-menu Calculator test needed Stop. The updated source completed a live “Open Calculator on this Mac” run in three decisions, with a fresh native window listing confirming Calculator. A browser navigation run reached example.com and stopped. A local Chrome form run filled the Message input with Hello and stopped in six decisions; both the driver snapshot and native Chrome accessibility view confirmed the value. The packaged worker was then tested from an isolated session directory: it selected desktop tools, selected the Calculator window, and completed in four decisions. The updated menu opened, accepted text, and retained the restored user draft. These are small supervised checks, not a general success-rate benchmark.

The tests reproduced a focus cycle, then verified that the guard stops repeating Tab in the same states. Playwright key names and flags before element references are now handled correctly. Truncated text output is rejected before typing. Native Command+O opened a live Preview file chooser with readable Search and Open controls.

The full “load a random image in Preview” task still failed in a supervised model run by selecting an unrelated window. The driver check does not establish successful image selection. Native window routing and broader workflows need more work.

The Chrome extension supports saved-URL restoration inside the current connection's tab group. A new connection creates a separate group. A live reconnect test correctly reported the old tab as unavailable. The user must move that tab into the new group, or begin a new session. Duplicate saved URLs are reported as ambiguous. Unit tests check URL verification before further interaction.

The old text-planner workflow has been replaced. Results from that workflow do not validate this loop.

## Repeatable checks

```bash
bun run check
bun run test
bun run format:check
bun run app:install
```

After changing a driver or decision prompt, repeat affected tasks with the real model and inspect the actual app result. Test a follow-up in the same connection, Stop during work, and a failed tool followed by a different tool choice. A model's Complete choice is not independent proof of success.

App session files and traces stay under `~/Library/Application Support/SystemOneComputerUse/`. Local QA traces, captured observations, and screenshots stay under ignored `runs/qa/`. They can contain private application content and must not be committed.
