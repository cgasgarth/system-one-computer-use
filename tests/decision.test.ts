import { expect, test } from 'bun:test';
import { SystemOneHttpDecisionModel } from '../src/decision';

test('sends typed choices and maps the selected option back to an action', async () => {
  let request: any;
  const server = Bun.serve({ port: 0, async fetch(req) {
    request = await req.json();
    return Response.json({ answers: { next_action: {
      choice: 'A1', probabilities: { A0: 0.1, A1: 0.9 },
    } } });
  } });
  try {
    const model = new SystemOneHttpDecisionModel(`http://127.0.0.1:${server.port}/v1/systemone`, 'decision-model');
    const actions = [
      { kind: 'launch_app' as const, name: 'Settings', reason: 'Open it' },
      { kind: 'finish' as const, summary: 'Done', reason: 'Already complete' },
    ];
    const result = await model.choose('Open Settings', { desktop: { apps: [], windows: [] } }, actions);
    expect(request.model).toBe('decision-model');
    expect(request.questions.next_action.type).toBe('choice');
    expect(Object.keys(request.questions.next_action.criteria)).toEqual(['A0', 'A1']);
    expect(result.action).toEqual(actions[1]);
  } finally { server.stop(true); }
});
