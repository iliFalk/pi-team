---
name: pi-coach
description: "Use when running, steering or checking pi lanes (pi-team)."
version: 3.0.2
author: Jarvis (Hermes Agent)
license: MIT
platforms: [linux, macos]
metadata:
  hermes:
    tags: [pi, lanes, worktree, orchestrator]
    category: software-development
    related_skills: [pi-harness, hermes-desktop-plugins]
---

# pi-coach — pi lanes under an orchestrator

The orchestrator opens lanes, steers them and verifies the work. Nobody types into a lane.
A lane is one headless `pi --mode rpc` run on its own worktree, with one record folder and no pty.
Plugin `pi-team` draws lane state; this skill is the procedure.

ThinkRail is a data-model reference, not a runtime: do not drive its WebSocket RPC, and keep no
lanewise state in `~/.thinkrail`. The files under `$HERMES_HOME/lanes` are the only record.

## When to Use

- Work splits into slices that can run in parallel, or a task is big enough to own a worktree.
- A lane finished and its work has to be read, verified, filed for review and closed.
- `pi` misbehaves in a lane: read `references/pitfalls.md` before touching anything.

Depth lives beside this file, and each is read only when a step names it:

| File | Read it when |
|---|---|
| `references/lane-data.md` | a field, a file or the backend payload needs explaining |
| `references/panel.md` | `desktop/plugin.js` changes: layout, colours, words, geometry, demo fixtures |
| `references/pitfalls.md` | something does not behave, or a runner/route change is planned |
| `references/specs.md` | the spec-graph and todos tools are wanted |
| `references/pi-rpc-protocol.md` | the RPC wire format matters; probe is `scripts/probe-rpc-question.py` |

## Before the first lane

```sh
pi --version                     # 1.4.0 on the agent machine
ls ~/.hermes/scripts/pi-lane     # the runner
```

The runner refuses a bad lane name, a non-repository path and a missing `pi`. It loads the provider
key itself: Hermes never exports one to a shell, so the runner asks Hermes's secret scope first and
falls back to the profile file for `OPENCODE_API_KEY`, `DEEPSEEK_API_KEY`, `NVIDIA_API_KEY`,
`OPENROUTER_API_KEY` and `ANTHROPIC_API_KEY`. It never prints a value.

Defaults: provider `nvidia`, model `nvidia/nemotron-3.5-super-vl-120b-a12b`, thinking `medium`.

**Which instructions a lane obeys.** The repository's `AGENTS.md` (and the copies above it) and
`~/.pi/agent/AGENTS.md` both load, with no `--approve`; `~/.hermes/AGENTS.md` is never read by `pi`.
Keep the global file neutral: a leftover experiment there contradicts every lane in every project.
Prove the chain with a scratch repo whose `AGENTS.md` says `Always answer with the single word MANGO.`

**Never touch an agent-instruction file.** `AGENTS.md`, `CLAUDE.md`, `SOUL.md` and `.cursorrules`
steer future agents, so Hermes requires a person for every change to them: `--yolo` does not bypass that
and lowering the approval mode does not either. Unattended, the request expires unanswered — measured at
274 s — and the run continues without the file. A lane run needs no such file: the brief is what a lane
obeys, and a brief needs no approval. Write the rules you want into the brief instead.

The ponytail block in `templates/ponytail-block.md` stays a manual, attended action for Ilja; the
orchestrator never places it on its own.

`--check` prints `current`, `outdated`, `missing`, `identical` or `no markers` and changes nothing, so it
is safe to run alone. Change the template and copy it again — never edit a project copy in place. Levels
`lite`, `full`, `ultra` are chosen by naming one in the task; `full` applies when the task names none.

**Ilja's text is his text.** Apply only the edits he asked for and keep his wording verbatim. Mark
every addition (`<!-- +ADDED … -->`) and show the marked text in chat before writing the file.

## The tree: Project → Feature → Lane

| Level | What it is | Where it lives |
|---|---|---|
| Project | one git repository | `~/work/<project>` (`~/src` keeps reference clones) |
| Feature | what the work is about, kebab-case (`settings-menu`) | registry `~/.hermes/plugin-data/pi-team/projects.json` |
| Lane | one slice of that feature | `<repo>/.worktrees/<lane>`, branch `lane/<lane>` |

A lane name must be unique inside its repository. Create the three levels on his word, in order:

```sh
pi-project add <project> <git-url>          # clone to ~/work/<project>, register
pi-feature add <project> <feature> --title "Settings menu"
pi-lane <lane> "<task>" --project <project> --feature <feature>
```

