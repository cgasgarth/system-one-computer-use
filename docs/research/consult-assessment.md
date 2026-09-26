# Consult assessment: smallest defensible next steps

Reviewed the full finished replies in `runs/consult/effects-full-dom.txt` and
`runs/consult/grounding-full-dom.txt`. Their source audit targets commit
`05a3de5`. They did not rerun the ignored local browser traces. The
53-request model comparison is correlated development data, not task success.
This assessment separates confirmed source behavior from proposed design.

## Confirmed boundaries

1. **Completion can forget a required result.** `completionCommit` runs only
   when a filled dialog is currently visible. After Cancel closes that
   dialog, `undefined` passes `finishEligible`. In the recorded create trace,
   S1 first said a committed result was still needed (0.540), then finished
   after Cancel with zero project saves. The 0.540 answer is weak evidence of
   intent; it is not a safe permanent truth latch.
2. **Global write permission is not target permission.** A task that allows
   saving one project does not allow saving an unrelated document. The
   current commit check can bypass authorization after a model
   `nonpersistent` classification. DOM `form_submit` detects only a POST-form
   mechanism; `non_submit` does not prove that JavaScript, a selection, or a
   key cannot write.
3. **Readback proves execution, not requested meaning.** The writer's text
   can match the observed field and still be the wrong text for the task.
   The existing `verifiedField` can support a narrow no-repeat check, but it
   cannot by itself authorize Save or establish semantic completion.
4. **Grounding has two distinct gaps.** The operation group says button/link
   even when its actions include options, checks, radios, tabs, and rows.
   Long-page targets can remain offered while distinguishing context is
   abbreviated. The Final Audit target ranked 110/122 and 19th within its
   last 22-control chunk; smaller groups alone cannot fix that ranking.
5. **A rejected useful action can disappear from the final trace.** When
   every candidate in an operation group fails checks, `chooseAvailable`
   retains the rejected operation summary but not all its detailed checks.
   This makes first-failure attribution harder.

The repo already has uniform role/label target text, browser pre-click
re-reading, underlying select-value handling, explicit historical-context
labels, and per-case checks for all five fixture write counters. These are
current repairs. Do not present the earlier missing-counter defect as current.

## Prioritized small changes to test

| Priority                      | Narrow change                                                                                                                                                                                                                                  | Required check                                                                                                                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Trace and grade            | Preserve every rejected candidate check and actual loaded-model identity. Keep task success and forbidden write deltas separate.                                                                                                               | A blocked trace names the first rejected useful action; all unrelated writes fail the fixture even if the goal later appears met.                                                                                               |
| 2. Keep an outstanding result | Preserve a request-scoped, S1-assessed `required result` and its uncertainty after a dialog closes. Track a separate observed result; closure or a returned click cannot satisfy a required creation. Use existing task/step structures first. | Create+Cancel stays unfinished; create+Save finishes only with a matching observed result; fill+Cancel can finish after a verified fill and closure. A draft-only task must not be trapped by a false required-save assessment. |
| 3. Bind selected input        | Keep the new prewrite app/window/URL/title check and document-scoped satisfied-field key. Treat a changed title as a reason to re-observe until a stronger document ID is available.                                                           | Different document at same URL is rejected; same document with a benign title change shows only an availability cost. The current five focused tests cover the basic guard, not this pair.                                      |
| 4. Fix operation description  | Describe the actual generic controls in the click group. Change only this criterion in a paired run.                                                                                                                                           | Operation, exact target, and final effect improve on select/Profile cases without more unrelated writes. The one-state 0.0655→0.992 shift alone is insufficient.                                                                |
| 5. Separate writer checks     | For the same unchanged field, do not let a weak repeated “missing?” answer erase verified readback of the selected writer argument. Keep argument-to-request judgment separate.                                                                | Thursday writer succeeds; Friday-for-Thursday writer is a hard semantic failure even if Friday reads back correctly.                                                                                                            |
| 6. Add local target context   | Include observed role, label, value, ancestor/row identity and nearby text in target choices where they distinguish duplicates. Show omitted-control coverage.                                                                                 | Early/late and same-label paired targets improve. A model-selected region must be graded separately from an oracle region.                                                                                                      |

Test one change at a time before combining them. Keep S1 as the sole tool,
target, DONE, and BLOCKED selector; the text model only writes arguments after
selection. A small monitor can prevent a known bookkeeping error without
claiming that S1 interpreted every user request correctly.

## Designs to defer

- **The proposed `TaskContract` / `BoundAttempt` / `ObservedFact` /
  `Assessment` framework and grant DSL.** Its distinctions are useful, but
  four new top-level records, source-span binding, subject identity, revisions,
  and path policy would be a broad refactor before the basic paired tasks
  pass. Express only the needed pending requirement, selected target, call
  status, and observed result in existing modules first.
- **A universal write shield.** A POST submit can fail validation; a
  `type=button`, select, typing, or key action can write through JavaScript.
  Generic UI inspection cannot certify arbitrary persistence. State the
  coverage of any gate and leave unknown effects unresolved.
- **Replacing relevance with global permission plus effect class.** The
  seven-task q4 permission probe falsely allowed a view-only request at
  0.772, above valid permissions at 0.586 and 0.604. The current binary
  effect wording confidently missed Save/Create. A second correlated S1
  check is not independent proof.
- **A model or precision switch as the fix.** Kev-4B chose 20/20 variants of
  five target states in a frozen replay, but effect recognition still had
  errors or abstentions. Q8/BF16 did not solve CLM's binary effect misses.
  These are development prompts, not browser/native task rates.
- **Chunk-only long-list selection and transport optimization.** A
  one-winner-per-chunk pass would still drop Final Audit under unchanged
  scores. Candidate-local evidence and region selection need separate tests.
  `--snapshot-mode none` may remove discarded Playwright output, but it has
  no measured benefit and must not replace a fresh observation.

## Acceptance limits

Use paired browser and native tasks with fresh fixture state. Grade exact
target, requested values, false DONE, false BLOCKED, duplicate or unrelated
writes, and skipped/attempted denominators. Keep objective truth in the
evaluator, not in the S1 prompt. A returned tool call, HTTP 200, field
readback, or closed dialog is only the evidence it actually supplies. If an
application has no available persistence witness, report the effect as
unresolved instead of marking it verified.
