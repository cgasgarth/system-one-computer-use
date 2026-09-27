# Decision preset benchmark

The matrix uses the same four disposable browser tasks for each available decision preset. It runs three trials per task and keeps Qwen 3.5 2B as the text writer for every trial. The current plan has seven decision presets and 84 task trials.

## Result on 2026-09-27

The corrected isolated run completed **84/84 trials**, with no driver errors, load failures, or cleanup errors. Each trial used the same localhost origin. The observed initial-state hash matched across models for each case. The Mac was an Apple M5 Pro with 48 GiB RAM, on AC power (`pmset powermode 2`); the thermal check had no recorded warning. The text model was Qwen 3.5 2B 4-bit at revision `674aaa7240b91e8012fcad5d791b7dfe5ba90207`.

| Decision preset          | Strict pass | Correct-task median seconds / turns | All-trial median seconds / turns¹ | First-unique request p50 ms² | Identical-repeat request p50 ms² |
| ------------------------ | ----------: | ----------------------------------: | --------------------------------: | ---------------------------: | -------------------------------: |
| CLM 8B 4-bit · MLX       |        0/12 |                                   — |                         0.007 / 1 |                        139.3 |                             0.59 |
| CLM 8B 8-bit · MLX       |        0/12 |                                   — |                         0.589 / 7 |                        201.6 |                             0.48 |
| CLM 8B BF16 · MLX        |        0/12 |                                   — |                        1.532 / 12 |                        211.7 |                             0.48 |
| Kev 0.8B BF16 · MLX      |        0/12 |                                   — |                         0.130 / 1 |                         30.0 |                            29.84 |
| Kev 4B BF16 · MLX        |        9/12 |                           0.586 / 2 |                       0.955 / 2.5 |                        119.9 |                           119.46 |
| **Kev 9B BF16 · MLX**    |   **12/12** |                     **1.626 / 2.5** |                   **1.626 / 2.5** |                    **228.6** |                       **220.04** |
| Julia 1 FP32 · Torch CPU |        0/12 |                                   — |                       0.824 / 2.5 |                         37.0 |                            36.62 |

¹ All-trial values include failed tasks and show time to stop, **not** time to a correct result. A fast Blocked or wrong Finish is not a speed win. ² Exact typed request-body hashes identify the first use and later identical repeats. A first-unique request can still use partial model caches; it is not a cold inference claim. CLM repeated identical requests returned in about 0.5 ms, which made its all-request median cache dominated. Kev request times changed much less on repeats.

| Decision preset | Open document | Leave draft | Edit and save | Select duplicate |
| --------------- | ------------: | ----------: | ------------: | ---------------: |
| CLM 8B 4-bit    |           0/3 |         0/3 |           0/3 |              0/3 |
| CLM 8B 8-bit    |           0/3 |         0/3 |           0/3 |              0/3 |
| CLM 8B BF16     |           0/3 |         0/3 |           0/3 |              0/3 |
| Kev 0.8B        |           0/3 |         0/3 |           0/3 |              0/3 |
| Kev 4B          |           3/3 |         3/3 |           3/3 |              0/3 |
| **Kev 9B**      |       **3/3** |     **3/3** |       **3/3** |          **3/3** |
| Julia 1         |           0/3 |         0/3 |           0/3 |              0/3 |

For the three cases **both** Kev 4B and Kev 9B passed, median correct-task seconds were: Open document 0.567 vs 1.094, Leave draft 0.565 vs 0.848, and Edit and save 1.900 vs 2.474. Kev 4B has no correct-task time for Select duplicate because all three trials made an extra save.

Kev 4B selected and saved the requested External High value in all three Select duplicate trials. It then clicked Save again after the page showed `saved=1` and a saved status. Those three extra POSTs fail the strict write grade, even though the requested state was visible before the extra write. CLM 8-bit made three unrelated document writes in that disposable case. Julia 1 had three strict capacity errors. These effects were confined to reset localhost fixtures.

Kev 9B had the highest strict success on **these four browser tasks**. Kev 4B was faster on the three matched task types but made duplicate saves on Select duplicate. This is a small synthetic test with a browser-only action menu. It does not rank native app choices, general agent intelligence, or same-weight runtime speed. The app keeps the user's Kev 4B selection; this benchmark does not change it.

The local evidence is in ignored `runs/benchmark/6827717b-b821-4de9-af47-01e3426f3e18/`: all 84 traces, exact request bodies and hashes, full comparison CSV/JSON, model startup times, resolved revisions and asset fingerprints. Run source hash: `7bbf48ab…`; fixture hash: `c93b427f…`; source HEAD: `b111464`. Qwen's fixed post-load probe took 139 ms beside Kev 4B and 2842 ms beside Kev 9B, but later real text requests with Kev 9B were 152–181 ms. The cause of that one probe difference is unknown.