`pi-project list` and `pi-feature list <project>` show the registry. A throwaway run can bypass it
with `--repo <path>`. The demo fixture `demo` is `~/work/demo-app`: one static page, no build, and
one visible surface per feature — a README-only repository yields an empty worktree.

**Placeholders.** The panel creates the row, the agent finishes it:

| Asked from the panel | What exists at once | What you do |
|---|---|---|
| `+` on a project (feature) | the feature, `state: preparation` | `pi-feature rename <project> <prep-key> <name> --title "…"`, then open the first lane |
| `+` in the tree header (project) | the project with `remote`, `state: preparation` | clone to `~/work/<name>`, then `pi-project add <name> <path>` |

`pireg.py` is the registry's only writer; no route, script or agent edits `projects.json` directly.
A placeholder never has lanes, so dropping it is safe; both `cancel` routes refuse afterwards.
`pi-feature rename` moves lanes already filed under the old key.

## The brief

A lane receives one text: its brief. `templates/lane-brief.md` holds the shape — files, the facts the
lane must not re-derive, the names it must use, what done means, the report format. Budget 2 500
characters; the worked example is 1 698.

Measured on three lanes: briefs of 6–9 KB each, paid as input tokens again by every lane, while half of
each was a restatement of the whole task. A slice brief names its slice and stops:

- **The slice, never the whole request.** The orchestrator read the task; a lane that reads it again
  pays twice.
- **Facts, not exploration.** Runtime, tools, the state of the tree and the commands. Two `ls` calls per
  lane disappear when the brief states what is there.
- **Names, not descriptions.** A contract line is `<symbol> <signature>`. The reasoning stays with the
  orchestrator.
- **The gate verbatim**, so a lane self-checks instead of being re-run.
- **Thinking level by kind of work:** `--thinking low` for docs, compose, config and glue; `medium` for
  code that must reason about existing behaviour.

The runner prints the brief size when it starts a lane and notes anything over 3 000 characters, so a
fat brief is visible in the log instead of only in the bill.

## Lane: open

```sh
pi-lane <lane> "<task>" --project <project> --feature <feature> [--provider P] [--model M] [--thinking L]
```

1. Cuts `<repo>/.worktrees/<lane>` on branch `lane/<lane>`.
2. Writes `$HERMES_HOME/lanes/<lane>/lane.json`: state `running`, task, pid, session.
3. Starts `pi --mode rpc --session-id <repo>-<lane> …` and sends `{"type":"prompt","message":"<task>"}`.
4. Parks every extension dialog in `question.json`, state `waiting`, and relays `answer.json`.
5. Writes `done`, or `failed` when pi exited non-zero or wrote no assistant text.

`--question-timeout SECONDS` (default 1800) cancels an unanswered question. Run several lanes in
separate calls. Two guards fire before the worktree is touched: the same lane name with a live pid in
the same repository is refused (exit 2), and a second lane in one feature is allowed with a note.
There are no lock files — the record and its pid are the truth, and a dead pid means free.

**Phrase the task as an order.** A lane that reads and narrates a plan ends `done` with an empty
worktree. Say "Edit these files now, do not describe a plan" and name the files.

## Lane: wait

```sh
pi-lane wait <lane> [--timeout SECONDS] [--interval 2] [--json]
```

| Code | Meaning | Next |
|---|---|---|
| `0` | `done`, `failed`, `stopped` or closed | read the diff, run the gates |
| `3` | `waiting` — a question is open | `pi-lane answer <lane> "<option>"` |
| `124` | still `running` after `--timeout` | wait again; do not restart the lane |

`--json` prints one object (`state`, `files`, `insertions`, `deletions`, `closed`, `question`), and the
verb prints one line per state change, not one per poll.

Wait on a whole batch with the names you started: `pi-lane wait --all tokens material screens`. It
returns `3` as soon as ANY of them asks a question, `1` if any failed, `0` when all are done, `124` on
timeout. Without names it follows every lane that is still running or waiting.

**Never wait with `sleep`.** It burns no tokens and costs wall time twice over: measured, a three-lane
run spent about a third of its 36 minutes asleep between polls.

## Lane: questions and the files

A waiting lane blocks until `answer.json` appears: `{"id": "<from question.json>", "value": "<option exactly as pi sent it>"}`, or `{"id": …, "cancelled": true}` to skip. Only `select`, `confirm`,
`input` and `editor` are questions; `notify` is fire-and-forget. `Other…` receives typed text as the
value. The panel's `/answer` route refuses an off-list value with `422` and a lane with no open
question with `409`. Field-by-field meaning of every file: `references/lane-data.md`.

