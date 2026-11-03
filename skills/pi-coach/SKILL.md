---
name: pi-coach
description: "Use when running, steering or checking pi lanes (pi-team)."
version: 2.4.0
author: Jarvis (Hermes Agent)
license: MIT
platforms: [linux, macos]
metadata:
  hermes:
    tags: [pi, lanes, worktree, orchestrator, spec-graph, todos]
    category: software-development
    related_skills: [pi-harness, kanban, hermes-desktop-plugins]
---

# pi-coach — pi lanes under an orchestrator

Skill `pi-coach` teaches the lane procedure. Plugin `pi-team` shows lane state.
The user does not type into a lane: the orchestrator opens lanes, steers them and verifies the work.

## When to Use

Work runs in lanes: several `pi` runs in isolated worktrees. Use this skill to open a lane, hand it a
follow-up task, read what the agent wrote, verify the result and close the lane.

A lane is headless. There is no tmux and no pty: one `pi --mode rpc` run per task, and one worktree
per lane. RPC mode, not `-p`, is what lets a lane ask the user a question — see **Questions from a lane**.

ThinkRail is a reference for the data model, not a runtime. Do not drive its WebSocket RPC and do not
keep lanewise state in `~/.thinkrail`; the files under `$HERMES_HOME/lanes` are the only record.
(Ilja chose this on 2026-10-29.)

## Checks before start

```sh
pi --version                 # 1.4.0 on the agent machine
ls ~/.hermes/scripts/pi-lane # the runner
```

The runner refuses a bad lane name, a non-repository path and a missing `pi`.

**The runner loads the provider key itself.** Hermes keeps keys in `~/.hermes/.env` and does not export
them to an agent shell, so `pi` started by hand often sees no provider. The runner reads
`NVIDIA_API_KEY` (and the DeepSeek, OpenRouter, OpenCode, Anthropic keys) from that file and exports
them before the run.

Defaults: provider `nvidia`, model `nvidia/nemotron-3.5-super-vl-120b-a12b`, thinking `medium`.
Override with `--provider`, `--model`, `--thinking`.

**Context files reach a lane from two places.** The worktree's `AGENTS.md` (and the copies above it in
the repository) and the global `~/.pi/agent/AGENTS.md` both load, and both load without `--approve` —
that flag gates only `.pi/mcp.json` and `.pi/prompts/`. Hermes keeps its own `~/.hermes/AGENTS.md`,
which `pi` never reads. Run `cat ~/.pi/agent/AGENTS.md` before a run: anything left there applies to
every lane in every project.

To prove the chain works, put `Always answer with the single word MANGO.` in a scratch repo's
`AGENTS.md`, open a lane with `--repo <scratch>` asking which word it must answer with, and expect
`MANGO`. Project rules that do not appear in the answer mean the file was not read; rules from a
stale global file mean the global file is the problem, not the project.

Web access needs no setup: `pi-web-access` (nicobailon) is installed as `npm:pi-web-access` in
`~/.pi/agent/settings.json`. Workflow skills for lanes live in `~/.pi/agent/skills/`:
`writing-specs`, `brainstorming`, `shipping-a-pr`, `setting-up-a-project`, `importing-a-codebase`,
`asking-user-questions`.

## The tree: Project → Feature → Lane

- **Project** is one git repository, cloned to `~/work/<project>`. `~/src` keeps reference clones only.
- **Feature** is what the work is about: kebab-case, one name per feature (`settings-menu`).
- **Lane** is one slice of that feature. Its worktree is `<repo>/.worktrees/<lane>`, so a lane name must be
  unique inside its repository.

Projects and features exist before the first lane: the registry `~/.hermes/plugin-data/pi-team/projects.json`
holds them, and the panel draws empty nodes. The orchestrator creates all three levels on Ilja's word, in
this order:

```sh
pi-project add <project> <git-url>          # clone to ~/work/<project> (fetch when it exists), register
pi-feature add <project> <feature> --title "Settings menu"
pi-lane <lane> "<task>" --project <project> --feature <feature>
```

`pi-project list` shows projects and their features; `pi-feature list <project>` shows one project's
features. A lane for a thrown-away experiment can still run outside the registry with `--repo <path>`.

