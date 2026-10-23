import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import autoName from '../extensions/pi-auto-name/index.js';
import { ATTEMPT_ENTRY, cleanTitle, MAX_SNIPPET, MAX_TITLE, registerAutoName, snippet } from '../extensions/pi-auto-name/core.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
const response = (text = 'Add pi session auto naming', overrides = {}) => ({
  role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }], ...overrides,
});

function harness({ name, entries = [], flags = {}, mode = 'tui', model = { provider: 'configured', id: 'selected' } } = {}) {
  const handlers = new Map(), commands = new Map(), requests = [], names = [], timers = new Set();
  let sequence = 0;
  let state = { id: 'session-A', file: '/sessions/A.jsonl', entries: [...entries], name, idle: true, queued: false };
  let resolve, reject;
  let result = new Promise((yes, no) => { resolve = yes; reject = no; });
  const append = entry => { const value = { ...entry, id: `entry-${++sequence}` }; state.entries.push(value); return value; };
  const pi = {
    on(event, fn) { const list = handlers.get(event) ?? []; list.push(fn); handlers.set(event, list); },
    registerFlag(key, options) { if (!(key in flags)) flags[key] = options.default; },
    getFlag: key => flags[key],
    registerCommand: (key, options) => commands.set(key, options),
    getSessionName: () => state.name,
    setSessionName(title) { state.name = title; names.push(title); append({ type: 'session_info', name: title }); },
    appendEntry(customType, data) { append({ type: 'custom', customType, data }); },
  };
  function context() {
    const original = state;
    return {
      mode, hasUI: true, ui: { notify() {} }, model,
      sessionManager: {
        getSessionId: () => original.id, getSessionFile: () => original.file,
        getLeafId: () => original.entries.at(-1)?.id ?? null,
        getBranch: () => [...original.entries], getEntries: () => [...original.entries],
      },
      modelRegistry: {
        find(provider, id) { return provider === 'other' ? { provider, id } : undefined; },
        streamSimple(selected, payload, options) { requests.push({ model: selected, payload, options }); return { result: () => result }; },
      },
      isIdle: () => original.idle, hasPendingMessages: () => original.queued,
    };
  }
  let ctx = context();
  const emit = (event, fields = {}) => { for (const fn of handlers.get(event) ?? []) fn({ type: event, ...fields }, ctx); };
  const install = () => registerAutoName(pi, {
    setTimer(fn) { timers.add(fn); return fn; }, clearTimer(fn) { timers.delete(fn); },
  });
  const start = (prompt = 'Add automatic pi session names', fields = {}) => {
    emit('before_agent_start', { messageType: 'user', prompt, ...fields });
    append({ type: 'message', message: { role: 'user', content: prompt } });
  };
  const finish = (answer = response(), fields = {}) => {
    append({ type: 'message', message: answer }); emit('agent_settled', { aborted: false, ...fields });
  };
  install(); emit('session_start');
  return {
    pi, requests, names, timers, commands, flags, emit, start, finish, append,
    async input(text, fields = {}) {
      // Pi awaits input handlers in registration order, before starting a run.
      for (const fn of handlers.get('input') ?? []) {
        const result = await fn({ type: 'input', text, source: 'interactive', ...fields }, ctx);
        assert.equal(result, undefined, 'auto-name must not transform or consume input');
      }
    },
    get state() { return state; }, get ctx() { return ctx; },
    resolve: value => resolve(value ?? response()), reject: error => reject(error),
    async exchange(prompt, answer) { start(prompt); finish(answer); await flush(); },
    switch(id, { copiedEntries = [], copiedName } = {}) {
      emit('session_shutdown', { reason: 'resume' });
      state = { id, file: `/sessions/${id}.jsonl`, entries: [...copiedEntries], name: copiedName, idle: true, queued: false };
      ctx = context(); emit('session_start');
    },
    reload() { emit('session_shutdown', { reason: 'reload' }); handlers.clear(); install(); emit('session_start'); },
    nextRequest() { result = new Promise((yes, no) => { resolve = yes; reject = no; }); },
  };
}

test('optional package has an explicit JS entry and no runtime dependencies', () => {
  const root = new URL('../extensions/pi-auto-name/', import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.keywords.includes('pi-package'), true);
  assert.equal(pkg.engines.node, '>=22.19.0');
  assert.equal(pkg.peerDependencies['@earendil-works/pi-coding-agent'], '*');
  assert.equal(pkg.dependencies, undefined);
  assert.deepEqual(pkg.pi.extensions, ['./index.js']);
  for (const file of pkg.files) assert.equal(existsSync(new URL(file, root)), true, file);
  assert.equal(typeof autoName, 'function');
});

