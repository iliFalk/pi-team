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
  done: 'var(--ui-text-tertiary)'
  stroke: 'var(--ui-text-quaternary)'
  border: 'var(--ui-stroke-secondary)'
  text-primary: 'var(--ui-text-primary)'
  text-secondary: 'var(--ui-text-secondary)'
  text-tertiary: 'var(--ui-text-tertiary)'
  text-quaternary: 'var(--ui-text-quaternary)'
  hover-paint: 'var(--chrome-action-hover)'
spacing:
  row-side: 10px
  row-vertical: 6px
  header-vertical: 4px
  header-height: 28px
  gap-project: 4px
  gap-feature: 4px
  tree-step: 18px
  band-pad: 4px
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
  project-sep: 'two 4px fades, up and down, 12% black at the line'
lines:
  border: 1px
  outline: 0.5px
  guide: 1px
  guide-opacity: 0.45
  tick-opacity: 0.65
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
| `running` | `#1A6543` | the word, the dot, the ball, the row outline, the gear |
| question (`waiting`) | `#0762B4` at 85% | the whole lane row, white text on it |
| question, gentle | `#0762B4` at 18% | the label band of the feature and the project above the lane |
| `failed`, `error`, `stopped` | `#8A1C0E` | the word, the outline, the count, the reason line |
| `done` | `var(--ui-text-tertiary)` | the tick and its count only |

Rules:

- **White on the question fill must stay readable.** At 70% it is 3.5:1, at 85% it is 4.6:1, which is
  the threshold for text this small. Do not lower the fill without re-measuring.
- **Counters climb to the deepest visible level.** A project always sums its lanes; a feature sums
  only while it is closed. `!` beats `?`, so a failed lane is never hidden behind a question.
- **App tokens, not hex, for text and lines.** `var(--ui-text-quaternary)` for a guide, because a
  border-toned line disappears on a highlighted row; `var(--ui-stroke-secondary)` for real borders.

## Typography

| Role | Size | Notes |
|---|---|---|
| Project and feature labels | `0.625rem` | uppercase, wide tracking, quaternary |
| Lane name | `0.6875rem` | monospace, `0.625rem` for its snippet |
| State word | `0.625rem` | coloured by state, never bold except a question |
| Counters | `0.625rem` | one sign per state |
| Receipt numbers | `0.6875rem` | monospace, right aligned |
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

Vertical rhythm of a lane row: 6 px, name line, snippet line, 6 px. Two lane rows therefore stand
12 px apart, which is the same air the project gap leaves between blocks.

## Tree geometry

A node owns its own line and its own tick, and draws them **after** its row: the highlight would
otherwise paint over them.

| Value | Meaning |
|---|---|
| `ICON_SIZE` 12 px | folder for a project or a feature, terminal for a lane |
| `ICON_CENTER` 12 px | the line hangs from the centre of the icon |
| `STUB_W` 12 px | the horizontal tick from the line to the next icon |
| `LINE_X` −6 px | where the spine sits relative to the icon column |
| guide | 1 px, `var(--ui-text-quaternary)`, opacity 0.45 |
| tick | 1 px, same colour, opacity 0.65 |
| last child | its spine stops at 50% of the row instead of running on |

The line physically cannot break between levels, because no element draws a line that belongs to
another element.

## Surfaces, borders, shadows

| Element | Value |
|---|---|
| Panel frame | one `1px` border on the panel's own root |
| Column seam | `1px` right border on the left column |
| Header shadow | one `4px` gradient band under each header (the band, not a `box-shadow`) |
| Band under a label | the same gradient, `4px`, 12% black at the edge |
| Project divider | two `4px` fades, one up and one down, with a transparent line between them |
| Highlight band | radius `4px`, padding `4px`, no shadow |

Rules:

- **The selected row and the right pane are one figure.** The seam stops at the row's top and starts
  again at its bottom, so the row opens into the pane; the outline runs around the union, not around two
  boxes. Colour it with the row's own state colour — the same value the row already shows — so selection
  and condition cannot disagree.
- **Measure the row, not the data.** The frame comes from the row's real box in the DOM and exists only
  while the row sits wholly inside the strip under the header (`visibleFrame`): a row scrolled away, or
  half under the header, draws nothing instead of a cut figure. The rule is a pure function so it is
  checked with four numbers, not a browser.
- **One shadow shape for the whole panel.** A gradient band, not a `box-shadow`, because a shadow
  belongs to a box and would cut off at the seam.
- **An inset ring does not work for the frame**: it paints under the children. A real border on the
  root does.
- **No border between rows.** Separation comes from spacing, not from a line under every row.

## Components

| Component | Rule |
|---|---|
| Lane row | icon, name, state word, snippet; band behind the text only, never behind the icon |
| Project or feature row | folder icon, label, counters |
| Add-feature row | the last line inside an open project: a dashed folder with a plus inside, label `new feature` in quaternary; the only way to create a feature |
| Counter | `?` `!` gear `✓` with a number, one colour each, no separator between them |
| Question block | inside the lane card, three controls at most, answer goes to the lane |
| Thread | a bubble per message, `panel` messages dimmed |
| Receipt | `merge` section: commit, date, message, diff, branch, then the file list |
| Card shell | one header strip of `HEADER_H` and content starting at `ROW_PAD` |
| Scroll pill | `44px` long, `3px` wide, radius `999px`, `var(--ui-text-quaternary)` at 0.55 |
| Panel frame | one border, no corner radius: the app's pane is square |
| Selection figure | one `1px` line around the selected row and the right pane, in the row's state colour; every turn carries the same `4px` radius, the two turns at the seam included; the row's own ring is suppressed while it is selected, and the seam opens over the band's height |
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

## Where the values live

| Group | File | Constants |
|---|---|---|
| Colour | `desktop/plugin.js` | `RUN_COLOR`, `ASK_COLOR`, `ASK_OUTLINE`, `ASK_BG`, `ASK_BG_SOFT`, `BAD_COLOR`, `DONE_COLOR`, `STROKE` |
| Tree | `desktop/plugin.js` | `GUIDE_STEP`, `ICON_SIZE`, `ICON_CENTER`, `STUB_W`, `LINE_X`, `LINE` |
| Spacing | `desktop/plugin.js` | `ROW_PAD`, `ROW_PY`, `HEADER_PY`, `HEADER_H`, `PROJECT_GAP`, `FEATURE_GAP`, `BAND_PY` |
| Surfaces | `desktop/plugin.js` | `SOFT_SHADOW`, `BAND_H`, `BAND_BG`, `PROJECT_SEP_*` |
| Pill | `desktop/plugin.js` | `PILL_H`, `ScrollPill`, `Scroller` |
| State machine | `plugin/dashboard/plugin_api.py` | which lane is in which state, what a receipt holds |
