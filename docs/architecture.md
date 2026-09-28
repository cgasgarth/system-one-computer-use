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

| Module                 | Responsibility                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `native/SystemOne`     | Menu-bar UI, Settings, Handy shortcut, and native IPC.                                                                                                                         |
| `src/app`              | Worker and CLI composition, configuration, session persistence, model process lifetime, and traces.                                                                            |
| `src/app/computers.ts` | Lazy browser and desktop driver ownership. The worker reuses its browser connection, closes its desktop connection after a task, and closes all owned connections at shutdown. |
| `src/agent`            | Action options, observation, target binding, task progress, Stop, and execution. `contracts.ts` owns the shared surface and action schemas.                                    |
| `src/models`           | Decision and text adapters, effect authorization, and typed request/response transport.                                                                                        |
| `src/computer`         | Playwright and CUA driver adapters, current target reads, and native menu transport.                                                                                           |
| `integrations`         | Local Python model bridges and pinned provider code.                                                                                                                           |

`src/agent`, `src/models`, and `src/computer` do not import `src/app`. The app composes these modules. External configuration, IPC frames, model replies, and driver observations cross typed boundaries; trusted internal calls use those parsed types.

## Task and resource lifetime

1. The native UI sends a task to the worker. The worker loads its session, selects the current request, and obtains computers from `ComputerSessions` as needed.
2. The agent observes the selected surface and offers grounded actions. The decision model selects an action. A chosen text or URL action may ask the text model for its argument. The agent refreshes the target before input and checks Stop before side effects.
3. The agent records tool results and observed state. Finish is the decision model's choice; the agent re-observes the screen before accepting it. The selected action is not an independent proof that the user goal was achieved.
4. The worker saves the task result and session target, then releases the native driver. The browser driver stays available for another task. Worker shutdown closes all owned drivers and waits for a desktop close already in progress.

Native menu inspection is a read-only action distinct from command invocation. The driver reads only the selected observed top-level menu and returns typed command paths, enabled states, and capture completeness. `SurfaceSession` scopes the inspected view to its process, window, and menu; fresh observations refresh that view, and surface changes or mutations clear it. The model receives the report directly in its observation rather than through the shortened action history. Disabled entries remain visible as evidence but are not executable choices.

Accessibility menu data belongs to the application process. The window ID binds the task's selection; it does not prove that command enablement belongs to that window. Inspection does not change focus. Invocation revalidates the command before passing its process, window, and path to CUA.

The CLI uses the same agent loop and driver owner, but retains its separate command flow. The model daemon owns resident model processes independently of a task driver. Managed local inference uses one JSON request and response per private Unix socket connection; external configured endpoints remain separate. Stop aborts pending model calls and prevents later input where the driver can enforce it. Native app launch also aborts its Accessibility watcher before launch when Stop arrives.

## Constraints

The model can make a wrong choice. Unit tests cover contracts and control flow, while task success requires an independent result check on a real browser or native app. Current checks and evidence levels are in [validation](validation.md) and [acceptance](acceptance.md). Generated traces, model files, and private observations stay under ignored `runs/` or the app's Application Support directory.
