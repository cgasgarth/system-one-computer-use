# Validation

## Repeatable source checks

Run from the repository root:

```sh
bun run check
bun run format:check
bun run test
bun run test:native
```

These checks cover strict type-aware lint, source size, formatting, agent and model behavior, AppKit and Accessibility helpers. They do not prove a live task result. Check actual page or app state and stored effects after each live task.

## Current source evidence

The signed source includes prompt preparation at `c873ad3` and the page-action pager. Its strict check, format check, **248 Bun tests**, and **12 Python bridge tests** passed before installation. The action policy separates observed select-option actions from button actions. The pager presents long pages in bounded action groups. New benchmark runs save typed decision and text request data privately in ignored traces.

Prompt preparation uses the same system-message bytes as ordinary text requests. Independent wire checks found identical ordinary request bodies and answers for URL, search, and general text before and after the change. A held synthetic prefill did not block task preparation: preparation returned in 0.5 ms and cancelled the pending connection. A prefill error did not block the next task. External model selections made no speculative endpoint calls. All 15 paired local text outputs matched; measured cached-token counts and latency limits are in [model management](models.md#bounded-cache-measurement). These checks establish cache behavior, not better task completion.

In the [bounded seven-preset browser benchmark](benchmark.md) before the pager change, all **28/28** isolated localhost trials finished with one fixed Qwen 3.5 2B text writer, a stable fixture origin, equal browser-only action scope, canonical reset hashes, and no driver errors or unintended writes. Kev 4B and Kev 9B each passed 4/4 strict task grades. The other five presets passed 0/4; one Julia case returned an explicit capacity error. Failed tasks' short time to stop is not a completion speed result. This cohort is not a measured success rate for the installed pager build.

Kev 4B also passed **7/8** tasks across two new sets of names and layouts. In the one failure, the fixed text writer gave no value for a changed draft field twice. The field stayed empty and the editor stayed open. The agent chose Blocked and made no write. No prompt or action policy changed after this held-out result. These browser cases do not establish broad native-app task reliability or general model quality.

## Installed app result

### Native menu and target selection

Native menu commands are grouped by their observed top-level menu. The operation request includes the offered command paths; the target request carries the operation that the model selected. This keeps a command such as File > New from competing with every command in the system menu. The model can still return to other operations, choose another surface, finish, or stop. There are no application-name routes or confidence thresholds.

On one captured Calendar state, Kev 4B selected File > New Event or Reminder after this change. The comparison executed model requests only. Separate controls retained correct Finish, Blocked, and rejection of an unsuitable menu. On 18 fixed development states, the changed policy passed 17/18 and the baseline passed 16/18. The changed policy had no false Finish in this set. Both policies failed a pending-save state by selecting Save again. These are development checks, not an end-to-end success rate or a claim that repeat writes are solved.

The prompt-preparation build `c873ad3` was signed and installed with the same local certificate. Its installed runtime bundles and Python bridge matched the source build. System One reached Ready with the user's Kev 4B decision model and Qwen 3.5 2B text model. Auto control and Automatic session mode remained selected. System One Accessibility, CUA Accessibility, and CUA Screen Recording showed Granted.

Opening the installed task menu prepared the text cache. The first synthetic general-field request then reused **165 of 429 prompt tokens**. A subsequent unrelated readiness control reused 0 of 66 tokens. The probe sent no seed request and did not press Start, create a task session, or control another app. Typing and voice use the same warm call in source, but physical voice input was not retested in this check.

The last computer-task checks used the same action policy before prompt preparation was added. The read-only Calculator task completed in three actions: select desktop, open Calculator, Finish. A separate macOS accessibility read confirmed a real Calculator window. The Wikipedia task exposed a remaining **semantic failure**. The app opened Wikipedia's Main Page, entered `Chicago` in the search field, and chose Finish before opening the Chicago article. A fresh browser read and the saved task surface still had the Main Page URL and title, while the app displayed Completed. The pager removed the earlier 422 long-page error, but it did not prevent this false Complete. No page edit or user-data write occurred. Cache preparation does not fix or establish a successful Wikipedia result.

After QA, the original three session files and index, model preferences, and environment file were restored from a fresh preflight backup. The original task draft was returned to the Ready panel. Only the user's original Chrome tab remains. The app was left running and Ready. The signed installed build is usable for the validated Calculator path, but broad browser completion reliability remains unverified.

## Evidence limits

The browser grader checks actual final page state and all fixture write counters. It rejects an early Finish, wrong target, missed write, duplicate write, or unrelated write. The suite covers document navigation, unsaved drafts, editing and saving, and duplicate-label selection. It does not cover every app, complex canvas, drag, or vision-driven workflow.

Use [acceptance checks](acceptance.md) to choose the required evidence for a change. Raw traces can contain task content. Keep them under ignored `runs/` or the app data directory; publish only bounded counts and conclusions.
