# Herdr Copilot Auto-Title

A [Herdr](https://herdr.dev) plugin that renames tabs running GitHub Copilot
CLI after the current conversation, including after `/resume`. It works for
local tabs and for your saved Herdr SSH machines. It needs no LLM calls, npm
dependencies, background service, or changes to your Copilot config.

## Requirements

- Windows (this release is Windows-only)
- Herdr 0.9.4 or newer
- Node.js 20 or newer on Herdr's `PATH`

## Install

```powershell
herdr integration install copilot
herdr plugin install shashank19gaurav/herdr-copilot-auto-title --ref v0.1.1
herdr plugin action invoke copilot-auto-title.start
```

The plugin starts itself on later Herdr launches. It runs in one background
tab called "Copilot Auto-Title"; keep that tab open. Its output shows
diagnostics only, never conversation titles.

## How it works

Herdr doesn't run plugin hooks for terminal-title changes, so the watcher
polls Herdr's snapshot every two seconds. For each pane running `copilot`:

1. It reads the terminal title and strips the trailing ` - GitHub Copilot`.
2. It ignores blank, generic ("GitHub Copilot", "New chat", "Loading…") and
   control-character titles.
3. Once the same title is seen twice in a row, it renames the tab, after
   re-checking the pane hasn't changed in the meantime.

Details worth knowing:

- **Manual tab names are overwritten** when they differ from the title.
- In a split tab, the Copilot pane with the smallest `pane_id` owns the name.
- If Herdr reports a new session ID, the old title is ignored until the
  terminal shows a different one. Herdr doesn't report a new ID on Copilot
  `/resume`, so there the plugin relies on the title changing. If it never
  does, the old tab name stays rather than risk a stale one.
- Non-Copilot tabs are never touched.
- Titles are kept in memory only. Nothing is written to disk.

### SSH machines

Install the plugin only on your local Herdr. Every enabled saved machine is
watched independently (remote calls use `--machine <id>`), so a slow or
offline machine doesn't delay the others. Remote calls time out after 30
seconds and retry with backoff up to 30 seconds. The remote needs a running
Herdr server, but not this plugin or Node.js. Plain `ssh` sessions typed into
a shell pane are not covered.

### Failures

Failed local calls back off from 4 to 30 seconds; after five in a row the
watcher stops. Fix the cause and run the start action again. Disabling or
uninstalling the plugin stops the watcher on its next cycle.

## Manage

```powershell
herdr plugin list
herdr plugin log list --plugin copilot-auto-title
herdr plugin disable copilot-auto-title
herdr plugin enable copilot-auto-title
herdr plugin uninstall copilot-auto-title
```

Uninstalling doesn't undo earlier renames. To upgrade a pinned install,
disable the plugin and reinstall with the new `--ref`. Omit `--ref` to follow
the default branch.

## Development

```powershell
npm test
herdr plugin link .
```

No install or build step is needed. Use `herdr plugin unlink copilot-auto-title`
to remove the link. CI runs the tests on Windows with Node 20, 22 and 24.

## Security

Herdr plugins run as your user and aren't sandboxed. This one only calls the
Herdr CLI (no direct network access) to list plugins and machines, read
snapshots, open its own pane and rename tabs. It never reads Copilot's
settings or session files.

MIT licensed.