test('names once through native pi API after successful settlement, without blocking the handler', async () => {
  const h = harness();
  h.start();
  h.append({ type: 'message', message: response('Working...', { stopReason: 'toolUse' }) });
  h.emit('agent_end');
  assert.equal(h.requests.length, 0, 'agent_end is not final');
  h.finish();
  assert.equal(h.names.length, 0);
  await flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.state.entries.filter(e => e.customType === ATTEMPT_ENTRY).length, 1);
  const { payload, options, model } = h.requests[0];
  assert.deepEqual(model, h.ctx.model);
  assert.equal(payload.messages.length, 1);
  assert.deepEqual(payload.tools, []);
  assert.equal(options.maxRetries, 0);
  assert.equal(options.maxTokens, 256);
  assert.equal(options.reasoning, 'off');
  assert.equal(options.cacheRetention, 'none');
  assert.equal(options.timeoutMs, 15000);
  h.resolve(); await flush();
  assert.deepEqual(h.names, ['Add pi session auto naming']);
  await h.exchange();
  assert.equal(h.requests.length, 1);
  assert.equal(h.timers.size, 0);
});

test('only bounded user and final assistant text is submitted, with common secrets and attachments omitted', async () => {
  const h = harness();
  h.append({ type: 'message', message: { role: 'system', content: 'SYSTEM_SECRET' } });
  h.start('Fix login <file name="private.txt">ATTACHMENT_SECRET</file> API_KEY=sk-testabcdefgh ghp_abcdefghijk');
  h.append({ type: 'message', message: { role: 'toolResult', content: 'TOOL_SECRET' } });
  h.finish(response('', { content: [
    { type: 'thinking', thinking: 'THINKING_SECRET' },
    { type: 'toolCall', arguments: { token: 'TOOL_ARGS_SECRET' } },
    { type: 'image', data: 'IMAGE_SECRET' },
    { type: 'text', text: `Done: fixed login ${'x'.repeat(4000)}` },
  ] }));
  await flush();
  const data = h.requests[0].payload.messages[0].content;
  for (const secret of ['SYSTEM_SECRET', 'ATTACHMENT_SECRET', 'sk-testabcdefgh', 'ghp_abcdefghijk',
    'TOOL_SECRET', 'THINKING_SECRET', 'TOOL_ARGS_SECRET', 'IMAGE_SECRET']) assert.equal(data.includes(secret), false, secret);
  const parsed = JSON.parse(data);
  assert.ok(parsed.assistant.length <= MAX_SNIPPET);
  assert.ok(parsed.user.includes('Fix login'));
  h.resolve(); await flush();
});

test('snippet drops fenced code, known credentials, incomplete file expansions, and terminal controls', () => {
  const text = snippet('Task ```secret code``` Bearer abc.def.xyz password="very private" '
    + 'AWS_SECRET_ACCESS_KEY=abc -----BEGIN PRIVATE KEY-----private-----END PRIVATE KEY----- '
    + 'AKIA1234567890123456 \u001b[31m <file name="x">private');
  for (const value of ['secret code', 'abc.def.xyz', 'very private', 'KEY=abc', '1234567890123456', 'private', '\u001b']) {
    assert.equal(text.includes(value), false, value);
  }
});

test('manual names present before or added during inference are never overwritten', async () => {
  const named = harness({ name: 'My name' });
  await named.exchange(); assert.equal(named.requests.length, 0);
  const h = harness(); await h.exchange();
  h.state.name = 'Manual title'; h.emit('session_info_changed', { name: 'Manual title' });
  assert.equal(h.requests[0].options.signal.aborted, true);
  h.state.name = undefined; h.emit('session_info_changed', { name: undefined });
  h.resolve(); await flush(); assert.deepEqual(h.names, []);
  await h.exchange(); assert.equal(h.requests.length, 1, 'clearing a name does not reset the attempt');
});

test('the final name check also protects against a rename without a metadata notification', async () => {
  const h = harness(); await h.exchange(); h.state.name = 'Manual';
  h.resolve(); await flush(); assert.deepEqual(h.names, []);
});

for (const event of ['session_before_switch', 'session_before_fork', 'session_before_tree', 'session_tree',
  'session_before_compact', 'session_shutdown', 'model_select']) {
  test(`${event} cancels an in-flight naming operation`, async () => {
    const h = harness(); await h.exchange(); h.emit(event);
    assert.equal(h.requests[0].options.signal.aborted, true);
    h.resolve(); await flush(); assert.deepEqual(h.names, []); assert.equal(h.timers.size, 0);
  });
}

