import { adapterFor } from './adapters/index.mjs';

export function completeIdentity(agent) {
  return [agent?.pane_id, agent?.tab_id, agent?.terminal_id]
    .every(value => typeof value === 'string' && value.trim());
}

export function snapshotFrom(result) {
  const snapshot = result?.snapshot;
  if (!Array.isArray(snapshot?.agents) || !Array.isArray(snapshot?.tabs)) {
    throw new Error('Herdr snapshot must contain agents and tabs arrays');
  }
  for (const agent of snapshot.agents) {
    if (adapterFor(agent?.agent) && !completeIdentity(agent)) {
      throw new Error('Supported agent is missing pane, tab, or terminal identity');
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
    const supported = agents.filter(agent => adapterFor(agent?.agent) && completeIdentity(agent));
    const owners = new Map();
    const live = new Set();
    for (const agent of supported) {
      live.add(agent.pane_id);
      const owner = owners.get(agent.tab_id);
      if (!owner || agent.pane_id < owner.pane_id) owners.set(agent.tab_id, agent);
    }
    for (const paneId of this.#panes.keys()) {
      if (!live.has(paneId)) this.#panes.delete(paneId);
    }

    const labels = new Map(tabs.map(tab => [tab.tab_id, tab.label]));
    const changes = [];
    for (const agent of supported) {
      const observation = adapterFor(agent.agent).read(agent);
      let state = this.#panes.get(agent.pane_id);
      if (!observation) {
        // Invalid identity is not an unnamed/loading session. Break stability
        // without losing the last known session needed for stale-title quarantine.
        if (state) state.stable = 0;
        continue;
      }
      const { title, sessionId, context } = observation;
      if (!state || state.terminal !== agent.terminal_id || state.harness !== agent.agent ||
          state.context !== context) {
        state = { harness: agent.agent, terminal: agent.terminal_id, context,
          sessionId, title: null, stale: null, stable: 0 };
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
      if (owners.get(agent.tab_id) !== agent) continue;
      if (title && !state.stale && state.stable >= 2 &&
          labels.has(agent.tab_id) && labels.get(agent.tab_id) !== title) {
        changes.push({ tabId: agent.tab_id, title, paneId: agent.pane_id,
          terminalId: agent.terminal_id, harness: agent.agent, sessionId, context });
      }
    }
    return changes;
  }
}
