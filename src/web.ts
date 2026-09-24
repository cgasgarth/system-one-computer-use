/** Local task entry point for typed text and Handy dictation. */
import { runTask } from './agent';
import { CuaBrowserComputer } from './browser';
import { CuaMcpComputer } from './cua';
import { SystemOneHttpDecisionModel } from './decision';
import { ChatCompletionTextModel } from './text';

function required(name: string): string {
  const value = Bun.env[name];
  if (!value) throw new Error(`${name} is required; see README.md`);
  return value;
}

const text = new ChatCompletionTextModel(required('TEXT_MODEL_URL'), required('TEXT_MODEL_ID'),
                                         Bun.env.TEXT_MODEL_API_KEY);
const decision = new SystemOneHttpDecisionModel(required('SYSTEM_ONE_URL'), required('SYSTEM_ONE_MODEL'));
const driver = Bun.env.CUA_DRIVER_BIN || 'cua-driver';
const html = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>System One Computer Use</title>
<style>
  :root { font-family: -apple-system,BlinkMacSystemFont,system-ui,sans-serif; color-scheme: dark;
    background: #111827; color: #eff6ff; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
  main { width: min(740px, calc(100vw - 48px)); padding: 36px; background: #1d293b;
    border: 1px solid #394b64; border-radius: 22px; box-shadow: 0 24px 90px #0005; }
  h1 { font-size: 32px; letter-spacing: -.04em; margin: 0 0 8px; }
  p { color: #b8c6d9; margin: 0 0 24px; }
  textarea,select,button { font: inherit; }
  textarea { box-sizing: border-box; width: 100%; min-height: 112px; padding: 16px; border-radius: 12px;
    border: 1px solid #52667f; background: #101926; color: white; resize: vertical; }
  .row { display: flex; gap: 12px; align-items: center; margin-top: 14px; }
  select,button { border: 1px solid #52667f; border-radius: 10px; padding: 11px 16px; }
  select { flex: 1; color: white; background: #101926; }
  button { cursor: pointer; color: #092118; background: #93e0c1; border: 0; font-weight: 700; }
  button:disabled { opacity: .55; cursor: wait; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; color: #cae9dc; font-size: 13px; }
</style>
<main><h1>System One Computer Use</h1>
<p>Type a task, or use Handy to dictate into this field. Press Run after transcription.</p>
<form><textarea id="task" required autofocus placeholder="Open https://example.com and inspect the page"></textarea>
<div class="row"><select id="mode"><option value="browser">Browser in isolated Chrome</option>
<option value="desktop">macOS desktop</option></select><button id="run">Run task</button></div></form>
<pre id="status" role="status">Ready.</pre></main>
<script>
  const form = document.querySelector('form');
  const status = document.getElementById('status');
  const button = document.getElementById('run');
  form.addEventListener('submit', async event => {
    event.preventDefault(); button.disabled = true; status.textContent = 'Working…';
    try {
      const response = await fetch('/tasks', { method: 'POST', headers: {'content-type':'application/json'},
        body: JSON.stringify({task:document.getElementById('task').value, mode:document.getElementById('mode').value}) });
      const data = await response.json();
      status.textContent = response.ok ?
        data.summary + '\n' + data.totalSeconds.toFixed(2) + ' s · ' + data.requestsPerSecond.toFixed(2) +
        ' decisions/s · ' + data.decisions + ' decisions' : data.error;
    } catch (error) { status.textContent = String(error); }
    finally { button.disabled = false; }
  });
</script></html>`;

let busy = false;
const server = Bun.serve({ hostname: '127.0.0.1', port: Number(Bun.env.PORT || 8787),
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (request.method !== 'POST' || url.pathname !== '/tasks') return new Response('Not found', { status: 404 });
    if (busy) return Response.json({ error: 'A task is already running' }, { status: 409 });
    let input: { task: string; mode: 'browser' | 'desktop' };
    try {
      const raw = await request.json() as Record<string, unknown>;
      if (typeof raw.task !== 'string' || !raw.task.trim() ||
          (raw.mode !== 'browser' && raw.mode !== 'desktop')) throw new Error('Enter a task and choose a mode');
      input = { task: raw.task.trim(), mode: raw.mode };
    } catch (error) { return Response.json({ error: String(error) }, { status: 400 }); }
    busy = true;
    const computer = input.mode === 'browser'
      ? new CuaBrowserComputer(Bun.env.CUA_BROWSER_APP || 'Google Chrome', driver)
      : new CuaMcpComputer(driver);
    try {
      const result = await runTask(input.task, computer, text, decision);
      return Response.json({ summary: result.summary, totalSeconds: result.totalMs / 1000,
        requestsPerSecond: result.requestsPerSecond, decisions: result.steps.length });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    } finally {
      await computer.close();
      busy = false;
    }
  },
});
console.log(`System One task input: ${server.url}`);
