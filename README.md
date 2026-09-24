# System One Computer Use

A local computer use harness for models that return probability distributions
over typed decisions. It accepts a text task, observes the desktop through Cua
Driver, builds candidates from visible controls, and lets a System One decision
model choose the next action. A small text model reads the request once to name
an application or supply text to enter. The harness checks each action against
the current Cua snapshot before it acts.

The decision model, text generator, and computer driver are separate interfaces.
The first driver holds one Cua MCP connection to the installed `cua-driver`
daemon and its macOS permission identity. The text generator can be any local service with a compatible chat
completion endpoint. Voice input from Handy will feed the same task interface
after the text path is verified.

## Local setup

Install [Bun](https://bun.sh/) and [Cua Driver](https://github.com/trycua/cua),
then start `CuaDriver.app` and grant its required macOS permissions.

```bash
bun install
export SYSTEM_ONE_URL=http://127.0.0.1:8009/v1/systemone
export SYSTEM_ONE_MODEL=your-system-one-model
export TEXT_MODEL_URL=http://127.0.0.1:8080/v1/chat/completions
export TEXT_MODEL_ID=your-local-instruct-model
bun run start "Open System Settings and find Bluetooth settings"
```

For browser tasks, start Chrome once, then use Cua's isolated Chrome profile:

```bash
export CUA_MODE=browser
export CUA_BROWSER_APP='Google Chrome'
bun run start "Open https://example.com and inspect the page"
```

The browser adapter binds the exact isolated tab, reads semantic page controls,
and uses short-lived action refs from each new snapshot. It does not attach to
or change the user's Chrome profile. The current task plan can open an exact URL
given in the request, click visible controls, and type into visible fields.
Browser clicks use Cua's explicit DOM event route because trusted background
input is refused on this setup; each click needs a fresh page observation to
confirm its effect. Sites that require trusted input may not respond.
Screens with only pixels still need visual grounding. Handy transcription will
feed the same task entry point after live tasks are verified.

The CLI prints a compact JSON trace. It does not record screenshots or voice.
The persistent Cua connection measured about 3 ms median for read-only desktop
observations on the development Mac, versus about 53 ms when starting the CLI
for every observation. These numbers do not measure a full task.

## Boundaries

- Cua supplies native window or browser page controls. The small text model supplies
  the requested application or text, and cannot send actions directly to Cua.
- The System One model chooses from current controls and returns probabilities.
- The harness accepts an element only when its one-use Cua token is present in
  the latest observation. A stale or invented token fails with a clear error.
- Each action is followed by a new observation. The loop stops on a selected
  `finish` action or its step limit.
