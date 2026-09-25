# Validation

## Checks for the decision-owned loop (2026-09-24)

- 35 automated tests pass, with strict type-aware lint and the 600-line source limit.
- Swift 6 release compilation passes. The task and Settings views were rendered and inspected. Rendered views do not prove physical keyboard or speech behavior.
- The installed dropdown accepted typed text, enabled Start, selected desktop tools, showed live metrics, and accepted Stop. The stopped session was saved with status `stopped`.
- Session tests cover the one-hour boundary, process restart, explicit resume/new selection, three-session retention, and concurrent turn updates.
- Loop tests cover switching after observation failure, switching after saved-tab restoration failure, terminal choices on both surfaces, and Stop before a pending decision starts its action.
- Warm-up tests cover draft retention under the cold policy and unloading after an actual task releases the models.
- The Handy state machine passes Hold, Auto threshold, Toggle, repeat-edge, and cancellation checks. The installed Handy setting was Hold. Physical dictation and final transcript delivery still need an end-to-end check.

## Live model and driver results

CLM selected the expected initial surface for six prompts against a captured desktop listing: Messages, Calendar, and Finder selected desktop; OpenTable, Wikipedia, and Google search selected Chrome. This is a small routing check, not a general task-success benchmark.

A supervised live run opened Messages. It did not complete the requested conversation lookup: CLM repeated application-opening choices. Earlier app-selection tests opened unrelated apps; those tests were stopped and their apps closed. The current loop must not be described as reliable for arbitrary native workflows.

An installed-menu test of Open Calculator selected desktop tools and opened Calculator, but CLM continued selecting actions instead of finishing. Stop ended the test. This is an incomplete task run, not a success result.

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