**The demo fixture is a small working app, not a hello-world fork.** `demo` is `~/work/demo-app`: one static
page (`index.html`, `app.js`, `styles.css`), no dependencies, no build, started with
`python3 -m http.server 8080`. A lane needs something to change — a repository whose only file is a README
yields an empty worktree and a panel that looks broken. Give the fixture one visible surface per feature so
a task names a file, and check the diff after the first lane lands.

**The coding block travels with the project.** `pi-project agents [<project>…] [--check]` writes the
block from this skill's `templates/ponytail-block.md` into `<repo>/AGENTS.md`, or refreshes the copy already
there. The block spans from `<!-- ponytail v1` to `<!-- /ponytail -->`; anything after the end marker is
the project's own rules and survives. A copy written before the end marker existed ends at its last level
row and is updated on the legacy rule. `--check` prints `current`, `outdated`, `missing`, `identical` or
`no markers` per project and changes nothing. A project whose `AGENTS.md` carries its own rules and no
block is refused as `no markers` — merge that file by hand. Run `--check` after any template change.

**Feature ↔ session link.** Ilja links his current chat session to a feature from the panel: the feature
header carries `+` (link) and `✓` (linked, click to remove). The link lives in the registry, under the
feature's `sessions` list, so one session can serve several features and one feature several sessions.
Store `host.state.focusedStoredSessionId`, never `host.state.activeSessionId`: the runtime id does not
survive a reload, and `openSession` / `session.title` take the stored one — a runtime id in the registry
opens a blank draft on click.
The right panel lists a lane's feature sessions with three controls per row: the pencil names it inline,
`↗` opens it with `host.openSession`, and `×` drops it from the feature (`POST /unlink` with project,
feature and session id). The name is the plugin's own label (`POST /label`, stored on the session entry
in `projects.json`), never the real session title: `session.title` answers `session not found` for a
stored id, and the panel must leave the session untouched. The row shows the label, else the real title,
else a shortened id.

## Which instructions a lane obeys

| File | Read by a lane | Note |
|---|---|---|
| `<repo>/AGENTS.md`, and the same file upward | yes | loads without `--approve`; the project file wins |
| `~/.pi/agent/AGENTS.md` | yes | global rules for every lane |
| `~/.hermes/AGENTS.md` | no | Hermes rules; `pi` never reads them |

Keep the global file neutral and put project rules into the project. A one-off experiment left in
`~/.pi/agent/AGENTS.md` reaches every lane of every project and contradicts most of them.

**The coding block.** Every project carries the same block at the top of its `AGENTS.md`: ask only on
architectural decisions, the smallest complete change, no commits, and two last lines with what was
skipped and which risk remains. The canonical text is this skill's
`templates/ponytail-block.md`; a project copy opens with
`<!-- ponytail v1 — generated block. Edit the template, not this copy. -->`. Change the template and copy
it again — never edit a project copy in place, or the copies drift. The `demo` project carries the block
and is the sample to compare against. The levels (`lite`, `full`, `ultra`) are chosen by naming one in
the task; `full` applies when the task names none, and no slash command switches them.

**Ilja's text is his text.** When he hands over prose for the block — or for any file — apply only the
edits he asked for and keep his wording, order and emphasis verbatim. Do not restructure, rename
sections or "improve" a sentence on the way in: a rewritten block loses the intent he encoded, and he
rejects it. Mark every addition (`<!-- +ADDED … -->`, `<!-- ~CHANGED: was … -->`) and show the marked
text in chat before writing the file. Deleting or rewriting a line he wrote needs his explicit word,
even when the line looks dead in the target context — name the reason and let him decide.

## Lane: open

```sh
pi-lane <lane> "<task>" --project <project> --feature <feature> [--provider P] [--model M] [--thinking LEVEL]
```

The runner does five things:

1. Cuts `<repo>/.worktrees/<lane>` on branch `lane/<lane>`.
2. Writes `$HERMES_HOME/lanes/<lane>/lane.json` with state `running`, the task, the pid and the session.
3. Starts `pi --mode rpc --session-id <repo>-<lane> --provider P --model M --thinking L` in the worktree
   and sends the task as `{"type":"prompt","message":"<task>"}` on stdin.
4. Parks every extension dialog in `question.json`, state `waiting`, and relays the answer written to
   `answer.json`.
5. Writes the final state: `done`, or `failed` when pi exited non-zero or wrote no assistant text.

