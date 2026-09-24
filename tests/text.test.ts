import { expect, test } from 'bun:test';
import { ChatCompletionTextModel } from '../src/text';

test('accepts a short task plan from a text provider', async () => {
  let request: any;
  const server = Bun.serve({ port: 0, async fetch(req) {
    request = await req.json();
    return Response.json({ choices: [{ message: { content: JSON.stringify({ app: 'Settings' }) } }] });
  } });
  try {
    const model = new ChatCompletionTextModel(`http://127.0.0.1:${server.port}/v1/chat/completions`, 'small-text');
    const plan = await model.prepare('Open Settings');
    expect(request.model).toBe('small-text');
    expect(plan).toEqual({ app: 'Settings' });
  } finally { server.stop(true); }
});

test('rejects prose in place of a task plan', async () => {
  const server = Bun.serve({ port: 0, fetch: () => Response.json({
    choices: [{ message: { content: 'Open Settings now.' } }],
  }) });
  try {
    const model = new ChatCompletionTextModel(`http://127.0.0.1:${server.port}/v1/chat/completions`, 'small-text');
    await expect(model.prepare('Open Settings'))
      .rejects.toThrow('did not return JSON');
  } finally { server.stop(true); }
});

test('accepts fenced JSON but removes invented plan fields', async () => {
  const server = Bun.serve({ port: 0, fetch: () => Response.json({
    choices: [{ message: { content: '```json\n{"app":"Flight Search","url":"https://example.com","textToEnter":"ORD to JFK"}\n```' } }],
  }) });
  try {
    const model = new ChatCompletionTextModel(`http://127.0.0.1:${server.port}/v1/chat/completions`, 'small-text');
    expect(await model.prepare('Type ORD to JFK into the route field')).toEqual({ textToEnter: 'ORD to JFK' });
  } finally { server.stop(true); }
});
