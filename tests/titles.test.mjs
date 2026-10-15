import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationTitle, snapshotFrom, TitleTracker } from '../src/titles.mjs';
import { decodeResponse } from '../src/main.mjs';

const agent = (overrides = {}) => ({
  agent: 'copilot', pane_id: 'w1:p1', tab_id: 'w1:t1', terminal_id: 'terminal1',
  agent_session: { agent: 'copilot', kind: 'id', value: 'session1' },
  terminal_title_stripped: 'Fix auth - GitHub Copilot', ...overrides,
});
const snapshot = (agents = [agent()], label = 'manual') => ({
  agents, tabs: [{ tab_id: 'w1:t1', label }],
});
const session = value => ({ agent_session: { agent: 'copilot', kind: 'id', value } });

test('normalizes only the exact suffix and preserves conversation text', () => {
  assert.equal(conversationTitle('  Fix auth - GitHub Copilot  '), 'Fix auth');
  assert.equal(conversationTitle('Fix - something else'), 'Fix - something else');
  assert.equal(conversationTitle('Fix - Working - GitHub Copilot'), 'Fix - Working');
  assert.equal(conversationTitle('修复登录 - GitHub Copilot'), '修复登录');
  assert.equal(conversationTitle('--help - GitHub Copilot'), '--help');
});

test('rejects blank, generic, transient and control-character titles', () => {
  for (const title of [undefined, null, 9, '', ' ', 'GitHub Copilot', 'Copilot CLI',
    'New conversation - GitHub Copilot', 'Loading...', 'Resuming…', 'Untitled session',
    ' - GitHub Copilot', 'bad\u001btitle']) {
    assert.equal(conversationTitle(title), null, String(title));
  }
});

test('parses CLI envelopes and rejects errors or malformed snapshots', () => {
  assert.deepEqual(snapshotFrom(decodeResponse(JSON.stringify({ result: { snapshot: snapshot() } }))), snapshot());
  assert.throws(() => decodeResponse('not json'));
  assert.throws(() => decodeResponse('{"error":{"code":"missing","message":"no server"}}'), /missing/);
  assert.throws(() => decodeResponse('{}'), /no result/);
  assert.throws(() => snapshotFrom({ agents: [], tabs: [] }), /snapshot/);
  assert.throws(() => snapshotFrom({ snapshot: snapshot([agent({ pane_id: null })]) }), /identity/);
});

test('waits for stability, overwrites manual titles, and avoids redundant renames', () => {
  const tracker = new TitleTracker();
  assert.deepEqual(tracker.plan(snapshot()), []);
  assert.equal(tracker.plan(snapshot())[0].title, 'Fix auth');
  assert.deepEqual(tracker.plan(snapshot([agent()], 'Fix auth')), []);
  assert.equal(tracker.plan(snapshot([agent()], 'my manual name'))[0].title, 'Fix auth');
});

test('same-tab /resume quarantines the old title and switching back works', () => {
  const tracker = new TitleTracker();
  tracker.plan(snapshot());
  tracker.plan(snapshot());
  const resumed = agent(session('session2'));
  assert.deepEqual(tracker.plan(snapshot([resumed], 'manual')), []);
  assert.deepEqual(tracker.plan(snapshot([resumed], 'manual')), []);
  resumed.terminal_title_stripped = 'New task - GitHub Copilot';
  assert.deepEqual(tracker.plan(snapshot([resumed])), []);
  assert.equal(tracker.plan(snapshot([resumed]))[0].title, 'New task');
  const original = agent();
  assert.deepEqual(tracker.plan(snapshot([original])), []);
  assert.equal(tracker.plan(snapshot([original]))[0].title, 'Fix auth');
});

test('generic reset releases quarantine, including equal conversation titles', () => {
  const tracker = new TitleTracker();
  tracker.plan(snapshot());
  tracker.plan(snapshot());
  const resumed = agent(session('session2'));
  tracker.plan(snapshot([resumed]));
  tracker.plan(snapshot([agent({ ...session('session2'), terminal_title_stripped: 'GitHub Copilot' })]));
  tracker.plan(snapshot([resumed]));
  assert.equal(tracker.plan(snapshot([resumed]))[0].title, 'Fix auth');
});

