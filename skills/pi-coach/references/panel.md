# The pi-team panel: what it draws and how it is built

Read this before changing anything in `desktop/plugin.js`. The procedure an orchestrator follows is in `SKILL.md`; this file is the panel's own contract — layout, colours, words, geometry and the demo fixtures.

## The lane card and the thread

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

**The thread names its speakers above each bubble.** A `5px` dot and the word: honey `#A97D14` `user` (he moved his own words off the running green), blue
`#0762B4` the agent, pi `#76B900` (his hex, the NVIDIA green) — lowercase, in the same half-hue tone a state word uses. The agent's
word is NOT a constant in the panel: `_lane_entry` carries `agent`, read by `_agent_name()` from the identity
line of `$HERMES_HOME/SOUL.md` (`You are <Name>`), so a rename needs no code change. **A message is TEXT, no box.** No ring, no fill, no mono: the dot and the word above carry who spoke, and the
band's height plus 4 px of side padding keep the messages apart. Three frames were tried and dropped —
`ASK_COLOR` at 70 % and 85 % transparent (invisible, 1.11:1), the speaker's hue at 85 % (green and blue 4.62 /
4.21 on his light panel, ochre only 2.75). What he CHOSE from four priced options is a `2px` bar on the LEFT in
the speaker's hue, and no ring: the bar identifies, it never carries text, and a ring plus a bar cuts the bubble
into two frames. "No outline" in his wording means no ring — the bar stands, so do not strip it again without
his word.
The dot and the word above the bubble carry who. Three `who` values exist: `user` (the panel's composer),
`jarvis` (only `pi-lane say`), `lane` (drawn from `last_text`, never written into `thread.jsonl`).

**Show the plan before closing.** `pi-lane close <lane>` prints what will be merged and what will be
deleted (worktree, branch, lane folder) and does nothing else; only `--yes` carries it out. Run the bare
form, paste the plan into the chat, wait for his go, then run it with `--yes`. A close commits the lane's
uncommitted work on its branch first, merges, writes one receipt line into `lanes/closed.jsonl`, and
deletes the worktree, the branch, the folder and the lane's own `pi` session under
`~/.pi/agent/sessions/--<worktree path, slashes as dashes>--`.

**The card is a thread per lane.** `to review` on the card queues the lane (it stays visible as
`in review`, never disappears — a control that vanishes once it worked reads as a missing feature); the
`send` on the review row, after its tick, puts the whole queue into the chat. `close` appears on the card
ONLY on a CHECKED lane (`lane.checked`, computed as `checked_sha == worktree HEAD`): handing over is not
enough, because a merge nobody read follows. A condition on the state alone (`done`, `stopped`, `failed`)
put it on every finished lane, and a condition on `handed_at` put it on work that was never opened — the
field that decides is `checked`, written by `pi-lane check <lane>` (§ The shelf, then the check, then the
button). A message Ilja writes in a
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
and the stored rows under it, so the same words never appear twice. **The thread is a ledger of SPEECH and
nothing else**, which is the whole answer to "which messages can be there?": three authors — `lane` (pi's
own last text, read from `events.jsonl` and never appended to the thread), `jarvis` (written only by
`pi-lane say`), `user` (written by the panel's composer, which also injects into the chat). A lane's
question lives in `question.json`, its tool calls and turns in `events.jsonl`, and the orchestrator's chat
replies reach the thread ONLY through an explicit `pi-lane say` — never promise a mirror that does not exist.

**The shelf, then the check, then the button — in that order.** `TO REVIEW` sets `handed_at` and the card
reads `in review` (the action slot is empty: the word carries the state). The check itself is recorded by
`pi-lane check <lane>`, which writes `checked_at` and `checked_sha` (the worktree's HEAD); the card then reads
`reviewed` and ONLY THEN does the `CLOSE` control appear. The backend computes `checked` as `checked_sha ==
current HEAD`, so a commit after the check puts the lane back to `in review` and hides `CLOSE` again — the
button can never close work that was not read. Run `pi-lane check <lane>` as the last step of every check,
after the gates pass, and say so in the report.

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

**The STATE heading carries the action between the word and the state.** One line, three things: `state`, the state word, then the action — the word comes BEFORE the button (`done` then `TO REVIEW`). **A click only asks:** the word is replaced by `✕`/`✓` in the same spot and only `✓` posts; `CLOSE` does the same inside its own row. The heading's right group reserves `CONFIRM_BOX` (24 px) in every state, so the row keeps its height when the ✕/✓ pair replaces a 16-px word — he notices the growth at once. Two traps: the `ask` flag is a hook and must sit ABOVE the early returns (below them React drops the whole card and the pane renders empty — a mutation test caught it within one run), and the pair is the existing `HeaderControl` idiom (`✕` in `BAD_TEXT`, `✓` in `RUN_TEXT`), not a new dialog. The action slot holds a `16px` bordered word — `to review` — and ONLY while the lane is untouched; once it
is handed the slot is EMPTY, because the shelf belongs in the state word itself: `in review` in the ask
tone, `reviewed` in the running tone, the run's own state in its own tone otherwise. A message in the button
slot reads as a control he can press, and he asked for it to stop looking like one — it keeps its mixed
case (`normal-case`), because the heading is uppercase. `close` stays the full-width `24px` row below,
because two words cannot share a 290-px heading. He drew both arrows into the gap between the label and the state word; a control on its own row below reads as a second area.

**`STATUS` is five rows at most, and its own numbers are the whole readability answer.** A row is `15px` with a
fixed height and the padding inside it (`boxSizing: 'border-box'`, inline `padding: '0 10px'` — an arbitrary
`py-[1.5px]` is not a utility the build is known to carry), and the VALUE takes `--ui-text-primary`: secondary sat
one step under its own label and he reads the block as grey. One fact per row: `commit` carries the short sha AND
the date, the receipt's `diff` and the card's `changes` are never drawn together (same numbers twice). **Three rows
he removed by name:** `branch` (always `lane/<the card's own title>`), `into` (always `Merge lane <that same
title>`), `tool` (the last tool call, which the last message already narrates). Never re-add one as "useful
information": each repeats what the header or the bubble above says. Measured: `5` rows / `75px` with a receipt,
`4` / `60px` without, against `10` / ~`190px` before. What is left is `commit`, `diff`, `changes` (only when no
receipt exists), `turns`, `tokens`, `error`, plus `why`/`stderr` of a lane that ended badly.

**The gear beside `+` opens the settings screen, and that screen takes the app's own theme.** A `Settings`
icon at `11px` in an `18 × 18` box, `8px` from the `+`; a click swaps the right column for the screen, and a
click outside closes it and opens the thing that was clicked — never a modal over the panel. Rows are FLAT:
name, masked field, `SAVE`, and one plain `1px` rule between rows; he removed every small shadow and divider,
and the gradient band is skipped while the screen is open. No mode switch and no panel palette — the panel wears
the app theme, and a light/dark toggle inside it was deleted on his word. The key list is FIXED —
four providers, each labelled lowercase with `_API_KEY` stripped and `_` read as a space (`openrouter`,
`opencode go`, `deepseek`, `nvidia`) — plus whatever a person already added
(`extra_keys` in `settings.json`), never the whole `~/.hermes/.env`: TAVILY, PODCAST and MINIMAX appeared there
and he took them out, and a list that mirrors the file invents entries nobody manages in the panel. `POST /settings/key`
writes mode `0600`, an empty field deletes, and NO route returns a value — the panel shows a mask or `set`, and a
route that echoes a key is a leak whichever client asks.

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

**The lane card is FOUR parts, and everything but the diff and the specs is a STATIC HEAD.** A
`div.flex.h-full.min-h-0.flex-col` carries: the fixed header (`HEADER_H`), then the head — `STATUS`, `SESSIONS`,
`STATE`, then the ask block LAST (he moved it below `STATE`; one full-width `24px` row per answer, `dismiss` last
without a frame), then `TASK` (its own `TASK_H` window with an inner scroll) — closed by a `1px` rule, then the
`Scroller` holding only `diff` — itself a window of the same `TASK_H` with its own scroll, so the pair reads as
one — and `specs`, then the THREAD block. Each of those four sections was
asked for and moved up there in its own round; a section that drifts back into the scroller is the defect he
circles next. The thread never scrolls with the body: its bubble list grows upward and its composer sits at the
card's bottom edge, which is where the app's own composer sits. With the thread inline in the scroller the
composer floats mid-panel and he reports it as "not the same alignment as the Hermes input field".

**A divider belongs to ONE side, and an empty body must not carry padding.** The head ended in `border-b` and the
thread block began with `border-t`, so with a zero-height body the two rules sat `2px` apart under an `8px`
`pb-2` — he circled that and asked "what is this empty narrow line?". Drop the padding and let ONE element draw the
rule: the head keeps no bottom border, the block below keeps its top one, and a Section that really does sit in
between opens with its own `border-t` (`first: false`), so the seam is never lost. Gray either way is the same
defect: two adjacent `1px` rules and any padding on the empty body read as an empty strip, not as a divider.

**Everything but the thread is LOCKED; the thread pays for the card's height.** The head (question, `STATUS`,
`SESSIONS`, `STATE`), the `TASK` window and the `DIFF` window are all `flexShrink: 0` and keep their height
(`TASK_H`, `49px`), and the body that holds `TASK`/`DIFF` is `flex: 0 0 auto`. The THREAD is the only part that
flexes (`flex: 1 1 auto`, bubble area `minHeight: 0`): it grows when the card has spare room and gives it back
when the card is short. **Do not give a window a shrink weight to buy space** — that was the earlier design and
it made `DIFF` slide up and down as the card changed height ("the area DIFF is still moving; it must be lock
up"). Two failures are on record: a head that shrank AS A WHOLE moved the rows above the thread, and a column
that was wholly `shrink-0` overflowed the card so `overflow: hidden` ate the composer's border and air (the
bottom padding complaint; measured `181 / 121 / 21` px past the panel's edge at card heights `360 / 420 / 520`).
Verify three things at card heights `820 / 640 / 520 / 420`: the `DIFF` heading's `y` is identical, both windows
measure `49`, and only the bubble area changes (`387 / 207 / 87 / 8`). Under about `500px` of card the thread is
already `0` and the composer clips — the floor of this layout, not a bug to hunt.

**The model is a CHIP INSIDE the field, under the writing, and the record is the truth.** TWO shapes, and he checks the jump every time — breaking it once cost a round ("our chat logic is now broken"). The writing keeps `4px` of air above the chip, and a click ANYWHERE in the box focuses the field: put that handler on the box ELEMENT, never inside its `style` (React ignores it silently, the click does nothing, and only a probe that clicks and reads `document.activeElement` catches it). **One line:**
a column (writing, then the chip) that stops at the button, `SEND` at the right centred against both rows;
the button's vertical middle is the box's middle, the chip's right edge is the button's left edge. **The line
reached the button:** the writing takes the whole box ABOVE it and the chip and the button share the row
under. The test reads the line's UNWRAPPED width against the room beside the button — never the chip's width
(the chip is under the writing) and never the layout's own numbers, or it flips per keystroke. The box is `57px` at rest (`42` of the app's field plus `COMPOSER_EXTRA_N 5 + 10` he dragged the top edge up; `justifyContent: center` keeps the button on the box's middle and the extra height lifts the top edge only). The chip is
`18px` on `--ui-bg-tertiary`, radius 4, `px-5`, mono `0.625rem`, `flex: 1 1 auto` INLINE with `min-width: 0`
(a class alone is not enough if the sheet trims it) and an inline ellipsis, or the name wraps onto two lines.
Its label is the catalogue's display name, else the id with the provider prefix cut. A click opens the
chooser above the box (`search id or name` + `set` + seven rows); `set` posts `provider` and `model` into
`lane.json`. Proven in the real component: box `57px` at rest (field bottom + `4` = chip top), field `230` wide
beside the button and `280` wide above it, chip ending at x `245.1`, `SEND` at `249.1` with its centre on the
box's centre.

**A control he names "like the Hermes input field" copies the app's own element, measured.** The rule and the
numbers — `42px` outer, radius `4px`, accent border, the panel's own surface, the air around it, the input
filling the whole shape — are in `hermes-desktop-plugins` § `references/panel-visuals.md` § The composer of a
pinned thread. Measure his screenshot rather than choosing a value: a thin `h-6` strip inside a padded row is
what he circles as wrong, however correct the row's own numbers are. The field inside is a `textarea`
(`rows: 1`) in ONE column, and that column sits beside the button: the writing on top, the model chip under
it, `SEND` at the right centred against BOTH rows (§ the chip paragraph). The writing wraps in place while the button
stands beside it; the moment its line would reach the button it takes the whole box ABOVE it and the chip and the
button share the row under — that jump is his, do not remove it to tidy the column. `SEND` is `32px`, caps, `px-2`. The writing's room is the box's inner width minus
the `SEND`'s column, the ONE gap and the field's own padding — the chip has a row of its own and must not be
subtracted, or the writing wraps at a length that still fits. Measure that room from the BOX, never from the
field (a field-relative width answers the layout it decides and oscillates — he rejected that with
"прыгало"), and never from the last line's width. `Enter` sends, `Shift+Enter` breaks
the line; the field grows upward with no ceiling and no scroll bar of its own. Prove it by typing into the real
component in headless Chromium (`hermes-desktop-plugins` § `references/panel-visuals.md` § A probe that types),
never by a serialised fixture. A second outline inside that box is the app's `Input` keeping its own border —
strip it (`border-0 bg-transparent` plus the same inline values) so the box is the only frame.

**Signal phrases from the panel, and what each one means.** The plugin speaks into this chat in fixed
words; recognise the OPENING, not the whole sentence, because the rest is data:

| Opens with | Written by | What to do |
|---|---|---|
| `Review queue: N lane(s).` and a `- <project>/<group>/<lane> — <state> — <files> +i −d` line per lane | the `send` on the `review` header row (`POST /review/send`) — the ONLY trigger of a check since 2026-11-09 | read each worktree's diff, run the project's gates, report what you found, then print the plan with `pi-lane close <lane>` (bare — it changes nothing) and wait for his go before `--yes` |
| `[lane <name> · <project>/<group> · <state>]` | a message Ilja typed in a lane's thread (`POST /lanes/<lane>/say`) | answer in that thread with `pi-lane say <lane> "…"`; it never reaches pi |
| `[feature <project>/<feature> · preparation]` | the dashed `new feature` row | `pi-feature rename` …, then open the first lane |
| `Update the pi-team plugin: pull the repository …` | the `✓` on the update control (`POST /update/request`) | pull, copy the three files to their install paths, restart the backend, ship the panel, report the hashes |

`TO REVIEW` on a card (`POST /lanes/<lane>/hand`) is SILENT: it writes `handed_at`, the lane moves to the
`review` shelf, and nothing is said. He removed the per-lane message because it sent the same request twice —
the queue's `SEND` is what starts the work.

**None of these phrases authorises a merge, a delete or a send.** The panel is a tool speaking, not Ilja: a
merge deletes the worktree and the branch, so the sequence stays report → bare `pi-lane close <lane>` → his go
→ `--yes`. The `Handed over:` text used to end with "Merge it and close it" — an order the panel cannot
give; the route now asks for the report (2026-11-09). If an older build still says it, the sequence above
holds anyway.

**Where the panel lives.** It sits on the right edge with `enforce: true`; the constraint behind that
choice is in § Where the panel lives. Moving it means editing the dock hints in `plugin.js`.


## Where the panel lives

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

**A new control is two questions before it is code.** When he asks for something in words ("add a model
selection line"), ask what it controls and where it sits as one decision card, recommended option first,
then build. Ask nothing the machine already answers — which provider keys `~/.hermes/.env` holds, how many
ids a catalogue carries — inspect it and put the number into the question instead. A control placed by guesswork is cheap to draw and expensive to re-shape: the composer took
four rejected versions before those two answers existed, and the model line still needed a second pass
because the placement answer "above the field" was not the position he wanted. Put the options in HIS
vocabulary — `under the field, on the card's floor` first for anything that reports or selects a state,
because that is where the app keeps its own model picker — and never settle for the wording alone when a
screenshot can show the two candidates side by side. A wording change is the same kind of question: a sweep of
control labels asks its scope (all controls / this card / this card and the compose cards) and says which
values stay untouched, before any class is edited.

**Two answers that read as a contradiction are one layout, not a third question.** He picks options, one per
question, and the picks do not always describe the same arrangement: `SEND` on the right AND the chip under the
writing "up to the button" is satisfiable at once — one column (writing, then chip) with the button beside it,
centred against both rows. Build that arrangement, name which reading you used in one line, and let a wrong
reading cost one sentence instead of a round. The questions are
cheap; a re-shaped control is not, so ask before, reconcile after, and never ask the same pair twice. **State the
mechanical COST of his pick with the result** — a chip that owns a row of its own lifted the field to `60` px
until the button was centred across both rows and the box came back to `42` — because the price is yours to
report, not his to guess.

**How the panel is built.** Label a control with a word, not a glyph: at 10 px a pictograph can read as an
empty spot, so the update control renders the word `UPDATE PLUGIN`. The source keeps the literal lowercase and
the class carries `uppercase`, because **a word he can press is caps and a word that only reports keeps its own
case**: `in review` stands where the `to review` button stands and stays a sentence, while state words, names,
model ids, pi's own option strings and field placeholders keep theirs (a transform on a field changes what he
types). He asked for one rule on the whole panel instead of per-control choices, so a sweep of a shared control
class must exempt the status word that borrowed it (`STATE_ACTION_CLASS` derives from `STATE_CONTROL_CLASS` for
exactly that). Sweep by measurement, never by reading the class names in the source, and quote the table:
`hermes-desktop-plugins` § `references/panel-visuals.md` § Word case: a control is caps, a message is not. **The list rows carry no interactive glyphs** — Ilja removed the link `+`, the `✓` marker and the
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
fixed height (`TASK_H`, measured `49px` on both the `TASK` and the `DIFF` window) with scrolling inside — a block that grows with the text pushes the fields
below it off screen. **The card's height is one strip's job:** the `TASK` window pays, nothing above the thread moves (§ above). Hierarchy rows carry guide lines drawn INLINE, one element per node: `TreeNode` owns the vertical run of
its subtree, `TreeRow` the row plus its own level segment and tick, and both are appended AFTER the row so
a selected row's background cannot paint over them. **No elbows and no `├`/`╰` glyphs** — a straight
vertical plus a one-pixel stub is what Ilja accepts; once every branch curves, the rows stop reading as
one tree. Every stroke is a BORDER (`border-left` for a spine, `border-top` for a tick), never a 1-px
background box: at a fractional display scale a background box paints on two device rows, so the ticks look
twice as thick as the spines they hang from. The tick starts on the spine's OWN column — one CSS pixel to
the right leaves a one-device-pixel hole at every corner on his display. Rules, measurements and the
corner trade-off: `hermes-desktop-plugins` § `references/hairline-geometry.md`. Derive `ICON_CENTER`,
`LINE_X` and the stub width from `ROW_PAD` and `GUIDE_STEP`; hand-written copies survived a `ROW_PAD`
change and put the spine 4 px off the icon centre. No
No class may carry that geometry — an injected stylesheet does not reach the panel (the one exception is a
`<style>` element rendered inside the pane's tree, used only to hide the native scroll bars; see
`hermes-desktop-plugins` for that rule and for why a scroll area keeps `width: '100%'`).
nesting the children in a `paddingLeft: GUIDE_STEP` box, and a row's highlight starts where the elbow ends
(`marginLeft: ROW_PAD`, `width: calc(100% - ROW_PAD)`), so no highlight swallows its own connector. Changing the
step, the radius or that 16 moves every level at once: it is one constant, not per-row padding. Put sizes and heights in inline
`style`: the app ships its CSS prebuilt, so a class it never saw in its own source may do nothing, while
an inline value always applies. A shared control (`HoverBox`) spreads its remaining props (`...rest`), and
that spread is load-bearing: a component that destructures a fixed prop list drops every `data-*` without a
word, so a probe anchored on one reports `0 rows` and `null` rects on a panel that renders seven. Keep every one of these numbers in the constant block at the top of
`plugin.js`, so "half that big" or "64 → 100" is one edit in one place — **and carry a DERIVED number as its
arithmetic, not as the result**: `COMPOSER_EXTRA_N = 5 + 10` records the two rounds he asked for,
`TASK_H = Math.round((100 - 30) * 0.7)` records which two instructions produced it, while `57` and `49` record
nothing and the next "10 px more" then costs a search through the file. `~/work/pi-team/DESIGN.md` mirrors
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
on. The plugin has **no update route of its own**: a catalog install is pinned to one commit, and a
plugin that replaces its own files breaks that pin. Pull by hand, copy, restart.
- **A written file is not a shipped file.** `sha256sum` both sides and put the expected value in the
  reply — the repo, `$HERMES_HOME/desktop-plugins/pi-team/plugin.js` on the window machine, and the copy
  the backend imports.
- **An unreachable client makes his screenshots describe the PREVIOUS build.** Keep committing while `ssh
  <host>` times out, but say in every reply which sha the repo holds and which one the client holds, and read
  a correction that repeats an already-fixed defect as a delivery question first: the window is drawing the
  copy it has, so re-fixing it moves the code away from what he described.
- **The desktop half and the backend half ship separately.** `dashboard/` and `plugin.yaml` reach a
  gateway by a copy into `~/.hermes/plugins/pi-team/` plus the serve restart; `desktop/plugin.js` reaches
  the app's plugin folder. One install of the catalog entry does both.


## Show the panel without a run

## Show the panel without a run

To show the animation without spending a lane, write a simulated record and keep a live PID:

```sh
# ~/.hermes/lanes/<lane>/lane.json: lane, task, project, group, state "running", pid, worktree, branch
# ~/.hermes/lanes/<lane>/events.jsonl: one message_end with an assistant text part and a tool_use part
```

- **The backend trusts the PID.** A record whose process is gone is served as `stopped` whatever the file
  says, so probe `os.kill(pid, 0)` and read `/lanes` back before saying the animation is on.
- **Hold the pid with a transient unit, not with a background shell from the session.** A process started
  by `terminal(background=true)` dies with that session, and the backend then re-serves the row as
  `stopped` — red work that never ran. Start a unit that outlives you and take its pid:

```sh
systemd-run --user --unit=pi-demo-<lane> --collect /bin/sleep 21600
systemctl --user show -p MainPID --value pi-demo-<lane>    # that number goes into lane.json
systemctl --user stop pi-demo-<lane>                       # the demo's own end, named in the report
```

  `--collect` removes the unit when it stops, so hours of green rows leave nothing behind and the report
  can name the exact command that ends it.
- **A demo never appends to `closed.jsonl` without a copy.** That file is the ONLY record of closed lanes —
  `pi-lane close` appends one line and nothing ever rewrites it — so a hand-written receipt outlives every
  folder teardown and shows in the `closed` group as work Ilja merged himself. `cp closed.jsonl
  closed.jsonl.bak` before, `mv` it back after, and say in the report which file held the fixture.
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
  `failed` state shows a red word with no reason. Show every state in ONE project, side by side
  (`running`, `waiting`, `stopped`, `failed`, `done`, one `handed_at` row, one `closed_at` row): a colour,
  a count and a hover are judged against their neighbours, and one project makes the four header groups
  sum in a single read. Read the payload back (`list_lanes()`, or `TestClient` on `/lanes`) and quote the
  counts — `? 1 ! 2 ⚙ 2 ✓ 1` — before telling him to look, because a record the backend shelves
  (`worktree gone`, dead pid) silently moves between groups and the row he checks reads wrong. Keep the
  `review` and `closed` rows out of those numbers: both groups count nowhere.
- `stopped` reads as a fault in the panel's colours, and the backend re-serves any record whose pid died as
  `stopped`, so re-arm the pid before demonstrating a running row: two dead demo lanes otherwise paint red
  and he reports a fault that is only the fixture.
- Tear the demo down (`state: done`, or `pi-lane close <lane> --no-merge --yes`) so it never reads as real work.



## Feature ↔ session link

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

## What a lane's pi already carries

Web access needs no setup: `pi-web-access` (nicobailon) is installed as `npm:pi-web-access` in
`~/.pi/agent/settings.json`. Workflow skills for lanes live in `~/.pi/agent/skills/`:
`writing-specs`, `brainstorming`, `shipping-a-pr`, `setting-up-a-project`, `importing-a-codebase`,
`asking-user-questions`.

## The demo fixture

**The demo fixture is a small working app, not a hello-world fork.** `demo` is `~/work/demo-app`: one static
page (`index.html`, `app.js`, `styles.css`), no dependencies, no build, started with
`python3 -m http.server 8080`. A lane needs something to change — a repository whose only file is a README
yields an empty worktree and a panel that looks broken. Give the fixture one visible surface per feature so
a task names a file, and check the diff after the first lane lands.

## Probing a decision the component takes IN an event

A fixture rendered once cannot show it: a height or a shape chosen in `onInput` is written by React
state after the key arrives, so the probe needs the real React and a typed key. The reverse step —
typing a short text back — is the assertion that catches a shape which never returns.
