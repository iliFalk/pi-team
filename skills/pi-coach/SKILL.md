---
name: pi-coach
description: "Use when running, steering or checking pi lanes (pi-team)."
version: 2.7.0
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

**Feature ↔ session link.** The left list is a pure tree — project, feature, lane, and no icons on any of
its rows; the panel asks the detail side for every state it draws. Linking lives only in the right pane's
sessions block, which is always drawn: one row per linked session, then `add this session +`, which links
the open chat to the feature. **One chat belongs to one feature, and one feature holds one chat** — the
chat is an address, not a bookmark: it is where that feature's lanes speak, and it cannot answer for two
features. `/link` refuses with `409 this chat already belongs to <project>/<feature>` or `409 this feature
already has a chat`; re-attaching means `×` (unlink) first. The add row never hides, and a refused click
names the current owner, so the click answers a question instead of doing nothing.
Each row carries three controls: the pencil names it inline, `↗` opens it with `host.openSession`, and `×`
drops it from the feature (`POST /unlink` with project, feature and session id). The name is the plugin's
own label (`POST /label`, stored on the session entry in `projects.json`) and must never touch the real
session title: setting `session.title` needs the runtime id, so a stored one answers `session not found`,
and Ilja wants the panel to leave his chat alone. The row shows the label, else the real title, else a
shortened id. Store `host.state.focusedStoredSessionId`, never `host.state.activeSessionId`: a runtime id
does not survive a reload, and `openSession` takes the stored one — a runtime id in the registry opens a
blank draft on click.

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

## Placeholders: a project or a feature asked for in one line

The person does not create structure by hand: the panel does, and the agent finishes it.

| Asked from the panel | What exists at once | What the agent does |
|---|---|---|
| `+` on a project (feature) | the feature, named by the person's text, `state: preparation` | `pi-feature rename <project> <prep-key> <name> --title "…"`, then open the first lane |
| `+` in the tree header (project) | the project with `remote` and `state: preparation` | clone to `~/work/<name>`, then `pi-project add <name> <path>` — that clears the placeholder |

Rules:

- **The registry has one writer: `pireg.py`.** The panel's routes and this skill both call it; no route,
  script or agent edits `projects.json` directly. Its rules — one chat per feature, a rename that moves
  lanes, a placeholder that must be empty before it is dropped — exist only there, and a second copy in
  `plugin_api.py` drifts the first time one of them changes.
- A placeholder never has lanes. Dropping it is safe while it has none; both `cancel` endpoints refuse after that.
- The request arrives in the chat as `[feature … · preparation]` or `[project … · preparation]`. Answer by finishing the structure, not by describing it.
- `pi-feature rename` moves lanes already filed under the old key, so nothing is orphaned.
- The row shows how long it has waited, so a forgotten placeholder is visible.

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

The raw event stream goes to `$HERMES_HOME/lanes/<lane>/events.jsonl`, stderr to `stderr.txt`. The stream
is unfiltered stdout, so most of its bytes are noise: `message_update` (the answer streamed token by token)
is about 58% of a file, and `agent_end` repeats the whole transcript while `message_start`/`message_end`
repeat each message twice — 72–74% of a 400 KB stream is duplication or streaming. Only `message_end`,
`turn_end`, `tool_execution_*`, `extension_ui_request` and `agent_settled` are worth keeping; a session's
short run already writes ~80 KB, so a lane folder grows fast and the drawer of `events.jsonl` is a
measurement question, not a guess.

Run several lanes in separate calls; each is its own process and its own worktree.

**Two guards run before the worktree is touched.** A lane whose record is `running` with a live pid and
the same name in the same repository is refused (`lane <x> is already running in <repo>`, exit 2). Another
lane already running in the same feature prints a note on stderr and still starts — parallel lanes inside
one feature are allowed, identical names are not. There are no lock files: the record and its pid are the
truth, and a dead pid means free.

## Lane: follow up

A lane owns a `pi` session, not a conversation: the runner starts it with `--session-id <repo>-<lane>`, so
a continuation is the same conversation with its whole context. Use the runner, never a fresh open —
`pi-lane <lane> "…"` cuts a SECOND worktree and looks like a new lane:

```sh
pi-lane continue <lane> "<next task>"
```