test('late arrival of the first session ID does not quarantine a valid title', () => {
  const tracker = new TitleTracker();
  tracker.plan(snapshot([agent({ agent_session: undefined })]));
  tracker.plan(snapshot([agent({ agent_session: undefined })]));
  tracker.plan(snapshot());
  assert.equal(tracker.plan(snapshot())[0].title, 'Fix auth');
});

test('ignores other agents and malformed session identities', () => {
  const tracker = new TitleTracker();
  for (const other of [agent({ agent: 'claude' }),
    agent({ agent_session: { agent: 'other', kind: 'id', value: 'x' } })]) {
    tracker.plan(snapshot([other]));
    assert.deepEqual(tracker.plan(snapshot([other])), []);
  }
});

test('supports SSH Copilot without session hooks and follows title changes', () => {
  const tracker = new TitleTracker();
  const remote = agent({ agent_session: undefined });
  assert.deepEqual(tracker.plan(snapshot([remote])), []);
  const change = tracker.plan(snapshot([remote]))[0];
  assert.equal(change.title, 'Fix auth');
  assert.equal(change.sessionId, null);
  remote.terminal_title_stripped = 'Resumed remote conversation - GitHub Copilot';
  assert.deepEqual(tracker.plan(snapshot([remote])), []);
  assert.equal(tracker.plan(snapshot([remote]))[0].title, 'Resumed remote conversation');
  remote.terminal_title_stripped = 'GitHub Copilot';
  assert.deepEqual(tracker.plan(snapshot([remote])), []);
});

test('deterministic split-pane owner does not follow focus or fall back to another pane', () => {
  const tracker = new TitleTracker();
  const second = agent({ pane_id: 'w1:p2', focused: true, terminal_title_stripped: 'Other - GitHub Copilot' });
  tracker.plan(snapshot([second, agent()]));
  assert.equal(tracker.plan(snapshot([agent(), second]))[0].title, 'Fix auth');
  const genericOwner = agent({ terminal_title_stripped: 'GitHub Copilot' });
  assert.deepEqual(tracker.plan(snapshot([second, genericOwner])), []);
  assert.equal(tracker.plan(snapshot([second]))[0].title, 'Other');
});

test('a non-owner resume remains quarantined when the owner closes', () => {
  const tracker = new TitleTracker();
  const second = agent({ pane_id: 'w1:p2', terminal_title_stripped: 'Old split title - GitHub Copilot' });
  tracker.plan(snapshot([agent(), second]));
  tracker.plan(snapshot([agent(), second]));
  const resumed = { ...second, ...session('resumed-split') };
  tracker.plan(snapshot([agent(), resumed]));
  assert.deepEqual(tracker.plan(snapshot([resumed])), []);
  assert.deepEqual(tracker.plan(snapshot([resumed])), []);
  resumed.terminal_title_stripped = 'New split title - GitHub Copilot';
  tracker.plan(snapshot([resumed]));
  assert.equal(tracker.plan(snapshot([resumed]))[0].title, 'New split title');
});

test('handles multiple workspaces, closed tabs, replacement terminals, and reset', () => {
  const tracker = new TitleTracker();
  const other = agent({ tab_id: 'w2:t1', pane_id: 'w2:p1', terminal_id: 'terminal2' });
  const data = { agents: [agent(), other], tabs: [
    { tab_id: 'w1:t1', label: '1' }, { tab_id: 'w2:t1', label: '2' },
  ] };
  tracker.plan(data);
  assert.equal(tracker.plan(data).length, 2);
  assert.deepEqual(tracker.plan({ agents: [other], tabs: [] }), []);
  assert.deepEqual(tracker.plan(snapshot()), []);
  assert.equal(tracker.plan(snapshot()).length, 1);
  assert.deepEqual(tracker.plan(snapshot([agent({ terminal_id: 'replacement' })])), []);
  tracker.reset();
  assert.deepEqual(tracker.plan(snapshot()), []);
});
