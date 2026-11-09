---
version: 1
name: pi-team
description: >-
  Visual system of the pi-team panel. Development reference only: nothing here ships to a user,
  and the panel keeps every value inline at runtime.
colors:
  running: '#1A6543'
  question: '#0762B4'
  question-outline: '#044A8A'
  question-fill: 'rgba(7, 98, 180, 0.85)'
  question-fill-soft: 'rgba(7, 98, 180, 0.18)'
  bad: '#8A1C0E'
  running-text: 'mix(#1A6543 50%, var(--ui-text-primary))  — 7.1:1 on the surface'
  question-text: 'mix(#0762B4 50%, var(--ui-text-primary))  — 7.3:1'
  bad-text: 'mix(#8A1C0E 50%, var(--ui-text-primary))  — 5.9:1'
  done: 'var(--ui-text-tertiary)'
  label: 'var(--ui-text-tertiary)  — 5.9:1; the old quaternary measured 3.4:1'
  stroke: 'var(--ui-text-tertiary)'
  border: 'var(--ui-stroke-secondary)'
  text-primary: 'var(--ui-text-primary)'
  text-secondary: 'var(--ui-text-secondary)'
  text-tertiary: 'var(--ui-text-tertiary)'
  text-quaternary: 'var(--ui-text-quaternary)'
  hover-paint: 'var(--chrome-action-hover)'
  control-hover-fill: 'var(--ui-bg-tertiary)'
  control-hover-text: 'var(--ui-text-secondary)'
spacing:
  row-side: 10px
  row-vertical: 6px
  header-vertical: 4px
  header-height: 28px
  gap-project: 4px
  gap-feature: 4px
  tree-step: 18px
  band-pad: 4px
  header-band: 16px
  tree-end-pad: 10px
typography:
  micro: 0.5625rem
  label: 0.625rem
  body: 0.6875rem
  name: 0.8125rem
  mono: 'ui-monospace, and the text-[0.6875rem] size'
radius:
  band: 4px
  control: 4px
  pill: 999px
shadows:
  # SOFT_SHADOW exists in the file but nothing paints with it today: the panel uses bands.
  unused-box-shadow: '0 2px 4px -2px rgba(0, 0, 0, 0.55)'
  band: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0))'
  band-height: 4px
  project-sep: 'two 1px lines: quaternary at 35% above, black at 45% below'
lines:
  border: 1px
  outline: 0.5px
  guide: 1px
  guide-opacity: 0.7
  tick-opacity: 0.7
  contrast-floor: '4.5:1 text, 3:1 graphics, against the panel surface'
  panel-frame: 1px
motion:
  poll: 3000ms
  gear-spin: 1800ms
  ball-run: 2400ms
  pill-fade: 1000ms
  pill-fade-after-drag: 700ms
---

# pi-team design system

**This file is for development only.** It decides how the panel looks and why; it changes nothing at
runtime and is not shown to a user. Every value below lives in `desktop/plugin.js` and is applied
inline — this document is the single place that explains the numbers, so a change happens in one
place and nobody has to guess what 4 px meant.

## The constraint that shapes everything

The panel is not a page. It renders inside the Hermes desktop app, whose stylesheet is built ahead of
time from the app's own classes. Two consequences:

1. **Geometry, colour and shadow go inline.** A utility class that the app never used may not exist in
   its build, and a missing class fails silently — the element simply keeps the default.
2. **Checked before use.** `h-full`, `min-h-0`, `min-w-0`, `flex-1`, `flex-col`, `overflow-hidden`,
   `overflow-y-auto`, `w-full`, `shrink-0` and arbitrary values such as `text-[0.6875rem]` were
   verified present in the app's built CSS. Anything not on that list goes inline.

One exception: a `<style>` element rendered inside the panel does reach the document, and its
class-scoped rules beat the app's global ones. That is how the scrollbars are hidden.

## Colour

Three states, each with one meaning. Nothing else in the panel is coloured.

| State | Colour | Where it appears |
|---|---|---|
| `running` | fill/outline `#1A6543`, words `mix(#1A6543 50%, primary)` | the dot, the ball and the row outline keep the hex; the word, the gear and the count take the text tone |
| question (`waiting`) | `#0762B4` at 85%, solid while hovered | the whole lane row, white text on it |
| question, gentle | `#0762B4` at 18%, at 28% while hovered | the label band of the feature and the project above the lane |
| `failed`, `error`, `stopped` | fill/outline `#8A1C0E`, words `mix(#8A1C0E 50%, primary)` | the outline keeps the hex; the word, the count, the reason and the stderr block take the text tone |
| `done` | `var(--ui-text-tertiary)` | the tick and its count only |

