import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { conversationTitle, snapshotFrom, TitleTracker } from './titles.mjs';

export const PLUGIN_ID = 'copilot-auto-title';
const execute = promisify(execFile);
const POLL_MS = 2000;

export function decodeResponse(stdout) {
  const response = JSON.parse(stdout);
  if (response?.error) throw new Error(`Herdr ${response.error.code}: ${response.error.message}`);
  if (!response?.result || typeof response.result !== 'object') {
    throw new Error('Herdr returned no result');
  }
  return response.result;
}

export async function herdr(args) {
  try {
    const { stdout } = await execute(process.env.HERDR_BIN_PATH || 'herdr', args, {
      encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    });
    return decodeResponse(stdout);
  } catch (error) {
    // Never print child output: it can contain private tab titles or paths.
    if (error.code || error.killed) {
      throw new Error(`Herdr command failed (${error.killed ? 'timeout' : error.code})`, { cause: error });
    }
    throw error;
  }
}

export function lockAddress(socketPath) {
  const key = createHash('sha256').update(socketPath.toLowerCase()).digest('hex').slice(0, 24);
  return `\\\\.\\pipe\\herdr-copilot-auto-title-${key}`;
}

export function watcherRunning(address) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(address);
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('Watcher probe timed out')); });
    socket.once('error', error => {
      socket.destroy();
      if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) resolve(false);
      else reject(error);
    });
  });
}

export function acquireLock(address) {
  return new Promise((resolve, reject) => {
    const server = net.createServer(socket => socket.end());
    server.once('error', error => {
      if (error.code === 'EADDRINUSE') resolve(null);
      else reject(error);
    });
    server.listen(address, () => resolve(server));
  });
}

export async function pluginEnabled(api) {
  const result = await api(['plugin', 'list', '--json']);
  if (!Array.isArray(result.plugins)) throw new Error('Herdr plugin list is missing plugins');
  return result.plugins.some(plugin => plugin.plugin_id === PLUGIN_ID && plugin.enabled === true);
}

export async function start(api, address) {
  if (await watcherRunning(address)) return;
  if (!await pluginEnabled(api)) return;
  await api(['plugin', 'pane', 'open', '--plugin', PLUGIN_ID,
    '--entrypoint', 'watcher', '--placement', 'tab', '--no-focus']);
}

export async function tick(api, tracker) {
  if (!await pluginEnabled(api)) return false;
  const snapshot = snapshotFrom(await api(['api', 'snapshot']));
  for (const change of tracker.plan(snapshot)) {
    // Recheck identity immediately before writing; /resume can race the snapshot.
    const result = await api(['agent', 'get', change.paneId]);
    const current = result.agent;
    if (current?.agent !== 'copilot' || current.tab_id !== change.tabId ||
        current.agent_session?.value !== change.sessionId ||
        conversationTitle(current.terminal_title_stripped) !== change.title) continue;
    if (!await pluginEnabled(api)) return false;
    await api(['tab', 'rename', change.tabId, change.title]);
    console.log(`Updated Copilot tab ${change.tabId}`);
  }
  return true;
}

export async function watch(api, address, { signal, sleep = delay, log = console } = {}) {
  const lock = await acquireLock(address);
  if (!lock) return;
  const tracker = new TitleTracker();
  let failures = 0;
  log.log('Copilot Auto-Title running. All Copilot tabs are managed; no conversation text is logged.');
  try {
    while (!signal?.aborted) {
      try {
        if (!await tick(api, tracker)) break;
        failures = 0;
      } catch (error) {
        tracker.reset();
        failures++;
        log.error(`Auto-title refresh failed: ${error.message}. Attempt ${failures}/5.`);
        if (failures >= 5) throw new Error('Herdr unavailable after five attempts; watcher stopped');
      }
      try {
        await sleep(Math.min(POLL_MS * 2 ** failures, 30000), undefined, { signal });
      } catch (error) {
        if (error.name !== 'AbortError') throw error;
      }
    }
  } finally {
    await new Promise(resolve => lock.close(resolve));
    log.log('Copilot Auto-Title stopped.');
  }
}

async function main() {
  if (process.platform !== 'win32') throw new Error('This release supports Windows only');
  if (process.env.HERDR_ENV !== '1' || !process.env.HERDR_SOCKET_PATH) {
    throw new Error('Run through Herdr plugin startup, action, or pane; Herdr context is required');
  }
  const address = lockAddress(process.env.HERDR_SOCKET_PATH);
  if (process.argv[2] === 'start') return start(herdr, address);
  if (process.argv[2] !== 'watch') throw new Error('Expected start or watch');
  if (process.env.HERDR_PLUGIN_ENTRYPOINT_ID !== 'watcher' || !process.env.HERDR_TAB_ID) {
    throw new Error('The watcher must run in its Herdr-owned plugin pane');
  }
  await herdr(['tab', 'rename', process.env.HERDR_TAB_ID, 'Copilot Auto-Title']);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await watch(herdr, address, { signal: controller.signal });
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Copilot Auto-Title: ${error.message}`);
    process.exitCode = 1;
  });
}