test('switch-away/back and duplicate settlement cannot apply an old completion or launch more requests', async () => {
  const h = harness(); await h.exchange();
  const original = [...h.state.entries];
  h.emit('agent_settled', { aborted: false }); await flush();
  assert.equal(h.requests.length, 1);
  h.switch('session-B'); h.switch('session-A', { copiedEntries: original });
  h.resolve(); await flush(); assert.deepEqual(h.names, []);
  await h.exchange(); assert.equal(h.requests.length, 1);
});

test('starting a new turn, changing leaf, or queued messages prevent late application', async () => {
  for (const mutation of [h => h.start('Next task'), h => h.append({ type: 'custom', customType: 'another-extension' }),
    h => { h.state.queued = true; }, h => { h.state.idle = false; }]) {
    const h = harness(); await h.exchange(); mutation(h);
    h.resolve(); await flush(); assert.deepEqual(h.names, []);
  }
});

test('submitted input cancels naming before asynchronous preprocessing reaches before_agent_start', async () => {
  const h = harness(); await h.exchange();
  const leaf = h.ctx.sessionManager.getLeafId();
  let entered, release;
  const enteredGate = new Promise(resolve => { entered = resolve; });
  const preprocessingGate = new Promise(resolve => { release = resolve; });
  h.pi.on('input', async () => { entered(); await preprocessingGate; });
  const preprocessing = h.input('A different task');
  try {
    await enteredGate;
    assert.equal(h.state.idle, true);
    assert.equal(h.ctx.sessionManager.getLeafId(), leaf);
    h.resolve(); await flush();
    assert.deepEqual(h.names, [], 'the previous title must not commit during input preprocessing');
    assert.equal(h.requests[0].options.signal.aborted, true);
    assert.equal(h.timers.size, 0);
  } finally {
    release(); await preprocessing;
  }
});

test('steering input during an active run preserves its eligible naming candidate', async () => {
  const h = harness(); h.start();
  h.state.idle = false;
  await h.input('Also preserve manual names', { streamingBehavior: 'steer' });
  h.append({ type: 'message', message: { role: 'user', content: 'Also preserve manual names' } });
  h.state.idle = true; h.finish(); await flush();
  assert.equal(h.requests.length, 1);
  h.resolve(); await flush();
  assert.deepEqual(h.names, ['Add pi session auto naming']);
});

test('resuming/reloading an attempted unnamed session does not silently retry after failure', async () => {
  const h = harness(); await h.exchange(); h.reject(new Error('AUTH_SECRET')); await flush();
  h.reload(); h.nextRequest(); await h.exchange();
  assert.equal(h.requests.length, 1); assert.deepEqual(h.names, []);
});

test('resumed unnamed sessions wait for new work; a fork/clone ignores inherited attempt markers', async () => {
  const h = harness({ entries: [{ type: 'message', id: 'historic', message: response('Historical answer') }] });
  h.emit('agent_settled', { aborted: false }); await flush(); assert.equal(h.requests.length, 0);
  await h.exchange(); h.reject(new Error('unavailable')); await flush();
  const copiedEntries = [...h.state.entries];
  h.switch('fork-B', { copiedEntries }); h.nextRequest(); await h.exchange('Explore a new approach');
  assert.equal(h.requests.length, 2);
  h.resolve(response('Explore alternate session naming')); await flush();
  assert.deepEqual(h.names, ['Explore alternate session naming']);
});

test('forks/clones with an inherited existing name retain it without a request', async () => {
  const h = harness(); h.switch('clone-B', { copiedName: 'Existing name' });
  await h.exchange(); assert.equal(h.requests.length, 0);
});

test('timeout and turn signal cancellation clean up and never retry or apply late output', async () => {
  for (const method of ['timeout', 'signal']) {
    const h = harness(); const controller = new AbortController(); h.ctx.signal = controller.signal;
    await h.exchange();
    if (method === 'timeout') [...h.timers][0](); else controller.abort();
    await flush();
    assert.equal(h.requests[0].options.signal.aborted, true);
    assert.equal(h.timers.size, 0);
    h.resolve(); await flush(); assert.deepEqual(h.names, []);
    await h.exchange(); assert.equal(h.requests.length, 1);
  }
});

test('provider throws and invalid model selection fail quietly without naming', async () => {
  const h = harness(); h.ctx.modelRegistry.streamSimple = () => { throw new Error('secret'); };
  await h.exchange(); await flush(); assert.deepEqual(h.names, []); assert.equal(h.timers.size, 0);
  for (const selection of ['missing/model', 'model-without-provider', '/empty', 'other/']) {
    const invalid = harness({ flags: { 'auto-name-model': selection } });
    await invalid.exchange(); assert.equal(invalid.requests.length, 0);
  }
});