Rules:

- **Contrast is a measured number, not an intention.** Text floor 4.5:1, a graphic floor 3:1, both
  against the surface the thing is drawn on. The hexes above are FILL colours; written as words on the
  panel's own `#171715` they measured `failed` 1.9:1, `running` 2.6:1, `?` 2.9:1 — dark paint on a dark
  surface. A word therefore takes half its state and half `var(--ui-text-primary)` (5.9 / 7.1 / 7.3:1)
  while fills, outlines and the ball keep the hex. The same rule moved every label and counter from
  `--ui-text-quaternary` (3.4:1) to `--ui-text-tertiary` (5.9:1) and the tree's guides from quaternary
  at 45% (1.65:1) to tertiary at 70% (3.5:1).
- **White on the question fill must stay readable.** At 70% it is 3.5:1, at 85% it is 7.4:1. Do not
  lower the fill without re-measuring. A question row's snippet is white at 82% (5.5:1 on the fill).
- **Counters climb to the deepest visible level.** A project always sums its lanes; a feature sums
  only while it is closed. `!` beats `?`, so a failed lane is never hidden behind a question.
- **A painted band still answers the pointer.** A question's wash used to win the style branch, so the
  one row that carries news was the only row that ignored a hover. Hover deepens the same hue
  (`18% → 28%`) and lifts the label to `var(--ui-text-secondary)`; the label's contrast against that
  band goes from 2.2:1 to 5.3:1 rather than falling with the deeper paint. Every header row brightens
  its label on hover for the same reason the band's control does: one gesture, one meaning. A LANE
  follows the same rule from the other side: plain lanes take the ordinary hover fill, and a question
  lane — already solid blue at 85% — goes to the solid hue, which lifts white on it from 4.6:1 to
  6.2:1. A fill that is already painted cannot be answered by painting under it.
- **App tokens, not hex, for text and lines.** `var(--ui-text-quaternary)` for a guide, because a
  border-toned line disappears on a highlighted row; `var(--ui-stroke-secondary)` for real borders.

## Typography

| Role | Size | Notes |
|---|---|---|
| Project and feature labels | `0.625rem` | uppercase, wide tracking, tertiary — quaternary measured 3.4:1 |
| Lane name | `0.6875rem` | monospace, `0.625rem` for its snippet |
| State word | `0.625rem` | coloured by state, never bold except a question |
| Counters | `0.625rem` | one sign per state |
| Receipt numbers | `0.6875rem` | monospace, right aligned |
| Header control label | `10.5px` | `SEND` in a project, feature or review band; the `✕` and `✓` that replace it are `12px` |
| Badge | `0.5625rem` | the only place this size is allowed |

No weights beyond regular and medium. A question row uses `font-medium` on the name only.

## Spacing

One rhythm, ten pixels, on both sides of a row and at the ends of the tree.

| Token | Value | Applies to |
|---|---|---|
| `ROW_PAD` | `10px` | row's left inset and its right padding — the same number, so a band sits centred |
| `ROW_PY` | `6px` | inside a lane row |
| `HEADER_PY` | `4px` | inside a project or feature row |
| `HEADER_H` | `28px` | both column headers, so their borders line up |
| `PROJECT_GAP`, `FEATURE_GAP` | `4px` | air between the blocks of the tree |
| tree end padding | `10px` | above the first project and below the last lane |
| `GUIDE_STEP` | `18px` | one level of the tree |
| band padding | `4px` | inside a highlight band, so its paint clears the text |
| `BAND_MIN_H` | `16px` | content height every HEADER band is floored to, so a project, a feature and the review row paint the same `24px` (`16 + 2 × 4`) |

Vertical rhythm of a lane row: 6 px, name line, snippet line, 6 px. Two lane rows therefore stand
12 px apart, which is the same air the project gap leaves between blocks.

## Tree geometry

A node owns its own line and its own tick, and draws them **after** its row: the highlight would
otherwise paint over them.

