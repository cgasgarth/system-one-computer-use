# Architecture

System One Computer Use has one decision-owned task loop. A `DecisionModel` chooses a supported action, including Finish or Blocked. A `TextModel` supplies a field value or URL only after the action is chosen. The loop does not contain app-specific or site-specific workflows.

```text
AppKit menu and Handy shortcut
  -> JSON-lines task worker
  -> session store and ComputerSessions
  -> agent task loop
  -> decision/text models and browser/native computers

AppKit model controls
  -> local model daemon
  -> private Unix sockets
  -> Python CLM, Kev, or text bridge
```

## Ownership

| Module                 | Responsibility                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `native/SystemOne`     | Menu-bar UI, Settings, Handy shortcut, and native IPC.                                                                                      |
| `src/app`              | Worker and CLI composition, configuration, session persistence, model process lifetime, and traces.                                         |
| `src/app/computers.ts` | Lazy browser and desktop driver ownership. Task completion releases both control sessions; shutdown joins any teardown in progress.         |
| `src/agent`            | Action options, observation, target binding, task progress, Stop, and execution. `contracts.ts` owns the shared surface and action schemas. |
| `src/models`           | Decision and text adapters and typed request/response transport.                                                                            |
| `src/computer`         | Codex native/Chrome adapters, current target reads, and stdio transport.                                                                    |
| `integrations`         | Local Python model bridges and pinned provider code.                                                                                        |

`src/agent`, `src/models`, and `src/computer` do not import `src/app`. The app composes these modules. External configuration, IPC frames, model replies, and driver observations cross typed boundaries; trusted internal calls use those parsed types.

## Task and resource lifetime

1. The native UI sends a task to the worker. The worker loads its session, selects the current request, and obtains computers from `ComputerSessions` as needed.
2. The agent observes the selected surface and offers grounded actions. The decision model selects an action. A chosen text or URL action may ask the text model for its argument. The agent refreshes the target before input and checks Stop before side effects.
3. The agent records tool results and observed state. Finish is the decision model's choice; the agent re-observes the screen before accepting it. The selected action is not an independent proof that the user goal was achieved.
4. The worker saves the task result and session target, releases both control sessions, then reports the terminal result. Follow-ups restore the saved target through a fresh connection. Worker shutdown joins any release already in progress.

Native controls use Codex’s app-scoped accessibility state. Internal target IDs identify the observed app and active window; they are not operating-system process handles. Each action revalidates its observed target. The adapter rejects ambiguous or stale bindings. It does not use a second native-control backend.

Menu inspection opens an observed menu and reads its visible commands. It is a UI view change, distinct from command invocation. The report is marked incomplete when the runtime does not expose a full inventory. Disabled entries remain visible but are not executable choices. Re-observation reads the open menu without toggling it closed.

The control transport automatically accepts app/site tool approvals for its own active Codex session. It does not request a user reply or save permanent grants. Unrelated session requests are rejected. The controllers do not invoke a Codex decision model.

The CLI uses the same agent loop and driver owner, but retains its separate command flow. The model daemon owns resident model processes independently of a task driver. Managed local inference uses one JSON request and response per private Unix socket connection; external configured endpoints remain separate. Stop aborts pending model calls and prevents later input where the driver can enforce it. Stop closes the owned control session, including an active call. Cleanup sends both the REPL turn-ended hook and the native Computer Use turn-ended notification with the owned session and operation IDs. App quit waits for worker teardown; another task cannot overlap that teardown.

## Constraints

The model can make a wrong choice. Unit tests cover contracts and control flow, while task success requires an independent result check on a real browser or native app. Current checks and evidence levels are in [validation](validation.md) and [acceptance](acceptance.md). Generated traces, model files, and private observations stay under ignored `runs/` or the app's Application Support directory.