test('cancellation before the provider microtask prevents submitting a request', async () => {
  const h = harness(); h.start(); h.finish(); h.emit('session_before_switch');
  await flush(); assert.equal(h.requests.length, 0); assert.deepEqual(h.names, []);
  assert.equal(h.timers.size, 0);
});

test('missing model, failed attempt persistence, and branch replacement fail closed', async () => {
  const missing = harness({ model: undefined });
  // The helper's default model is otherwise intentional; simulate no runtime selection.
  missing.ctx.model = undefined;
  await missing.exchange(); assert.equal(missing.requests.length, 0);
  const failed = harness(); failed.pi.appendEntry = () => { throw new Error('read-only session'); };
  await failed.exchange(); assert.equal(failed.requests.length, 0);
  const branch = harness(); branch.append({ type: 'custom', customType: 'old-branch' });
  branch.start(); branch.state.entries = []; branch.finish();
  await flush(); assert.equal(branch.requests.length, 0);
});

test('explicit model override is exact provider/model-id and keeps embedded model slashes', async () => {
  const h = harness({ flags: { 'auto-name-model': 'other/vendor/small-model' } });
  await h.exchange(); assert.deepEqual(h.requests[0].model, { provider: 'other', id: 'vendor/small-model' });
  h.resolve(); await flush();
});

test('disable flag and runtime command stop naming without renaming or deleting existing names', async () => {
  const disabled = harness({ flags: { 'auto-name-disabled': true } }); await disabled.exchange();
  assert.equal(disabled.requests.length, 0);
  await disabled.commands.get('auto-name').handler('on', disabled.ctx);
  await disabled.exchange(); assert.equal(disabled.requests.length, 0, 'CLI flag remains authoritative');
  const h = harness(); await h.exchange(); await h.commands.get('auto-name').handler('off', h.ctx);
  assert.equal(h.requests[0].options.signal.aborted, true);
  h.resolve(); await flush(); assert.deepEqual(h.names, []);
  await h.commands.get('auto-name').handler('on', h.ctx);
  await h.exchange(); assert.equal(h.requests.length, 1, 'on does not retry the session');
});

test('non-TUI modes, custom runs, empty exchanges, errors and aborted turns never request titles', async () => {
  for (const mode of ['rpc', 'json', 'print']) {
    const h = harness({ mode }); await h.exchange(); assert.equal(h.requests.length, 0);
  }
  for (const prompt of ['', '   ', '<file name="x">secret</file>', '```only code```']) {
    const h = harness(); await h.exchange(prompt); assert.equal(h.requests.length, 0);
  }
  for (const answer of [response(''), response('bad', { stopReason: 'error' }), response('partial', { stopReason: 'aborted' }),
    response('only a tool', { stopReason: 'toolUse' }), response('', { content: [{ type: 'thinking', thinking: 'not public text' }] })]) {
    const h = harness(); await h.exchange(undefined, answer); assert.equal(h.requests.length, 0);
  }
  const aborted = harness(); aborted.start(); aborted.finish(response(), { aborted: true });
  const custom = harness(); custom.start('custom', { messageType: 'custom' }); custom.finish();
  await flush(); assert.equal(aborted.requests.length, 0); assert.equal(custom.requests.length, 0);
});

test('invalid model outputs are rejected without a fallback or repeated request', async () => {
  for (const output of ['', 'Untitled', 'New session', 'line one\nline two', 'bad\u001b]2;injection\u0007',
    'bad\u202ename', 'bad\u0085name', '```markdown```', '# Heading', 'password=not-a-title',
    'Bearer abc.def.xyz', 'x'.repeat(MAX_TITLE + 1)]) {
    const h = harness(); await h.exchange(); h.resolve(response(output)); await flush();
    assert.deepEqual(h.names, [], JSON.stringify(output));
    await h.exchange(); assert.equal(h.requests.length, 1);
  }
  assert.equal(cleanTitle(' Title: "Review PR #42" '), 'Review PR #42');
  assert.equal(cleanTitle('Improve pi — SSH naming'), 'Improve pi — SSH naming');
  assert.equal(cleanTitle('🧪'.repeat(37)), null);
});

test('error, aborted, truncated or tool-using naming responses cannot set a name', async () => {
  for (const stopReason of ['error', 'aborted', 'length', 'toolUse', 'deferred']) {
    const h = harness(); await h.exchange(); h.resolve(response('A plausible title', { stopReason }));
    await flush(); assert.deepEqual(h.names, []);
  }
});