| Value | Meaning |
|---|---|
| `ICON_SIZE` 12 px | folder for a project or a feature, terminal for a lane |
| `ICON_CENTER` 16 px | the line hangs under the centre of the icon: `ROW_PAD 10 + ICON_SIZE/2` |
| `STUB_W` 13 px | the horizontal tick from the parent's axis to the child icon's ink: `GUIDE_STEP 18 − ICON_SIZE/2 + STUB_OVERLAP 1` |
| `LINE_X` −2 px | where the spine sits relative to the child's own box: `ICON_CENTER − GUIDE_STEP 18` |
| trunk | from `50% + ICON_SIZE/2 − TRUNK_OVERLAP 2` down to `−FEATURE_GAP`: it starts inside the icon's bottom stroke, not at its box edge, because a folder's ink stops 2 px above the box |
| guide | 1 px, `var(--ui-text-tertiary)`, opacity 0.7 — 3.5:1 |
| tick | 1 px as a `border-top` with a `border-left` on the spine's own column, same colour, opacity 0.7 — a background box would straddle two device rows, and a tick starting one CSS pixel right of the spine left a hole at the corner at a fractional scale |
| last child | its spine stops at 50% of the row instead of running on |
| `tail` | how far a row's own segment runs past its box to the next sibling: `FEATURE_GAP 4`, `0` for lanes, whose rows touch |
| `trunkTail` | how far the trunk runs past its box to its first child: the child container's top padding — `4` for a feature, `0` for the review and closed rows, whose lanes start at the container's edge |
| tick start | one pixel right of the spine (`STUB_X`) and one pixel shorter, so its far end still lands on the icon: the spine's own stroke already covers that column |

**The tick ends on the GLYPH, not on the icon's box.** A `1.75px` stroke inside a 12 px box leaves
one empty pixel column at the box edge, so a tick that stops on the box reads as "this line does not
reach the icon" — and only on the rows whose glyph is drawn thinner (the dashed `new feature` folder,
the terminal of a lane), which is why it looked like *some* lines only. `STUB_OVERLAP` is that one
column: measured at 2×, the tick then meets the stroke and merely brightens the stroke's antialiased
edge by ~20%, with no notch cut into the icon.

**Derive these three, never write them twice.** `ICON_CENTER`, `LINE_X` and `STUB_W` all come from
`ROW_PAD` and `GUIDE_STEP`; the code builds them from the two numbers, and the table above is their
arithmetic. They were once hand-written against `ROW_PAD 6`: when the rhythm moved to 10 the icons
moved right and the lines stayed, so every spine sat 4 px outside its icon's centre and every stub
stopped 4 px short of the icon it was supposed to join. A measured gap at the end of a stub means the
three numbers came from two different `ROW_PAD` values — check the arithmetic before touching pixels.

**Every guide is a border, never a background box.** A `height: 1px` box with a background paints one
device row at a whole scale but straddles two at a fractional one (measured at 1.65: two full rows),
while a `1px` border snaps to a single row or column. The spines were borders and the ticks were boxes,
so on his display the ticks looked twice as thick as the lines they hang from — the fault was the
primitive, not the number. Borders snap; backgrounds antialias.

**A segment runs exactly the air below it, never more — and never over the stroke it leaves.** Two 1-px strokes at 45% opacity painted over
each other darken the pixel, so an extension that lands on the next row's own segment shows as a
short brighter piece on an otherwise even line. Features stand `4px` apart and lanes touch, so the
extension is the row's own `tail`: `FEATURE_GAP` for a feature or a group row, `0` for a lane. Lane
rows lived on the shared default and every pair of them carried a 4-px doubled chunk. The trunk has
its own air — the CHILD container's top padding, `4` under a feature and `0` under the review or
closed row — so it carries its own number (`trunkTail`); one value for both painted 4 px over the
first lane of every group. And a tick that starts on the spine's own column paints that pixel twice,
which shows as a darker dot at every junction: it starts one pixel right and is one pixel shorter, so
its far end still reaches the icon. Three overlaps, one rule: no 45% stroke may sit on another.

**Every row with visible children passes `trunk`.** A tree row draws its own segment under its own
icon and hands the rest to its children; a row that forgets the flag has no segment, so the line
starts one whole row late and leaves a hole between the folder and the first child's own segment.
The `review` group row was the only one in the panel without it — the defect shows as a gap under
that folder and nowhere else, which is why it looked like a fault of one level rather than of the tree.

The line physically cannot break between levels, because no element draws a line that belongs to
another element.

## Surfaces, borders, shadows