| Frozen model source          | Checkpoint or head revision                | Base or encoder revision                   |
| ---------------------------- | ------------------------------------------ | ------------------------------------------ |
| CLM 8B, all three precisions | `e939398d4556fcd9400c76fa8c5a513202f42b0a` | `b968826d9c46dd6066d109eabc6255188de91218` |
| Kev 0.8B                     | `9a45d25eb2ab761841196625383fa1dff0e56c1e` | `dc7cdfe2ee4154fa7e30f5b51ca41bfa40174e68` |
| Kev 4B                       | `139fdd94f1b6a6ad80cc15e08fcb99cac885a101` | `1001bb4d826a52d1f399e183466143f4da7b741b` |
| Kev 9B                       | `2629c06a5aeb0feb3b9783bafed17ed8f39ecf5c` | `68c46c4b3498877f3ef123c856ecfde50c39f404` |
| Julia 1                      | `a85b127321d580d65176c89ced8273f305745d85` | Included in checkpoint                     |

These revisions are the resolved model inputs **for this run**. The app checks for newer runtime assets and offers Update when they are available; preset code does not hardcode these revisions. Full source and base asset fingerprints are in the ignored run manifest.

## Run

1. Quit System One and confirm that its model host has stopped. The runner starts a private isolated Chrome context; it does not use the user's tabs.
2. Check the plan without loading a model:

   ```sh
   bun scripts/evals/benchmark.ts plan
   ```

3. Run from the repository root with the installed app's existing environment file. The runner loads local model settings but uses a private browser, not the Chrome extension token. It does not change app preferences:

   ```sh
   bun --no-env-file --env-file "$HOME/Library/Application Support/SystemOneComputerUse/.env" scripts/evals/benchmark.ts run
   ```

4. The runner closes its private browser and model processes and removes its private temporary runtime directory. Check `run-status.json` for any cleanup error before using the app again.

The runner resolves the latest artifact manifest for all presets and the fixed text model before the first task. It uses that saved revision for each download and model load. A CLM encoder or head fingerprint mismatch stops the matrix. A single preset load failure is recorded and the other presets continue. A resource limit or a browser escape stops the matrix.

## Cases and grades

| Case             | Required result                                       | Allowed persistent fixture writes |
| ---------------- | ----------------------------------------------------- | --------------------------------: |
| Open document    | Roadmap Review is open                                |                                 0 |
| Leave draft      | `Draft Only` is in the open Project editor            |                                 0 |
| Edit and save    | Roadmap Review has the requested text and a saved URL |                   1 document save |
| Select duplicate | External `High` is selected and saved                 |                     1 choice save |

Every trial resets fresh in-memory fixture data at one stable origin. The runner loads a new page and checks its canonical values and normalized initial-state hash before any model request. The grader checks all write counters, including writes unrelated to the task. An early Finish, wrong target, missed save, duplicate save, or unrelated write fails the trial. An unintended write stops that trial but does not hide the other model results. Browser actions are limited to the disposable localhost fixture. Each task has a 60-second benchmark deadline; this does not change the app's task action limit.

## Files and metrics

Each ignored `runs/benchmark/<run-id>/` folder has `manifest.json`, `startup.json`, `trials.jsonl`, `summary.json`, `run-status.json`, and one trace per trial. Each trace has exact decision request JSON and SHA-256 hashes. The manifest records source and fixture hashes, model artifact revisions, runtime fingerprints, artifact lookup time, chip, RAM, current power settings, and thermal status. Startup records separate cache preparation, model load, and ready-probe time. It also records the fixed Qwen load and the same post-load Qwen probe for each decision model. Each decision model runs alone with Qwen, then stops before the next model loads.

`summary.json` reports task success rate and failure counts. Median task seconds, turns, and decision request count use successful tasks only. Task time starts just before `runTask` and ends when it returns or fails; fixture setup and grading are outside this time. Median completed decision request time uses every completed request, including requests from failed tasks. A preset with no trials has no success rate or speed value. Capacity errors, response format errors, timeouts, model errors, and browser errors have separate counts.

The runtime labels matter. Kev and CLM use MLX on the Apple GPU at the stated precision. Julia 1 uses Torch 2.14.0 and Transformers 5.0.0 on the CPU in FP32 with four CPU threads. Its strict 20-choice and token limits stay enabled. The comparison measures end-to-end task fit across different model packages. It does not show a same-weight runtime speedup. Artifact fingerprints come from Hugging Face metadata; the runner does not hash all downloaded weight bytes again.

The runner requires at least 200 GiB free disk space and limits new cache use to 80 GiB. It checks memory before each model load and after each trial. It does not load decision models together. The source runner uses private Unix sockets and separate `uv` runtimes; it does not install packages into the user's app runtime.
