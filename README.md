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
[CUA Driver](https://github.com/trycua/cua). Native tasks use CUA's Accessibility
and Screen Recording grants. Browser tasks use the
[Playwright Chrome extension](https://github.com/microsoft/playwright/tree/main/packages/extension).
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
  It checks System One Accessibility and the configured CUA Driver's Accessibility
  and Screen Recording grants. Open the matching macOS privacy page from a missing
  status, then select Recheck. Handy owns microphone access; Settings links to its
  macOS page but does not claim to verify Handy's grant.
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

### Chrome connection

Keep Chrome and its Playwright extension available. Set
`PLAYWRIGHT_MCP_EXTENSION_TOKEN`, or reuse the existing Playwright token in
`~/.claude.json`. Credentials stay local. The token avoids repeated connection
approval dialogs.

The current Playwright extension gives each connected client its own tab group.
The app keeps one connection across tasks. Drag an existing tab into the
**system-one-computer-use** group to make it available. The connection's Welcome
tab closes after a usable tab is attached. Other clients' tabs remain outside
this connection.

Session context is saved on disk. Browser continuation restores a unique saved URL within the connected tab group and verifies it before use. If the saved tab is missing or ambiguous, the driver creates a blank task tab. It does not select an unrelated tab. On macOS, the adapter uses the installed Chrome executable to establish the extension connection; `PLAYWRIGHT_MCP_EXECUTABLE_PATH` can specify another Chrome location. Native window transitions get one bounded rediscovery within the same process; ambiguous windows return to model selection.

Playwright MCP is installed from npm's latest release and locked in `bun.lock`.
The browser adapter uses that release's `target` references for clicks and typing.

### Timing

The task dropdown shows:

| Metric               | Definition                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| Median decision · ms | Median completed System One request latency                                                         |
| Actions / sec        | Performed model-selected actions divided by task execution time, including time still spent waiting |

Tool operations and observations are included in throughput. Initial model loading is excluded. The menu stays open on submit and does not reopen itself after a task error.

## Models in the app

Select a model in Settings to download and load it. Presets include CLM 8B at 4-bit, 8-bit and BF16, and Kev 0.8B, 4B and 9B through the upstream MLX backend. Qwen 3.5 2B at 4-bit is available for text generation. External inference URLs are also supported.

Choose whether to keep models loaded, unload after five idle minutes, or unload after each task. Quitting the app stops its model processes. See [model management](docs/models.md) for runtime requirements, endpoints, memory behavior and logs.

Editing the task field or starting dictation starts model loading before submission. Draft warm-up holds models for five idle minutes, including under the unload-after-task policy. It does not start computer actions.

## Model services

| Setting                          | Purpose                                                    |
| -------------------------------- | ---------------------------------------------------------- |
| `SYSTEM_ONE_URL`                 | App-managed Unix endpoint or external System One URL       |
| `SYSTEM_ONE_MODEL`               | Decision provider's model ID                               |
| `SYSTEM_ONE_API_KEY`             | Optional bearer token                                      |
| `TEXT_MODEL_URL`                 | App-managed Unix endpoint or external Chat Completions URL |
| `TEXT_MODEL_ID`                  | Text provider's model ID                                   |
| `TEXT_MODEL_API_KEY`             | Optional bearer token                                      |
| `CUA_MODE`                       | `auto` (default), `browser`, or `desktop`                  |
| `CUA_DRIVER_BIN`                 | CUA executable; defaults to `cua-driver`                   |
| `PLAYWRIGHT_MCP_EXTENSION_TOKEN` | Optional explicit Chrome extension token                   |
| `SYSTEM_ONE_TRACE`               | Set to `1` for CLI decision output                         |

The app writes its managed endpoints to its private `.env` file. A local endpoint
has the form `unix:///absolute/path/model.sock?role=decision` or `role=text`.
Each connection carries one JSON request and one JSON response. The Python
bridge calls the model library directly; local inference has no HTTP server or
TCP listening port. Closing the connection cancels the caller's pending request.
An active decision forward pass can finish before its process accepts another request.

## CLI

```bash
bun run start "Open https://example.com and inspect the page"
CUA_MODE=desktop bun run start "Open Calculator"
```

CLI traces go to ignored `runs/`. The app uses a persistent JSON-lines worker
with the same task loop and adapters. Provider protocols other than System One
can implement [`DecisionModel`](src/models/system-one.ts).

## Behavior and limits

External configuration, socket and HTTP responses, model output, and driver data are
validated with Zod. Swift validates its IPC messages with Codable. Internal
TypeScript uses schema-derived types and concrete driver methods.

Actions use current references. CUA's own authorization windows and the harness UI are excluded. Tool failures are included in the next decision; they do not remove access to the other tool set.

The decision model selects tools, installed applications, and termination. Selecting desktop tools does not launch an application. The next choice names an exact installed app; the harness checks that name before launch. Large target lists are grouped for model selection. The text helper supplies field text or a URL only when needed. Field handles are refreshed after text generation. There is no text-model task planner.

The loop remembers recent state/action pairs. Repeated controls in the same state become unavailable, including focus cycles that return to an earlier state. Refresh retries are bounded when the screen does not change or the same observation error persists. Other tools and terminal choices remain available. There is no total action limit.

Opening the current URL or selected app is idempotent. Text responses must end normally before the harness types them. Native text areas need an explicit writable capability before they become typing targets; some native editors need more driver support. Browser text areas expose that capability through Playwright.

Actions are grouped by operation, with native menus grouped by their observed top-level menu. The model can reject a group and choose another without executing an unrelated tool. Observed links, file-open controls, and search submission use the primary grounded choice. Persistent effects retain separate authorization and field checks. Native labels, search-field roles, and document URLs come from Accessibility metadata bound to the selected process and window; no app-specific workflow is encoded.

Completion uses the observed app, window title, URL, and field values. Inline editors and dialogs get a separate check for an unobserved saved or submitted result, so matching text alone does not prove a save. If the screen changes before Finish, completion is checked again against the fresh observation. Model decisions use their selected answer; the harness does not override that answer with a confidence cutoff.

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
have a hard 600-line limit. See [engineering rules](docs/engineering.md).

```text
src/
  agent/       tool options, turn execution, surface state and task loop
  app/         CLI, native worker, settings and configuration boundaries
  computer/    CUA and Playwright adapters
  models/      decision and text model adapters
native/
  SystemOne/   AppKit menu-bar UI, settings, shortcuts, IPC
integrations/
  clm-mlx/     optional local CLM serving adapter
```

Keep recordings and experiments under ignored `runs/`. Demo videos use real app
footage and remain local. No GitHub Actions or YouTube uploads.

### Driver overhead

The app disables CUA's decorative agent cursor for its own session. Native
accessibility and input checks still run. Chrome uses Playwright directly with
`--timeout-settle 0`; it retains Playwright's actionability checks. If no next
control is available after an action, the loop re-observes for up to 1.5 seconds
instead of waiting after every successful action.

A local button test on the development Mac used 12 clicks per configuration:
median Playwright click latency was 547 ms with its 500 ms settle window and
28 ms with zero settle. All 24 resulting counts were verified. This isolates
driver overhead and is not a model or full-task throughput benchmark. A delayed
page update was checked separately to verify the bounded observation retry.

Task traces separate `observationMs`, `decisionMs`, and `actionMs`. Request
latency varies with screen size and cache state; a large Calendar observation
can take much longer than a small page. Request events record the phase, result,
and duration, including an unfinished request when a task is stopped. The menu
shows the median request latency for the current task.

See [validation](docs/validation.md) for installed-app checks and their limits.