It refuses a closed lane, a lane whose worktree is gone and a lane still running; it clears `handed_at`,
appends the text to the lane's thread, sets `running` and runs that session in that worktree. The record
keeps `provider`, `model` and `thinking`, so the continuation runs exactly like the first run.

**Ask before continuing.** His note in a thread is a thought, not an order. Put the exact prompt in the
question in that thread ("продолжить с текстом «…»? да / нет") and run `pi-lane continue` only after his
да. A silent continuation moves a `done` lane to `running` and burns tokens on his behalf, which reads as
the panel starting work by itself.

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

**Show the plan before closing.** `pi-lane close <lane>` prints what will be merged and what will be
deleted (worktree, branch, lane folder) and does nothing else; only `--yes` carries it out. Run the bare
form, paste the plan into the chat, wait for his go, then run it with `--yes`. A close commits the lane's
uncommitted work on its branch first, merges, writes one receipt line into `lanes/closed.jsonl`, and
deletes the worktree, the branch, the folder and the lane's own `pi` session under
`~/.pi/agent/sessions/--<worktree path, slashes as dashes>--`.

**The card is a thread per lane.** `to review` on the card queues the lane (it stays visible as
`in review`, never disappears — a control that vanishes once it worked reads as a missing feature); the
`send` on the review row, after its tick, puts the whole queue into the chat. `close` appears on the card
ONLY while the lane sits in `review`: closing is the step after the check, and offering it on a freshly
finished lane invites a merge nobody read. A condition on the state alone (`done`, `stopped`, `failed`)
put it on every finished lane — the field that decides is `handed_at`, not the state. A message Ilja writes in a
lane's thread reaches the orchestrator, never pi: the route appends it to
`$HERMES_HOME/lanes/<lane>/thread.jsonl` (`{who: lane|jarvis|user, at, text}`, one object per line) and
calls `ctx.inject_message` with a `[lane <name> · project/group · state]` prefix. That call reaches nothing
until the plugin is allowed to speak: `hermes config set plugins.entries.pi-team.allow_gateway_injection true`
(back up `config.yaml` first). Without it the log reads
`inject_message: gateway injection denied for plugin pi-team` and the route still answers
`message_sent: false`, so every button in the panel goes quiet at once — check this setting before the
session key or the render code. Answer in the same
thread with `pi-lane say <lane> "…"` — it appends `who: jarvis` and touches nothing else, so pi never
hears it until a continuation is started. The card draws the lane's own last text as the newest bubble
and the stored rows under it, so the same words never appear twice.

**Closing is a decision, never a side effect.** A lane that finishes, or whose worktree disappears, stays in
the active list with its own state. Nothing in the repository moves it: not `done`, not `stopped`, not a
merged branch, not a missing worktree. Two fields alone decide a group, and only the orchestrator writes
them:

| Group | Field in `lane.json` | Written by |
|---|---|---|
| `review` | `handed_at` | the card's `to review`, on Ilja's click |
| `closed` | `closed_at` | `pi-lane close`, after Ilja says close |

A group with no entry does not render. Never seed either field to show how the tree looks: Ilja reads an
unapproved row as the orchestrator moving his work and answers "no one must be in closed and handed".
Name a group after what the lane WAITS for (`review`), not after the gesture that put it there
(`handed`): the old label said nothing about what happens next, and he asked for a rename within a minute.

Verify, merge and close in that order: read the diff, run the project gates, then `pi-lane close <lane>`,
which commits the lane's work on its branch, merges it, writes the receipt line and removes the worktree,
the branch and the record. `pi-lane close --no-merge` closes without merging; `--keep` keeps the worktree,
branch and folder; `--reason "…"` sets the wording.

**The review queue reaches the chat in one message.** The `send` word on the `review` header row posts
`/review/send` with the panel's `session_key`; the backend lists every handed lane (name, state, diff size,
failure) and calls `ctx.inject_message` so the orchestrator gets the whole queue in one turn. The answer is
a report, never a merge: check each lane, show what you found, and wait for his go before closing.
`409` means the queue is empty. A one-word control on a header that also toggles needs the click stopped
(`stopPropagation`), or it collapses the group it just sent.

