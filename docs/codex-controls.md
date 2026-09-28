# Codex controls for external clients

The optional MCP bridge exposes the installed ChatGPT desktop app's native
computer controls and Chrome connection to another MCP client. The calling
client supplies the decisions. The bridge does not request a Codex model response.

This is a local, experimental integration. It depends on installed desktop
components and the user's existing Codex configuration. A desktop update can
change these interfaces. This repository does not copy or distribute the
proprietary desktop runtime.

## Requirements

- macOS with the ChatGPT desktop app installed and Computer Use set up.
- Codex's Chrome extension connected for browser tasks.
- Bun and this repository's dependencies (`bun install`).
- An MCP client with stdio tool support.

The bridge uses stdio. It does not start an HTTP listener or a local model server.
An isolated app-server process owns a temporary session for tool state. No
`turn/start` or other model-generation call is used. Browser operation metadata
uses IDs owned by this bridge; it does not copy another chat's identity.

## Connect Claude Code

From the repository directory:

```sh
claude mcp add --scope user --transport stdio computer -- \
  "$(command -v bun)" "$(pwd)/src/app/codex-controls-mcp.ts" --surface computer
claude mcp add --scope user --transport stdio chrome -- \
  "$(command -v bun)" "$(pwd)/src/app/codex-controls-mcp.ts" --surface chrome
```

Start a new Claude Code session and check `/mcp`. Ask it to use the
`computer` or `chrome` tools. This changes the available tools, not Claude's configured
model or API endpoint.

Claude reserves `computer-use` for its built-in server and rejects that name for
custom servers. Use `computer` for this replacement. Disable the built-in server
in `/mcp` and disable other browser drivers when you want only these controls.
See [Claude MCP configuration](https://code.claude.com/docs/en/mcp).

For another MCP client, use the same Bun command and absolute script path as a
stdio server. Each bridge process has its own control session.

## Permissions and ownership

The bridge automatically accepts app and site tool approvals for its own active
Codex session. No client confirmation UI or elicitation support is needed. It
does not save permanent grants. macOS permissions and Codex runtime restrictions
still apply.

Observe the app or tab before acting. Use current element references, inspect
the result after actions, and handle returned errors. Text and screenshots can
contain private data, so the calling client's model and data policy apply.

End the control session after the task. Do not retain temporary browser tabs
unless they are a requested output or needed for a follow-up. Existing user tabs
must retain their normal ownership.

## Evidence and limits

A separate Bun client, with inherited Codex runtime variables removed, called the
installed app-server on this Mac. It opened Calculator, clicked `7 + 5 =`, and
read `12` from the UI. It also used the Codex Chrome extension to open Example
Domain, follow its Learn more link to IANA, read the resulting page, and capture
a screenshot. It then closed its test tab. Neither task used a Codex model turn.

These short tasks prove the control connection; they do not establish general
agent reliability or a speed advantage. System One uses these Codex controls for its native and browser drivers. Its
selected local or external decision model remains separate from the control runtime.

## Tool use

Each server exposes its own execution tool plus session reset and end tools.
`computer_js` supplies the `cua` API. `chrome_js` supplies the connected `chrome`
and `agent` objects. Call the execution tool with empty code first and read its
returned documentation before taking an action. JavaScript bindings persist
within that server session.

Use `reset_controls` to finish the current operation group and clear JavaScript
state. Use `end_controls` when the client has finished. The client must treat
a tool error as an error, even if the MCP connection itself remains healthy.

The packaged MCP bridge was then checked with an independent MCP SDK client:
Calculator showed `9 + 6 = 15`, Chrome followed the same public link, and reset
closed its unmarked test tab and removed its JavaScript bindings. The two surface-specific
tool lists and Claude Code connection checks passed. See
[validation](validation.md) for installed-app results and their limits.

These are tool-connection results. A live agent test also requires access to its
selected model through the calling client's provider. A healthy MCP connection
does not establish model availability.
