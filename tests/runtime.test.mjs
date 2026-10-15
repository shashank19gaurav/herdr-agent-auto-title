import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireLock, watcherRunning, pluginEnabled, tick, watch, start, PLUGIN_ID } from '../src/main.mjs';
import { TitleTracker } from '../src/titles.mjs';

const address = () => process.platform === 'win32'
  ? `\\\\.\\pipe\\copilot-title-test-${randomUUID()}`
  : join(tmpdir(), `copilot-title-${randomUUID()}.sock`);
const close = server => new Promise(resolve => server.close(resolve));
const plugins = enabled => ({ plugins: [{ plugin_id: PLUGIN_ID, enabled }] });
const agent = {
  agent: 'copilot', pane_id: 'w1:p1', tab_id: 'w1:t1', terminal_id: 'terminal',
  agent_session: { agent: 'copilot', kind: 'id', value: 's1' },
  terminal_title_stripped: 'Title "quoted" - GitHub Copilot',
};
const snapshot = { snapshot: { agents: [agent], tabs: [{ tab_id: 'w1:t1', label: 'manual' }] } };

test('singleton lock is scoped, detectable, released, and duplicate acquisition is harmless', async () => {
  const pipe = address();
  assert.equal(await watcherRunning(pipe), false);
  const lock = await acquireLock(pipe);
  try {
    assert.equal(await watcherRunning(pipe), true);
    if (process.platform === 'win32') assert.equal(await acquireLock(pipe), null);
    let calls = 0;
    await start(async () => { calls++; }, pipe);
    assert.equal(calls, 0);
  } finally { await close(lock); }
  assert.equal(await watcherRunning(pipe), false);
});

test('start uses a native background plugin pane and respects disabled plugins', async () => {
  const calls = [];
  await start(async args => {
    calls.push(args);
    return plugins(true);
  }, address());
  assert.deepEqual(calls[1], ['plugin', 'pane', 'open', '--plugin', PLUGIN_ID,
    '--entrypoint', 'watcher', '--placement', 'tab', '--no-focus']);
  await start(async args => {
    assert.deepEqual(args, ['plugin', 'list', '--json']);
    return plugins(false);
  }, address());
  await assert.rejects(pluginEnabled(async () => ({})), /missing plugins/);
});

test('tick uses argv, rechecks session before rename, and stops on disable', async () => {
  const calls = [];
  const api = async args => {
    calls.push(args);
    if (args[0] === 'plugin') return plugins(true);
    if (args[0] === 'api') return snapshot;
    if (args[0] === 'agent') return { agent };
    return {};
  };
  const tracker = new TitleTracker();
  await tick(api, tracker);
  await tick(api, tracker);
  assert.deepEqual(calls.at(-1), ['tab', 'rename', 'w1:t1', 'Title "quoted"']);
  assert.equal(await tick(async () => plugins(false), tracker), false);
  calls.length = 0;
  await tick(async args => args[0] === 'agent'
    ? { agent: { ...agent, agent_session: { value: 'switched' } } } : api(args), tracker);
  assert.equal(calls.some(args => args[0] === 'tab'), false);
});

test('rename errors propagate instead of caching success', async () => {
  const tracker = new TitleTracker();
  tracker.plan(snapshot.snapshot);
  const api = async args => {
    if (args[0] === 'plugin') return plugins(true);
    if (args[0] === 'api') return snapshot;
    if (args[0] === 'agent') return { agent };
    throw new Error('rename failed');
  };
  await assert.rejects(tick(api, tracker), /rename failed/);
  await assert.rejects(tick(api, tracker), /rename failed/);
});

test('missing server uses bounded backoff, logs failures, and releases lock', async () => {
  const pipe = address();
  const waits = [];
  const errors = [];
  await assert.rejects(watch(async () => { throw new Error('server missing'); }, pipe, {
    sleep: async ms => { waits.push(ms); },
    log: { log() {}, error: message => errors.push(message) },
  }), /five attempts/);
  assert.deepEqual(waits, [4000, 8000, 16000, 30000]);
  assert.equal(errors.length, 5);
  assert.equal(await watcherRunning(pipe), false);
});

test('disable/uninstall exits watcher and releases singleton', async () => {
  const pipe = address();
  await watch(async () => ({ plugins: [] }), pipe, { log: { log() {} } });
  assert.equal(await watcherRunning(pipe), false);
});

test('optional session identity still rechecks terminal identity before writing', async () => {
  const remote = { ...agent, agent_session: undefined };
  const tracker = new TitleTracker();
  let current = remote;
  const renames = [];
  const api = async args => {
    if (args[0] === 'plugin') return plugins(true);
    if (args[0] === 'api') return { snapshot: { ...snapshot.snapshot, agents: [remote] } };
    if (args[0] === 'agent') return { agent: current };
    renames.push(args);
    return {};
  };
  await tick(api, tracker);
  await tick(api, tracker);
  assert.equal(renames.length, 1);
  current = { ...remote, terminal_id: 'replacement' };
  await tick(api, tracker);
  assert.equal(renames.length, 1);
  const controller = new AbortController();
  controller.abort();
  assert.equal(await tick(api, tracker, { signal: controller.signal }), false);
});
