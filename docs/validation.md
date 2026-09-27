# Validation

## Repeatable source checks

Run from the repository root:

```sh
bun run check
bun run format:check
bun run test
bun run test:native
uv run --project integrations/clm-mlx --frozen --no-editable python -m unittest integrations/local-bridge/test_serve.py -q
```

These checks cover strict type-aware lint, source size, formatting, agent and model behavior, AppKit and Accessibility helpers, and local Unix socket framing and cancellation. They do not prove a live task result. Check actual page or app state and stored effects after each live task.

## Current source evidence

At source commit `33543ce`, strict check, format check, and all **276 Bun tests** passed. The action policy separates observed select-option actions from button actions. The decision model can choose a control that is present in the current snapshot, including an option in a grouped select. The benchmark stores exact typed decision request bodies and hashes. New runs also save typed text request and validated response JSON privately in each ignored trial trace. The 28-task cohort below preceded that text-wire capture, so its traces contain decision wires but not text wires.

In the [current seven-preset browser benchmark](benchmark.md), all **28/28** isolated localhost trials finished with one fixed Qwen 3.5 2B text writer, a stable fixture origin, equal browser-only action scope, canonical reset hashes, and no driver errors or unintended writes. Kev 4B and Kev 9B each passed 4/4 strict task grades. The other five presets passed 0/4; one Julia case returned an explicit capacity error. Failed tasks' short time to stop is not a completion speed result. The report lists every case result, correct-task time, turns, and first-unique model request time.

Kev 4B also passed **7/8** tasks across two new sets of names and layouts. In the one failure, the fixed text writer gave no value for a changed draft field twice. The field stayed empty and the editor stayed open. The agent chose Blocked and made no write. No prompt or action policy changed after this held-out result. These browser cases do not establish broad native-app task reliability or general model quality.

The installed app has **not yet been validated against the current source**. A signed install, permission check, Ready state, and read-only app tasks are separate release gates. Do not describe the prior installed build as this source revision.

## Evidence limits

The browser grader checks actual final page state and all fixture write counters. It rejects an early Finish, wrong target, missed write, duplicate write, or unrelated write. The suite covers document navigation, unsaved drafts, editing and saving, and duplicate-label selection. It does not cover every app, complex canvas, drag, or vision-driven workflow.

Use [acceptance checks](acceptance.md) to choose the required evidence for a change. Raw traces can contain task content. Keep them under ignored `runs/` or the app data directory; publish only bounded counts and conclusions.
