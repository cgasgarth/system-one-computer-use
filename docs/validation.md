# Validation

## Repeatable checks

Run these from the repository root:

```bash
bun run check
bun run format:check
bun run test
bun run test:native
uv run --project integrations/clm-mlx --frozen --no-editable python -m unittest integrations/local-bridge/test_serve.py -q
```

The Bun checks cover strict type-aware lint, the 600-line source limit, formatting, and unit behavior. Native tests cover the AppKit and Accessibility helper paths. The Python tests cover local socket framing, cancellation, and errors without loading a model. An installed-app check is a separate product gate.

## Verified coverage

At source commit `9a421b3`, `bun run check`, `bun run format:check`, and `bun run test` passed with 201 tests. A disposable Bun build produced the worker, daemon, and permission-status entry points. Tests cover Stop while an Accessibility watcher is pending, normal/error/timeout watcher cleanup, browser reuse, desktop release, concurrent shutdown, and rejection of new drivers after shutdown.

A source QA run on that commit passed four disposable tasks:

| Task                          | Observed result                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Edit and save                 | Four steps, 2.23 seconds, exactly one matching document write.                                                             |
| Fill an unsaved draft         | Two steps, 714 ms, no stored write.                                                                                        |
| Leave a prefilled editor open | One step, 185 ms, no stored write.                                                                                         |
| Serialized session follow-up  | Two steps in each request; the target was restored after reconnect, with zero changes to all seven tracked write counters. |

The task times exclude model loading. The local artifacts are under ignored `runs/qa/recovery/arch-9a421b3-20260927T173957Z/` and `runs/qa/overnight/session-followup-reconnect-1d4d12f4-1007-4fae-831e-d9a57ba7f31e.json`. These cases check specific paths, not general task success. Native status and permission tests, seven Python socket bridge tests, and the disposable Bun bundle build also pass at this source revision.

The signed installed update used the same signing certificate; all three JavaScript bundles matched a fresh source build. The install left model preferences, the environment file, the draft plist, and all four session files unchanged. The app reached Ready with Kev and Qwen. System One and CUA Accessibility, and CUA Screen Recording, remained Granted without another authorization step. A menu task selected desktop, selected Calculator by name, and then chose Finish; a separate native read confirmed its window.

In a separate installed task, Stop arrived during target inference before TextEdit launch. The task ended as stopped and no TextEdit window opened. A following Calculator task completed, which confirms that Stop did not leave the menu task path unusable. One earlier Calendar Stop attempt raced normal completion; it did not create an event. These checks do not prove physical Handy shortcut delivery or general native-task reliability.

The QA turns displaced one older session under the three-session retention rule. After grading them, QA restored the original three session files and index byte for byte and kept its test session under ignored `runs/`. Quit stopped the owned worker, model daemon, model processes, and sockets.

## Limits

Disposable local browser cases have exercised document navigation, editing and saving, unsaved drafts, duplicate-label selection, changed controls, and session follow-up. A model Finish was graded against actual page state and write counters. Native menu and browser capability coverage still varies by app and page. Complex canvas, drag, and vision-driven workflows have not been validated broadly.

Use [acceptance checks](acceptance.md) to choose the evidence level for a change. Confirm the actual task result outside the model, count unintended writes, and preserve failures in the report. Local traces can contain private app content; keep them under ignored `runs/` or `~/Library/Application Support/SystemOneComputerUse/`.
