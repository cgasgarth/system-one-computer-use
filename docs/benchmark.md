# Decision preset benchmark

The matrix uses the same four disposable browser tasks for each available decision preset. It runs three trials per task and keeps Qwen 3.5 2B as the text writer for every trial. The current plan has seven decision presets and 84 task trials.

## Run

1. Quit System One and confirm that its model host has stopped. Keep the user's Chrome tabs open. Open one new blank Chrome tab for this test.
2. Check the plan without loading a model:

   ```sh
   bun scripts/evals/benchmark.ts plan
   ```

3. Run from the repository root with the installed app's existing environment file. This reads the Chrome extension token; it does not change app preferences:

   ```sh
   bun --no-env-file --env-file "$HOME/Library/Application Support/SystemOneComputerUse/.env" scripts/evals/benchmark.ts run
   ```

4. Close only the new test tab after the run. The runner stops its source model processes and removes its private temporary runtime directory. Check `run-status.json` for any cleanup error before using the app again.

The runner resolves the latest artifact manifest for all presets and the fixed text model before the first task. It uses that saved revision for each download and model load. A CLM encoder or head fingerprint mismatch stops the matrix. A single preset load failure is recorded and the other presets continue. A resource limit or a browser escape stops the matrix.

## Cases and grades

| Case             | Required result                                       | Allowed persistent fixture writes |
| ---------------- | ----------------------------------------------------- | --------------------------------: |
| Open document    | Roadmap Review is open                                |                                 0 |
| Leave draft      | `Draft Only` is in the open Project editor            |                                 0 |
| Edit and save    | Roadmap Review has the requested text and a saved URL |                   1 document save |
| Select duplicate | External `High` is selected and saved                 |                     1 choice save |

Every trial starts with fresh in-memory fixture data. The grader checks all write counters, including writes unrelated to the task. An early Finish, wrong target, missed save, duplicate save, or unrelated write fails the trial. An unintended write stops that trial but does not hide the other model results. Browser actions are limited to the disposable localhost fixture. Each task has a 60-second benchmark deadline; this does not change the app's task action limit.

## Files and metrics

Each ignored `runs/benchmark/<run-id>/` folder has `manifest.json`, `startup.json`, `trials.jsonl`, `summary.json`, `run-status.json`, and one trace per trial. The manifest records source and fixture hashes, model artifact revisions, runtime fingerprints, artifact lookup time, chip, RAM, current power settings, and thermal status. Startup records separate cache preparation, model load, and ready-probe time. It also records the fixed Qwen load. Each model runs alone with Qwen; the decision model changes only after its trials finish.

`summary.json` reports task success rate and failure counts. Median task seconds, turns, and decision request count use successful tasks only. Task time starts just before `runTask` and ends when it returns or fails; fixture setup and grading are outside this time. Median completed decision request time uses every completed request, including requests from failed tasks. A preset with no trials has no success rate or speed value. Capacity errors, response format errors, timeouts, model errors, and browser errors have separate counts.

The runtime labels matter. Kev and CLM use MLX on the Apple GPU at the stated precision. Julia 1 uses Torch 2.14.0 and Transformers 5.0.0 on the CPU in FP32 with four CPU threads. Its strict 20-choice and token limits stay enabled. The comparison measures end-to-end task fit across different model packages. It does not show a same-weight runtime speedup. Artifact fingerprints come from Hugging Face metadata; the runner does not hash all downloaded weight bytes again.

The runner requires at least 200 GiB free disk space and limits new cache use to 80 GiB. It checks memory before each model load and after each trial. It does not load decision models together. The source runner uses private Unix sockets and separate `uv` runtimes; it does not install packages into the user's app runtime.
