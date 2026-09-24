import { describe, expect, test } from 'bun:test';
import { runTask } from '../src/agent';
import { validateActions, type Action, type Desktop, type Window } from '../src/contracts';
import type { Computer } from '../src/cua';
import type { DecisionModel } from '../src/decision';
import type { TextModel } from '../src/text';

const desktop: Desktop = { apps: [{ name: 'Settings', pid: 7, bundle_id: 'test.settings' }],
  windows: [{ app_name: 'Settings', pid: 7, window_id: 9, title: 'Settings' }] };
const window: Window = { app_name: 'Settings', window_title: 'Settings', pid: 7,
  window_id: 9, snapshot_id: 's00000001', elements: [
    { element_index: 1, element_token: 's00000001:1', role: 'AXButton', label: 'Bluetooth', actions: ['AXPress'] },
  ] };

describe('live Cua action boundary', () => {
  test('accepts a current element and rejects a stale token', () => {
    const actions: Action[] = [
      { kind: 'click_element', pid: 7, window_id: 9, element_token: 's00000001:1', reason: 'Open Bluetooth' },
      { kind: 'click_element', pid: 7, window_id: 9, element_token: 's00000000:1', reason: 'Old snapshot' },
    ];
    expect(validateActions(actions, { desktop, window })).toEqual([actions[0]]);
  });

  test('refuses a window that is not in the desktop snapshot', () => {
    const action: Action = { kind: 'observe_window', pid: 7, window_id: 100,
      reason: 'Invented target' };
    expect(validateActions([action], { desktop })).toEqual([]);
  });
});

test('text task drives observed action through the decision model', async () => {
  const clicked: string[] = [];
  const computer: Computer = {
    desktop: async () => desktop,
    window: async () => window,
    launchApp: async () => { throw new Error('unexpected launch'); },
    clickElement: async (_pid, _id, token) => { clicked.push(token); },
    typeText: async () => { throw new Error('unexpected text'); },
    pressKey: async () => { throw new Error('unexpected key'); },
  };
  let turn = 0;
  const text: TextModel = { propose: async () => {
    turn++;
    if (turn === 1) return [{ kind: 'observe_window', pid: 7, window_id: 9, reason: 'Inspect Settings' }];
    if (turn === 2) return [
      { kind: 'click_element', pid: 7, window_id: 9, element_token: 's00000000:1', reason: 'Stale' },
      { kind: 'click_element', pid: 7, window_id: 9, element_token: 's00000001:1', reason: 'Open Bluetooth' },
    ];
    return [{ kind: 'finish', summary: 'Bluetooth settings are open', reason: 'The target was reached' }];
  } };
  const decision: DecisionModel = { choose: async (_task, _observation, actions) => ({
    action: actions[0], probabilities: { A0: 1 }, latencyMs: 12,
  }) };
  const result = await runTask('Open Bluetooth settings', computer, text, decision);
  expect(clicked).toEqual(['s00000001:1']);
  expect(result.steps.map(s => s.action.kind)).toEqual(['observe_window', 'click_element', 'finish']);
  expect(result.requestsPerSecond).toBeGreaterThan(0);
});