**The counts belong to the deepest visible level, and a project always sums its own.** A feature prints
them while it is closed and hands over to its lane rows once it opens; a project prints them open or
closed, because it is the row Ilja scans to see whether anything runs anywhere — hiding them while a
project happened to be open got the feature reported as missing from the panel. The right end of a header
is four groups in fixed order: `? n` in `#0762B4`, `! n` in `#8A1C0E`, the gear with `n` in `#1A6543`,
`✓ n` in `var(--ui-text-tertiary)`. A group at zero is absent, each lane counts in exactly ONE group by
precedence (`isBad` → `waiting` → `running` → `done`), and a shelved lane counts nowhere. The old pair
`3 · 2` (features · lanes) is gone: two numbers of different units on one 10-px row cannot be compared at
a glance, and he removes them the moment the four groups exist. One `countStates(lanes)` serves every
level; a header that draws nothing means a CALL SITE still passing the old props.

**State colours follow the same deepest-visible rule.** Working is `#1A6543` (status word, pulse, ball,
ring), a question paints the lane's label band `#0762B4` at 85% with white text, and its parents take the
same hue as an 18% wash on the deepest visible level only. Failure is `#8A1C0E` for `failed`, `error`,
`stopped` and any `last_error`, and it does not escalate to a parent unless he asks. Values, contrast maths
and the constant block: `hermes-desktop-plugins` § `references/panel-visuals.md` § State colours.

**A bad lane has no messenger.** A failed lane speaks through its colour and one line: the bare `failed:`
plus `last_error` in the card, the red `!` count on its feature and project, and nothing else. There is no
watcher, no unread mark, no delivery button — a backend cannot open a conversation on its own (a keyless
`inject_message` is refused), so an unprompted notice has nowhere to land and adds only a mark nobody reads.
Ilja's rule: "if it doesn't work with delivery in chat, we leave it as we have — I will see if something is
wrong on the lane itself through colour". Do not rebuild the notification channel without a delivery path
the backend owns; the panel's job is that the colour and the reason are RIGHT.