The runner is `~/.hermes/scripts/pi-lane`, Python, one process per lane. `--question-timeout SECONDS`
(default 1800) cancels an unanswered question.

The raw event stream goes to `$HERMES_HOME/lanes/<lane>/events.jsonl`, stderr to `stderr.txt`.

Run several lanes in separate calls; each is its own process and its own worktree.

**Two guards run before the worktree is touched.** A lane whose record is `running` with a live pid and
the same name in the same repository is refused (`lane <x> is already running in <repo>`, exit 2). Another
lane already running in the same feature prints a note on stderr and still starts — parallel lanes inside
one feature are allowed, identical names are not. There are no lock files: the record and its pid are the
truth, and a dead pid means free.

## Lane: follow up

The lane owns a `pi` session, not a conversation. A follow-up is another run with the same session id,
so the context continues:

```sh
pi-lane <lane> "<next task>" --project <project> --feature <feature>
```

The runner reuses the existing worktree and branch. It does not reset the session.

## Questions from a lane

RPC mode turns an extension dialog into a request the runner can park: the lane blocks until the answer
arrives, and the panel shows the question with one button per option.

- The runner writes `$HERMES_HOME/lanes/<lane>/question.json`: `id`, `method`, `title`, `message`,
  `options`. pi sends `Other…` and `Chat about this` as the last two options itself; render them like the
  rest.
- **The panel answers it.** The backend reads `question.json` into the lane payload while the state is
  `waiting`; `POST /api/plugins/pi-team/lanes/<lane>/answer` writes `answer.json` for the runner, and
  `plugin.js` draws the title with one button per option plus `dismiss`. A value that is not one of the
  options is refused with `422`, a lane with no open question with `409`.
- Without a signed-in panel the route needs a session ticket, so write the file yourself:

```sh
printf '{"id": "<id from question.json>", "value": "<option string exactly as pi sent it>"}' \
  > ~/.hermes/lanes/<lane>/answer.json
```

  Use `{"id": …, "cancelled": true}` to skip the question.
- `Other…` asks for typed text, so a click on it relays the bare label. Ask Ilja to put the text in the
  chat, then run the follow-up lane with it.
- Send the option string exactly as pi sent it — that is the form the dialog matches.
- The runner replies `{"type":"extension_ui_response","id":…,"value":…}` on stdin, deletes both files
  and returns the state to `running`.
- Protocol shape, event names and a live probe: `references/pi-rpc-protocol.md` and
  `scripts/probe-rpc-question.py`.

## Lane: read

```sh
cat ~/.hermes/lanes/<lane>/lane.json          # state, task, pid, exit
python3 - <<'PY'                              # last assistant text only
import json,pathlib
p=pathlib.Path.home()/'.hermes/lanes/<lane>/events.jsonl'
for line in p.read_text().splitlines():
    e=json.loads(line)
    if e.get('type')=='message_end' and (e.get('message') or {}).get('role')=='assistant':
        for part in e['message'].get('content') or []:
            if part.get('type')=='text' and part.get('text','').strip(): print(part['text'])
PY
```

The `pi-team` right panel shows the same fields: last text, last tool call, turns, tokens and cost.

**Where the panel lives.** It sits on the right edge with `enforce: true`; the constraint behind that
choice is in § Where the panel lives. Moving it means editing the dock hints in `plugin.js`.

## Lane: verify

A lane report is not evidence. The orchestrator verifies with commands:

```sh
git -C <repo>/.worktrees/<lane> status --porcelain
git -C <repo>/.worktrees/<lane> diff --stat
git -C <repo>/.worktrees/<lane> diff          # read the diff itself
```

Then run the real project gates in that directory: tests, build, `curl` to a live server. Show the output.
A lane whose gates were not run does not close.

## Lane: close

```sh
# a good branch: merge into the main line, then drop the worktree and the record
git -C <repo> merge --no-ff lane/<lane>
git -C <repo> worktree remove .worktrees/<lane>
rm -rf ~/.hermes/lanes/<lane>
```

A dirty worktree: `git worktree remove --force`, then `git worktree prune`. Keep the lane record while the
branch is alive: it holds the task and the last text.

## Where the panel lives

The desktop plugin registers **one** pane, `pi team`, tiled into the right sidebar
(`placement: 'right'`, `dock: { pane: 'workspace', pos: 'right', enforce: true }`, 620px). Inside it two
areas sit side by side: the lane list as a fixed 240px column with a border on its right, and the selected
lane filling the rest.

