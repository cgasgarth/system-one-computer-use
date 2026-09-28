# System One Computer Use

A native macOS menu-bar app and Bun harness for System One decision models.
Enter a task or dictate with Handy. The harness reads live controls, asks the
model to choose an action, executes it, and checks the resulting state.

The decision model, text model, and computer driver are separate interfaces.
App-managed MLX models use JSON messages over private Unix sockets. External
System One endpoints use HTTP when selected in Settings. This repository does
not train a custom decision model.

## macOS app

To build the app, install [Bun](https://bun.sh/), [uv](https://docs.astral.sh/uv/), Xcode Command Line Tools, and
the [ChatGPT desktop app](https://chatgpt.com/download/) with Codex Computer Use
and its Chrome connection configured. Native and browser actions use those
installed Codex controls.
Configure a [stable signing identity](docs/local-signing.md) once so rebuilds can
retain the app's macOS permission identity.

```bash
bun install --frozen-lockfile
cp .env.example .env
# The app downloads and runs local models. No serving terminal is needed.
SYSTEM_ONE_CODESIGN_IDENTITY=<certificate-fingerprint> bun run app:install
open "$HOME/Applications/System One Computer Use.app"
```

Click the **cursor icon** in the menu bar. The dropdown contains task input,
voice control, status, and timing. It has no web portal or detached task window.

- **Control surface** offers **Auto**, **Chrome**, and **Desktop**. Auto lets the decision model choose its first tool set. It can switch tool sets on every turn.
- **Session** defaults to Automatic. Follow-ups reuse the active session for up to one hour of inactivity. Choose New session or one of the last three sessions explicitly.
- **Command–Option–C** starts Handy dictation and follows Handy's Hold, Auto, or Toggle setting. Handy
  pastes its transcript into the task field, which starts the task.
  Using the shortcut while a task runs or a transcript is pending stops that work and starts a new recording. The Dictate button stays available too.
- **Settings** stays inside the dropdown, with General, Models, and Permissions
  tabs. General holds the voice shortcut, control surface, and idle memory policy;
  Models holds local models and external endpoints.
  Permissions checks the installed Codex runtime and whether its computer and
  Chrome plugins are enabled. Open Codex to finish setup. Installation and enabled
  status do not prove an active connection; the first control call verifies it.
  Handy owns microphone access; Settings links to its macOS page.
- **Stop** cancels the task or voice input. Reopen the dropdown while a task runs to stop it. Tasks have no fixed action-count limit. The decision model can mark a task Complete or Blocked. Tool errors go back to the model with switching options; model-service or storage failures stop execution. Click outside to dismiss the dropdown.

[Handy](https://github.com/cjpais/Handy) must be installed in `/Applications`
with its microphone access and a transcription model configured. Use Handy's
standard clipboard paste method. The app does not change your regular Handy
shortcut. Live speech requires a working microphone; a silent recording cannot
produce a task.

The installed runtime is bundled inside the app. Local settings and task traces
live in `~/Library/Application Support/SystemOneComputerUse/`. The installer
copies `.env` there on first install. Later Settings changes affect that app
configuration. The CLI continues to use the checkout's `.env`.

### Codex control setup

Enable Computer Use in the ChatGPT desktop app and complete its macOS permission
prompts. Enable the Codex Chrome plugin and connect its extension in Chrome.
System One uses the installed desktop runtime through local stdio. It does not
start a Codex model turn; the selected System One model still chooses actions.

System One automatically accepts Codex app and site tool approvals for its own
active control session. The app, CLI, and MCP bridge share this behavior. Stop
cancels the active task. macOS permissions still apply.

Browser sessions save the exact task-owned browser and tab identity. Follow-ups
reuse that target when it is available. A stale or ambiguous target is not replaced
with an unrelated user tab. Native controls bind to the selected app's observed
active window. New observations invalidate stale element references.

### Timing

The task dropdown shows:

| Metric               | Definition                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| Median decision · ms | Median completed System One request latency                                                         |
| Actions / sec        | Performed model-selected actions divided by task execution time, including time still spent waiting |

Tool operations and observations are included in throughput. Initial model loading is excluded. The menu stays open on submit and does not reopen itself after a task error.

## Models in the app

Select a model in Settings to download and load it. Fresh installs default to Kev 4B; saved selections are preserved. Decision presets include CLM 8B at 4-bit, 8-bit and BF16; Kev 0.8B, 4B and 9B through MLX; and Julia 1 on CPU. Qwen 3.5 2B at 4-bit supplies text. External inference URLs are also supported. Settings checks for newer downloaded checkpoints and offers **Update model** without changing a model during a task.

Choose whether to keep models loaded, unload after five idle minutes, or unload after each task. Quitting the app stops its model processes. See [model management](docs/models.md) for runtime requirements, endpoints, memory behavior and logs.

Opening the task menu, editing the task field, or starting dictation loads models before submission. The local text model also prepares its exact system prompts in the background. A task cancels unfinished prompt preparation. Draft warm-up holds models for five idle minutes, including under the unload-after-task policy. It does not start computer actions or send the draft to a model.

## Model services

| Setting                      | Purpose                                                    |
| ---------------------------- | ---------------------------------------------------------- |
| `SYSTEM_ONE_URL`             | App-managed Unix endpoint or external System One URL       |
| `SYSTEM_ONE_MODEL`           | Decision provider's model ID                               |
| `SYSTEM_ONE_API_KEY`         | Optional bearer token                                      |
| `TEXT_MODEL_URL`             | App-managed Unix endpoint or external Chat Completions URL |
| `TEXT_MODEL_ID`              | Text provider's model ID                                   |
| `TEXT_MODEL_API_KEY`         | Optional bearer token                                      |
| `SYSTEM_ONE_CONTROL_SURFACE` | `auto` (default), `browser`, or `desktop`                  |
| `SYSTEM_ONE_TRACE`           | Set to `1` for CLI decision output                         |

The app writes its managed endpoints to its private `.env` file. A local endpoint
has the form `unix:///absolute/path/model.sock?role=decision` or `role=text`.
Each connection carries one JSON request and one JSON response. The Python
bridge calls the model library directly; local inference has no HTTP server or
TCP listening port. Closing the connection cancels the caller's pending request.
An active decision forward pass can finish before its process accepts another request.

## CLI

```bash
bun run start "Open https://example.com and inspect the page"
SYSTEM_ONE_CONTROL_SURFACE=desktop bun run start "Open Calculator"
```

CLI traces go to ignored `runs/`. The app uses a persistent JSON-lines worker
with the same task loop and adapters. Provider protocols other than System One
can implement [`DecisionModel`](src/models/system-one.ts).

## Codex controls for other clients

An optional [stdio MCP bridge](docs/codex-controls.md) exposes the installed
ChatGPT desktop app’s computer and Chrome controls to external clients, including
Claude Code. The calling client supplies the decisions; the bridge does not run
a Codex model turn. It accepts app and site tool approvals automatically.

## Behavior and limits

External configuration, socket and HTTP responses, model output, and driver data are
validated with Zod. Swift validates its IPC messages with Codable. Internal
TypeScript uses schema-derived types and concrete driver methods.

Actions use current references. The controller's authorization windows and the harness UI are excluded. Tool failures are included in the next decision; they do not remove access to the other tool set.

The decision model selects tools, installed applications, and termination. Selecting desktop tools does not launch an application. The next choice names an exact installed app; the harness checks that name before launch. Large target lists are grouped for model selection. The text helper supplies field text or a URL only when needed. Field handles are refreshed after text generation. There is no text-model task planner.

The loop remembers recent state/action pairs. Repeated controls in the same state become unavailable, including focus cycles that return to an earlier state. Refresh retries are bounded when the screen does not change or the same observation error persists. Other tools and terminal choices remain available. There is no total action limit.

Opening the current URL or selected app is idempotent. Text responses must end normally before the harness types them. Native text areas need an explicit writable capability before they become typing targets; some native editors need more driver support. Browser text areas expose that capability through the Codex Chrome observation.

Actions are grouped by operation; native commands are grouped by their observed top-level menu. The selected operation stays in the next target decision. The model can reject a group and choose another without executing an unrelated tool. Observed links, file-open controls, and search submission use the primary grounded choice. Persistent effects retain separate authorization and field checks. Native labels, search-field roles, and document URLs come from Accessibility metadata bound to the selected process and window; no app-specific workflow is encoded.

The model can also **inspect an app menu** before choosing a command. It selects an observed menu name, such as File, Edit, or View, and receives a fresh read of that menu's commands, including disabled items. Inspection opens the observed menu and reads its visible commands; it does not invoke a command. The report stays in the current observation and states whether the read was complete. Changing the app, window, or tool set clears the inspected view. Menu inspection requires a selected app and an exposed menu; it does not invent a File menu.

The decision model chooses the next action, including Finish and Blocked. There is no completion preflight. A selected Finish stops the task after a fresh observation confirms that the screen has not changed. The harness checks requested persistent effects before the action, and reads back typed field values. If the screen changes before Finish, completion is checked again against the fresh observation. Model decisions use their selected answer; the harness does not override that answer with a confidence cutoff.

**Complex workflows remain under development.** Diagram authoring, arbitrary
canvas interaction, and reliable multi-app workflows are not validated yet.
A System One model ranks supplied choices; it does not independently generate
arbitrary text, coordinates, or a complete workflow. Small text models can also
return incorrect arguments. Models can repeat actions or mark completion incorrectly; a model's Complete decision is not independent proof of task success. Use Stop to interrupt a loop.

## Development

```bash
bun run check
bun run test
bun run format
bun run app:install
```

TypeScript extends `@tsconfig/strictest`. Oxlint enables all categories at error
severity with type-aware checks and zero warnings. Source files, including Swift,
have a hard 600-line limit. See [engineering rules](docs/engineering.md)
and [architecture](docs/architecture.md) for module ownership and lifetimes.

```text
src/
  agent/       tool options, turn execution, surface state and task loop
  app/         CLI, worker, settings, sessions, model and driver lifetime
  computer/    Codex native and Chrome adapters
  models/      decision and text model adapters
native/
  SystemOne/   AppKit menu-bar UI, settings, shortcuts, IPC
integrations/
  clm-mlx/     optional local CLM model adapter
  local-bridge/ private Unix socket model service
```

Keep recordings and experiments under ignored `runs/`. Demo videos use real app
footage and remain local. No GitHub Actions or YouTube uploads.

### Driver behavior

Codex owns native input, accessibility reads, and the Chrome extension connection.
System One translates current observations into model choices and sends the
selected action through those controls. Its drivers retain snapshot-bound targets
and apply Stop before input. Control errors return to the decision loop.

Task traces separate `observationMs`, `decisionMs`, and `actionMs`. Request
latency varies with screen size and cache state; a large Calendar observation
can take much longer than a small page. Request events record the phase, result,
and duration, including an unfinished request when a task is stopped. The menu
shows the median request latency for the current task.

See [validation](docs/validation.md) for installed-app checks and their limits.
