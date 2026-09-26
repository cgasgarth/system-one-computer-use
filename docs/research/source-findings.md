# Sources and local findings

[Research index](./system-one-evidence.md)

## What the sources establish

| Source                                                                                                                                                                                       | Direct evidence                                                                                                                                                                                                                                                                                                      | Consequence and limit                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [CLM schema and engine](https://github.com/Contrastive-LM/CLM/blob/main/src/clm/schema.py), [engine](https://github.com/Contrastive-LM/CLM/blob/main/src/clm/engine.py)                      | The state encoder receives context, then question instructions. The action encoder receives each `choice` description verbatim. The engine applies softmax to scaled cosine scores over only the supplied candidates. One request with several questions still creates a distinct state embedding for each question. | Candidate words are part of the policy. A returned probability is relative to the current set; it is not a calibrated probability that a task is done or an action will work. Batching can save HTTP overhead, but does not imply one encoder pass. |
| [CLM model and server](https://github.com/Contrastive-LM/CLM)                                                                                                                                | The released head is trained with a Qwen3-8B last-token encoder; the reference server exposes embedding caches.                                                                                                                                                                                                      | Exact candidate reuse can save encoding. Claims from the reference server's GPU timings do not transfer to this Mac's MLX 4-bit encoder without measurement.                                                                                        |
| [jev-ultrafast policy](https://github.com/browser-use/jev-ultrafast/blob/main/jev_ultrafast/model.py), [loop](https://github.com/browser-use/jev-ultrafast/blob/main/jev_ultrafast/agent.py) | It groups targets by operation, scores operation and operation-specific target questions in one request, binds an action to a page fingerprint, consumes the decision before mutation, and checks page freshness again after text generation.                                                                        | The operation/target structure supports the current design. The fingerprint and one-use binding are useful patterns to test locally. Its browser result and TypeSafe/Jev probabilities do not establish CLM accuracy here.                          |
| [SystemOneHarness](https://github.com/HarnessRouter/SystemOneHarness)                                                                                                                        | It compiles finite actions, bounded history, typed questions, and complete transition traces. Its sample gates vary by action risk; its published live runs are small deterministic environments.                                                                                                                    | Trace and failure taxonomy transfer. Its numeric thresholds do not calibrate this CLM, and its LLM escalation is outside this product contract.                                                                                                     |
| [BrowserGym](https://github.com/ServiceNow/BrowserGym), [WebArena-Verified](https://github.com/ServiceNow/webarena-verified), [OSWorld](https://github.com/xlang-ai/OSWorld)                 | BrowserGym supplies repeatable browser tasks. WebArena-Verified grades responses and network traces with audited deterministic evaluators. OSWorld uses initialized desktop tasks and execution-based outcome checks.                                                                                                | Grade persisted effects outside the controller. Browser-only tasks cannot establish native Mac capability, and an accessibility-only agent cannot be compared directly with a screenshot-capable benchmark agent.                                   |

Source versions inspected locally: CLM `bb42c6c5bf914fd449bed2f6ca65be80602cb1f7`;
jev-ultrafast `1231850a0bf1a0c0341fe408ef1668dbbfdfac46`. The
source clones are temporary and ignored under `runs/research/overnight/`.
The app's `integrations/clm-mlx/pyproject.toml` pins CLM
`7956937c58ed5839c06ddc4dc6b6b61c3a3e4094`. I compared its schema and
engine with the inspected CLM head: the schema is identical; the newer engine
adds only conversion of typed SDK question objects before `build_pairs`.
The app sends wire-format dictionaries, so the formatter and score structure
described here apply to its pinned version.
jev-ultrafast also stops after a three-action unchanged-page pattern and has
a 60-action demo budget. Those are demonstration safeguards, not evidence that
either limit is suitable for this product. Keep the local per-state retry
policy and grade delayed effects before changing stop behavior.

The official CLM page reports zero-shot results on T-Rex, BFCL v4,
WikiRacing, and Super Mario, plus best-of-N verification results. These
support its use as a fast candidate scorer. They do not establish success
on arbitrary browser and native Mac workflows with this observation and tool
set. That gap needs local end-to-end tests.

[OSWorld 2.0](https://arxiv.org/abs/2606.29537) studies long computer-use
workflows and calls out dynamic environments, hidden state, cross-source
reasoning, and visual precision as distinct challenges. This supports testing
more than simple open/edit flows. Its agent models, inputs, operating systems,
and long tasks differ from this harness, so its completion rate is not a
baseline for the local CLM loop.
[OSGuard](https://arxiv.org/abs/2606.15034) explicitly grades both isolated
action judgments and full execution with state-based constraints; its authors
report that good local guard judgments can leave gaps in end-to-end safety.
The local `modal-cancel` failure illustrates why both grades are needed here:
the click check approved the wrong navigation, and the later classifier
missed repeated unrelated saves.

[TypeSafe's System One documentation](https://docs.typesafe.ai/concepts/system-one)
says calibration is measured over groups and does not guarantee a single
answer. This is a claim about its models, not a calibration result for the
local CLM head or this task distribution. The current
[Kev-0.8B model card](https://github.com/jaredpalmer/kev/blob/main/docs/model-cards/kev-0.8b.md)
reports a decline on an eval-only tool-call decision set and advises against
using that checkpoint for tool-call routing. This is a model-specific limit,
not a reason to change the provider-neutral loop. Run the same frozen local
tasks before substituting any decision model or sharing one threshold across
providers.

The [Kev-4B model card](https://github.com/jaredpalmer/kev/blob/main/docs/model-cards/kev-4b.md)
reports typed-decision tests on policy, developer-tooling, and other data;
it does not establish browser/native computer-use success for this harness.
The app uses a pinned Kev-4B checkpoint and upstream MLX server through the
same HTTP adapter. A local read-only replay can test this question without
changing the harness or training a model.

## What the local evidence says

The current [decision model](../../src/models/system-one.ts) checks completion
when a window or app is observed, then scores an operation and a compatible
target. It can score further targets after a rejected verification. The follow-up
target check can restrict editing until the requested document is selected.
The [option compiler](../../src/agent/options.ts) offers observed controls and
the current tool set; keyboard options now depend on focus and dialog state.
The [progress guard](../../src/agent/progress.ts) removes repeated actions in the
same observed state. It does not prove the goal is met.
The completion prompt has used a `Task context and tool results` label for
`input.context`, while the session code supplies a previous request and
target under that field. The label can blur historical reference data and
current result evidence; keep the provenance label exact.

The [validation log](../validation.md#extended-real-model-testing-september-25-2026-evening)
records real Chrome failures: guessed paths, early DONE, repeated typing,
unneeded keys, false BLOCKED with Save visible, and a wrong-document follow-up.
A later local open/edit-save/follow-up run passed with independently checked data.
These development runs do not estimate general success. The fixed-observation
suite also used prompts during development and is not held out.

Ignored local diagnostic probes support the need for controlled wording tests:
`runs/qa/night-test/candidate-language.log` scored six templates against the
same toy goal and four document names. The chosen name was Documents in three,
Autumn Plan in two, and Spring Plan in one; Autumn Plan was the named target.
The probe did not include the page observation and is not a task-accuracy test.
`runs/qa/night-test/blocked-polarity.log` changed only a binary verifier's
wording. On one save-ready state, the original wording gave "no available
control" probability 0.724, while the direct "enabled control" wording gave
"yes" probability 0.748. On one locked state, all three variants chose no
available control. These cases were explored during development, so they
cannot validate the selected prompt or a threshold.
In `runs/qa/night-test/group-probe.log`, a generic keyboard option ranked
first in three of four captured observations (about 0.57 to 0.82). Removing
those key candidates changed the selected operation. This is a diagnostic
candidate-set effect; the four observations were development inputs and no
task outcomes were graded in that probe.

A later disposable `modal-cancel` trace (`runs/evals/browser/modal-cancel.json`)
failed at two different boundaries. On the Projects page, both a Documents
link and New project button were offered, but CLM chose Documents at 0.865
and the click relevance check approved it at 0.995. The run then saved an
unrelated document seven times and ended BLOCKED; it never opened the New
project dialog. For a selected `Save document` button, the separate
commit-effect classifier answered "nonpersistent" at about 0.942, so the
task-only authorization question was skipped. This is a direct failure of
that classifier on this screen, despite high reported probability. The link
and button had asymmetric candidate wording, which may affect the first
choice; a paired wording probe is needed before assigning cause.
In a later frozen read-only q4 batch, the same sparse binary effect format
called both `Save document` and `Create project` nonpersistent at 0.942 and
0.988. A six-way effect format called both persistent at 0.689 and 0.909.
The question format strongly changed these local judgments; the six-way
format still missed other control effects, so it is not a validated guard.
This trace also found an evaluator gap: the modal-cancel case checked
project creation and cancel records but left `expectedSaves` undefined,
so unrelated document saves did not affect that case's pass condition. An
agent could eventually cancel and appear to pass after unwanted writes.
Grade deltas of **all** fixture write counters for each task, with explicit
allowed and forbidden effects.
`runs/qa/night-test/completion-variants.log` scored 17 development states
under one alternate state rendering: three Choice wordings got 12 or 13
correct, while bare Noul got 6. This does not show that Noul is intrinsically
worse; question wording, state rendering, and case selection were not held
out. It warns against swapping the binary primitive without a paired test.

The local [MLX encoder](../../integrations/clm-mlx/src/clm_mlx/encoder.py) rejects
inputs above 2,048 tokens. The decision state uses character limits, and its
completion, operation, target, and verification questions each add instructions.
There is no proof that all real screens fit the token limit. A token-overflow
case should be measured before assuming truncation or graceful recovery. The
local 4-bit encoder also differs from the reference inference setup; its effect
on choice quality is unknown.

A read-only capture on 2026-09-26 mocked the HTTP responses and rendered the
then-current request text from 14 fixed scenarios and 12 saved real-observation
inputs. It produced 88 synthetic request paths. The largest state plus appended
question was 857 Qwen3 tokens; it had 65 target candidates totaling 586
candidate tokens. None of these captured texts crossed 2,048 tokens. This
checks only those saved observations under mock choices. It does not exercise
long screens, all rejection paths, real model answers, or outcome quality.

The CLM score structure gives an important control. For a **fixed state,
question, and exact candidate texts**, permuting the candidate dictionary
should only permute the corresponding scores. Adding a candidate changes the
softmax denominator and can introduce a new winner, but it should not change
the pairwise order or `log(p_i/p_j)` of two unchanged candidates. If it does,
inspect ties, numerical batch effects, tokenization, and the adapter cache
before calling the result semantic prompt sensitivity. Reordering text _inside
the state_ changes its embedding and can change all scores. This is an
inference from the [CLM engine](https://github.com/Contrastive-LM/CLM/blob/main/src/clm/engine.py),
not a measured local result.

Do not transfer this permutation invariant to every decision provider.
[Kev's model notes](https://github.com/jaredpalmer/kev/blob/main/README.md)
say option order can change an answer because options within one question can
affect one another. Its early
[0.5B model card](https://github.com/jaredpalmer/kev/blob/main/MODEL_CARD.md)
reports 7% top-choice flips under option reordering on its measured set. That
rate is evidence about that checkpoint, not a measured rate for current Kev,
Jev, or this computer-use task set. Run the order probe for each provider.
The app-pinned Kev server
[`api.py`](https://github.com/jaredpalmer/kev/blob/09ff745d52a0f23954e3b0f5a608bf4c7c6aebb4/kev/api.py)
renders each Choice option as its key plus description (for example
`A0: Activate button`). CLM sends the description to its action encoder
without the key. Identical wire requests therefore are not identical
internal model text. A provider replay compares the usable provider
behavior, not only weights or quantization.

The text-entry path refreshes the selected field after the text helper returns
and rejects an ambiguous or changed match. A browser click now re-reads the
window and rejects changes to its state key or element-token sequence before
using the selected token. This is a pre-action freshness check; it does not
prove the click's effect. Native click freshness and rapid changes between
the check and the input remain unmeasured.
The target-correction filter now allows several observed navigation roles
without reading task keywords. A brief button exception based on a lowercase
substring match between task/context and button label was removed because it
could exclude paraphrases or admit same-label distractors. A navigation
button without a navigation role can still be omitted; test that boundary
with role-varied follow-ups instead of restoring a text shortcut.
The option compiler can offer actions for every observed element, while the
decision state displays at most 100 sorted controls and a character-limited
slice. On a long screen, an offered target can therefore lack the value or
nearby context needed to identify it. This is a state/action visibility gap,
not evidence of a model error by itself.
The current refresh action waits 250 ms, and its per-state guard suppresses it
after eight unchanged attempts. Eight direct waits total about two seconds.
A result that arrives later could cause a premature BLOCKED choice. This is a
timing hypothesis, not a reproduced failure.
