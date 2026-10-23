import { sessionIdFor } from './session.mjs';

const SUFFIX = ' - GitHub Copilot';
const GENERIC = /^(?:github copilot(?: cli)?|copilot(?: cli)?|new (?:chat|conversation|session)|untitled(?: (?:chat|conversation|session))?|loading[.\u2026]*|resuming[.\u2026]*)$/i;

export function conversationTitle(raw) {
  if (typeof raw !== 'string') return null;
  let title = raw.trim();
  if (title === SUFFIX.trim()) return null;
  if (title.endsWith(SUFFIX)) title = title.slice(0, -SUFFIX.length).trim();
  if (!title || GENERIC.test(title) || /[\x00-\x1f\x7f]/.test(title)) return null;
  return title;
}

export const copilot = Object.freeze({
  read(agent) {
    if (agent?.agent !== 'copilot') return null;
    const sessionId = sessionIdFor(agent, 'copilot');
    if (sessionId === undefined) return null;
    return { title: conversationTitle(agent.terminal_title_stripped), sessionId, context: null };
  },
});
