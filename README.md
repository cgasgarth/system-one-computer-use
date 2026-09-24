# System One Computer Use

A provider-neutral computer-use harness for System One decision models. Give it
a text task. It reads live controls through CUA, asks a model to choose an action,
executes that action, and observes the result before the next decision.

CLM, Jev, Kev, and other compatible services use the same HTTP adapter. The
decision model, text model, and computer driver are separate interfaces. This
repository does not train or include a custom decision model.

## Run

Install [Bun](https://bun.sh/) and [CUA Driver](https://github.com/trycua/cua).
Start `CuaDriver.app` and grant its Accessibility and Screen Recording permissions.
Start Chrome for browser tasks.

```bash
bun install --frozen-lockfile
cp .env.example .env
# Set your decision and text endpoints in .env.
bun run start "Open https://example.com and inspect the page"
```

| Setting                | Purpose                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `SYSTEM_ONE_URL`       | Complete System One HTTP endpoint, including `/v1/systemone` |
| `SYSTEM_ONE_MODEL`     | The provider's model ID                                      |
| `SYSTEM_ONE_API_KEY`   | Optional bearer token                                        |
| `TEXT_MODEL_URL`       | Chat-completion endpoint for task text                       |
| `TEXT_MODEL_ID`        | The text provider's model ID                                 |
| `TEXT_MODEL_API_KEY`   | Optional bearer token                                        |
| `CUA_MODE`             | `browser` or `desktop`                                       |
| `CUA_BROWSER_APP`      | Browser application; defaults to Google Chrome               |
| `SYSTEM_ONE_MAX_STEPS` | Decision limit; defaults to 16                               |
| `SYSTEM_ONE_TRACE`     | Set to `1` to print each decision                            |

The example configuration uses local CLM. To use a hosted model, replace the
decision URL, model ID, and optional key. The task loop contains no provider list
or model-name branches. A provider with another protocol can implement
[`DecisionModel`](src/models/system-one.ts).

### Local CLM on Apple Silicon

The optional [CLM MLX integration](integrations/clm-mlx/README.md) serves the
published CLM-8B heads with a Qwen3-8B encoder running in MLX:

```bash
uv run --project integrations/clm-mlx --frozen clm-mlx --bits 4
```

This provides `http://127.0.0.1:8700/v1/systemone` with model ID `clm-latest`.
The first start downloads the pinned public weights. This integration is
independent of the TypeScript task loop.

### Text service

Any compatible chat-completion service can supply task text. One tested local
option is Qwen3.5-2B in MLX:

```bash
uv tool install mlx-lm==0.31.3
mlx_lm.server --model mlx-community/Qwen3.5-2B-4bit --port 8080 \
  --chat-template-args '{"enable_thinking":false}'
```

For `mlx-lm`, `TEXT_MODEL_ID=default_model` selects the model loaded by the server.
The text model extracts the requested app, URL, target, and text once per task.
Only values present in the user request can drive navigation or typing.

### Task page and Handy

```bash
bun run web
```

Open the printed local address. Type a task, or dictate with Handy into the task
field, then press **Run task**. The page and CLI use the same task loop. The local
page accepts one task at a time and keeps credentials on the server.

## How it works

- External configuration, requests, CUA results, and model responses are validated
  with Zod at their boundaries. Internal functions use the resulting types.
- The model receives semantic action descriptions. Temporary CUA handles stay
  local, so changing a handle does not invalidate a model's action-text cache.
- The selected action must refer to a control in the latest observation.
  Browser observations use CUA's exact tab binding; desktop observations stay
  inside the selected native window.
- Text is inserted in one operation. A Return action is available only after
  the requested text is visible in a field.
- Completion requires an observed result. A previous task's completion status
  cannot complete a new task. Refused CUA operations are recorded as failures.
- The text plan distinguishes opening a URL or app from a larger task. Simple
  opening tasks stop when the requested URL or app is observed; complex tasks
  continue through the decision model.

The browser driver uses an isolated Chrome profile and CUA's explicit DOM-event
click route. Sites that require trusted input can reject that route. Controls
that exist only as pixels still need a visual-grounding adapter.

Completed CLI traces are written to ignored `runs/`. They report total time,
decision time, actions, and probabilities. Full-task time includes planning and
computer operations; model response time measures a different boundary.

## Development

```bash
bun run check       # Oxlint plus strict TypeScript checks
bun test
bun run format
```

`tsconfig.json` extends `@tsconfig/strictest`. Oxlint enables all categories at
error severity, uses type-aware checks, and allows zero warnings. Source files
have a hard 600-line limit. [Engineering rules](docs/engineering.md) explain the
small set of syntax and SDK compatibility exceptions.

```text
src/
  agent/       action candidates, completion, execution, task loop
  app/         CLI, local task page, configuration and HTTP boundaries
  computer/    CUA transport schemas and native/browser adapters
  models/      System One and text-provider contracts and adapters
integrations/
  clm-mlx/     optional local CLM serving adapter
tests/         task behavior and provider protocol checks
```
