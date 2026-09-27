# Decision preset benchmark

## Current result

The current one-trial comparison ran seven decision presets on the same four disposable browser tasks. Each preset used the same Qwen 3.5 2B text writer, model artifacts, task text, browser action scope, and localhost fixture origin. All **28/28 trials** finished. There were no driver errors, unintended writes, failed model loads, or cleanup errors.

| Decision preset          | Strict pass | Correct task median, seconds / turns | All task median to stop, seconds / turns¹ | First-unique model request p50, ms² |
| ------------------------ | ----------: | -----------------------------------: | ----------------------------------------: | ----------------------------------: |
| CLM 8B 4-bit · MLX       |         0/4 |                                    — |                                 0.197 / 1 |                                 189 |
| CLM 8B 8-bit · MLX       |         0/4 |                                    — |                                 0.198 / 1 |                                 191 |
| CLM 8B BF16 · MLX        |         0/4 |                                    — |                                 0.223 / 1 |                                 216 |
| Kev 0.8B BF16 · MLX      |         0/4 |                                    — |                                 0.086 / 1 |                                  31 |
| **Kev 4B BF16 · MLX**    |     **4/4** |                      **0.812 / 2.5** |                           **0.812 / 2.5** |                             **153** |
| Kev 9B BF16 · MLX        |         4/4 |                          2.036 / 2.5 |                               2.036 / 2.5 |                                 274 |
| Julia 1 FP32 · Torch CPU |         0/4 |                                    — |                                 0.110 / 1 |                                  37 |

¹ The all-task value includes failures. For a failed task, it measures time until the task stopped, **not** time to a correct result. A fast Blocked or wrong Finish is not a speed win. ² A first-unique request has a distinct exact request-body hash within that model's run. It can still use a partial model cache, so it is not a cold inference measurement. Kev 4B and Kev 9B each had one identical-repeat request; its response time was 116 and 215 ms, respectively. The other presets had no identical-repeat request in this run.

| Decision preset | Open document | Leave draft open  | Edit and save  | Select duplicate |
| --------------- | ------------- | ----------------- | -------------- | ---------------- |
| CLM 8B 4-bit    | Blocked       | Blocked           | No save        | No choice save   |
| CLM 8B 8-bit    | Blocked       | Blocked           | No save        | No choice save   |
| CLM 8B BF16     | Blocked       | Blocked           | No save        | No choice save   |
| Kev 0.8B        | Blocked       | Wrong final state | No save        | No choice save   |
| **Kev 4B**      | **Pass**      | **Pass**          | **Pass**       | **Pass**         |
| Kev 9B          | Pass          | Pass              | Pass           | Pass             |
| Julia 1         | Blocked       | Blocked           | Capacity error | No choice save   |

Kev 4B and Kev 9B passed the same four cases. Kev 4B took less task time on each matched case: Open 0.6 versus 2.3 seconds, draft 0.6 versus 0.8, edit and save 1.6 versus 2.6, and duplicate choice 1.0 versus 1.8. These are single trials, so they do not give a stable latency estimate.

The policy also faced two new sets of task terms and page layouts. Kev 4B passed **7/8 held-out tasks**. It passed all four in set B. In set A it passed Open, Edit and save, and Select duplicate. The draft failed because the fixed text writer supplied no suitable value for a new field twice; the field stayed empty, the editor stayed open, and the decision model then chose Blocked. There was no stored write. No policy or prompt changed after this held-out result.

These small synthetic browser tasks do not rank general model intelligence, native app use, or same-weight runtime speed. The app keeps the user's Kev 4B selection.

## Method and evidence

The four tasks require: open a named document with no write; enter text and leave a dialog open with no write; change and save a document with exactly one document POST; and select an option from one of two groups with the same visible label and make exactly one choice POST. The grader checks the final page and every fixture write counter. A wrong target, early Finish, missing write, duplicate write, or unrelated write fails. The fixture resets its data and checks the same normalized initial state before each task.

The run used a private isolated Chrome context and a single localhost origin. It did not use the user's browser tabs or app sessions. Browser-only action scope was the same for every preset. Each decision model loaded alone with the fixed Qwen writer and stopped before the next model loaded. Task time starts just before `runTask` and ends when it returns or fails; model download, load, fixture setup, and grading are outside task time. The one-trial run is a bounded comparison, not the default three-trial benchmark plan.

The host was an Apple M5 Pro with 48 GiB RAM on AC power (`pmset powermode 2`). No thermal warning was recorded. Kev and CLM used MLX on the Apple GPU at the stated precision. Julia used Torch on the CPU in FP32 with four CPU threads and its strict 20-choice and token limits. Julia's edit case hit a recorded capacity error; it was not treated as a semantic success.

The ignored evidence is in `runs/benchmark/1f47afeb-26dd-4c29-a9dc-1001afbffc00/`. It has all 28 traces, exact decision request JSON and SHA-256 hashes, per-case write counts, startup records, resolved model assets, `final-28-summary.json`, and `run-status.json`. The held-out traces are in `runs/benchmark/259c29b4-a7df-450a-81dc-c667373df8c9/` and `runs/benchmark/ad79bf55-892d-4b7a-b53e-5406fa67b2ac/`. The final 28 source content hash is `2d7a9c386672bb5caf25b18eb44195a9f249595a8fc857ad929e2af93c5716ab`; the fixture hash is `ae3631445776772707e90216b628cd002b80c3b62ecada5e670fd6304b17f553`. The policy commit was `5aa775e`.

| Frozen input                      | Resolved revision                          |
| --------------------------------- | ------------------------------------------ |
| CLM head, all three precisions    | `e939398d4556fcd9400c76fa8c5a513202f42b0a` |
| CLM encoder, all three precisions | `b968826d9c46dd6066d109eabc6255188de91218` |
| Kev 0.8B                          | `9a45d25eb2ab761841196625383fa1dff0e56c1e` |
| Kev 4B                            | `139fdd94f1b6a6ad80cc15e08fcb99cac885a101` |
| Kev 9B                            | `2629c06a5aeb0feb3b9783bafed17ed8f39ecf5c` |
| Julia 1                           | `a85b127321d580d65176c89ced8273f305745d85` |
| Qwen 3.5 2B text writer           | `674aaa7240b91e8012fcad5d791b7dfe5ba90207` |

These are the resolved inputs for this run. The app checks for newer assets and offers Update when needed. The source does not hardcode these revisions. Full asset fingerprints are in the ignored manifest.

## Repeat the benchmark

Quit System One and confirm its model host stopped. The runner starts its own private browser and model processes. It does not change app preferences.

```sh
bun scripts/evals/benchmark.ts plan
bun --no-env-file --env-file "$HOME/Library/Application Support/SystemOneComputerUse/.env" scripts/evals/benchmark.ts run
```

The default plan has seven decision presets, four tasks, and three trials per task: 84 trials. The runner resolves the latest artifacts once for that matrix and holds them fixed during the trials. It requires 200 GiB free disk space, limits new cache use to 80 GiB, checks memory between trials, and stops on a resource limit or an observed browser escape. A single model load failure is recorded while the other models continue. Check `run-status.json` for cleanup errors before starting the app again.

Each ignored run folder has `manifest.json`, `startup.json`, `trials.jsonl`, `summary.json`, `run-status.json`, and one trace per trial. The benchmark now also saves typed text request and response JSON privately in each new trace. Published summaries use counts and timings; raw traces can contain task content and stay ignored. The benchmark measures task fit across different model packages. It does not measure a same-weight runtime speedup.
