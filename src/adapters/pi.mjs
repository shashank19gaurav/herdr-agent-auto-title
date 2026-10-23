import { posix, win32 } from 'node:path';
import { sessionIdFor } from './session.mjs';

const PREFIX = 'π - ';
const CONTROL = /[\x00-\x1f\x7f]/;

// Select path semantics from the remote cwd, never the watcher's platform.
function cwdBasename(cwd) {
  if (typeof cwd !== 'string' || !cwd || CONTROL.test(cwd)) return null;
  const paths = /^(?:[a-z]:[\\/]|\\\\)/i.test(cwd) ? win32 : posix;
  return paths.isAbsolute(cwd) ? paths.basename(cwd) : null;
}

// Stock @earendil-works/pi-coding-agent 1.3.0: updateTerminalTitle().
export function conversationTitle(raw, cwd) {
  const basename = cwdBasename(cwd);
  if (typeof raw !== 'string' || CONTROL.test(raw) || basename === null) return null;
  if (!raw.startsWith(PREFIX) || raw === `${PREFIX}${basename}`) return null;
  const suffix = ` - ${basename}`;
  if (!raw.endsWith(suffix)) return null;
  // Names and directory names can both contain " - ". Remove exact edges only.
  const title = raw.slice(PREFIX.length, -suffix.length).trim();
  return title || null;
}

export const pi = Object.freeze({
  read(agent) {
    if (agent?.agent !== 'pi') return null;
    const sessionId = sessionIdFor(agent, 'pi');
    // Missing required context is not an unnamed reset: preserve quarantine.
    if (sessionId === undefined || cwdBasename(agent.cwd) === null) return null;
    return {
      title: conversationTitle(agent.terminal_title_stripped, agent.cwd),
      sessionId,
      // A different cwd with the same basename is still a different observation.
      context: agent.cwd,
    };
  },
});