Settle this before rearranging it again:

- The right sidebar is **one unit with the core `Files` panel**. Closing `Files` collapses that side and
  the panel goes with it. Ilja reads that as "closing Files closes the whole right sidebar".
- A plugin **cannot close or hide a core panel**: the SDK exposes `revealPane`, `undismissPane` and the
  read-only `paneVisibility`; `dismissTreePane` stays inside the app's store.
- Two separate panes were tried and merged into this one; a single floating card was tried and reverted —
  it leaves the sidebar but covers the conversation. Ask before switching either way.
- Changing a pane id (`lanes`/`status` → `team`) leaves the old tabs in a saved layout: tell Ilja to run
  ⌘K → **Reset layout**.
- `pi-team:` prefixes every contributed id (`pi-team:team`).

**How the panel is built.** Label a control with a word, not a glyph: at 10 px a pictograph can read as an
empty spot, so the update control is the word `update`. Give both column headers one fixed height
(`HEADER_H`, 28px), or their text size sets their heights and the two `border-b` lines land on different
rows. Draw a shadow as a 3-px gradient strip across the full width (`BAND_H`, `BAND_BG`), never as
`boxShadow`: on a zero- or 1-px-tall strip Chromium paints nothing, and two per-header shadows double up
at the seam the columns share, which Ilja sees as a broken line. The same band goes under a section label
(`TASK`, `LAST MESSAGE`), not onto the block below it — he marks the label line as the place for the
shadow, and a shadow on the block's own border reads as a frame around the text. The blocks keep one
fixed height (`TEXT_H`, 100px) with scrolling inside — a block that grows with the text pushes the fields
below it off screen. Hierarchy rows carry guide lines (a `.pi-guide` border per level plus a `.pi-row`
tick), so the indent comes from nesting, not from per-row paddings. Put sizes and heights in inline
`style`: the app ships its CSS prebuilt, so a class it never saw in its own source may do nothing, while
an inline value always applies. Keep every one of these numbers in the constant block at the top of
`plugin.js`, so "half that big" or "64 → 100" is one edit in one place. Recipes and the pixel check:
`hermes-desktop-plugins` § `references/panel-visuals.md`.

**Updating a client.** The `update` word at the right end of the `projects` header calls `POST /update` after a `ConfirmDialog` (it replaces files, so it always asks): the backend pulls the
repo here (`~/work/pi-team`, override with `PI_TEAM_REPO`), writes `desktop/plugin.js` to this machine's
`desktop-plugins/`, then hands the same bytes to every host in
`~/.hermes/plugin-data/pi-team/clients.json` (`{"host": "ili@casalt", "path": "/home/ili/…/plugin.js"}`)
over `ssh` with the file on stdin. The app watches that folder, so a copied file reloads by itself.

- The route takes **git's** copy. Commit and push a local edit first, or the button silently reverts it.
- `ssh` rides Tailscale check mode: an unapproved host answers with an approval URL, and the notify shows
  that line. `local` in `host` writes in place and needs no ssh.
- The pane cannot run git or write files — the SDK exposes no fs and no exec — so an update is always a
  backend route, never plugin code.

## Lane status (what the `pi-team` panels read)

| Field | Source |
|---|---|
| state | `lane.json`: `running`, `waiting` (a question is open), `done`, `failed`, `stopped` |
| question | `question.json`: `id`, `method`, `title`, `options`; the panel draws one button per option |
| last text | last `message_end` with `role: assistant` and a text part |
| last tool | `tool_use` part: name plus the command or path |
| turns, tokens, cost | the same events: `usage.input`, `usage.output`, `usage.cost.total` |
| changes | `git status --porcelain`, `git diff HEAD --stat` |
| plan | `.thinkrail/context/todos/<session-id>.json` |
| specs | every `SPEC.md` of the worktree with `id` and `type`, ordered by the `parent` chain; a dot marks a spec the lane touched |
| shelf | why the lane left the active list: merged, quiet, or worktree gone |

The backend reads the last 1 MB of `events.jsonl`. Older events do not reach the panel.

## Shelf

A finished lane leaves the active list and sits on the shelf when one of these is true:

- its worktree no longer exists;
- its commits are already in the default branch (a lane without commits on the default tip does not
  count — nothing was merged);
