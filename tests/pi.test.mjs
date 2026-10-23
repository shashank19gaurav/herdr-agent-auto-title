import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { conversationTitle, pi } from '../src/adapters/pi.mjs';
import { copilot } from '../src/adapters/copilot.mjs';
import { adapterFor } from '../src/adapters/index.mjs';
import { snapshotFrom, TitleTracker } from '../src/titles.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/pi-1.3.0.json', import.meta.url), 'utf8'));
const agent = (overrides = {}) => ({ ...fixtures.cases[0].agent, ...overrides });
const snapshot = (agents = [agent()], label = 'manual') => ({
  agents, tabs: [{ tab_id: 'w1:t1', label }],
});
const session = value => ({ agent_session: { agent: 'pi', kind: 'id', value } });
const copilotAgent = (overrides = {}) => ({
  ...agent(), agent: 'copilot', terminal_title_stripped: 'Copilot task - GitHub Copilot', ...overrides,
});

for (const fixture of fixtures.cases) {
  test(`pi ${fixtures.version} fixture: ${fixture.name}`, () => {
    const data = snapshotFrom({ snapshot: snapshot([fixture.agent]) });
    assert.equal(pi.read(data.agents[0]).title, fixture.title);
    const tracker = new TitleTracker();
    assert.deepEqual(tracker.plan(data), []);
    assert.equal(tracker.plan(data)[0]?.title ?? null, fixture.title);
  });
}

test('pi removes exact title edges across native and remote path formats', () => {
  for (const cwd of ['C:\\dev\\repo', 'C:/dev/repo', '/work/repo', '/work/repo/',
    '\\\\server\\share\\repo', '//server/share/repo']) {
    assert.equal(conversationTitle('π - A - B - repo', cwd), 'A - B', cwd);
  }
  assert.equal(conversationTitle('π - Plan - my - repo - my - repo', '/work/my - repo'), 'Plan - my - repo');
  assert.equal(conversationTitle('π - --help "quoted" - repo', '/work/repo'), '--help "quoted"');
  assert.equal(conversationTitle('π -   Title  - repo', '/work/repo'), 'Title');
  assert.equal(conversationTitle('π - Name - path\\with\\backslashes', '/work/path\\with\\backslashes'), 'Name');
  assert.equal(conversationTitle('π - Name - repo ', '/work/repo '), 'Name');
  assert.equal(conversationTitle('π - Root task - ', '/'), 'Root task');
  assert.equal(conversationTitle('π - Root task - ', 'C:\\'), 'Root task');
});

test('pi unnamed delimiter-heavy basenames cannot masquerade as a named session', () => {
  for (const basename of ['Fix auth - project', 'A - B - C', ' - repo', 'repo - ', 'π - repo']) {
    for (const cwd of [`/work/${basename}`, `C:\\work\\${basename}`]) {
      assert.equal(conversationTitle(`π - ${basename}`, cwd), null, cwd);
      assert.equal(conversationTitle(`π - Actual name - ${basename}`, cwd), 'Actual name', cwd);
    }
  }
});

test('pi root directories use the same basename semantics as its native implementation', () => {
  // Pi uses path.basename(sessionManager.getCwd()) on the agent's OS.
  for (const [paths, cwd] of [[posix, '/'], [win32, 'C:\\'], [win32, '\\\\server\\share\\']]) {
    const basename = paths.basename(cwd);
    assert.equal(conversationTitle(`π - ${basename}`, cwd), null, cwd);
    assert.equal(conversationTitle(`π - Root name - ${basename}`, cwd), 'Root name', cwd);
  }
  assert.equal(posix.basename('/'), '');
  assert.equal(win32.basename('C:\\'), '');
});

test('pi fails closed for unnamed, missing, custom, malformed, or mismatched titles', () => {
  for (const [raw, cwd] of [
    ['π - repo', '/work/repo'], ['π - my - repo', '/work/my - repo'],
    ['π - ', '/'], ['π -    - repo', '/work/repo'],
    ['pi - Name - repo', '/work/repo'], ['my-agent - Name - repo', '/work/repo'],
    ['π - Name - repo - Working', '/work/repo'], ['π - Name - other', '/work/repo'],
    ['π - Name - repo', undefined], ['π - Name - repo', null],
    ['π - Name - repo', 5], ['π - Name - repo', ''], ['π - Name - repo', 'relative/repo'],
    ['π - Name - repo', 'C:repo'], [null, '/work/repo'], [3, '/work/repo'],
    ['π - bad\u001bname - repo', '/work/repo'], ['π - Name\n - repo', '/work/repo'],
    ['π - Name - repo', '/bad\n/repo'],
  ]) assert.equal(conversationTitle(raw, cwd), null, JSON.stringify([raw, cwd]));
});

