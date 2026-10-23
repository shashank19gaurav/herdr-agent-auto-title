# Pi Auto-Name

An **optional, separately installable pi extension** in the Herdr Agent Auto-Title
repository. It generates a short name for an unnamed conversation using a small
model request and saves it through pi's native `setSessionName()` API. It works
without Herdr. With the Herdr watcher running, pi's native terminal title then
supplies the tab name automatically.

**This is opt-in executable code with an additional model request.** The watcher
alone never calls a model. Installing this extension changes that: the configured
provider receives bounded conversation excerpts and may charge for the request.

## Requirements and installation

Verified API contract: stock **`@earendil-works/pi-coding-agent` 1.3.0**, on its
supported **Node 22.19+** runtime. The Herdr watcher still independently supports
Node 20+ and has no dependency on pi or this extension. No build or `npm install`
is required; pi provides its own APIs.

Try it for a single interactive invocation, from the repository root:

```powershell
pi -e ./extensions/pi-auto-name/index.js
```

Install the local package for future pi sessions:

```powershell
pi install C:/dev/herdr-agent-auto-title/extensions/pi-auto-name
```

Replace the example path with your actual checkout path. Existing checkouts
named `herdr-copilot-auto-title` continue to work without moving them.
This references the checkout without copying it. Keep that directory in place.
Use `pi install --local <path>` for project scope instead of personal scope;
project configuration is loaded only after pi's project-trust decision. Review
the source before installing. Do not load both the package and the direct entry
file together. This subpackage is not yet published on npm. The repository root
is the Herdr plugin, not this pi package: do not use its GitHub URL as a pi package
installation source.

A running pi process needs `/reload` after installation, or restart pi. An already
open conversation is not named merely by loading the extension: finish a new
exchange to trigger it. Installing/reloading does not rewrite historical turns.

## Where the name comes from

1. An unnamed interactive pi session completes a **successful user run**.
2. After `agent_settled` (including tools/retries/queued work), the extension takes
   the initiating user text and final assistant text, each bounded to 2,000 UTF-16
   code units after filtering. It does not submit the whole transcript.
3. It asks the **currently selected pi model** for a concise title, ideally 3–8
   words, at most 72 Unicode code points. No tools are offered.
4. It validates the result and, only if the same idle session/branch still owns
   the request and remains unnamed, calls `pi.setSessionName(title)`.
5. Pi persists the name and updates its native terminal title. Herdr can then
   synchronize it, normally within a few seconds locally.

Naming runs in the background and never adds a prompt, assistant message, tool
call, or tool result to the main chat. It requests reasoning off, at most 256
output tokens, no prompt-cache retention, and no provider retries. Providers may
clamp unsupported options. A 15-second deadline requests cancellation; late
results cannot rename anything even if a provider ignores cancellation.

### Model selection and cost

By default, the extension uses `ctx.model` at settlement through
`ctx.modelRegistry.streamSimple()`. This honors pi's provider configuration,
request-time credentials, custom endpoints, and virtual-model routing (a direct
request). No separate account, API key, fallback provider, or credential file is
introduced. A virtual model may route this request differently from the chat.

Optionally select an exact existing provider/model ID for naming:

```powershell
pi -e ./extensions/pi-auto-name/index.js --auto-name-model "your-provider/exact-model-id"
```

Model IDs may themselves contain `/`. Unknown IDs fail closed; there is no fuzzy
selection or fallback. Configure/authenticate the desired provider through pi,
not through this extension. Do not assume a smaller model is available through
your existing subscription.

One **logical naming request** can consume tokens, subscription quota, and/or
money under the selected provider's normal policy. The provider's invoice or
usage dashboard is authoritative. Direct extension requests are **not added to
pi's chat/session usage totals** by this implementation. SDK/provider internals
may have their own transport behavior; this extension does not retry failures.

## Naming and safety rules

- Existing names, including names inherited by a fork/clone, are never replaced.
  `/name My preferred title` always remains available.
- The first eligible completed exchange after enabling/loading triggers one
  attempt. Resumed unnamed sessions wait for a new successful exchange; they do
  not cause an immediate historical transcript request.