- it stayed quiet for 7 days.

The left panel shows the shelf as a separate group. The record stays until the lane is closed, so the
task and the last text survive. Close a shelved lane with the merge, worktree removal and record
deletion from the section above.

## Specs: pi-spec-graph

The package comes from the ThinkRail repository (Apache-2.0). It is portable and runs under plain `pi`.

```sh
git clone --depth 1 https://github.com/JetBrains/thinkrail.git ~/src/thinkrail
pi install ~/src/thinkrail/packages/spec-graph
pi install ~/src/thinkrail/packages/pi-todos
```

It adds the tools `spec_grep`, `spec_get`, `spec_graph`, `spec_create`, `spec_update`, `spec_delete` and
`spec_validate`, plus the skill `spec-graph`. `pi-todos` adds the `todo_*` tools and the chat plan.

- **Both packages are `private: true` and absent from npm** (`npm view pi-spec-graph` returns 404).
  Install from a local path only. Pin the repository commit.
- **`pi install` writes the path relative to `PI_CODING_AGENT_DIR`.** Moving the agent directory breaks
  the install: reinstall from the new location.
- **`pi-spec-graph` needs the `yaml` module.** Without it the extension fails to load with
  `Cannot find module 'yaml'` from `core/parse.ts`. `npm install` inside the package fails on the
  `catalog:` protocol (bun workspace), and bun is not installed here. This workaround runs:

```sh
cd ~/.hermes/cache/scratch && npm pack yaml@2.9.1
mkdir -p ~/src/thinkrail/packages/spec-graph/node_modules
tar xzf yaml-2.9.1.tgz -C ~/src/thinkrail/packages/spec-graph/node_modules
mv ~/src/thinkrail/packages/spec-graph/node_modules/package \
   ~/src/thinkrail/packages/spec-graph/node_modules/yaml
```

`pi-todos` has no runtime dependencies and loads at once.

- **A file is a spec when its frontmatter carries `id` and `type`.** `parent` builds the hierarchy that
  mirrors the code. `depends-on`, `references` and `implements` build the dependency layer.
  `spec_validate` reports dangling links, duplicate `id` values and `parent` cycles.
- **The tools change frontmatter only.** Prose is written with the normal `edit` tool.
- **A change that moves a boundary updates the spec in the same change.** A spec that drifts from the
  code stops being ground truth.

## Lane rules

1. **One writer per worktree.** The runner gives every lane its own worktree; never point two lanes at one.
2. **Open lanes through the runner.** A hand-made `pi` run leaves no record, so the panel cannot show it.
3. **Keep `--session-id` stable.** The runner derives it from repository and lane; a follow-up depends on it.
4. **Keep one `in_progress` item in the plan.** A step is a task, not a thought.
5. **The writer never accepts the work.** The orchestrator verifies in the main session.
6. **The orchestrator merges the branch.** A lane never pushes to the main line.
7. **A waiting lane is not a stuck lane.** Answer it or cancel it; do not open a second lane on the same
   worktree while it waits, and do not report it as finished.

## Pitfalls

- **The plugin backend is imported once, at `hermes-serve` start.** An edited
  `~/.hermes/plugins/pi-team/dashboard/plugin_api.py` does not reach the live route. Restart the
  service; the agent session runs inside it, so schedule the restart
  (`systemd-run --user --on-active=25 … systemctl --user restart hermes-serve`) and say that the window
  reconnects.
- **The app may run on another machine.** The panels are read from
  `$HERMES_HOME/desktop-plugins/pi-team/plugin.js` on the machine that shows them, not from the agent
  machine. Copy the file there and compare sha256. That machine reaches the backend through the `url` in
  its own `connection.json` (`mode: remote`) — the desktop backend, not the gateway port the routes were
  tested on — so a replaced machine joins the tailnet first and the copy waits for SSH to work. Steps:
  `hermes-desktop-plugins` § Ship to another machine.
- **`ask_user_question` asks only under `--mode rpc`.** With `pi -p` or JSON mode it answers "UI not
  available" and the agent states its assumptions in text instead. That is a property of the mode, not a
  broken extension — switch the mode before concluding the tool is unusable.