## Lane: unattended runs need the approval gate off

A lane needs nobody. The orchestrator in front of it does: every `write_file` goes through Hermes's
approval system, so under `approvals.mode: smart` a `hermes chat -q` run blocks forever on the first
one with `waiting for user approval`.

```sh
hermes config set approvals.mode off     # before
hermes config set approvals.mode smart   # after
```

`--yolo` is not enough: it bypasses terminal-command approvals, not file writes.

## Lane: parallel

Start as many lanes as the work has independent slices, then wait once. Nothing in the runner
serialises them: each lane is its own process, its own worktree and its own branch.

```sh
pi-lane tokens  "<brief>" --project <p> --feature <f> &
pi-lane material "<brief>" --project <p> --feature <f> &
pi-lane screens "<brief>" --project <p> --feature <f>
pi-lane wait --all tokens material screens
```

**The one rule that keeps it safe: disjoint file ownership.** Two lanes may run at once only when
their briefs name non-overlapping files. Worktrees prevent write conflicts, not semantic ones: two
lanes editing the same component or the same token block merge into a conflict, or worse, the second
merge silently replaces the first one's reasoning. A slice that must touch a shared file is sequential
by definition — put it in a lane that starts after the merge.

- Write the file list into every brief ("these files and nothing else"). A lane that wanders outside
  its list makes the boundary meaningless.
- Merge in dependency order, one lane at a time, and re-run the gates after each merge that touches a
  gate input. Two lanes that both change `src/index.css` are a dependency, not a pair.
- Parallelism buys wall time, not money: N lanes read the context N times, so tokens grow roughly
  linearly while the clock does not. Use it when the slices are real, not to look fast.
- A question parks its own lane only. `wait --all` returns `3` for the first one that asks, so answer
  it (`pi-lane answer <lane> "<option>"`) and call `wait --all` again.

## Lane: follow up

A lane owns a `pi` session, so a follow-up is the same conversation with its whole context:

```sh
pi-lane continue <lane> "<next task>"
```

It refuses a closed lane, a lane whose worktree is gone and one still running; it clears `handed_at`,
appends the text to the thread, sets `running` and keeps `provider`, `model` and `thinking`. Never
re-open with `pi-lane <lane> "…"` — that cuts a SECOND worktree and looks like a new lane.

**Ask before continuing.** His note in a thread is a thought, not an order: put the exact prompt in
the question and run `continue` only after his yes.

## Lane: verify

A lane report is not evidence.

```sh
git -C <repo>/.worktrees/<lane> status --porcelain
git -C <repo>/.worktrees/<lane> diff --stat
git -C <repo>/.worktrees/<lane> diff
```

Then run the real gates and record them:

```sh
pi-lane gate <lane> [<lane> …] --cmd "python3 -m unittest discover -s tests" --cmd "npm run build"
```

It runs every command in the **merged tree** — the repository root, not a lane worktree — prints each
command with its exit code and the tail of its output, and on success writes `checked_at` and
`checked_sha` (the merged HEAD) on every named lane, which is what makes the panel offer `CLOSE`.

## Pull, do not push

Nothing in the panel speaks into the chat by default: `plugins.entries.pi-team.allow_gateway_injection`
stays off, so a click changes state and no message arrives. The agent asks for what it needs:

```sh
pi-lane review            # the review shelf, with task, what the lane said, and where to look
pi-lane digest <lane>     # one lane as a record: task, commits, diff size, gate result, leftovers
```

This is the economy that matters: a message in a chat costs a full agent turn with its whole context,
and the same facts cost one call with `pi-lane review`. Keep the record on disk rich — it is what a
later "write a skill from this" reads — and spend tokens on synthesis only when somebody asks for it.

It refuses for a reason worth knowing: a lane whose branch is not an ancestor of HEAD was never
merged, and a gate run next to unmerged work would bless code that is not in the tree. Lanes from
different repositories cannot share one run either.

A lane whose gates were not run does not close.

## Measure a run

A lane run pays two bills, and the second one is easy to forget:

1. The orchestrator's own turns, from the Hermes session in `state.db`.
2. Every lane's `pi` session: `~/.pi/agent/sessions/<cwd-slug>/*.jsonl`, field `usage.cost.total`.

A solo arm has only the first bill. Count the orchestrator alone, and lanes look two times cheaper
than they are: measured on one task, orchestrator $0.088 plus lanes $0.101 against solo $0.098.

