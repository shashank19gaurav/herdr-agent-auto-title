# Herdr Copilot Auto-Title

A Windows-native Herdr plugin that keeps **all Copilot tabs** named after the
active Copilot conversation, including after `/resume`. No LLM calls, paid API,
npm dependencies, user service, or changes to your Copilot hooks.

## Install

Requires Windows, Herdr **0.9.4+**, Node.js **20+** on Herdr's PATH, and Git.
Copilot's Herdr integration must report its active session ID:

```powershell
herdr integration install copilot
herdr plugin install shashank19gaurav/herdr-copilot-auto-title --ref v0.1.0
herdr plugin action invoke copilot-auto-title.start
```

The install command asks you to review the plugin before installing. The start
action activates it immediately without restarting your running agents. On
subsequent Herdr server startups the plugin activates automatically, including
after Windows login when you start Herdr. It does not start Herdr at login.

The watcher uses one **background tab**, without changing your focus.
Keep that tab open. It is a Herdr-owned plugin pane, not a detached process.
Its terminal shows operational diagnostics without conversation titles.

## Behavior

- Polls one authoritative `session.snapshot` every two seconds, across all
  workspaces. Uses `HERDR_BIN_PATH` and argv-based, timed CLI calls; no shell
  interpolation or assumptions about Windows named-pipe transport.
- Only agents whose `agent` is exactly `copilot` and which have a native
  Copilot session ID are eligible. Non-Copilot tabs are untouched.
- Reads `terminal_title_stripped`, trims surrounding whitespace and removes
  only the exact trailing ` - GitHub Copilot`. It preserves all other title
  text, including any activity text Copilot includes in its terminal title.
- Ignores blank, generic, loading, and control-character titles. Requires
  two consecutive identical observations (normally two to four seconds).
- A session ID change invalidates the previous title. An unchanged old title
  is quarantined until the terminal emits a different title or a generic
  reset. Switching back is supported; identities are rechecked before renames.
- **Manual tab names are overwritten** whenever an eligible title differs.
  Already-correct labels do not generate rename calls.
- In a split tab, the Copilot pane with the **ordinally smallest complete
  `pane_id`** owns the title, regardless of focus. If that pane is loading,
  the plugin waits rather than alternating with other panes. Closing it
  transfers ownership to the next Copilot pane.
- New/recreated panes and tabs are discovered automatically. Duplicate
  watchers are prevented with an OS-owned named-pipe singleton per Herdr
  socket; no stale PID files, transcripts, or title database are written.

### Lifecycle design

Herdr 0.9.4 exposes terminal-title changes through `pane.updated` subscriptions,
but **does not run plugin event hooks for that event**. Startup hooks are
one-shot commands, not supervised daemons. This plugin therefore uses a
documented long-running plugin pane and bounded polling, rather than launching
an unmanaged background process from a startup hook.

The one-shot startup/action command opens the watcher tab. Workspace creation,
agent detection, and tab-focus hooks also ensure it is running. An empty
headless server has no workspace in which to open a pane; its first workspace
creation activates the watcher. There is no scheduled task, shell profile edit,
or separately managed service.

Each cycle checks the plugin's registry entry. Disable/uninstall stops the
watcher on the next cycle (plus any in-flight CLI timeout). Re-enable and invoke
the start action for immediate activation; focusing another tab or detecting
an agent also activates it. Herdr owns process termination when its pane/server
closes. Failed API calls log an error, discard cached observations, and back off
from 4 to 30 seconds; five consecutive failures stop the watcher. Fix the cause
and invoke the start action to retry.

**Freshness limit:** Herdr provides terminal titles and session IDs separately,
without a shared title/session generation. If a resumed conversation never
emits a different title or generic reset, the plugin intentionally retains the
existing tab name rather than assigning a potentially stale title. Two different
conversations with identical titles usually need no label change, but a manual
label applied during that transition can remain until the next title update.
No plugin using only these Herdr fields can prove their atomic association.

Herdr 0.9.4's session-replacement allowlist does not include Copilot, so its
reported `agent_session.value` can remain unchanged on `/resume`. Title changes
are tracked independently of session IDs and still update the tab. The
session-switch guard applies whenever Herdr actually reports a changed ID.

## Manage

```powershell
herdr plugin list
herdr plugin log list --plugin copilot-auto-title
herdr plugin disable copilot-auto-title
herdr plugin enable copilot-auto-title
herdr plugin action invoke copilot-auto-title.start
herdr plugin uninstall copilot-auto-title
```

Startup/action diagnostics appear in Herdr's plugin log. Ongoing refresh
diagnostics appear in the watcher tab. Disabling/uninstalling does not undo
previous tab renames or alter your Copilot settings. An exited watcher pane may
remain visible depending on Herdr's pane-exit settings; it can be closed normally.
If a restored layout retains an old, exited watcher tab, close that tab and
keep the newly started watcher.

An install pinned with `--ref v0.1.0` stays pinned during `plugin update`.
To follow the default branch, omit `--ref` when installing. For another release,
reinstall with that release's `--ref` after reviewing it.

## Local development

```powershell
git clone https://github.com/shashank19gaurav/herdr-copilot-auto-title.git
Set-Location herdr-copilot-auto-title
npm test
herdr plugin link .
herdr plugin action invoke copilot-auto-title.start
```

No `npm install` or build step is required. Uninstall the GitHub installation
before linking a local copy with the same ID. Use `herdr plugin unlink
copilot-auto-title` to unregister a local link without deleting source files.

Tests cover normalization, envelopes, session switches and switch-back, stale
titles, manual names, deterministic split ownership, workspace isolation,
idempotence, identity races, command errors, singleton release, backoff, and
disable/uninstall. CI runs the tests on Windows with Node 20, 22, and 24.

## Security and privacy

Herdr plugins run as your user and are **not sandboxed**. This plugin needs local
Herdr access to list plugins, read agent/tab snapshots, open its own pane, and
rename Copilot tabs. It has no network requests, tokens, telemetry, persisted
conversation text, or session-file access. It does not read or rewrite Copilot
settings/hooks. A short hash of the Herdr socket path names the singleton pipe;
the pipe accepts no commands. Conversation titles stay in memory and Herdr's
own tab labels, which Herdr may persist as part of its normal session state.

## Publishing

The root `herdr-plugin.toml` and GitHub topic **`herdr-plugin`** make this public
repository eligible for automatic marketplace indexing (normally within
30 minutes). A marketplace listing is discovery, not a security review.
GitHub tags such as `v0.1.0` support reproducible `--ref` installs.

References: [Plugins](https://herdr.dev/docs/plugins/),
[Socket API](https://herdr.dev/docs/socket-api/),
[Marketplace](https://herdr.dev/docs/marketplace/).

MIT licensed.