- **`pi` in RPC mode is a server: it does not exit after `agent_end`.** A host that waits for EOF after
  the turn blocks forever and leaves the record `running` with `exit: null` although the work is done.
  Break on `agent_end`, drain what is already in the pipe, then `terminate()` the child and take its
  return code.
- **Only `select`, `confirm`, `input` and `editor` are questions.** `notify` is fire-and-forget; treating
  every `extension_ui_request` as a dialog parks a question nobody asked and stalls the lane.
- **`pi` exits 0 when the provider never answered.** The runner checks for assistant text and records
  `failed`; trust that state, not the exit code.
- **A new directory brings a trust dialog that a headless run cannot answer.** Project-local
  `.pi/mcp.json` and `.pi/prompts/` load only with `--approve`; without it they are ignored, not broken.
  `AGENTS.md` is the exception — it loads in both cases, so instructions from the repository apply
  even when nothing was approved.
- **A stale `~/.pi/agent/AGENTS.md` overrides every project.** The global file is read by every lane
  and every interactive `pi` session, so a leftover experiment there ("write one file `index.html`,
  create nothing else") contradicts the task of an unrelated lane and looks like the lane disobeying.
  Keep project rules in the project's own `AGENTS.md` and the global file neutral. `--no-context-files`
  silences the repository's rules too, so repair the file instead of passing that flag.
- **A silent MCP server prints in the header on start.** It does not block the lane.
- **The lane dies with the gateway.** The process is a child of it; the `pi` session survives, so a
  follow-up run continues the conversation. Use `setsid` or `systemd-run --user` when a lane must outlive
  a gateway restart.
- **A panel feature exists only when three layers are present.** The runner writes an artifact, the
  backend exposes it in the lane payload, the panel renders it and posts the answer back. Check each
  layer before reporting a feature as working or writing it into this skill: the runner half alone
  leaves a lane parked and invisible to Ilja. Search the artifact name in `dashboard/plugin_api.py` and
  in `plugin.js` — a route list without the field, or a field without the handler, is a half-built flow,
  not a fault in the lane.
- **A probe lane is a live row in Ilja's panel.** A test run (`hello`, `ask2`, a throwaway theme probe)
  leaves `~/.hermes/lanes/<lane>`, a worktree and a branch behind, and the panel draws it as real work; a
  hand-written `sessions` entry in the registry then looks like a link Ilja added himself. After every
  probe: `git -C <repo> worktree remove --force .worktrees/<lane>`, `git -C <repo> worktree prune`,
  `rm -rf ~/.hermes/lanes/<lane>`, drop the session from `projects.json`, and confirm the lane count is
  zero before calling the panel ready.
- **The panel holds no privilege.** It only reads files and git; every action goes through the runner.

## Verification

- `~/.hermes/lanes/<lane>/lane.json` names state `done` or `failed`, never `running` after the run.
- `done` is not proof of work: run `git -C <worktree> status --porcelain`. An empty answer means the lane
  read the files and narrated a plan instead of editing — phrase the task as an order ("Edit these files
  now, do not describe a plan") and run it again on the same lane.
- A lane that asked shows `waiting` with a `question.json`, and returns to `running` when `answer.json`
  lands. Left `waiting` after the run, the answer channel is broken, not the task.
- `POST /lanes/<lane>/answer` answers `422` for a value outside the options and `409` when no question is
  open; an accepted answer carries the question `id` back.
- `/api/plugins/pi-team/lanes` returns the list payload only: `status`, `plan` and `spec_tree` arrive on
  `/lanes/<lane>`. A `KeyError` on `plan` from the list route means the wrong route, not a missing field.
- The lane and registry scripts carry no `.py` suffix, so
  `importlib.util.spec_from_file_location` returns `None` for them. Test a function from one by loading it
  with `SourceFileLoader(name, path)` plus `spec_from_loader` and calling it — that exercises the shipped
  file instead of a wrapper copy that can drift from it.
- `git -C <worktree> status --porcelain` reports the lane work.
- Panel geometry is checkable without the window: rebuild the box model in a throwaway HTML file with the
  same numbers, screenshot it in headless Chromium and measure the pixels — header-line y, band rows, text
  indents, spread across a seam (`hermes-desktop-plugins` § `references/panel-visuals.md`). Measured
  numbers are what he accepts; the rendered look in his own window stays unverified, so say that and name
  the gesture that closes it.
- The project gates ran as commands, and the output is attached to the report.