test('registry uses exact harness IDs and adapters distinguish invalid identity from no title', () => {
  assert.equal(adapterFor('pi'), pi);
  assert.equal(adapterFor('copilot'), copilot);
  for (const harness of ['Pi', 'PI', 'deepseek', 'claude', '__proto__', 'toString', null]) {
    assert.equal(adapterFor(harness), undefined);
    assert.equal(pi.read(agent({ agent: harness })), null);
    assert.equal(copilot.read(copilotAgent({ agent: harness })), null);
  }
  for (const agent_session of [undefined, null]) {
    assert.equal(pi.read(agent({ agent_session })).sessionId, null);
  }
  assert.equal(pi.read(agent(session('session-one'))).sessionId, 'session-one');
  for (const agent_session of [{}, 'session', [],
    { agent: 'copilot', kind: 'id', value: 'session' },
    { agent: 'pi', kind: 'path', value: 'session' },
    { agent: 'pi', kind: 'id', value: '' },
    { agent: 'pi', kind: 'id', value: ' ' },
    { agent: 'pi', kind: 'id', value: 5 }]) {
    assert.equal(pi.read(agent({ agent_session })), null);
  }
  assert.deepEqual(pi.read(agent({ terminal_title_stripped: 'π - project' })),
    { title: null, sessionId: null, context: 'C:\\dev\\project' });
});

test('pi requires valid cwd metadata without confusing its absence with an unnamed reset', () => {
  for (const cwd of [undefined, null, '', ' ', 3, {}, 'relative/project', 'C:project', '/bad\n/project']) {
    assert.equal(conversationTitle('π - Fix auth - project', cwd), null);
    assert.equal(pi.read(agent({ cwd })), null, JSON.stringify(cwd));
    assert.equal(pi.read(agent({ cwd, terminal_title_stripped: 'π - project' })), null);
  }
  assert.deepEqual(pi.read(agent({ terminal_title_stripped: 'π - project' })),
    { title: null, sessionId: null, context: 'C:\\dev\\project' });
});

test('snapshot validation covers both harnesses without inspecting unsupported records', () => {
  for (const harness of ['pi', 'copilot']) {
    for (const field of ['pane_id', 'tab_id', 'terminal_id']) {
      for (const value of [undefined, null, 3, '', ' ']) {
        assert.throws(() => snapshotFrom({ snapshot: snapshot([agent({ agent: harness, [field]: value })]) }), /identity/);
      }
    }
  }
  const unsupported = snapshot([null, { agent: 'unknown' }]);
  assert.equal(snapshotFrom({ snapshot: unsupported }), unsupported);
  const tracker = new TitleTracker();
  assert.deepEqual(tracker.plan(unsupported), []);
  assert.deepEqual(tracker.plan(unsupported), []);
});

test('mixed splits choose the lowest complete supported pane, not focus or harness', () => {
  const tracker = new TitleTracker();
  const second = copilotAgent({ pane_id: 'w1:p2', focused: true });
  const first = agent();
  tracker.plan(snapshot([second, first]));
  assert.equal(tracker.plan(snapshot([first, second]))[0].title, 'Fix auth');
  for (const loadingOwner of [agent({ terminal_title_stripped: 'π - project' }),
    agent({ cwd: undefined }), agent({ agent_session: {} })]) {
    assert.deepEqual(tracker.plan(snapshot([second, loadingOwner])), []);
  }
  assert.equal(tracker.plan(snapshot([second]))[0].title, 'Copilot task');
  const unknown = agent({ pane_id: 'w1:p0', agent: 'unknown' });
  assert.equal(tracker.plan(snapshot([unknown, second]))[0].title, 'Copilot task');

  const reverse = new TitleTracker();
  const copilotFirst = copilotAgent();
  const piSecond = agent({ pane_id: 'w1:p2' });
  reverse.plan(snapshot([piSecond, copilotFirst]));
  assert.equal(reverse.plan(snapshot([copilotFirst, piSecond]))[0].title, 'Copilot task');
});

