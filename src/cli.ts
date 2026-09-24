import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
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

const task = process.argv.slice(2).join(' ').trim();
if (!task) throw new Error('Usage: bun run start "Describe the computer task"');
const computer = Bun.env.CUA_MODE === 'browser'
  ? new CuaBrowserComputer(Bun.env.CUA_BROWSER_APP || 'Google Chrome', Bun.env.CUA_DRIVER_BIN || 'cua-driver')
  : new CuaMcpComputer(Bun.env.CUA_DRIVER_BIN || 'cua-driver');
const text = new ChatCompletionTextModel(
  required('TEXT_MODEL_URL'), required('TEXT_MODEL_ID'), Bun.env.TEXT_MODEL_API_KEY,
);
const decision = new SystemOneHttpDecisionModel(
  required('SYSTEM_ONE_URL'), required('SYSTEM_ONE_MODEL'),
);
const maxSteps = Number(Bun.env.SYSTEM_ONE_MAX_STEPS || 16);
const result = await runTask(task, computer, text, decision, maxSteps,
  Bun.env.SYSTEM_ONE_TRACE === '1' ? step => console.error(JSON.stringify(step)) : undefined,
).finally(() => computer.close());
const dir = resolve('runs');
await mkdir(dir, { recursive: true });
const path = resolve(dir, `task-${new Date().toISOString().replaceAll(':', '-')}.json`);
await Bun.write(path, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ summary: result.summary, totalSeconds: result.totalMs / 1000,
                             requestsPerSecond: result.requestsPerSecond, decisions: result.steps.length,
                             trace: path }));
