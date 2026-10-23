// null means absent (supported); undefined means present but invalid.
export function sessionIdFor(agent, harness) {
  const session = agent.agent_session;
  if (session == null) return null;
  if (session.agent === harness && session.kind === 'id' &&
      typeof session.value === 'string' && session.value.trim()) return session.value;
  return undefined;
}
