# Herdr Agent Auto-Title

A Windows-native Herdr plugin that synchronizes **Copilot and pi session names**
to tab labels on Local and enabled saved SSH machines. One shared watcher uses
small harness-specific adapters; more harnesses can be added incrementally.
The watcher makes no LLM calls and needs no paid API, npm dependencies, user
service, or agent hook changes. It synchronizes existing names; it does **not**
generate conversation titles. For automatic pi names, an optional, separately
installed [Pi Auto-Name extension](extensions/pi-auto-name/README.md) can generate
one using pi's selected model. **That extension adds a model request and its
normal provider cost/data handling; it is not enabled by installing this watcher.**

The package/project name is now `herdr-agent-auto-title`. The installed plugin
ID remains **`copilot-auto-title`** for compatibility. Repository URLs below
intentionally use the existing repository until its separate rename is complete.

## Install

Requires Windows, Herdr **0.9.4+**, Node.js **20+** on Herdr's PATH, and Git.
A supported agent must be recognized by Herdr and emit its supported native
terminal title. For Copilot, install its Herdr integration for session-ID
tracking where supported. Pi does not require an additional extension.

**Release status:** these are the commands for the planned `v0.2.0` release;
the tag must be published before they work. To try an unpublished checkout,
use [Local development](#local-development).

```powershell
# For Copilot session-ID tracking where supported:
herdr integration install copilot
herdr plugin install shashank19gaurav/herdr-copilot-auto-title --ref v0.2.0
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

- Polls authoritative `session.snapshot` responses across all workspaces,
  waiting two seconds between completed cycles. Uses `HERDR_BIN_PATH` and
  argv-based, timed CLI calls; no shell interpolation or assumptions about
  Windows named-pipe transport.
- Manages Local and **all enabled saved Herdr SSH machines**, not just the
  machine selected in the UI. Every remote read/write is explicitly scoped with
  `--machine <id>`; identical pane/tab IDs on different servers stay isolated.
- Routes by exact Herdr `agent` identifier: `copilot` or `pi`. Native session
  IDs strengthen switch detection when available, but are not required.
  Unsupported agents are untouched; title text never selects an adapter.
- For Copilot, reads `terminal_title_stripped`, trims surrounding whitespace,
  and removes only the exact trailing ` - GitHub Copilot`. It preserves all
  other text, including any activity text Copilot includes in its title, and
  ignores generic/loading names. For pi, see [Pi support](#pi-support).
- Ignores blank and control-character titles. Requires two consecutive identical
  observations (normally two to four seconds locally; SSH adds transport latency).
- A session ID change invalidates the previous title. An unchanged old title
  is quarantined until the terminal emits a different title or a generic reset.
  Switching back is supported; harness, pane, tab, terminal, session, normalized
  title, and adapter context (pi's full cwd) are rechecked before renames.
  Harness or pi cwd replacement requires fresh stability. Invalid session
  identities break stability without being mistaken for unnamed sessions.
- **Manual tab names are overwritten** whenever an eligible title differs.
  Already-correct labels do not generate rename calls.
- In a split tab, the supported pane with the **ordinally smallest complete
  `pane_id`** owns the title across both harnesses, regardless of focus. If that
  pane is loading, unnamed, or has unusable metadata, the plugin waits rather
  than falling back to another pane. Closing it transfers ownership to the
  next supported pane.
- New/recreated panes and tabs are discovered automatically. Duplicate
  watchers are prevented with an OS-owned named-pipe singleton per Herdr
  socket; no stale PID files, transcripts, or title database are written.

### Pi support

Initially verified against stock **`@earendil-works/pi-coding-agent` 1.3.0**.
Name a session with `/name My task` or start with `pi --name "My task"`.
Stock interactive pi emits `π - <session name> - <cwd basename>`; the prefix
uses **Greek `π`**, not ASCII `pi`. The adapter removes that exact prefix and
exact cwd suffix, so names and directories may contain ` - ` themselves.
Windows and POSIX cwd paths are parsed independently of the watcher's OS.

Stock pi does not automatically assign a conversation name. Use `/name`, or
opt into the standalone [Pi Auto-Name extension](extensions/pi-auto-name/README.md)
for model-generated names after a successful exchange. The extension works
without Herdr and sets pi's native session name; this watcher then synchronizes it.

Unnamed titles (`π - <cwd basename>`) leave the existing tab label unchanged,
even if a previous named session set it. Missing/non-absolute cwd, mismatched
titles, custom title extensions, rebranded forks, and non-interactive modes are
not supported. The watcher does not read transcripts, import pi's SDK, install
an extension, or infer a name from a prompt/model. Pi's own runtime requirement
(Node 22.19+ for 1.3.0) is separate from this watcher's Node 20+ requirement.

Live read-only checks during planning found Herdr 0.9.4 detecting `agent: "pi"`
with cwd/title but no `agent_session`. The Herdr pi integration is not required
or verified here; when a valid pi session ID is supplied it strengthens switch
tracking. Without one, stable title and terminal/cwd changes are the only
observable signals. Named transitions and remote pi still require the release
smoke tests below; fixtures are not an end-to-end compatibility claim.

Version evidence: pi's shipped `dist/modes/interactive/interactive-mode.js`
(`updateTerminalTitle`), `dist/config.js` (`APP_TITLE`), and its
[`sessions.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md)
and [`cli.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md).
The **installed 1.3.0 files**, not changing upstream `main`, were inspected.
Synthetic matching Herdr records are in `tests/fixtures/pi-1.3.0.json`.

### SSH machines

Install the plugin **once on your local Windows Herdr**, even if a saved
machine runs Linux or macOS. The remote needs a running compatible Herdr
server, but does not need this plugin or Node.js installed for the watcher.
The agent itself still needs its own runtime (including Node for pi).

```powershell
herdr machine list --json
herdr machine status "My Devbox" --json
herdr --machine "My Devbox" agent list
```

The watcher discovers saved profiles automatically. Each enabled machine has
its own polling task, title tracker, and reconnect backoff. An offline or slow
device does not stall local titles or other machines. Disabling/removing a
profile stops its task and cancels in-flight commands. SSH requests have a
30-second timeout (local requests use five seconds); disconnected machines retry
with backoff up to 30 seconds without prompting for authentication. Reconnect
through Herdr yourself if SSH needs interactive authentication.

Herdr CLI forwarding can establish a fresh SSH transport for each command.
For a roughly ten-second transport setup, initial synchronization can take
40 seconds or more because title confirmation and rename are separate requests.
No remote service, files, hook edits, or installation are used to avoid that
transport cost.

This covers Herdr's **saved SSH machine connections**, not an arbitrary `ssh`
command typed inside a local shell pane or a separate standalone Herdr window
on another computer. Those need their own Herdr agent detection/connection.

### Lifecycle design

Herdr 0.9.4 exposes terminal-title changes through `pane.updated` subscriptions,
but **does not run plugin event hooks for that event**. Startup hooks are
one-shot commands, not supervised daemons. This plugin therefore uses a
long-running plugin pane and bounded polling, rather than launching an
unmanaged background process from a startup hook.

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
from 4 to 30 seconds; five consecutive local failures stop the watcher. Remote
failures are isolated and keep retrying. Fix a stopped local watcher's cause
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
Without a session ID, only stable title and observable identity/context changes
can be checked; a session switch with no observable change cannot be detected.

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
previous tab renames or alter your agent settings. An exited watcher pane may
remain visible depending on Herdr's pane-exit settings; it can be closed normally.
If a restored layout retains an old, exited watcher tab, close that tab and
keep the newly started watcher.

### Upgrade compatibility

Keep using the installed ID `copilot-auto-title` and action
`copilot-auto-title.start`, despite the new display/package name. The legacy
singleton pipe namespace is also retained so old and new code cannot race.
There is no second plugin ID to install alongside it.

An install pinned with `--ref v0.1.0` or `--ref v0.1.1` stays pinned during
`plugin update`. Once `v0.2.0` is published, disable the old watcher, wait for
it to stop (or close its pane), then install the new tag:

```powershell
herdr plugin disable copilot-auto-title
herdr plugin install shashank19gaurav/herdr-copilot-auto-title --ref v0.2.0
herdr plugin enable copilot-auto-title
herdr plugin action invoke copilot-auto-title.start
```

To follow the default branch, omit `--ref` when installing. For another release,
reinstall with that release's `--ref` after reviewing it. Old tags should remain
available. Renaming the GitHub repository is a separate release task: verify
fresh installs, pinned installs, and updates before changing these URLs; do not
assume Herdr aliases or GitHub redirects provide an in-place migration.

## Local development

```powershell
git clone https://github.com/shashank19gaurav/herdr-copilot-auto-title.git
Set-Location herdr-copilot-auto-title
npm test
herdr plugin link .
herdr plugin action invoke copilot-auto-title.start
```

No `npm install` or build step is required. Disable an existing watcher before
linking a local copy with the same ID. Use `herdr plugin unlink copilot-auto-title`
to unregister a local link without deleting source files.

Tests cover both adapters, pi path/delimiter edge cases, envelopes, session
switches and switch-back, stale titles, manual names, mixed-harness split
ownership, harness replacement in reused panes, workspace/machine isolation,
idempotence, pre-write identity/title/cwd races, command errors, singleton
compatibility/release, backoff, disable/uninstall, missing remote session IDs,
offline-machine isolation, and in-flight cancellation. CI runs on Windows with
Node 20, 22, and 24.

To add another harness, follow [Adding a harness](docs/adding-harness.md).
A DeepSeek model selected inside pi still uses the pi adapter; a different
harness needs its own verified Herdr detection and title/identity contract.

## Security and privacy

Herdr plugins run as your user and are **not sandboxed**. This plugin needs local
Herdr access to list plugins/machines, read agent/tab snapshots, open its own pane,
and rename supported agent tabs. It uses Herdr's existing SSH connections to
manage enabled saved machines; disabling a machine profile excludes it. It makes
no direct network requests and handles no SSH credentials, tokens, telemetry,
persisted conversation text, or session files. It does not read or rewrite agent
settings/hooks. These guarantees describe the watcher, not the optional pi naming
extension: that extension processes bounded user/assistant text using the chosen
model provider; review its separate [privacy and cost details](extensions/pi-auto-name/README.md). A short hash of the Herdr socket path names the singleton pipe;
the pipe accepts no commands. Conversation titles stay in memory and Herdr's
own tab labels, which Herdr may persist as part of its normal session state.

## Publishing

The root `herdr-plugin.toml` and GitHub topic **`herdr-plugin`** make this public
repository eligible for automatic marketplace indexing (normally within
30 minutes). A marketplace listing is discovery, not a security review.
GitHub tags such as `v0.2.0` support reproducible `--ref` installs.

Before publishing 0.2.0:

- Run tests/metadata checks on the Windows Node 20/22/24 matrix.
- Smoke-test pi `/name`, `/resume`, `/new`, fork/clone, and both regular and
  fullscreen terminal modes on pi's supported runtime.
- Exercise mixed Copilot/pi split tabs, owner removal/loading, saved SSH pi,
  reconnect, disable/re-enable, and upgrade from v0.1.1.
- Confirm unsupported tabs never change and conversation text is not logged.
- Validate repository rename/install/update behavior separately. This patch
  does not rename the remote repository, move a checkout, or publish a tag.

References: [Plugins](https://herdr.dev/docs/plugins/),
[Socket API](https://herdr.dev/docs/socket-api/),
[Marketplace](https://herdr.dev/docs/marketplace/).

MIT licensed.