| Element | Value |
|---|---|
| Panel frame | one `1px` border on the panel's own root |
| Column seam | `1px` right border on the left column |
| Header shadow | one `4px` gradient band under each header (the band, not a `box-shadow`) |
| Band under a label | the same gradient, `4px`, 12% black at the edge |
| Project divider | two `1px` lines: `var(--ui-text-quaternary)` at 35% above, `rgba(0,0,0,0.45)` below; air `PROJECT_SEP_AIR 6` on each side on top of the list's gap, so a row stands `10px` from the divider — the same `10px` the list keeps at its own top and bottom |
| Highlight band | radius `4px`, padding `4px`, no shadow |

Rules:

- **The selection outlives its row.** When the selected lane scrolls out of sight, the frame does not vanish:
  the pane keeps its outline in that lane's colour and the seam closes over it, so the pane still says what
  is selected. Only an absent row — a collapsed feature — leaves nothing to frame.
- **The selected row and the right pane are one figure.** The seam stops at the row's top and starts
  again at its bottom, so the row opens into the pane; the outline runs around the union, not around two
  boxes. Colour it with the row's own state colour — the same value the row already shows — so selection
  and condition cannot disagree.
- **Measure against the content box, and inset half a pixel.** The panel carries a `1px` border and the
  overlay sits inside it: measuring against the border box shifts the whole figure up and left, and a stroke
  centred on `0` or `width` is half clipped by the panel's own edge — the user sees a frame that is missing
  its top and right sides. Read `clientWidth/clientHeight`, subtract the border, and draw the outer edges at
  `0.5` and `size - 0.5`.
- **Measure the row, not the data.** The frame comes from the row's real box in the DOM and exists only
  while the row sits wholly inside the strip under the header (`visibleFrame`): a row scrolled away, or
  half under the header, draws nothing instead of a cut figure. The rule is a pure function so it is
  checked with four numbers, not a browser.
- **A groove cannot be painted with black alone.** On a dark surface 12% of black moves three units
  out of 255, so the old two-fade divider read as a smudge and its inner line disappeared. A groove
  needs two edges: a light one and a dark one. The light edge takes the theme's own quaternary tone
  (`color-mix(… 35%, transparent)`, 23 → 46 on `#171715`), the dark edge stays black at 45% (23 → 12).
  Both are drawn as `1px` lines; the shadow fades around them are gone. Its air is one number for the
  whole list: `PROJECT_SEP_AIR 6 + PROJECT_GAP 4 = 10`, the same inset the list keeps above its first
  project and below its last. A divider that stands closer to a row than the list's own edge does is
  the first thing he circles on a screenshot.
- **One shadow shape for the whole panel.** A gradient band, not a `box-shadow`, because a shadow
  belongs to a box and would cut off at the seam.
- **An inset ring does not work for the frame**: it paints under the children. A real border on the
  root does.
- **No border between rows.** Separation comes from spacing, not from a line under every row.

## Components

