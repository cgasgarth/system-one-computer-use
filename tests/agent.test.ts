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
    window: async () => clicked.length ? { ...window, elements: [] } : window,
    launchApp: async () => { throw new Error('unexpected launch'); },
    clickElement: async (_pid, _id, token) => { clicked.push(token); },
    typeText: async () => { throw new Error('unexpected text'); },
    pressKey: async () => { throw new Error('unexpected key'); },
  };
  let preparations = 0;
  const text: TextModel = { prepare: async () => { preparations++; return { app: 'Settings' }; } };
  const decision: DecisionModel = { choose: async (_task, _observation, actions) => ({
    action: actions[0], probabilities: { A0: 1 }, latencyMs: 12,
  }) };
  const result = await runTask('Open Bluetooth settings', computer, text, decision);
  expect(clicked).toEqual(['s00000001:1']);
  expect(result.steps.map(s => s.action.kind)).toEqual(['observe_window', 'click_element', 'finish']);
  expect(preparations).toBe(1);
  expect(result.requestsPerSecond).toBeGreaterThan(0);
});

test('a browser task navigates through a live isolated tab once', async () => {
  const navigated: string[] = [];
  const browser: Computer = {
    desktop: async () => desktop,
    window: async () => ({ ...window, window_title: navigated.length ? 'Example Domain' : 'about:blank', elements: [] }),
    navigate: async url => { navigated.push(url); },
    launchApp: async () => { throw new Error('unexpected launch'); },
    clickElement: async () => { throw new Error('unexpected click'); },
    typeText: async () => { throw new Error('unexpected text'); },
    pressKey: async () => { throw new Error('unexpected key'); },
  };
  const text: TextModel = { prepare: async () => ({ url: 'https://example.com' }) };
  const decision: DecisionModel = { choose: async (_task, _observation, actions) => ({
    action: actions[0], probabilities: { A0: 1 }, latencyMs: 1,
  }) };
  const result = await runTask('Open https://example.com', browser, text, decision);
  expect(navigated).toEqual(['https://example.com']);
  expect(result.steps.map(step => step.action.kind)).toEqual(['observe_window', 'navigate', 'finish']);
});
