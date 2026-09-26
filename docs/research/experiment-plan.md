# Harness experiments and evaluation

[Research index](./system-one-evidence.md)

## Ranked hypotheses and discriminating experiments

Keep all candidate text, model version, observation, selected action, and
post-action state in each trace. Freeze a development set before each change.
Use a separate held-out set that is graded by saved data, URL, selected native
window, or a documented permission/error state. Record confidence intervals
only when the sample supports them; report raw counts first.

### 1. Make evidence provenance explicit for terminal decisions

**Hypothesis.** A short state with the current observed URL, title, relevant
values, and an explicit _pending effect_ produces fewer false DONE and false
BLOCKED calls than either long action prose or a generic completion prompt.
The pending effect is a generic fact from the last tool operation, such as
"save was requested; no persisted result has been observed yet." It is not a
claim of success. An action result and a fresh observation remain separate.

**Test.** Replay identical saved observations under (A) current prompt,
(B) current prompt plus a typed evidence ledger, and (C) the ledger with the
action-success wording removed. Include correct target, wrong target, list page,
unsaved editor, saved editor, delayed save, and visible Save control. Change only
the state rendering; keep choices and model fixed. Compare false DONE, false
BLOCKED, and correct next operation, with token count and latency. Then test the
best variant on untouched live tasks. A lower replay error alone is insufficient.
Cross the state variants with two question placements: task named only in the
state versus task named in both state and appended question. This isolates any
effect of the current repeated task text.

### 2. Bind actions to fresh observations, especially before writes

**Hypothesis.** A generic freshness check **before** click, text, and terminal
decisions prevents stale control use without a large latency cost. It answers
"does this decision still refer to this screen?" It cannot answer whether a
later action succeeded. The text path already refreshes its target. The click
path now has a browser-only re-read guard. Its coverage and latency need
measured tests, and native clicks still need review.

**Test.** On a disposable page, choose a button, then reorder or replace the
same-labeled controls before execution; separately remove it, change its URL,
and change an adjacent target. Verify zero wrong clicks and one re-observation
when stale. Run an unchanged-page control to measure extra read latency. On
native, test a focused-window switch between choice and click.
jev-ultrafast's fingerprint is a reference pattern, not proof that a whole-page
hash is the best local implementation.

### 3. Evaluate candidate wording and set effects as a policy change

**Hypothesis.** The current operation text and target descriptions may create
generic key, wait, and BLOCKED bias. Since CLM embeds each candidate description
verbatim, wording changes can alter rankings even when the available actions do
not change.
One operation description is also incomplete: the `click_element` group can
contain pick/select options, checkboxes, radios, tabs, and rows, while its
current text says only "Click a button or open an existing link." In a saved
Profile trace after two text fields were filled, the next needed action was
an option/check control but q4 chose URL navigation. This is a specific
operation-stage hypothesis. In a later driver-only Profile capture with both
text fields correct, I captured the production operation request and changed
only that group description to "Activate an observed button, select option,
checkbox, radio, tab, row, or link." The original request chose
`compose_text` at 0.821 (click group 0.0655); the edited request chose the
click group at 0.992. This is a one-state development probe, not a live task
result. Its standalone action list still offered the two text fields and
did not include the live loop's progress suppression. Target choice after
operation selection remains untested. Full requests/answers are ignored at
`runs/research/overnight/profile-operation-results.json`.

**Test.** First check adapter invariants on exact texts: score the same state
and candidates individually, batched, warm, cold, and in permuted dictionary
order. Compare pairwise log odds within numeric tolerance. Add an irrelevant
candidate and check the unchanged pair's order and log odds. Run the same
control with 4-bit and BF16 if both are available. The earlier 17 captured
4-bit/BF16 choice matches are a smoke check, not broad parity proof. A failed
invariant points to adapter/cache/numerics before a prompt diagnosis.

Then build paired semantic cases from real traces. For each observation, keep
the state fixed and compare (A) current descriptions, (B) concise verb plus
observed target and effect, and (C) B with a semantically equivalent alternate
wording. Separately reorder only the state fields while keeping candidates
exact. Score the **chosen operation and exact target**, not only
complete/continue. Keep terminal choices available for truly blocked states.
If one wording helps only development cases, do not promote it.

### 4. Treat DONE, BLOCKED, and action effects as different judgments

