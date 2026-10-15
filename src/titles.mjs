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

export function copilotSessionId(agent) {
  const session = agent.agent_session;
  if (session == null) return null;
  if (session.agent === 'copilot' && session.kind === 'id' &&
      typeof session.value === 'string' && session.value.trim()) return session.value;
  return undefined;
}

export function snapshotFrom(result) {
  const snapshot = result?.snapshot;
  if (!Array.isArray(snapshot?.agents) || !Array.isArray(snapshot?.tabs)) {
    throw new Error('Herdr snapshot must contain agents and tabs arrays');
  }
  for (const agent of snapshot.agents) {
    if (agent?.agent === 'copilot' &&
        (typeof agent.pane_id !== 'string' || typeof agent.tab_id !== 'string' ||
         typeof agent.terminal_id !== 'string')) {
      throw new Error('Copilot agent is missing pane, tab, or terminal identity');
    }
  }
  for (const tab of snapshot.tabs) {
    if (typeof tab?.tab_id !== 'string' || typeof tab.label !== 'string') {
      throw new Error('Herdr tab is missing its identity or label');
    }
  }
  return snapshot;
}

export class TitleTracker {
  #panes = new Map();

  reset() {
    this.#panes.clear();
  }

  plan({ agents, tabs }) {
    const owners = new Map();
    const live = new Set();
    for (const agent of agents) {
      if (agent.agent !== 'copilot') continue;
      live.add(agent.pane_id);
      const owner = owners.get(agent.tab_id);
      if (!owner || agent.pane_id < owner.pane_id) owners.set(agent.tab_id, agent);
    }
    for (const paneId of this.#panes.keys()) {
      if (!live.has(paneId)) this.#panes.delete(paneId);
    }

    const labels = new Map(tabs.map(tab => [tab.tab_id, tab.label]));
    const changes = [];
    for (const agent of agents) {
      if (agent.agent !== 'copilot') continue;
      const tabId = agent.tab_id;
      const sessionId = copilotSessionId(agent);
      if (sessionId === undefined) continue;
      const title = conversationTitle(agent.terminal_title_stripped);
      let state = this.#panes.get(agent.pane_id);
      if (!state || state.terminal !== agent.terminal_id) {
        state = { terminal: agent.terminal_id, sessionId, title: null, stale: null, stable: 0 };
        this.#panes.set(agent.pane_id, state);
      } else if (state.sessionId !== sessionId) {
        // A new session can briefly retain the previous session's OSC title.
        state.stale = state.sessionId && title && title === state.title ? title : null;
        state.sessionId = sessionId;
        state.stable = 0;
      }
      if (!title || title !== state.stale) state.stale = null;
      state.stable = title && title === state.title ? state.stable + 1 : 1;
      state.title = title;
      if (owners.get(tabId) !== agent) continue;
      if (title && !state.stale && state.stable >= 2 &&
          labels.has(tabId) && labels.get(tabId) !== title) {
        changes.push({ tabId, title, paneId: agent.pane_id, terminalId: agent.terminal_id, sessionId });
      }
    }
    return changes;
  }
}