Read a token figure only after `exit=0`. A run cut off at minute 13 reported half the bill and all of
its merges, and the unfinished arm looked better than the finished one.

Count the repair rounds per lane (`pi-lane continue`) in the report. One extra round on a single slice
cost $0.06 and seven minutes, and that variance, not the lane model, decides most of the spread.

## Review, close

| Step | Command | Field |
|---|---|---|
| record the check | `pi-lane gate <lane> … --cmd "…"` (or `pi-lane check <lane>`) | `checked_at` + `checked_sha` |
| file for review | `pi-lane hand <lane>` | `handed_at` |
| close (plan) | `pi-lane close <lane>` | prints the plan, changes nothing |
| close (execute) | `pi-lane close <lane> --yes` | `closed_at` |
| close without merge | `--no-merge`; keep the worktree | `--keep` |

**A hand needs a fresh check.** `pi-lane hand` refuses, exit 1, unless `checked_sha` equals the
repository HEAD. The gate records the merged HEAD, so the order is: merge, gate, hand. A commit after
the gate makes the pair stale, and the hand refuses until the gate runs again. `pi-lane check` records
the worktree HEAD, which is not the tree the gates ran in, so a lane with only a `check` cannot be
filed: merge it and gate it.

`TO REVIEW` in the panel writes the same `handed_at` and says nothing; the check is what the queue's
`SEND` asks for, and the panel offers `CLOSE` only while `checked_sha` equals the worktree HEAD — so a
commit after the check hides the button again.

**Not merged is not delivered.** A lane's work lives on its branch until the orchestrator merges it, so
"lane done" means nothing on its own. Before reporting a task finished: merge every lane the task
needed, run `pi-lane gate` over them (it refuses while any of them is unmerged), hand each one, and name
any lane left unmerged instead of counting it as done.

**Show the plan before closing.** Bare `pi-lane close` prints what will be merged and deleted; paste
it into the chat, wait for his go, then run `--yes`. Close commits the lane's uncommitted work on its
branch, merges `--no-ff`, appends one receipt line to `$HERMES_HOME/lanes/closed.jsonl`, and removes
the worktree, branch and folder. Everything that must survive the close has to be in that line or in
git before it runs. The order is the point: commit after merge turns the merge into
`Already up to date` and the cleanup deletes the only copy.

## Lane rules

1. One writer per worktree; never point two lanes at one.
2. Open lanes through the runner — a hand-made `pi` run leaves no record and cannot be shown.
3. Keep `--session-id` stable; a follow-up depends on it.
4. Keep one `in_progress` item in the plan. A step is a task, not a thought.
5. The writer never accepts its own work; the orchestrator verifies in the main session.
6. The orchestrator merges the branch; a lane never pushes to the main line.
7. A waiting lane is not a stuck lane: answer it or cancel it, never report it as finished.
8. A lane that touches the panel follows `references/panel.md`; an invented value contradicts it
   even when the lane's own tests pass.

## Pitfalls that cost the most

- **Commit before you merge, or the cleanup eats the work** — a lane never commits, so its work sits
  uncommitted and `merge` answers `Already up to date`.
- **`pi` in RPC mode is a server**: it does not exit after `agent_end`; break on the event, drain the
  pipe, then terminate the child.
- **`pi` exits 0 when the provider never answered** — trust the runner's `failed`, not the exit code.
- **The backend is imported once at `hermes-serve` start**: an edited `plugin_api.py` needs a restart,
  and the session runs inside it, so schedule it and say the window reconnects.
- **A refused write is not a no-op — it becomes a lie in the brief.** One orchestrator's protected-file
  write expired unanswered and it kept going, telling its lanes the repository held that file. After any
  write that can be refused, read the tool result before building facts from it.
- **A probe lane is a live row in his panel**: remove the worktree, prune, close with `--no-merge
  --yes`, and confirm zero lanes before calling the panel ready.

The rest — runner edits, route testing, panel rendering, shipping to another machine — is in
`references/pitfalls.md`.

## Verification

- `lane.json` names `done` or `failed`, never `running` after the run.
- `done` is not proof: `status --porcelain` must show edits, not an empty worktree.
- A lane that asked shows `waiting` with `question.json` and returns to `running` when `answer.json`
  lands; still `waiting` after the run means the answer channel is broken.
- The project gates ran as commands, and their output is attached to the report.
- `pi-lane list` shows the shelf you expect: `review` after `hand`, nothing closed without `--yes`.
