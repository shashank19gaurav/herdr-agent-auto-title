// Offline developer check against an already installed pi. No package installation,
// credentials, user configuration, active sessions, or network calls are needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!process.argv[2]) throw new Error('Usage: node scripts/check-pi-auto-name-host.mjs <installed-pi-package-root>');
process.env.PI_OFFLINE = '1';
const root = resolve(process.argv[2]);
const load = file => import(pathToFileURL(resolve(root, file)).href);
const [{ loadExtensions }, { ExtensionRunner }, { SessionManager }, { readPiManifest }, { AgentSession }] = await Promise.all([
  load('dist/core/extensions/loader.js'), load('dist/core/extensions/runner.js'),
  load('dist/core/session-manager.js'), load('dist/core/pi-manifest.js'), load('dist/core/agent-session.js'),
]);
const packageRoot = fileURLToPath(new URL('../extensions/pi-auto-name/', import.meta.url));
const manifest = readPiManifest(resolve(packageRoot, 'package.json'));
assert.deepEqual(manifest.extensions, ['./index.js']);
const loaded = await loadExtensions(manifest.extensions.map(path => resolve(packageRoot, path)), process.cwd());
assert.deepEqual(loaded.errors, []);
assert.equal(loaded.extensions.length, 1);
const manager = SessionManager.inMemory(process.cwd());
const model = { provider: 'offline-test', id: 'exact-chat-model' };
const requests = [], errors = [];
const titleResponse = { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Verify native pi auto naming' }] };
let titleResult = Promise.resolve(titleResponse);
const registry = {
  streamSimple(selected, context, options) {
    assert.strictEqual(selected, model, 'must use the exact current model object');
    requests.push({ context, options });
    return { result: () => titleResult };
  },
};
const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, process.cwd(), manager, registry);
runner.onError(error => errors.push(error));
runner.setUIContext(undefined, 'tui');
runner.bindCore({
  appendEntry: (kind, data) => { manager.appendCustomEntry(kind, data); },
  getSessionName: () => manager.getSessionName(),
  setSessionName: name => { manager.appendSessionInfo(name); },
  getSettings: () => ({}), getActiveTools: () => [], getAllTools: () => [], getCommands: () => [],
  getThinkingLevel: () => 'off', setThinkingLevel() {}, setActiveTools() {}, refreshTools() {}, setLabel() {},
  sendMessage() { throw new Error('Naming must not enter the main chat'); },
  sendUserMessage() { throw new Error('Naming must not enter the main chat'); }, setModel: async () => false,
}, {
  getModel: () => model, getScopedModels: () => [], isIdle: () => true, isProjectTrusted: () => false,
  getSignal: () => undefined, abort() {}, hasPendingMessages: () => false, shutdown() {},
  getContextUsage: () => undefined, compact() {}, getSystemPrompt: () => '',
});
await runner.emit({ type: 'session_start', reason: 'startup' });
await runner.emitBeforeAgentStart({ messageType: 'user', prompt: 'Build optional native pi naming' }, { cwd: process.cwd(), selectedTools: [] });
manager.appendMessage({ role: 'user', content: 'Build optional native pi naming', timestamp: Date.now() });
manager.appendMessage({
  role: 'assistant', content: [{ type: 'text', text: 'The optional naming extension is built.' }],
  provider: model.provider, model: model.id, api: 'offline-test', stopReason: 'stop', timestamp: Date.now(),
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});
await runner.emit({ type: 'agent_settled', aborted: false });
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(errors, []);
assert.equal(requests.length, 1);
assert.equal(manager.getSessionName(), 'Verify native pi auto naming');
assert.equal(manager.getEntries().filter(entry => entry.type === 'message').length, 2);
await runner.emit({ type: 'agent_settled', aborted: false });
await new Promise(resolve => setImmediate(resolve));
assert.equal(requests.length, 1);
// Exercise the actual AgentSession.prompt -> _runInputHandlers -> runner.emitInput
// path with a minimal offline receiver. A downstream handler deliberately awaits
// before consuming the prompt, so no chat/model/auth work can run.
manager.newSession();
await runner.emit({ type: 'session_start', reason: 'new' });
let resolveTitle;
titleResult = new Promise(resolve => { resolveTitle = resolve; });
await runner.emitBeforeAgentStart({ messageType: 'user', prompt: 'Finish the first task' }, { cwd: process.cwd(), selectedTools: [] });
manager.appendMessage({ role: 'user', content: 'Finish the first task', timestamp: Date.now() });
manager.appendMessage({ ...titleResponse, timestamp: Date.now() });
await runner.emit({ type: 'agent_settled', aborted: false });
await new Promise(resolve => setImmediate(resolve));
assert.equal(requests.length, 2);
const leaf = manager.getLeafId();
let enterInput, releaseInput;
const enteredInput = new Promise(resolve => { enterInput = resolve; });
const inputGate = new Promise(resolve => { releaseInput = resolve; });
const inputHandlers = loaded.extensions[0].handlers.get('input');
assert.equal(inputHandlers.length, 1);
inputHandlers.push(async event => {
  assert.equal(event.text, 'A new task');
  enterInput();
  await inputGate;
  return { action: 'handled' };
});
const receiver = {
  _extensionRunner: runner, isStreaming: false,
  _runInputHandlers: AgentSession.prototype._runInputHandlers,
};
const preprocessing = AgentSession.prototype.prompt.call(receiver, 'A new task', { expandPromptTemplates: false });
try {
  await enteredInput;
  assert.equal(manager.getLeafId(), leaf);
  resolveTitle(titleResponse);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(manager.getSessionName(), undefined, 'input preprocessing must not admit an older title');
  assert.equal(requests[1].options.signal.aborted, true);
} finally {
  releaseInput();
  await preprocessing;
  inputHandlers.pop();
}
assert.deepEqual(errors, []);
await runner.emit({ type: 'session_shutdown', reason: 'quit' });
runner.invalidate();
const host = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
console.log(`PASS: pi ${host.version}, Node ${process.versions.node}: actual loader/runner/native naming; exact ctx.model; duplicate suppression; AgentSession input-preprocessing race blocked. In-memory sessions and mocked model only; no provider requests.`);
