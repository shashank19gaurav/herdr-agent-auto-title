import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { decodeResponse, syncMachines, tick, PLUGIN_ID } from '../src/main.mjs';
import { TitleTracker } from '../src/titles.mjs';

const plugin = { plugins: [{ plugin_id: PLUGIN_ID, enabled: true }] };
const machine = (id, enabled = true) => ({ id, enabled, target: id, session: 'default' });
const snapshot = title => ({
  snapshot: {
    agents: [{
      agent: 'copilot', pane_id: 'w1:p1', tab_id: 'w1:t1', terminal_id: 'terminal',
      terminal_title_stripped: `${title} - GitHub Copilot`,
    }],
    tabs: [{ tab_id: 'w1:t1', label: 'manual' }],
  },
});
const abortSleep = (_ms, _value, { signal }) => new Promise(resolve => {
  if (signal.aborted) resolve();
  else signal.addEventListener('abort', resolve, { once: true });
});
const quiet = { log() {}, error() {} };
const stop = async remotes => {
  for (const remote of remotes.values()) remote.controller.abort();
  await Promise.all([...remotes.values()].map(remote => remote.task));
};

test('machine-list bare JSON arrays are accepted only for that command', async () => {
  assert.deepEqual(decodeResponse('[{"id":"ssh","enabled":true}]', { array: true }), [
    { id: 'ssh', enabled: true },
  ]);
  assert.throws(() => decodeResponse('[]'), /no result/);
  await assert.rejects(syncMachines(async () => ({}), new Map()), /machine list/);
  await assert.rejects(syncMachines(async () => [{ enabled: true }], new Map()), /machine list/);
});

test('every remote read and rename stays scoped despite overlapping local IDs', async () => {
  const calls = [];
  const api = async args => {
    calls.push(args);
    const remote = args[0] === '--machine';
    const command = remote ? args.slice(2) : args;
    if (command[0] === 'plugin') {
      assert.equal(remote, false, 'remote does not need a plugin installation');
      return plugin;
    }
    const data = snapshot(remote ? 'Remote conversation' : 'Local conversation');
    if (command[0] === 'api') return data;
    if (command[0] === 'agent') return { agent: data.snapshot.agents[0] };
    return {};
  };
  const local = new TitleTracker();
  const remote = new TitleTracker();
  const remoteApi = args => api(['--machine', 'ssh-one', ...args]);
  await tick(api, local);
  await tick(remoteApi, remote, { enabledApi: api });
  await tick(api, local);
  await tick(remoteApi, remote, { enabledApi: api });
  assert.ok(calls.some(args => JSON.stringify(args) === JSON.stringify(
    ['tab', 'rename', 'w1:t1', 'Local conversation'])));
  assert.ok(calls.some(args => JSON.stringify(args) === JSON.stringify(
    ['--machine', 'ssh-one', 'tab', 'rename', 'w1:t1', 'Remote conversation'])));
});

test('slow SSH is independent, disabled machines are ignored, and removal aborts requests', async () => {
  let profiles = [machine('slow'), machine('disabled', false)];
  const remotes = new Map();
  const requests = [];
  const api = async (args, options) => {
    if (args[0] === 'machine') return profiles;
    if (args[0] === 'plugin') return plugin;
    requests.push({ args, options });
    return new Promise((resolve, reject) => {
      const fail = () => reject(new Error('cancelled'));
      if (options.signal.aborted) fail();
      else options.signal.addEventListener('abort', fail, { once: true });
    });
  };
  try {
    await syncMachines(api, remotes, { sleep: abortSleep, log: quiet });
    await setImmediate();
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].args, ['--machine', 'slow', 'api', 'snapshot']);
    assert.equal(requests[0].options.timeout, 30000);
    assert.equal(remotes.size, 1);
    await syncMachines(api, remotes, { sleep: abortSleep, log: quiet });
    assert.equal(remotes.size, 1, 'discovery does not duplicate existing workers');
    assert.equal(await tick(async () => ({ plugins: [] }), new TitleTracker()), false);
    profiles = [];
    await syncMachines(api, remotes, { sleep: abortSleep, log: quiet });
    assert.equal(requests[0].options.signal.aborted, true);
    assert.equal(remotes.size, 0);
  } finally { await stop(remotes); }
});

test('offline SSH backs off without preventing other machines from renaming', async () => {
  const remotes = new Map();
  const waits = [];
  const errors = [];
  const renames = [];
  let cycles = 0;
  const api = async args => {
    if (args[0] === 'machine') return [machine('offline'), machine('online')];
    if (args[0] === 'plugin') return plugin;
    const [, id, command] = args;
    if (id === 'offline') throw new Error('SSH unavailable');
    const data = snapshot('Online SSH');
    if (command === 'api') return data;
    if (command === 'agent') return { agent: data.snapshot.agents[0] };
    renames.push(args);
    return {};
  };
  const sleep = (ms, value, options) => {
    waits.push(ms);
    if (++cycles <= 4) return setImmediate();
    return abortSleep(ms, value, options);
  };
  try {
    await syncMachines(api, remotes, { sleep, log: { log() {}, error: msg => errors.push(msg) } });
    for (let turn = 0; turn < 12; turn++) await setImmediate();
    assert.ok(errors.some(message => message.includes('offline')));
    assert.ok(waits.includes(4000));
    assert.ok(renames.some(args => args[1] === 'online' && args.at(-1) === 'Online SSH'));
    assert.equal(remotes.size, 2);
  } finally { await stop(remotes); }
});

test('pi local and SSH title/cwd state stay isolated with the same pane and terminal IDs', async () => {
  const calls = [];
  const api = async args => {
    calls.push(args);
    const remote = args[0] === '--machine';
    const command = remote ? args.slice(2) : args;
    if (command[0] === 'plugin') {
      assert.equal(remote, false);
      return plugin;
    }
    const data = snapshot('unused');
    data.snapshot.agents[0] = {
      ...data.snapshot.agents[0], agent: 'pi',
      cwd: remote ? '/remote/project' : 'C:\\local\\project',
      terminal_title_stripped: `π - ${remote ? 'Remote pi' : 'Local pi'} - project`,
    };
    if (command[0] === 'api') return data;
    if (command[0] === 'agent') return { agent: data.snapshot.agents[0] };
    return {};
  };
  const local = new TitleTracker();
  const remote = new TitleTracker();
  const remoteApi = args => api(['--machine', 'ssh-pi', ...args]);
  await tick(api, local);
  await tick(remoteApi, remote, { enabledApi: api });
  await tick(api, local);
  await tick(remoteApi, remote, { enabledApi: api });
  assert.deepEqual(calls.filter(args => args[0] === 'tab'), [
    ['tab', 'rename', 'w1:t1', 'Local pi'],
  ]);
  assert.deepEqual(calls.filter(args => args[0] === '--machine' && args[2] === 'tab'), [
    ['--machine', 'ssh-pi', 'tab', 'rename', 'w1:t1', 'Remote pi'],
  ]);
});
