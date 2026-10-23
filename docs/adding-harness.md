# Adding a harness

A harness is the running agent application, not its selected model/provider.
A DeepSeek model in pi uses the pi adapter. A separate application needs its
own verified Herdr identifier and observation contract.

## 1. Establish the contract

Before coding, inspect the exact harness/version and its documentation/source.
Confirm what Herdr reports in both snapshots and `agent get`:

- Exact `agent` identifier and complete `pane_id`, `tab_id`, `terminal_id`.
- Native `terminal_title_stripped` format, including unnamed/loading states.
- Optional `agent_session` shape, whether it changes on resume/new/fork, and
  any other input needed to normalize a title (pi needs `cwd`).
- Local and saved-SSH differences, custom title behavior, and runtime versions.

Do not infer a harness from title text. If Herdr does not recognize it or expose
a safe title/identity contract, an adapter alone is insufficient. Document that
blocker rather than scanning processes or reading private session transcripts.

## 2. Add one adapter

Create `src/adapters/<harness>.mjs` exporting an object with `read(agent)`.
Register it under the **exact Herdr identifier** in `src/adapters/index.mjs`.
The function is synchronous and pure: no I/O, SDK imports, timers, logging,
settings changes, or external dependencies.

Return either:

```js
// Valid observation. No eligible title and no optional session ID are allowed.
{ title: 'Task name', sessionId: null, context: null }

// Invalid observation, e.g. session metadata identifies another harness.
null
```

- `title`: normalized nonblank string or `null` for no usable title. Reject
  controls, transient/unnamed forms, and unrecognized formats as appropriate
  to the documented harness. Do not invent a title or over-filter real names.
- `sessionId`: nonblank string or `null` when absent. `sessionIdFor()` returns
  `undefined` for malformed/mismatched session metadata: return an invalid
  observation, not a valid observation with an absent ID.
- `context`: string or `null`. Include any additional source context whose
  changes must invalidate a plan. Pi uses the full cwd, not just its basename.
  Encode multiple future inputs unambiguously, e.g. `JSON.stringify([...])`.
  This value stays in memory and must never contain credentials/transcripts.

Check the agent identifier inside the adapter as well as at registry routing.
Preserve exact delimiter semantics; do not split on a delimiter that names
or directories can contain. Parse remote paths using explicit path semantics,
not the watcher's OS defaults. Fail closed when required data is unavailable.
A valid observation with `title: null` must remain distinct from invalid
identity: an unnamed/reset title can release stale-title quarantine, whereas
invalid identity must not.

The shared watcher owns snapshot envelopes, complete identities, two-reading
stability, stale-title quarantine, harness/context replacement, deterministic
ownership, idempotence, and machine isolation. It invokes the **same adapter**
for the final `agent get` check and compares all normalized fields and identities.
Do not add harness-specific branching to transport or lifecycle code.

## 3. Prove safety with fixtures and tests

Use synthetic or sanitized records with fictional paths/names/IDs; never commit
session files, prompts, credentials, or user conversation text. Record the exact
verified harness/package version and evidence in the support documentation.
Pi's initial fixture is `tests/fixtures/pi-1.3.0.json`.

Cover:

- Named/unnamed/loading titles, Unicode, controls, delimiters, and malformed data.
- Missing optional identity versus malformed/mismatched identity.
- Relevant Windows/POSIX paths, root directories, and misleading unnamed titles.
- Session changes, switch-back, stale title quarantine, and title resets.
- Mixed-harness splits: lowest complete supported pane owns the tab; an unnamed,
  loading, or invalid owner blocks fallback. Unsupported agents never own tabs.
- Harness replacement in a reused pane/terminal and changes to adapter context.
- Pre-write pane/tab/terminal/harness/session/title/context races.
- Overlapping pane/tab IDs on different machines, idempotence, and disable.

Run `npm test` on Node 20+. Keep the Windows Node 20/22/24 CI matrix. Tests must
not require the harness installation or mutate live Herdr/pi configuration.
State any live/SSH scenarios not actually verified; fixtures do not replace them.

## 4. Document and review

Update README support/version evidence, limitations, setup (if any), and release
smoke tests. A normal contribution is one adapter, its registry entry, fixtures,
tests, and documentation—not a new plugin framework or a watcher rewrite.
Have the patch reviewed before publishing.

The display/package name is `Herdr Agent Auto-Title` / `herdr-agent-auto-title`.
Keep `copilot-auto-title` as the installed plugin ID and retain the legacy
singleton namespace unless a separate explicit installation migration is agreed.