**Hypothesis.** A single numerical gate cannot safely express all three. The
current 0.6 completion, 0.5 draft-completion, and 0.8 click gates are
heuristics. Because the
denominator changes with candidate sets, their raw values should not be read
as calibrated success odds.

**Test.** On a frozen corpus with independent labels, plot empirical error by
score bucket separately for completion, target match, click, and blocked. Include
candidate count as a stratum for any multi-option gate. Binary completion and
click checks keep two choices, but their wording and state still need
calibration. Compare the present gates with selective policies
that abstain on ambiguous cases and request one new observation. Measure false
DONE and wrong side effects as primary costs, plus extra reads, latency, and
blocked tasks. Choose gates only on development tasks; report held-out results
without retuning. Preserve a typed BLOCKED reason when no supported path exists.
For binary terminal checks with external truth labels, report a reliability
table, Brier score, and false-DONE or false-BLOCKED rate at each tested gate.
For operation and target choices, a state can have several useful actions;
label the acceptable set rather than force one arbitrary gold action. Report
top choice in that set, then grade the actual effect after execution. Raw
softmax probabilities should be compared across providers only after each
provider has its own held-out calibration read.

For BLOCKED, use a paired 2 × 2 probe over a **positive** question ("Can an
enabled action advance this request?") and a **negative** question ("Is the
request blocked?"), each with plain Yes/No and explicit semantic candidate
sentences. Reverse the A0/A1 keys while keeping candidate texts exact as a
parity control; this should only relabel scores. Include Save-ready, truly
locked, missing-permission, delayed-loading, and absent-control states. A
variant must reject false BLOCKED without making truly blocked cases loop.
The local one-case polarity probe above motivates this test but cannot choose
its winner.

### 5. Make repeated effects observable, not only repeated commands

**Hypothesis.** A fresh observation **after** an action must resolve its effect
before the loop retries a non-idempotent action or declares DONE. This answers
"what changed?" and is separate from the pre-action freshness check. The
state-key retry guard prevents some cycles but cannot detect an accepted write
whose UI looks unchanged or a delayed save that later lands.
It can also reject a useful second attempt after a legitimate state transition
that hashes the same way.

**Test.** Create fixtures for (a) delayed save, (b) save accepted with unchanged
editor, (c) failed save with unchanged editor, (d) duplicate button after a
timeout, and (e) same-looking pagination. Grade actual write count and content.
Vary the delayed result across 0.5, 2, and 5 seconds to test the current
refresh window.
Compare current per-state retry with a generic effect record: target identity,
operation, observation before/after, and whether independent state confirmed
the effect. The desired policy re-observes uncertain writes and avoids a second
write until the effect is resolved; it may retry a confirmed failure. If a tool
call times out after submission, do not infer that the operation failed. Do not
add a total-action cap to hide loops.

### 6. Test one-request operation/target batching for latency only after quality

**Hypothesis.** Sending operation plus each compatible target question in one
HTTP request reduces round trips. CLM's engine builds one state embedding per
question, so the expected gain is network overhead, not free target scoring.
With exact question and candidate parity, batching alone should preserve each
answer apart from numerical effects.

The local [MLX embedder](../../integrations/clm-mlx/src/clm_mlx/encoder.py)
sorts uncached texts by token length and batches texts while its padded-token
budget allows. One HTTP request can therefore also reduce encoder scheduling
overhead or increase device use. It still computes a distinct embedding for
each distinct state and candidate text. Exact cache keys mean a changed field
value, URL, or question can make the prior state embedding unusable.

**Test.** First pass the adapter parity control above. Then replay the same
observations with sequential and batched questions; compare exact
operation/target choices, server encoder token misses, wall time, and end-to-end
task time. Use cold and warm caches and candidate sets of 5, 25, and 100
controls. Keep the target question's state, instructions, and candidate texts
byte-identical across variants. Divergence is an adapter/numerics issue to
diagnose. Do not batch completion with action choice until a separate
experiment beats the current behavior; the earlier combined completion trial
regressed locally **while also changing the completion state**. That trial
does not show batching itself reduced accuracy. A batch that saves
milliseconds but raises wrong-target effects is a regression.

For the latency report, split time into observation, decision HTTP and
encoding, text argument generation, action execution, and post-action read.
Report fresh encoder tokens and cache hits where available. An 8 ms warm
decision and a 612 ms other decision occurred in the same local browser
development traces; those two points show why a single median cannot explain
the source of latency. They do not measure a batching gain.

**Playwright reply overhead to test.** The installed `@playwright/mcp`
0.0.82 source requests an automatic post-action snapshot for `browser_click`,
`browser_select_option`, and `browser_navigate`. In this CLI mode it writes
that snapshot to a `page-*.yml` output file and returns a link. The driver
discards the action reply, then the next turn calls explicit
`browser_snapshot` and reads another snapshot. Its current parser expects
an inline Page header and YAML block from the explicit tool, so the file
link is not a drop-in replacement. Default `browser_type`
without `submit` or `slowly` does **not** request a full automatic snapshot.
The package's `--snapshot-mode none` can suppress automatic action snapshots,
while explicit `browser_snapshot` still requests a full read. That is a
small latency experiment to measure on disposable tasks after correctness
stabilizes. Do not reuse a click reply as current state without a freshness
rule: asynchronous page changes can occur between the reply and next model
decision. The MCP response builder still calls `captureSnapshot` with
`ariaFormat="none"` for headers/events, so this option may save the full
accessibility tree and file write rather than all tool-side read time. No
snapshot cache is proposed from this inspection alone.

### 7. Measure the accessible action boundary

**Hypothesis.** Some tasks fail because the driver does not expose the needed
control or visual state. No wording or threshold can recover an action absent
from the finite set.

**Test.** For each failed live task, have a human label whether the next needed
action was offered and whether the observed state carried enough target evidence.
Include a long page where the correct control is beyond the displayed 100 or
the character slice but remains an offered action. Count `offered but not
identifiable` separately from `not offered` and from a wrong choice despite
adequate evidence.
Separate `missing action`, `missing observation`, `wrong model choice`,
`text argument error`, `driver error`, and `terminal error`. Include canvas, drag,
scroll, hidden menus, native sheets, multi-window switching, and delayed updates.
Only add a generic driver capability after the audit finds a recurring missing
capability. This prevents per-app rules from masking the model boundary.

Use this first-error attribution in each trace:

| First failed boundary                                                        | Likely owner to investigate                                                             |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Needed operation or target is absent from the compiled set                   | Driver capability or option compiler.                                                   |
| Action exists, but the distinguishing value or relation is hidden from state | Observation and state renderer.                                                         |
| Action and evidence are present; selected operation or target is wrong       | Decision model, question, or candidate descriptions. Compare providers on exact inputs. |
| Selected action is correct but execution fails or hits a stale control       | Driver or pre-action freshness binding.                                                 |
| Correct tool selected but URL, app name, or field value is wrong             | Text argument model and its supplied evidence.                                          |
| Tool returned, but persisted effect is absent or duplicated                  | Post-action outcome check and retry policy.                                             |
| Goal is met but BLOCKED is chosen, or goal is unmet but DONE is chosen       | Terminal decision and evidence policy.                                                  |

### 8. Preserve temporal evidence without success prose

**Problem.** A request can require a sequence such as "fill the form, then
cancel." The final screen can look like the initial screen. A current snapshot
alone cannot prove the fill occurred. A brief implementation experiment put
recent action reasons and tool outputs back into the next decision state; it
was reverted. Earlier browser tests found that successful tool prose can bias
terminal choices. Removing all history would fail temporal requests; copying
tool prose into model evidence can produce false DONE.

**Small contract to test.** Keep two or three typed facts from the **current
request**. Each fact has: selected operation and observed target identity,
call status (`returned`, `error`, or `uncertain`), and a separately observed
effect (`field_value_seen`, `window_closed`, `url_changed`, `no_change`, or
`unknown`). Store before/after snapshot references in the trace. A returned
call is not a verified effect. A field value seen in a dialog is not a saved
record. The model receives short factual text rendered from these typed
fields; raw tool output stays in the trace and can still help the text
argument model. Prior-session context stays marked historical.
Start by showing these facts to the completion checks only. Keep the
next-action state free of successful-effect history as a control, since an
earlier save-ready probe shifted toward BLOCKED even when it included
accurate field-value prose. Compare this with a variant that also shows typed
facts to next-action selection; retain it only if paired task outcomes improve.

For "fill X, then cancel," the evidence can say: `Type into field A:
returned; next read showed A=X in dialog D` and `Activate Cancel in D:
returned; next read showed D absent`. For "save X," the first fact alone is
not enough. Save requires a later visible saved state, reload, or other
available independent result before DONE. If the post-action read fails,
record `unknown` and observe again before retrying a write.

**Paired test.** Hold the final screen fixed and compare: no history; fill
verified but cancel absent; fill verified then Cancel returned without a fresh
read; fill verified then dialog disappearance observed; Save returned but no
persisted result; and Save with persisted result. Also start a new request
with identical old-session facts to ensure they do not count. Grade both DONE
and the next action. The typed facts pass only if they recover sequence
completion without reviving false DONE on unsaved or stale effects.

The later uniform-wording `modal-create` trace shows a second temporal
failure. Step 12 verified the project-name field. At steps 13–15 the filled
dialog was open; the completion question chose DONE at 0.708, but a separate
commit question chose "a committed result is still required" at 0.540, so
Finish was withheld. Step 15 clicked Cancel. At step 16 a fresh read showed
the dialog gone and zero project saves. The commit question no longer ran
because the draft was no longer visible; completion alone chose DONE at
0.656 and the task falsely finished. The requirement had been recognized
before Cancel and then lost. A small task-scoped required-effect fact could
survive a dialog closing, while a separate observed-effect fact is satisfied
only by visible or independent persistence evidence. Neither a returned
click nor a closed dialog proves persistence. The earlier 0.540 answer is
weak and not a calibrated hard latch; pair create+Cancel, create+Save, and
fill+Cancel before selecting an acceptance rule.

### 9. Let System One find controls on long screens

The current state can hide controls that still appear as action candidates.
Compare three generic designs without selecting a tool by task keywords:
Candidate-local context helps only after System One selects the operation.
The current operation question sees generic operation descriptions and the
truncated state; it can choose BLOCKED before any target descriptions are
scored. Include operation recall as a separate grade. A count of omitted
controls and their broad roles, or a read-only search option, gives the
operation decision evidence that more controls can be inspected.

| Design                  | How System One stays in control                                                                                                                                                                                                          | Main cost or risk                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Candidate-local context | Each target candidate includes its role, label, current value, ancestor labels, and nearby text when observed. System One still chooses the exact target.                                                                                | Dynamic candidate strings reduce exact cache reuse and increase total encoder work. Repeated labels can remain ambiguous. |
| Controlled pages        | Offer a bounded control page plus an `inspect next controls` action. System One chooses when to inspect and later chooses the target.                                                                                                    | More decision turns; early BLOCKED is wrong while unseen pages remain. Page order can bias choices.                       |
| Generic control search  | System One first chooses a read-only `search controls` tool. The text model then supplies only its query argument. The result gives matching observed controls with local context; System One chooses the exact target in the next turn. | The query can miss a target or add a text-model call. Search must not execute a control or decide the final target.       |

Start with candidate-local context because it needs no extra decision turn.
Add search only if long-list tasks show missed evidence or excessive encoding.
Paging is a fallback when the list cannot be searched. The search tool must
query the observed control tree, not infer site paths or run app-specific
scripts. Its availability can depend on control count or truncation, which
are screen facts, not an intent classifier.

**Test.** Use matched screens with 20, 120, and 300 controls; place the
requested target early, late, and among same-label distractors. Change one
ancestor or nearby value at a time to create a unique right target. Score
operation recall, exact target after the right operation, false BLOCKED,
token overflow, fresh encoder tokens, decision
latency, total task time, and duplicate effects. A target offered without its
distinguishing context counts as a state-rendering failure. A search result
that omits it counts as search recall failure. Compare all three methods on
untouched tasks after local tuning.

## Next single-factor trials

After the commit-gate ablation, hold q4, fixture starts, candidate set, and
grader fixed. Test these source changes separately before combining them:

1. Replace only the incomplete click-operation description with text that
   includes observed buttons, options, checks, radios, tabs, rows, and links.
   Grade operation choice first, then target and task result on select and
   Profile cases. A changed operation score alone is not a passed task.
2. Retain a task-scoped required-effect fact across dialog closure. Grade
   modal-create after Cancel as incomplete, create after observed persistence
   as complete, fill-then-Cancel as complete only after verified fill and
   closure, and draft-open as incomplete if Cancel closes it. A weak S1
   requirement answer is not a calibrated hard fact.
3. Skip the redundant missing-field judgment only when the selected text
   writer's argument was read back in the same unchanged field. Grade
   edit-and-save with the exact requested value. Also inject a wrong writer
   value (Friday when the request says Thursday): field readback proves the
   tool wrote Friday, not that Friday meets the task. A persisted wrong value
   is a hard failure, even if DONE follows.

Record the first divergent step and all write-counter deltas for each arm.
Only after individual effects are known should a combined arm be tested.

## Evaluation design

1. Use three layers: fixed-observation decision replays; disposable browser and
   native integration tasks with independent state checks; and held-out multi-step
   tasks with fresh data. The first layer isolates prompt and candidate effects.
   Only the latter two measure task completion.
2. Define task families before sampling: open/select, edit/save, search/filter,
   create once, cross-app switch, follow-up reference, delayed update, absent
   control, and permission block. Include paraphrases and distractor controls.
   Keep task text and expected data out of harness code.
3. Label every transition with availability of a useful action, correctness of
   the chosen operation/target, freshness at execution, and actual state change.
   This identifies where the first error occurs. A final pass rate alone does not.
4. Record task success, false DONE, false BLOCKED, duplicate side effects,
   recovery rate after a failed tool, median/p95 decision latency, total time,
   number of decisions, and text-helper time. Report browser and native results
   separately. Preserve raw traces and evaluator versions.
5. Do not compare directly with BrowserGym or OSWorld leaderboard percentages.
   Their tasks, operating systems, modalities, setup, and action budgets differ.
   Borrow their reset and external-grader discipline. A Mac-specific suite is
   needed for this app's native driver.

For an initial frozen pilot, use at least eight **base tasks** in each family
below, with two counterfactual states per base task. Split by base task before
making variants, so a paraphrase or changed value cannot leak across
development and held-out sets. Predeclare the split and the primary error
measure. This pilot can expose large failures; its small denominators will not
support a broad reliability claim.

| Family               | Paired counterfactual                                                                                                                                                               | Independent check                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Target and follow-up | Correct document versus a different open document with similar visible text; current request stays fixed. Expose the switch as a link, button, row, or menu item in separate cases. | Exact URL or native document identity; no write to the distractor. |
| Edit and save        | Field contains requested text but is unsaved versus persisted; Save visible in both.                                                                                                | Stored value and write count after reload.                         |
| Create once          | Submitted item visible versus pending form; tool reply is the same in both.                                                                                                         | One persisted item, no duplicate.                                  |
| Search and filter    | Matching result is visible with requested filter applied versus unapplied.                                                                                                          | Filter state and opened result identity.                           |
| Blocked and recovery | Enabled useful control versus absent or permission-denied control; inject one failed tool.                                                                                          | Correct action or typed block reason; no premature stop.           |
| Dynamic grounding    | Target stays fixed versus changes after observation; include native focus switch.                                                                                                   | No action on a stale or wrong target.                              |
| Tool-set switch      | Requested item accessible on browser versus native surface while the other surface shows a distractor.                                                                              | Correct surface and final target.                                  |
| Timing               | Save result arrives immediately versus after a bounded delay.                                                                                                                       | Final stored state, no duplicate write, total time.                |

Run exact task text on both states of each pair; also run a paraphrase as a
separate robustness measure. Score pairs as pairs: both decisions must be
correct. A policy that always says DONE, BLOCKED, or click can pass one side
of many pairs but cannot pass both. After the pilot, grow the held-out task set
and report uncertainty on each error type. If another decision provider is
available, replay identical typed states and candidates to separate a
model-specific miss from a missing harness action. Do not replace the decision
model with a planner when one provider fails.

The pilot cannot certify a low false-DONE rate. If 32 independent unfinished
tasks produce zero false DONE calls, the one-sided 95% binomial upper bound is
about 8.9%. About 300 independent unfinished cases with zero errors would be
needed to put that bound near 1%. Paired variants and paraphrases share a base
task, so count them as one cluster for uncertainty estimates. Use the pilot
to find failure modes; expand it before making a broad reliability claim.

## Unsupported assumptions to avoid

- A CLM probability above 0.6 means at least 60% real-world completion.
- A successful tool return proves that a save, send, or page transition occurred.
- A target verifier asked a similar question is independent confirmation.
- A changed prompt that fixes the development replay improves unseen tasks.
- The reference CLM GPU speedup applies to local 4-bit MLX inference.
- A visible accessibility tree contains every action required by arbitrary apps.
- A browser-only benchmark proves native macOS behavior.

The next evidence-producing step is a frozen, trace-based failure set with
independent effect checks and the paired experiments above. Prioritize terminal
errors and duplicate writes before optimizing request count.