| Component | Rule |
|---|---|
| Lane row | icon, name, state word, snippet; band behind the text only, never behind the icon; a selected lane's fill runs the last `10px` to the divider and fades to nothing over the final `14px`, so it dissolves where the right part begins |
| Project or feature row | folder icon, label, counters |
| Header control | one word, `10.5px` uppercase, `1px` stroke, radius `4px`, height `BAND_MIN_H` (`16px`); clicking it swaps the word for `✕` and `✓` at `16 × 16`, the same box, so the band never moves. Hover fills it with `var(--ui-bg-tertiary)` and lifts the word to `var(--ui-text-secondary)` over `120ms`; the `✕` and `✓` take the same fill and keep their state colour. The hover is React state driving an inline style, never a utility class |
| Add-feature row | the FIRST line inside an open project, directly under the project row: a dashed folder with a plus inside, and the words `new feature` inside a `1px dashed` band that has the SHAPE of the hover band — same left edge, `24px` tall, radius `4px`, `4px` of padding — with `14px` of content instead of `BAND_MIN_H 16` so the two borders keep the row at its siblings' height, and as wide as the words (`flex: 0 1 auto`), never the row's width; the only way to create a feature. It opens the block so the gesture stays visible however long the list grows; the level's closing `last` mark moves to whichever row ends the block (a feature, `review`, or `closed`) |
| Counter | `?` `!` gear `✓` with a number, one colour each, no separator between them |
| Question block | inside the lane card, three controls at most, answer goes to the lane |
| Thread | a bubble per message, anchored at the bottom: the box is a `column-reverse` scroller with `minHeight TEXT_H` and `maxHeight 38vh`, so the newest bubble sits on the composer and a long thread opens scrolled to it. A bubble is a row of the panel, not a cloud: `24px` tall (`BAND_MIN_H + 2·BAND_PY`), radius `4px`, full column width, and a `1px` inset ring in `ASK_COLOR` (`#0762B4`); the author is named in the label, and no second hue cuts through the ring. The composer copies the app's own input field: `42px` outer (a `40px` fill plus two `1px` borders), radius `4px`, border `var(--ui-accent)`, fill `var(--ui-bg-editor)` — the panel's own surface — inset `10px` at the sides, `4px` above the model row that closes the card. The box has TWO shapes and picks one from the text alone. While the writing's line ends before the button's column, the writing and the `SEND` share one row: the field is one line tall (`12px`) and the row centres it, so the first line stands in the middle of the field, the field takes the room that is left and the `SEND` — `32px`, caps, `px-2` — closes the row 4px later. The moment that line would reach the button, the writing takes the FULL width on a row of its own and the `SEND` drops under it, right aligned, 4px below. The test is the UNWRAPPED width of the whole text against the box's own inner width minus the button and the gap: both numbers come from the box, never from the field, so the answer does not move with the shape it decides and cannot flip on a keystroke. A second line (a typed break, or a wrapped line) holds the stacked shape. The field grows upward with its text (floor `minHeight` 42px) with no ceiling and no scroll bar of its own. Enter sends, Shift+Enter breaks the line |
| Model line | the card's LAST row, under the field and `4px` below it, on the card's own `10px` inset and the panel's `24px` control height; the `8px` of air the composer keeps above the window edge sits under this row. The word `model` (`0.625rem`, caps, tertiary), the model's own name (`0.625rem` mono, secondary) and the word `change` (tertiary) at the right end — the whole row is the control, so a 290-px line needs no second box. The word becomes `close` while the list is open, and the list opens IN THE FLOW ABOVE the row — between the field and the row, never over either: one `24px` row per model, the one in use in `var(--ui-text-primary)` and the rest in secondary, each row's right end carrying the provider's name; the card is bottom-pinned, so the list pushes the thread up. The choice writes `provider` and `model` into the lane record, which is what `pi-lane continue` reads back — it decides the NEXT run of that lane and never the one already going. The offer comes from `~/.hermes/plugin-data/pi-team/models.json`, which the backend creates from its defaults on the first read: pi's own catalog holds 500-odd ids and cannot be a row, so the list is edited in that file |
| Lane card | three areas in fixed order, all of them always: `STATUS` (the receipt rows, branch, changes, turns, tokens, tool, error, and the `why`/`stderr` blocks of a lane that ended badly), then `SESSIONS`, then `STATE` (the heading carries the state word on its own line, right aligned, in the state's text tone; below it the card's controls, each one `24px` tall and as wide as the card with its word centred). The question block, when a lane asks, sits above all three, and the THREAD is not part of this column at all: it is pinned to the card's bottom edge, its bubbles grow upward and its composer stays level with the app's own input field. The FIRST area carries no rule of its own (`Section first`): the header already ends in a border, and two of them land four pixels apart |
| Receipt | the rows of the `STATUS` area: commit, date, message, diff — they carry no heading of their own, because the area is drawn once even when there is no merge |
| Card shell | one header strip of `HEADER_H` and content starting at `ROW_PAD` |
| Card footer buttons | `24px` tall — `BAND_MIN_H 16` plus `BAND_PY 4` above and below, the hover band's own size — sharing the row equally (`flex: 1 1 0`), the word centred in each |
| Scroll pill | `44px` long, `3px` wide, radius `999px`, `var(--ui-text-quaternary)` at 0.55 |
| Panel frame | one border, no corner radius: the app's pane is square |
| Selection figure | one `1px` line around the selected row and the right pane, in the row's state colour; every turn carries the same `4px` radius, the two turns at the seam included, and each seam segment stops a radius short of the corner so no straight stub sits inside the curve; the row's own ring is suppressed while it is selected, and the seam opens over the band's height |
| What can be selected | a lane, or a feature still in preparation. A finished feature has no card: its click opens or closes it and never touches the selection. A second click on the selected lane releases it |

## Motion

| Thing | Timing | Why |
|---|---|---|
| Poll of `/lanes` | `3000ms` | fast enough to feel live, cheap enough to ignore |
| Gear spin | `1800ms`, linear, endless | the only always-on motion; it says "working" without a word |
| Ball along the spine | `2400ms`, offsets `0 · .05 · .2 · .7 · .88 · .97 · 1` | appears on the stub, climbs, turns into the folder, shrinks behind it |
| Pill fade | `1000ms` after the last scroll, `700ms` after a drag | the pill reports, it does not decorate |

