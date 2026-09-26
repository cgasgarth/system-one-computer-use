# Evidence and experiments for the System One computer-use harness

Research snapshot: 2026-09-26. This document records source-backed design facts,
local observations, and experiments to run. A proposal is not a measured gain.
The controller remains provider-neutral: a decision model chooses a supported
operation, target, DONE, or BLOCKED. A text model supplies arguments only after a
tool choice. No task planner, site workflow, or custom model training is proposed.

## Working conclusions

1. Keep current observations, tool-call returns, and verified effects as
   different facts. Temporal requests need a small history of observed
   transitions; successful tool prose is weak completion evidence.
2. Check target freshness before an action. Check the actual effect after it.
   Neither check replaces the other, especially for writes and retries.
3. Treat CLM candidate descriptions as policy text. Calibrate DONE, BLOCKED,
   target match, and click decisions on separate held-out task data. The
   current probability gates are heuristics.
4. Grade operation choice and target choice separately. Long screens can
   offer an action whose distinguishing control is absent from model state.
5. Use paired, independently graded browser and native tasks before claiming
   reliability or optimizing away model calls.

## Detailed records

- [Sources and local findings](./source-findings.md) records primary-source scope, runtime provenance, local failures, and unsupported assumptions.
- [Harness experiments and evaluation](./experiment-plan.md) lists paired tests for grounding, freshness, effects, stopping, latency, and held-out outcomes.
- [Model probes and task-effect constraints](./model-probes.md) records the q4/q8/BF16/Kev-4B fixed-input results, wrong-commit analysis, and the bounded gate ablation.

## Current status

The disposable browser suite has shown wrong-target actions, false completion, false BLOCKED, and unwanted writes. The strongest read-only model comparison uses 53 frozen request bodies; it is a development probe over five target states, seven task texts, and six controls. Kev-4B chose all 20 target variants correctly but still missed some effect judgments. CLM q8 and BF16 were close to each other on these inputs but did not solve the effect errors. None of those counts is an end-to-end task-success rate.

Five copied q4 traces in a folder named `kev4b_uniform_7137b90c` were identified as invalid Kev evidence. Use only the explicit Kev replay at `runs/research/overnight/precision-kev4b-results.json` for that comparison, and require fresh model/provenance checks for live task claims.

The next acceptance gate is independently graded, multi-step browser and native tasks with per-case checks for **all** unrequested writes. Keep the task loop provider-neutral; System One chooses tools and terminal actions, while the text model only supplies arguments after tool choice.

## Paused checkpoint

This is a work-in-progress checkpoint, not a release. The last pre-pause
strict baseline passed the source checks and 97 tests. No tests or live tasks
were run after the user paused work. An unintegrated effect-history draft
was removed. The current source was not installed as a final verified build.
False completion, wrong targets, and rejected valid actions remain open.
System One, its managed model servers, and disposable test resources were
closed. User model preferences, sessions, and the task draft were preserved.

The user paused work before the M/A/T commit-gate ablation was fully reviewed.
No causal result from those arms is claimed here. The exact Profile operation
and four-task dialog-final-state probes are complete in the linked records.
The prepared long-list hierarchy and field-readiness wording probes were
**not run**. Any later work should first verify the provenance of each
ablation artifact and separate a model decision from the effect seen in the
browser fixture.