**The right side is one column of cards, and every card is the same shell.** A card is a header strip of
`HEADER_H` with its title in the tree's mono style, then a scrolling body at the tree's own 10-px left edge
(`px-2.5`) — compose cards and placeholder cards alike. A card that brings its own `p-3` on top of a
section's 10 px sits 22 px from the divider while every list row sits at 10, and the user reads that as a
broken layout before he can name it. One `CardShell({ title, children })` keeps all four in line.

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
pi-lane close <lane>              # commit, merge, receipt, then remove worktree, branch and folder
pi-lane close <lane> --no-merge   # close without touching the branch
pi-lane close <lane> --keep       # keep worktree, branch and record
```

One command, six steps in this order:

1. Commits the lane's uncommitted work on `lane/<lane>` as `Lane <name>: <first line of the task>`.
2. Merges that branch into the default branch with `--no-ff`.
3. Appends one receipt line to `$HERMES_HOME/lanes/closed.jsonl`: lane, project, group, branch, state,
   `closed_at`, reason, merge sha and subject, date, files, insertions, deletions.
4. Removes the worktree, the branch and `$HERMES_HOME/lanes/<lane>` itself.
5. Stamps nothing further — read `closed.jsonl` back to confirm the receipt.
6. Leaves the repository's other branches alone.

**The order is the point.** Committing after the merge turns the merge into `Already up to date` on an
empty branch, and the `branch -d` plus `worktree remove --force` that follow then delete the only copy of
the work; the close still prints success. Prove the routine on a disposable repository, not on a lane
holding real work: a repo, a worktree on `lane/probe`, one uncommitted line, a hand-written `lane.json`,
then close it — `git log` must show the lane commit AND the merge commit, and the default branch must
contain the line.

**A closed lane has no folder.** Its journal line is the whole record: `/lanes` and `/lanes/<lane>` serve
it as `archived: true` with the merge receipt, so the `closed` group still lists what was merged as what.
Everything that must survive the close — task, last text, decision — has to be in that line or in git
before `pi-lane close` runs; afterwards there is nothing left to read it from.

## Where the panel lives

The desktop plugin registers **one** pane, `pi team`, tiled into the right sidebar
(`placement: 'right'`, `dock: { pane: 'workspace', pos: 'right', enforce: true }`, 620px). Inside it two
areas sit side by side at fifty fifty — the lane list `flex: '0 0 50%'`, the selected lane `flex: '1 1 50%'`,
both with `minWidth: 0` and `overflow: 'hidden'`, and ONE `border` on the pane root so the frame closes on
all four sides. A fixed 240-px list beside a flexible card measured 122 / 283 in a 405-px pane and read as a
broken layout; the root border is a border, not an inset ring, because an inset ring is painted under the
columns and never shows.

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
empty spot, so the update control is the word `update`. **The list rows carry no interactive glyphs** — Ilja removed the link `+`, the `✓` marker and the
project-focus `»` one by one, and every gesture lives on the detail side; any state a row would mark (this
chat is linked) is already on the right. The rows DO carry level icons, which he asked for: a folder
(closed/open) per project and feature, `icons.Terminal` for a lane, no chevrons — a whole-row click toggles,
and the guide lines hang from the icons. A feature with working lanes shows the four state groups at its right edge while it is closed, and every
working lane runs a ball up its line that ends behind the folder icon. A project row prints the same four
groups, open or closed — the `3 · 2` size pair is gone, and a tag would read as a button in a 10-px row, so
quantity never becomes one. Give both column headers one fixed height
(`HEADER_H`, 28px), or their text size sets their heights and the two `border-b` lines land on different
rows. Draw a shadow as a 3-px gradient strip across the full width (`BAND_H`, `BAND_BG`), never as
`boxShadow`: on a zero- or 1-px-tall strip Chromium paints nothing, and two per-header shadows double up
at the seam the columns share, which Ilja sees as a broken line. The same band goes under a section label
(`TASK`, `LAST MESSAGE`), not onto the block below it — he marks the label line as the place for the
shadow, and a shadow on the block's own border reads as a frame around the text. The blocks keep one
fixed height (`TEXT_H`, 100px) with scrolling inside — a block that grows with the text pushes the fields
below it off screen. Hierarchy rows carry guide lines drawn INLINE, one element per node: `TreeNode` owns the vertical run of
its subtree, `TreeRow` the row plus its elbow (a rounded `╰` box for the last row, a straight `├` tee
above), and both are appended AFTER the row so a selected row's background cannot paint over them. No
No class may carry that geometry — an injected stylesheet does not reach the panel (the one exception is a
`<style>` element rendered inside the pane's tree, used only to hide the native scroll bars; see
`hermes-desktop-plugins` for that rule and for why a scroll area keeps `width: '100%'`).
nesting the children in a `paddingLeft: GUIDE_STEP` box, and a row's highlight starts where the elbow ends
(`marginLeft: 9px`, `width: calc(100% - 9px)`), so every label sits 16px from its level line. Changing the
step, the radius or that 16 moves every level at once: it is one constant, not per-row padding. Put sizes and heights in inline
`style`: the app ships its CSS prebuilt, so a class it never saw in its own source may do nothing, while
an inline value always applies. Keep every one of these numbers in the constant block at the top of
`plugin.js`, so "half that big" or "64 → 100" is one edit in one place. `~/work/pi-team/DESIGN.md` mirrors
that block as tables with the reason behind each number (its first line says it is development-only and
changes nothing at runtime): change a constant and its table in one commit, because the doc is what the
next session reads before it reads the code. Structure and the cross-check rule:
`hermes-desktop-plugins` § Document the visual system. Recipes and the pixel check:
`hermes-desktop-plugins` § `references/panel-visuals.md`.

**Updating a client.** The control at the right end of the `projects` header says `update plugin`; a click
replaces the word with `✕` and `✓` on the same spot (a centred dialog for a two-word decision costs a
round trip and breaks the row). `✓` posts `/update/request`, whose only job is `ctx.inject_message` with
the request in plain words: pull the repo, put each file where it belongs, restart the backend, ship the
panel to every client. The orchestrator then does it. That indirection is the point — the backend knows
this one host's repo path, install paths and service name, while the agent can look at the machine it is
on, so the button works for anyone who installs the plugin. Do not move the work back into the route;
`POST /update` survives as a manual path (`TestClient`, one `steps` row per stage) and the button no
longer calls it.

- **A machine joins the list only after its SSH answers.** Add the entry, then prove it: `ssh <host>
  'sha256sum <path>'` must print the hash the route will write. Until that works the button reports the
  host's error and copies nothing there — a refused port or an unapproved Tailscale check is the whole
  failure, not the plugin.
- Test a new client end to end through the route, not by eye: call `POST /update` with FastAPI
  `TestClient`, then read `steps` — one row per stage (`git`, `local`, each host) with `ok` and `detail`,
  and compare `sha256sum` on the client against the repo. That output is the report Ilja can check.

- The route takes **git's** copy. Commit and push a local edit first, or the button silently reverts it.
- **The route carries the desktop half only.** `plugin/` (the lane API) reaches a gateway by
  `cp -r plugin/* ~/.hermes/plugins/pi-team/` plus the serve restart; the button never touches it.
- **The repo is private**, so `raw.githubusercontent.com` answers 404 to a plain `curl`. A new machine
  gets the files with `gh repo clone iliFalk/pi-team` or through the button, never by a raw URL.
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
| shelf | `handed_at` / `closed_at`: which group the lane sits in; the git hint (`merged into <branch>`, `worktree gone`) is display-only |
| thread | `thread.jsonl`: `{who, at, text}` rows, the lane's own last text drawn as the newest bubble |
| archived | no folder left: the row comes from `closed.jsonl`, the card draws the receipt only |

The backend reads the last 1 MB of `events.jsonl`. Older events do not reach the panel.

## Show the panel without a run

To show the animation without spending a lane, write a simulated record and keep a live PID:

```sh
# ~/.hermes/lanes/<lane>/lane.json: lane, task, project, group, state "running", pid, worktree, branch
# ~/.hermes/lanes/<lane>/events.jsonl: one message_end with an assistant text part and a tool_use part
```

- **The backend trusts the PID.** A record whose process is gone is served as `stopped` whatever the file
  says, so probe `os.kill(pid, 0)` and read `/lanes` back before saying the animation is on.
- **A background process started from an agent session dies with that session.** Re-arm it each time
  (`sleep 7200` through `terminal(background=true)`) and state in the report that it ends by itself.
- Two records in one `group` exercise the feature's `<n> running` indicator; one record shows the mark
  alone. Give the record a real `repo` and a real, EXISTING `worktree` (the repository itself is enough):
  the backend shelves any finished lane whose worktree is absent and reports it as `worktree gone`, so a
  made-up path empties the active tree and the state you meant to demonstrate never renders.
- A second project is how the spacing BETWEEN top-level blocks gets judged: `pi-project add <name> <path>`, two
  features, one `done` record and one `running` record, then read `/lanes` back. It is a real repository on
  disk and a real row in his panel — say where both live, and that the removal is `rm -rf` on the records plus
  the project entry.
- A question is simulatable too: set the record's `state` to `waiting` and write `question.json` beside it
  (`id`, `method`, `title`, `message`, `options` as plain strings, `asked_at`). The panel draws one button per
  option and an answer writes `answer.json`; `rm question.json` clears it without an answer. Prove the payload
  with `TestClient` on `/lanes/<lane>` before telling him to look, and name the two files so he can answer it
  himself.
- A failure is a record with `state: failed`, a non-zero `exit`, and an `auto_retry_start` event carrying
  `errorMessage` in `events.jsonl` — that event is where the panel's `last_error` comes from, so a bare
  `failed` state shows a red word with no reason. Show all three states at once (running, waiting, failed)
  in one panel: a colour is only judged against its neighbours.
- `stopped` reads as a fault in the panel's colours, and the backend re-serves any record whose pid died as
  `stopped`, so re-arm the pid before demonstrating a running row: two dead demo lanes otherwise paint red
  and he reports a fault that is only the fixture.
- Tear the demo down (`state: done`, or `rm -rf ~/.hermes/lanes/<lane>`) so it never reads as real work.

## Review and closed

Two groups sit above the active list, and both stay empty until the orchestrator writes the field that
fills them. There is no git-derived shelf: a merged branch, a missing worktree or a quiet week changes
nothing on a row.

| Group | Field | Meaning |
|---|---|---|
| `review` | `handed_at` | finished and waiting for a check |
| `closed` | `closed_at` | checked, merged, worktree gone |

The git hints (`merged into <branch>`, `worktree gone`) are display-only text on the card and feed no
group. `shelved: true` in `lane.json` is not a flag the backend honours; only `closed_at` is. Fill a field
by hand only for a demonstration Ilja asked for, and clear it afterwards — `/review/send` collects `handed_at`
rows, so a leftover entry ends up in the next queue the button posts.

**A closed lane is one line, not a folder.** `pi-lane close` deletes the record with the worktree, so the
`closed` group is drawn from `$HERMES_HOME/lanes/closed.jsonl` — one JSON object per lane, read into the
list as `archived: true`. An archived row carries the receipt only: no thread, no `to review`, no diff
block, and the card says `record · closed · folder removed, receipt kept`. Never write a route or a card
that expects a closed lane's files to exist.

**Counts exclude both groups.** A lane in `review` or `closed` is counted in none of the four header groups,
so a project whose only finished lane sits in `review` shows no `✓`. Verify the arithmetic from `/lanes`
before reporting numbers to Ilja, and name the rows that were excluded.

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
6. **A lane that touches the panel follows `DESIGN.md`.** The repository ships the accepted numbers —
   spacing, state colours, shadows, line weights — and a lane that invents its own value contradicts
   the panel even when its own tests pass.
6. **The orchestrator merges the branch.** A lane never pushes to the main line.
7. **A waiting lane is not a stuck lane.** Answer it or cancel it; do not open a second lane on the same
   worktree while it waits, and do not report it as finished.

## Pitfalls

- **The runner's run loop is shared by the first run and a continuation.** It lives in `run_session(lane_dir, record, lane, worktree, task, question_timeout)`, which reads `provider`, `model` and `thinking` from the record, so `main()` and `pi-lane continue` behave identically. When you move that block by script, parse before spending a lane: `python3 -c "import ast,pathlib; ast.parse(open(path).read())"`. The block sat inside a `with` in `main()`, so a function needs it DEDENTED by the depth it left; a duplicated assignment at the seam (`text = ""` twice) means the anchor matched the wrong end of the move, not that the code is fine.
- **Prove a runner change with a throwaway lane, not with the panel.** `pi-lane smoke --project <p> --feature <f> "Answer one word: ok. Change nothing." --question-timeout 60` must end `state: done`, `exit: 0`; then `pi-lane continue smoke "one more word"` must print `continuing`, end `done` again and leave MORE lines in `events.jsonl` than the first run. Two states and one line count settle the refactor in a minute; a green syntax check proves nothing about the run loop. Remove the probe lane afterwards (§ probe lane pitfall).
- **Commit before you merge, or the cleanup eats the work.** A lane never commits, so its changes sit
  uncommitted in the worktree; `git merge --no-ff lane/<lane>` answers `Already up to date`, and the
  `git branch -d` and `worktree remove --force` that follow delete the only copy. Every automated close is
  commit → merge → receipt → remove, and it is proven on a throwaway repository with one uncommitted line
  before it points at a real lane.
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
- **"failed to render" is a ReferenceError in `plugin.js`, not a data fault.** One `jsx()` prop naming a
  component or helper that is gone takes the whole panel down with a card that names no line, and
  `node --check` passes because the syntax is valid. Run `node desktop/render-check.mjs` in
  `~/work/pi-team` (it stubs the SDK and calls every component) and fix the name before copying the file
  anywhere. Keep its fixtures rich enough to clear early returns, or the body never runs.
- **A two-column pane needs BOTH columns inline.** The list gets `style: { width: '50%', minWidth: 0 }` and
  the detail side gets `style: { width: '50%', minWidth: 0 }`, with `overflow: 'hidden'` on each column and
  on the pane root; a `min-w-0` class on the flexible side is not enough. A textarea or a long mono name
  sets a min-content width the detail side will not give back, so it takes width from the list — measured
  122 / 283 instead of 202 / 202 in a 405-px pane — and the whole pane then scrolls sideways: the list's
  text starts at x=0 with words cut at the left edge, which reads as a geometry bug and is a flex one.
- **A feature taken back leaves three traces.** Code, the fields it added to a payload, and the data files
  it wrote (`notified.json`, a pid file, a thread flag). Delete all three, restart the backend, then prove
  the removal with `TestClient`: `404` for its route and zero occurrences of its field in `/lanes`. A `curl`
  status proves nothing — auth answers before routing, so 401 comes back for a path that never existed.

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