- A small non-context custom entry records the attempt's session ID **before**
  submission. An error, timeout, manual name change, cancellation, or discarded
  output does not automatically retry on every turn, `/reload`, or resume.
- That marker is session-wide, even across `/tree` branches. Forked/cloned sessions
  have new IDs, so inherited attempt markers do not suppress their own attempt if
  they remain unnamed. In-memory `--no-session` runs cannot retain this marker
  across process restarts. Concurrent separate pi processes editing the same
  session file are not coordinated; use a single owner per session.
- New input cancels a pending title before downstream asynchronous preprocessing;
  steering input does not erase an active run's eligible candidate. Session
  switching/shutdown/reload, tree navigation, compaction, model changes, and
  session-name changes also invalidate pending work. Changing
  session/branch state while inference runs conservatively discards the result.
  A cancelled switch/navigation can therefore still consume the one attempt.
- Empty/code-only/attachment-only prompts, non-user extension runs, final errors,
  aborted runs, and responses without final assistant text do not trigger it.
- Print, JSON, and RPC modes are intentionally inactive; this initial extension
  targets interactive TUI sessions only.
- Multi-line, control/invisible-character, overlong, blank, generic, and malformed
  title outputs are rejected, not executed or silently truncated into a name.
- Failures are silent and never interrupt the conversation. There is no automatic
  fallback or retry button; use `/name` after a failed/cancelled attempt.

## Disable and remove

Within the current extension runtime:

```text
/auto-name off
/auto-name status
/auto-name on
```

`on` allows future eligible sessions; it does **not** erase an attempt marker or
regenerate an existing name. This toggle lasts until reload/session replacement.
To disable for an entire process, even if `/auto-name on` is used:

```powershell
pi -e ./extensions/pi-auto-name/index.js --auto-name-disabled
```

For persistent resource control use `pi config`, or remove the package:

```powershell
pi remove C:/dev/herdr-agent-auto-title/extensions/pi-auto-name
```

Use `--local` when removing a project-scoped install. Reload or restart pi after
changing loaded resources. Existing names and attempt markers are not erased.

## Privacy

Only user/final-assistant **text** excerpts enter the naming prompt. Thinking,
images, tool arguments/results, system prompts, older turns, summaries, cwd,
session files, and environment/credential contents are not collected. Recognized
pi `<file ...>...</file>` expansions and fenced code are removed. Common token,
password, bearer, and private-key forms are filtered before truncation. The
extension does not log conversation text, generated titles, or provider errors,
and it performs no direct file reads or transcript uploads.

**Filtering is best effort, not secret detection or a security boundary.** User
or assistant prose may quote sensitive information or tool output in an
unrecognized form. Inline text attachments from other extensions may also be
indistinguishable from ordinary text. Disable automatic naming for sensitive
sessions, or use a trusted/local naming model. Generated names may themselves
reveal the task and are persisted by pi and potentially by terminal/Herdr state.
The provider and trusted pi provider extensions retain their normal access and
telemetry/data-handling policies.

## Development and evidence

From the repository root, `npm test` includes deterministic offline extension
lifecycle/model mocks alongside the existing watcher tests. No real model calls
are needed. Verify the actual installed pi loader/runtime without installing the
package or touching an active session:

```powershell
node scripts/check-pi-auto-name-host.mjs "C:/path/to/node_modules/@earendil-works/pi-coding-agent"
```

Use pi's supported Node runtime for that check. It loads the package entry through
pi's actual loader, dispatches synthetic events through its extension runner,
and checks the actual `AgentSession` input-preprocessing path with a minimal
mocked receiver. It uses an in-memory session manager and mocked model responses,
makes no provider requests, and changes no user settings.

The installed 1.3.0 docs `extensions.md`, `packages.md`, `configuration.md`,
`settings.md`, `sessions.md`, `session-format.md`, `message-types.md`, `models.md`,
`providers.md`, `virtual-models.md`, `sdk.md`, and relevant references/examples
were read. Exact contracts were checked in `dist/core/extensions/types.d.ts`,
`model-registry.d.ts`, `session-manager.d.ts`, and the corresponding runtime code.
This is not a guarantee of compatibility with older pi releases or future APIs.