test('reusing a pane and terminal with a different harness resets observations', () => {
  const tracker = new TitleTracker();
  const copilotSame = copilotAgent({ terminal_title_stripped: 'Fix auth - GitHub Copilot' });
  tracker.plan(snapshot([copilotSame]));
  assert.equal(tracker.plan(snapshot([copilotSame]))[0].harness, 'copilot');
  assert.deepEqual(tracker.plan(snapshot()), []);
  assert.equal(tracker.plan(snapshot())[0].harness, 'pi');
  assert.deepEqual(tracker.plan(snapshot([copilotSame])), []);
  assert.equal(tracker.plan(snapshot([copilotSame]))[0].harness, 'copilot');
  tracker.plan(snapshot([agent({ agent: 'unknown' })]));
  assert.deepEqual(tracker.plan(snapshot()), []);
});

test('pi cwd changes with an identical basename require fresh stability', () => {
  const tracker = new TitleTracker();
  tracker.plan(snapshot());
  tracker.plan(snapshot());
  const moved = agent({ cwd: 'D:\\other\\project' });
  assert.deepEqual(tracker.plan(snapshot([moved])), []);
  assert.equal(tracker.plan(snapshot([moved]))[0].context, moved.cwd);
  assert.deepEqual(tracker.plan(snapshot([agent({ cwd: undefined })])), []);
  assert.deepEqual(tracker.plan(snapshot([moved])), []);
});

test('pi session switch quarantines stale names, unnamed reset releases it, and switch-back works', () => {
  const tracker = new TitleTracker();
  const first = agent(session('first'));
  tracker.plan(snapshot([first]));
  tracker.plan(snapshot([first]));
  const next = agent(session('next'));
  assert.deepEqual(tracker.plan(snapshot([next])), []);
  assert.deepEqual(tracker.plan(snapshot([next])), []);
  const changed = { ...next, terminal_title_stripped: 'π - Next task - project' };
  assert.deepEqual(tracker.plan(snapshot([changed])), []);
  assert.equal(tracker.plan(snapshot([changed]))[0].title, 'Next task');
  assert.deepEqual(tracker.plan(snapshot([first])), []);
  assert.equal(tracker.plan(snapshot([first]))[0].title, 'Fix auth');
  tracker.plan(snapshot([next]));
  tracker.plan(snapshot([{ ...next, terminal_title_stripped: 'π - project' }]));
  assert.deepEqual(tracker.plan(snapshot([next])), []);
  assert.equal(tracker.plan(snapshot([next]))[0].title, 'Fix auth');
});

test('invalid identity breaks consecutive stability but retains session-switch quarantine', () => {
  const tracker = new TitleTracker();
  const first = agent(session('first'));
  tracker.plan(snapshot([first]));
  tracker.plan(snapshot([first]));
  assert.deepEqual(tracker.plan(snapshot([agent({ agent_session: {} })])), []);
  assert.deepEqual(tracker.plan(snapshot([first])), []);
  assert.equal(tracker.plan(snapshot([first]))[0].title, 'Fix auth');
  tracker.plan(snapshot([agent({ agent_session: {} })]));
  const next = agent(session('next'));
  assert.deepEqual(tracker.plan(snapshot([next])), []);
  assert.deepEqual(tracker.plan(snapshot([next])), []);
});

test('a non-owner pi resume stays quarantined after the Copilot owner closes', () => {
  const tracker = new TitleTracker();
  const first = copilotAgent();
  const second = agent({ pane_id: 'w1:p2', ...session('first') });
  tracker.plan(snapshot([first, second]));
  tracker.plan(snapshot([first, second]));
  const resumed = { ...second, ...session('next') };
  tracker.plan(snapshot([first, resumed]));
  assert.deepEqual(tracker.plan(snapshot([resumed])), []);
  assert.deepEqual(tracker.plan(snapshot([resumed])), []);
  resumed.terminal_title_stripped = 'π - Resumed - project';
  tracker.plan(snapshot([resumed]));
  assert.equal(tracker.plan(snapshot([resumed]))[0].title, 'Resumed');
});
