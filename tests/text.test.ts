import { expect, test } from 'bun:test';
import { ChatCompletionTextModel } from '../src/text';

test('accepts structured candidate actions from a text provider', async () => {
  let request: any;
  const server = Bun.serve({ port: 0, async fetch(req) {
    request = await req.json();
    return Response.json({ choices: [{ message: { content: JSON.stringify({ actions: [
      { kind: 'launch_app', name: 'Settings', reason: 'The task asks for settings' },
    ] }) } }] });
  } });
  try {
    const model = new ChatCompletionTextModel(`http://127.0.0.1:${server.port}/v1/chat/completions`, 'small-text');
    const actions = await model.propose('Open Settings', { desktop: { apps: [], windows: [] } }, []);
    expect(request.model).toBe('small-text');
    expect(actions).toEqual([{ kind: 'launch_app', name: 'Settings', reason: 'The task asks for settings' }]);
  } finally { server.stop(true); }
});

test('rejects prose in place of an action plan', async () => {
  const server = Bun.serve({ port: 0, fetch: () => Response.json({
    choices: [{ message: { content: 'Open Settings now.' } }],
  }) });
  try {
    const model = new ChatCompletionTextModel(`http://127.0.0.1:${server.port}/v1/chat/completions`, 'small-text');
    await expect(model.propose('Open Settings', { desktop: { apps: [], windows: [] } }, []))
      .rejects.toThrow('did not return JSON');
  } finally { server.stop(true); }
});