Every ball shares one clock: the first animation sets the origin, the rest start at its phase, so two
running lanes never show two different positions. Both animations stop when the system asks for
reduced motion.

The ball uses the Web Animations API, not a CSS class: a class needs the app's stylesheet, an
animation does not.

## Do

- Change a value in `desktop/plugin.js`, then update the table here in the same commit.
- Keep one number for two sides of the same thing: a row's left and right padding are one token.
- Measure before believing. Three checks, all cheap:
  - `node desktop/render-check.mjs` — every component renders; every name must say `ok`.
  - `node desktop/props-check.mjs` — no props object carries two `style` keys; it names the lines.
  - a static mock of the geometry, rendered by headless Chromium, measured with `PIL`: the seam, the
    end of a band, the frame on all four edges.
- Write the reason next to the constant in code when it is not obvious: `85%: white on this fill
  reaches 4.6:1`.

## Don't

- **Do not put one style object with two `style:` keys in a JSX props object.** The second silently
  wins and the first disappears — that is how the native scrollbar survived three fixes.
- **Do not try `scrollbar-width: none` here.** The app styles `::-webkit-scrollbar`, and a styled bar
  ignores it. Use the class rule.
- **Do not hide a scrollbar by padding the scroll area.** The padding eats content width, and
  right-aligned numbers get cut. Either hide the bar with a rule, or leave the width alone.
- **Do not use `box-shadow` for a horizontal line across both columns.** Use a gradient band.
- **Do not invent a fourth state colour.** Three states, one meaning each.
- **Do not add a border where spacing can do the work.**
- **Do not depend on a utility class the app may not have built** — see the constraint above.
- **Do not name a token the app's build does not have.** `--ui-fill-*` does not exist in the shipped
  CSS at all, so every `hover:bg-(--ui-fill-tertiary)` in the panel painted nothing and read as a
  button with no hover. Grep the app's `main-<hash>.css` for the token before using it; the control
  fills that DO exist are `--ui-bg-tertiary`, `--ui-control-hover-background` (aliased as
  `--chrome-action-hover`) and `--ui-control-active-background`. `--ui-danger` is the same trap: it is
  defined nowhere, so a red that named it stayed grey. The panel's own failure colour is `BAD_COLOR`.
- **Every clickable element answers the pointer.** Three mechanisms count, and nothing else: `HoverBox`
  (or `HeaderControl`, which wraps it), the state a row already keeps for its band, or a `hover:` class
  that the shipped CSS really generated. The audit is mechanical: list every `onClick`, and for each
  element check for `hoverFill` / `hoverColour` / a `hover:` class; the ones that have none are the
  buttons of the compose cards, the two placeholders' drop rows and a lane row in the feature card —
  all were found this way, none by looking.
- **Every hover is `HoverBox`.** One component owns the state, the `120ms` fade and the two paints:
  a fill (`hoverFill`, `--ui-bg-tertiary`) and/or a word colour (`hoverColour`). A bordered control
  inside a header band goes through `HeaderControl`, which is `HoverBox` plus the band's numbers. No
  `hover:` utility class survives in `plugin.js` — the build only generates a fixed set, and the set
  it generated never matched what the panel asked for.

## Where the values live

| Group | File | Constants |
|---|---|---|
| Colour | `desktop/plugin.js` | `RUN_COLOR`, `ASK_COLOR`, `ASK_OUTLINE`, `ASK_BG`, `ASK_BG_SOFT`, `BAD_COLOR`, `DONE_COLOR`, `STROKE` |
| Tree | `desktop/plugin.js` | `GUIDE_STEP`, `ICON_SIZE`, `ICON_CENTER`, `STUB_W`, `LINE_X`, `LINE` |
| Spacing | `desktop/plugin.js` | `ROW_PAD`, `ROW_PY`, `HEADER_PY`, `HEADER_H`, `PROJECT_GAP`, `FEATURE_GAP`, `BAND_PY`, `BAND_MIN_H` |
| Surfaces | `desktop/plugin.js` | `SOFT_SHADOW`, `BAND_H`, `BAND_BG`, `PROJECT_SEP_*` |
| Hover | `desktop/plugin.js` | `HOVER_FADE`, `HoverBox` (state + fade + paints), `HeaderControl` (band control) |
| Pill | `desktop/plugin.js` | `PILL_H`, `ScrollPill`, `Scroller` |
| State machine | `plugin/dashboard/plugin_api.py` | which lane is in which state, what a receipt holds |
