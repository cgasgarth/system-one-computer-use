# Kev and CLM: controller and runtime assessment

Date: 2026-09-27.

The consultation reviewed source from `85ade1d`. Later fixes must be assessed
against the current controller, not assumed missing because they appear in that
older snapshot.

## Operational choice

Kev 4B is the default local decision model. This is a deployment choice based on
development checks and observed task outcomes. It is not a claim that Kev is a
better model on every benchmark. Existing saved model selections are preserved.

The public CLM headline coding results use task-specific verifier heads and
candidate solutions from other models. Its released generic head and our local
computer-use controller are different systems. See the
[CLM model card](https://huggingface.co/Contrastive-LM/CLM-v0.1-8B) and
[Kev model card](https://huggingface.co/jaredpalmer/kev-4b).
The app pins revision `139fdd94f1b6a6ad80cc15e08fcb99cac885a101`; the public
model card can change independently of that pin.

## Accepted controller repairs

| Finding                                                 | Chosen implementation                                                                                                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hidden app or website action during surface selection   | Surface selection only selects tools. The decision model selects the next executable action.                                                                                 |
| Same-label controls lose their row identity             | Use observed container context in candidate descriptions, text arguments, refreshed field binding, and effect checks. Do not infer an owner from several unrelated headings. |
| A literal URL can be search content                     | Offer literal addresses as explicit navigation choices. The model selects a destination; the writer does not receive an automatic host override.                             |
| Repeated correlated relevance checks veto valid actions | Trust the selected grounded action; retain effect authorization, field read-back, and fresh observations.                                                                    |
| Exhaustive internal checks create a stalled turn        | Bound requests and elapsed time within one decision. Stop reports a stalled decision, not missing user input. Total task actions remain uncapped.                            |
| Current-target completion depends on historical context | Use the current request and observation for completion, including fresh sessions. Retain the full current request.                                                           |
| Previous verifier scores influence later completion     | Keep factual tool returns; remove prior verifier answers and probabilities from completion evidence.                                                                         |
| Completion preflight skips required actions             | Select the next action first, including Finish. Re-observe before accepting Finish; do not ask a second model judge to veto it.                                              |

All confidence cutoffs remain removed. Categorical answers control decisions;
probability validation checks the protocol, not a confidence threshold.

## Completion experiments

The controlled development probes compared the same questions sent serially and
in a batch. Both providers returned identical choices and probabilities. That
establishes protocol parity for those inputs, not semantic correctness.

Several proposed semantic gates failed and were rejected for deployment. A
separate target judge blocked valid CLM results. Longer completion wording made
Kev falsely finish on a page that merely listed the requested link. A direct
choice among actions correctly selected that link but repeated text entry on a
completed draft.

The short completion wording plus pending persistence matched six of six synthetic
Finish labels for Kev, but then failed four of seven real disposable browser
flows. It is not the deployed policy.

The selected policy asks the model to choose an action first. Finish is an
explicit choice, followed by a fresh observation.
There is no completion preflight or separate completion judge. On the same
seven browser cases, six passed: open a document, fill an unsaved draft, edit and
save, click a replaced button, select a duplicate-label option, and leave an
already-open editor unchanged. The context-only follow-up case still blocked;
its prose history omitted the typed saved surface used by the app. A separate
serialized SessionStore follow-up restored the saved document after the active
page changed. These are development checks, not a held-out benchmark.

A later repeat saved the exact requested document once and selected Finish, but
the pending-persistence judge incorrectly vetoed it despite visible saved text
and a saved-status message. That judge was also rejected. The final policy trusts
the main Finish choice after the fresh-screen check. This is not independent
proof of task success; evaluation still grades the actual result and write
counters. Authorization before persistent actions and typed-field read-back
remain in place.

## Encoder and serving findings

The CLM port retains the upstream heads, raw-text encoding, last-real-token
pooling, normalization, and scoring path. The partial reference check found no
reason to replace those operations with a different template or pooling rule.
The Torch MPS SDPA singleton reference was inconsistent with its own padded batch
in this environment; CPU/MPS eager controls were used to isolate that issue.

MLX BF16 closely matched the valid checked reference. Q4 changed a development
choice. Precision variants must be measured separately. Numerical results,
pinned inputs, and their limits are in [model probes](model-probes.md).

The production CLM encoder rejects inputs over 2,048 tokens. The stock service
can truncate them. This is a documented policy difference; we do not silently
drop task constraints to imitate a reference. Character budgets do not prove
token-length compliance.

The pinned Kev HTTP worker has a conditional cancelled-future hazard. Our local
socket bridge uses the synchronous answer path and does not cancel that future.
It discards a disconnected queued request before inference, drains an active
decision, and discards its result. Text generation has an explicit stop hook.
Cancellation and a following request are tested separately.

## Evaluation interpretation

The evaluator reports exact wire-choice agreement separately from Finish
discrimination. A non-Finish answer is not counted as a correct action merely
because Finish was wrong. Comparisons check unique case IDs, symmetric case
sets, and the actual wire-subset hash. Errors are retained separately from
choice mismatches.

Stock vLLM parity and a sealed, broad task-success study remain unverified.
The original 14 frozen requests produced 7 expected choices with CLM q4, 7 with
CLM BF16, and 13 with the saved Kev responses. Q4 and BF16 differed on three
choices, so quantization affects some decisions but does not explain the total
gap on this development set. All inputs fit within the CLM token limit and all
requests returned valid answers. Exact hashes and reference limits are in
[model probes](model-probes.md).

Neither a running service nor a small collection of passing decisions proves
general computer-use reliability.
