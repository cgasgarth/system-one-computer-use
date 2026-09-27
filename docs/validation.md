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

## Current preset and installed-app gate

At source commit `b111464`, strict check, format check, and all **224 Bun tests** passed. The Julia integration also passed 28 Python tests. The signed macOS install built with Command Line Tools and kept the same certificate-bound designated requirement. The installed Models menu listed Julia 1. Selecting it started the Julia CPU Unix process at revision `a85b127321d580d65176c89ced8273f305745d85` and showed Ready. The selected model was then restored to Kev 4B. The saved model preferences matched the preinstall copy byte for byte; all four session files and their index remained unchanged. The environment file only gained the app-managed `SYSTEM_ONE_MAX_CHOICES` key. The app was left Ready with the original Calculator draft, Auto control surface, and Automatic session mode. No user task was submitted for this gate.

The installed Julia, Kev 4B, and Qwen artifact manifests matched the latest runtime-asset check at validation time, so no Update control appeared for those current files. No new release was simulated. The source updater tests cover an available update and cancellation while base metadata is pending; installed UI validation covers only the current-file state.

The corrected [seven-preset browser benchmark](benchmark.md) completed 84/84 isolated localhost trials with one fixed Qwen writer, a stable fixture origin, equal browser-only actions, canonical reset hashes, exact request capture, and no driver errors. Strict success was Kev 9B 12/12 and Kev 4B 9/12; five other presets passed 0/12 on these four development cases. Three Kev 4B failures reached the requested saved selection but made a second POST, so they remain strict failures. CLM identical-request cache hits are reported separately from first-unique request times. These cases do not establish general desktop-task or model quality.

## Limits

Disposable local browser cases have exercised document navigation, editing and saving, unsaved drafts, duplicate-label selection, changed controls, and session follow-up. A model Finish was graded against actual page state and write counters. Native menu and browser capability coverage still varies by app and page. Complex canvas, drag, and vision-driven workflows have not been validated broadly.

Use [acceptance checks](acceptance.md) to choose the evidence level for a change. Confirm the actual task result outside the model, count unintended writes, and preserve failures in the report. Local traces can contain private app content; keep them under ignored `runs/` or `~/Library/Application Support/SystemOneComputerUse/`.
