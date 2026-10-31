---
name: pi-coach
description: "Use when running, steering or checking pi lanes (pi-team)."
version: 2.1.0
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

**Feature ↔ session link.** Ilja links his current chat session to a feature from the panel: the feature
header carries `+` (link) and `✓` (linked, click to remove). The link lives in the registry, under the
feature's `sessions` list, so one session can serve several features and one feature several sessions.
The right pane lists a lane's feature sessions and jumps to one with `host.openSession`. The API is
`POST /api/plugins/pi-team/link` and `/unlink` with `{project, feature, session}`; an unknown project or
feature answers 404. Automatic attribution is impossible from the agent side — the shell wrapper strips
`HERMES_SESSION_*` — so the link is always a deliberate click.

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
arrives, and the pane shows the question with one button per option.

- The runner writes `$HERMES_HOME/lanes/<lane>/question.json`: `id`, `method`, `title`, `message`,
  `options`. pi sends `Other…` and `Chat about this` as the last two options itself; render them like the
  rest.
- The pane posts the pick to the plugin backend, which writes `answer.json` as
  `{"id": …, "value": "<option string>"}`, or `{"id": …, "cancelled": true}` to skip.
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

The `pi-team` right pane shows the same fields: last text, last tool call, turns, tokens and cost.

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

## Lane status (what the `pi-team` panes read)

| Field | Source |
|---|---|
| state | `lane.json`: `running`, `waiting` (a question is open), `done`, `failed`, `stopped` |
| question | `question.json`: `id`, `method`, `title`, `options`; the pane draws one button per option |
| last text | last `message_end` with `role: assistant` and a text part |
| last tool | `tool_use` part: name plus the command or path |
| turns, tokens, cost | the same events: `usage.input`, `usage.output`, `usage.cost.total` |
| changes | `git status --porcelain`, `git diff HEAD --stat` |
| plan | `.thinkrail/context/todos/<session-id>.json` |
| specs | every `SPEC.md` of the worktree with `id` and `type`, ordered by the `parent` chain; a dot marks a spec the lane touched |
| shelf | why the lane left the active list: merged, quiet, or worktree gone |

The backend reads the last 1 MB of `events.jsonl`. Older events do not reach the pane.

## Shelf

A finished lane leaves the active list and sits on the shelf when one of these is true:

- its worktree no longer exists;
- its commits are already in the default branch (a lane without commits on the default tip does not
  count — nothing was merged);
- it stayed quiet for 7 days.

The left pane shows the shelf as a separate group. The record stays until the lane is closed, so the
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
2. **Open lanes through the runner.** A hand-made `pi` run leaves no record, so the pane cannot show it.
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
- **The app may run on another machine.** The panes are read from
  `$HERMES_HOME/desktop-plugins/pi-team/plugin.js` on the machine that shows them, not from the agent
  machine. Copy the file there and compare sha256.
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
- **A silent MCP server prints in the header on start.** It does not block the lane.
- **The lane dies with the gateway.** The process is a child of it; the `pi` session survives, so a
  follow-up run continues the conversation. Use `setsid` or `systemd-run --user` when a lane must outlive
  a gateway restart.
- **The pane holds no privilege.** It only reads files and git; every action goes through the runner.

## Verification

- `~/.hermes/lanes/<lane>/lane.json` names state `done` or `failed`, never `running` after the run.
- A lane that asked shows `waiting` with a `question.json`, and returns to `running` when `answer.json`
  lands. Left `waiting` after the run, the answer channel is broken, not the task.
- `git -C <worktree> status --porcelain` reports the lane work.
- The project gates ran as commands, and the output is attached to the report.
