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

The signed installed source includes pager commit `0d8f22e`. Its strict check, format check, and **242 Bun tests** passed before installation. The action policy separates observed select-option actions from button actions. The pager presents long pages in bounded action groups. New benchmark runs save typed decision and text request data privately in ignored traces.

In the [bounded seven-preset browser benchmark](benchmark.md) before the pager change, all **28/28** isolated localhost trials finished with one fixed Qwen 3.5 2B text writer, a stable fixture origin, equal browser-only action scope, canonical reset hashes, and no driver errors or unintended writes. Kev 4B and Kev 9B each passed 4/4 strict task grades. The other five presets passed 0/4; one Julia case returned an explicit capacity error. Failed tasks' short time to stop is not a completion speed result. This cohort is not a measured success rate for the installed pager build.

Kev 4B also passed **7/8** tasks across two new sets of names and layouts. In the one failure, the fixed text writer gave no value for a changed draft field twice. The field stayed empty and the editor stayed open. The agent chose Blocked and made no write. No prompt or action policy changed after this held-out result. These browser cases do not establish broad native-app task reliability or general model quality.

## Installed app result

The pager build was signed and installed with the same local certificate. System One reached Ready with the user's Kev 4B decision model and Qwen 3.5 2B text model. Auto control and Automatic session mode remained selected. System One Accessibility, CUA Accessibility, and CUA Screen Recording showed Granted.

The read-only Calculator task completed in three actions: select desktop, open Calculator, Finish. A separate macOS accessibility read confirmed a real Calculator window. The Wikipedia task exposed a remaining **semantic failure**. The app opened Wikipedia's Main Page, entered `Chicago` in the search field, and chose Finish before opening the Chicago article. A fresh browser read and the saved task surface still had the Main Page URL and title, while the app displayed Completed. The pager removed the earlier 422 long-page error, but it did not prevent this false Complete. No page edit or user-data write occurred. The installed task must not be called a successful Wikipedia result.

After QA, the original three session files and index, model preferences, and environment file were restored from a fresh preflight backup. The original task draft was returned to the Ready panel. Only the user's original Chrome tab remains. The app was left running and Ready. The signed installed build is usable for the validated Calculator path, but broad browser completion reliability remains unverified.

## Evidence limits

The browser grader checks actual final page state and all fixture write counters. It rejects an early Finish, wrong target, missed write, duplicate write, or unrelated write. The suite covers document navigation, unsaved drafts, editing and saving, and duplicate-label selection. It does not cover every app, complex canvas, drag, or vision-driven workflow.

Use [acceptance checks](acceptance.md) to choose the required evidence for a change. Raw traces can contain task content. Keep them under ignored `runs/` or the app data directory; publish only bounded counts and conclusions.
