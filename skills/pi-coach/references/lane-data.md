# Lane data: the files, the fields, the payload

Read this when you need to know what a file means or what the backend serves. The procedure is in `SKILL.md`.

## Lane status (what the panels read)

## Lane status (what the `pi-team` panels read)

| Field | Source |
|---|---|
| state | `lane.json`: `running`, `waiting` (a question is open), `done`, `failed`, `stopped` |
| question | `question.json`: `id`, `method`, `title`, `options`; the panel draws one button per option |
| last text | last `message_end` with `role: assistant` and a text part |
| last tool | `tool_use` part: name plus the command or path |
| turns, tokens, cost | the same events: `usage.input`, `usage.output`, `usage.cost.total` |
| changes | `git status --porcelain`, `git diff HEAD --stat` |
| specs | every `SPEC.md` of the worktree with `id` and `type`, ordered by the `parent` chain; a dot marks a spec the lane touched |
| shelf | `handed_at` / `closed_at`: which group the lane sits in; the git hint (`merged into <branch>`, `worktree gone`) is display-only |
| thread | `thread.jsonl`: `{who, at, text}` rows, the lane's own last text drawn as the newest bubble |
| archived | no folder left: the row comes from `closed.jsonl`, the card draws the receipt only |

The backend reads the last 1 MB of `events.jsonl`. Older events do not reach the panel.


## Review and closed

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



## The event stream

`$HERMES_HOME/lanes/<lane>/events.jsonl` is unfiltered stdout, and stderr goes to `stderr.txt`.
is unfiltered stdout, so most of its bytes are noise: `message_update` (the answer streamed token by token)
is about 58% of a file, and `agent_end` repeats the whole transcript while `message_start`/`message_end`
repeat each message twice — 72–74% of a 400 KB stream is duplication or streaming. Only `message_end`,
`turn_end`, `tool_execution_*`, `extension_ui_request` and `agent_settled` are worth keeping; a session's
short run already writes ~80 KB, so a lane folder grows fast and the drawer of `events.jsonl` is a
measurement question, not a guess.

## Payload shape

- `/api/plugins/pi-team/lanes` returns the list only; `status` and `spec_tree` arrive on `/lanes/<lane>`.
- The card shows no plan: the backend stopped reading the pi-todos store per lane, so a `plan` key
  anywhere is a stale copy.
- The backend reads the last 1 MB of `events.jsonl`; older events never reach the panel.
- Lane and registry scripts carry no `.py` suffix, so `spec_from_file_location` returns `None` for
  them — load one with `SourceFileLoader(name, path)` plus `spec_from_loader` and call the function.
