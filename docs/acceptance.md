# Harness acceptance checks

The product is a general-purpose controller for decision models. A model chooses
from current tools and targets; a text model supplies arguments only after a tool
has been selected. The controller must not contain a workflow for a named app,
site, or test fixture.

## Required behavior

| Area        | Acceptance check                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task entry  | The anchored menu accepts text and a Handy transcript through the same task path. Settings have their own view.                                                                             |
| Voice       | The configured shortcut follows Handy's hold, auto, or toggle behavior. A second activation can start a new request.                                                                        |
| Activity    | Opening the task menu or starting dictation warms local models. Running, successful, stopped, and failed states remain distinct.                                                            |
| Serving     | Local model selection downloads and serves the chosen model through MLX. External endpoints use the same typed decision interface. Idle unloading and cancellation release owned processes. |
| Tool choice | The decision model can choose Chrome or macOS and change tools after an error. A failed saved-target restoration leaves recovery tools usable.                                              |
| Grounding   | Every executed target comes from a current observation. Reordering or replacing controls during inference causes a fresh decision rather than a write to the wrong target.                  |
| Forms       | Text, select options, checkboxes, and radio controls use the operation supported by the control. Verified values are not entered again without a state change.                              |
| Dialogs     | Background controls do not compete with an active modal. Open-editor, unsaved-draft, and committed-result requests have different success conditions.                                       |
| Completion  | DONE requires observed evidence of the requested result. Tool return status alone does not prove completion. A wrong target or failed observation cannot become success.                    |
| Recovery    | Failed calls and unsupported actions return useful feedback. An unchanged failed action cannot spin indefinitely. There is no total task action cap.                                        |
| Sessions    | Automatic continuation reuses a session within one hour. The last three sessions preserve request context and target references. A changed request is rebound before editing.               |
| Stop        | Stop prevents subsequent actions, survives late model/tool responses, returns the menu to a usable state, and leaves no active task driver.                                                 |
| Metrics     | Median decision latency includes the model calls for a decision. Tool throughput counts successful executions; waits and failed calls do not count.                                         |
| Repository  | Strict TypeScript, boundary schemas, lint, formatting, and the 600-line source limit pass. Traces, model assets, and videos remain ignored.                                                 |

## Evidence levels

1. **Unit/transport:** malformed responses, target binding, cancellation, and tool
   mapping are tested without relying on model intelligence.
2. **Fixed model observations:** paired success/failure states test decision
   behavior. They do not measure task completion.
3. **Real task:** the harness controls a live browser or native app. A separate
   grader reads the resulting saved data or app state.
4. **Installed app:** task entry, model lifecycle, permissions, menu state, and
   Stop are checked through the installed product.

A change needs the evidence level that covers its risk. A browser fixture passing
does not prove native behavior, and one provider passing does not prove another.

## Test design

- Freeze the task family and its outcome before tuning the implementation.
- Include the paired counterexample: wrong target, unsaved draft, disabled
  control, missing permission, or already-satisfied value.
- Include valid final states that resemble failures, such as a requested open
  dialog or an explicitly unsubmitted draft.
- Keep real user documents and browser tabs outside write tests. Use disposable
  local workspaces, track owned tabs, and restore app preferences and session data.
- Record failures as well as successes. Report model calls, actions, total time,
  and saved side effects separately. Mark model/cache/hardware conditions.
- Do not treat paraphrases of one fixture as independent task coverage.

Current results and limits are in [validation](validation.md). Research methods and
source evidence are in [the research review](research/system-one-evidence.md).
