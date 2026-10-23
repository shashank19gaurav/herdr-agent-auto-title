import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireLock, watcherRunning, pluginEnabled, tick, watch, start, lockAddress, PLUGIN_ID } from '../src/main.mjs';
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

const piAgent = {
  agent: 'pi', pane_id: 'w1:p1', tab_id: 'w1:t1', terminal_id: 'terminal',
  cwd: '/work/project', terminal_title_stripped: 'π - Title "quoted" - project',
};

for (const withSession of [false, true]) {
  test(`pi pre-write checks all observation inputs (session ID ${withSession ? 'present' : 'absent'})`, async () => {
    const initial = { ...piAgent, ...(withSession
      ? { agent_session: { agent: 'pi', kind: 'id', value: 's1' } } : {}) };
    const tracker = new TitleTracker();
    let current = initial;
    const renames = [];
    const api = async args => {
      if (args[0] === 'plugin') return plugins(true);
      if (args[0] === 'api') return { snapshot: { ...snapshot.snapshot, agents: [initial] } };
      if (args[0] === 'agent') return { agent: current };
      renames.push(args);
      return {};
    };
    await tick(api, tracker);
    assert.deepEqual(renames, []);
    await tick(api, tracker);
    assert.deepEqual(renames, [['tab', 'rename', 'w1:t1', 'Title "quoted"']]);
    renames.length = 0;
    for (const overrides of [
      { pane_id: 'w1:p2' }, { pane_id: undefined }, { tab_id: 'w1:t2' },
      { terminal_id: 'replacement' }, { agent: 'copilot', terminal_title_stripped: 'Title "quoted"' },
      { agent: 'unknown' }, { agent_session: {} },
      { agent_session: { agent: 'pi', kind: 'id', value: 'switched' } },
      { agent_session: { agent: 'copilot', kind: 'id', value: 's1' } },
      { terminal_title_stripped: 'π - Changed - project' },
      { terminal_title_stripped: 'π - project' },
      { terminal_title_stripped: 'pi - Title "quoted" - project' },
      { cwd: undefined }, { cwd: '/other/project' },
      { cwd: '/work/other', terminal_title_stripped: 'π - Title "quoted" - other' },
      ...(withSession ? [{ agent_session: undefined }] : []),
    ]) {
      current = { ...initial, ...overrides };
      await tick(api, tracker);
      assert.deepEqual(renames, [], JSON.stringify(overrides));
    }
    current = undefined;
    await tick(api, tracker);
    assert.deepEqual(renames, []);
    current = initial;
    await tick(api, tracker);
    assert.equal(renames.length, 1, 'mismatched reads must not cache a successful rename');
  });
}

test('Copilot pre-write check rejects pane and harness replacement even when title agrees', async () => {
  const tracker = new TitleTracker();
  tracker.plan(snapshot.snapshot);
  for (const current of [{ ...agent, pane_id: 'other' },
    { ...piAgent, agent_session: { agent: 'pi', kind: 'id', value: 's1' } }]) {
    const api = async args => {
      if (args[0] === 'plugin') return plugins(true);
      if (args[0] === 'api') return snapshot;
      if (args[0] === 'agent') return { agent: current };
      assert.fail('must not rename a replacement pane or harness');
    };
    await tick(api, tracker);
  }
});

test('pi rename is idempotent and a disable after validation prevents writing', async () => {
  const tracker = new TitleTracker();
  let label = 'manual';
  let disableBeforeWrite = false;
  let agentRead = false;
  const renames = [];
  const api = async args => {
    if (args[0] === 'plugin') return plugins(!(disableBeforeWrite && agentRead));
    if (args[0] === 'api') return { snapshot: {
      agents: [piAgent], tabs: [{ tab_id: piAgent.tab_id, label }],
    } };
    if (args[0] === 'agent') { agentRead = true; return { agent: piAgent }; }
    renames.push(args);
    label = args.at(-1);
    return {};
  };
  await tick(api, tracker);
  await tick(api, tracker);
  await tick(api, tracker);
  assert.equal(renames.length, 1);
  label = 'manual again';
  disableBeforeWrite = true;
  agentRead = false;
  assert.equal(await tick(api, tracker), false);
  assert.equal(renames.length, 1);
});

test('pi invalid cwd during session-switch quarantine cannot authorize a stale rename after recovery', async () => {
  for (const cwd of [undefined, null, '', 3, 'relative/project', 'C:project', '/bad\n/project']) {
    const tracker = new TitleTracker();
    const first = { ...piAgent, agent_session: { agent: 'pi', kind: 'id', value: 'A' } };
    const second = { ...first, agent_session: { agent: 'pi', kind: 'id', value: 'B' } };
    let current = first;
    let label = 'manual';
    const renames = [];
    const api = async args => {
      if (args[0] === 'plugin') return plugins(true);
      if (args[0] === 'api') return { snapshot: {
        agents: [current], tabs: [{ tab_id: current.tab_id, label }],
      } };
      if (args[0] === 'agent') return { agent: current };
      renames.push(args);
      label = args.at(-1);
      return {};
    };
    // A, A establish the old title. B retains A's OSC title and must quarantine it.
    await tick(api, tracker);
    await tick(api, tracker);
    assert.equal(renames.length, 1);
    current = second;
    label = 'manual B';
    await tick(api, tracker);
    await tick(api, tracker);
    assert.equal(renames.length, 1);
    current = { ...second, cwd };
    if (cwd === undefined) delete current.cwd;
    await tick(api, tracker);
    current = second;
    await tick(api, tracker);
    await tick(api, tracker);
    assert.equal(renames.length, 1, `quarantine must survive invalid cwd ${JSON.stringify(cwd)}`);
    assert.equal(label, 'manual B');
    // A genuinely new B title still converges after two valid observations.
    current = { ...second, terminal_title_stripped: 'π - Legitimate B - project' };
    await tick(api, tracker);
    assert.equal(renames.length, 1);
    await tick(api, tracker);
    assert.deepEqual(renames.at(-1), ['tab', 'rename', 'w1:t1', 'Legitimate B']);
    assert.equal(renames.length, 2);
  }
});

test('generic release retains the installed plugin ID and legacy singleton address', () => {
  assert.equal(PLUGIN_ID, 'copilot-auto-title');
  assert.match(lockAddress('C:\\Herdr\\socket'), /^\\\\\.\\pipe\\herdr-copilot-auto-title-[0-9a-f]{24}$/);
  assert.equal(lockAddress('C:\\Herdr\\socket'), lockAddress('c:\\herdr\\socket'));
  assert.notEqual(lockAddress('socket-one'), lockAddress('socket-two'));
});
