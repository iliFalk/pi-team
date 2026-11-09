/**
 * pi-team — pi lanes in the Hermes desktop.
 *
 * Left pane: one row per lane — name, state, the first line of its last message.
 * Right pane: the selected lane — task, the last text the agent wrote, last tool,
 * changes, touched specs.
 *
 * Lanes are headless `pi -p` runs recorded by ~/.hermes/scripts/pi-lane.
 * Backend: ~/.hermes/plugins/pi-team/dashboard/plugin_api.py (/api/plugins/pi-team).
 * Procedure: skill `pi-coach`.
 */

import { atom, ConfirmDialog, host, icons, Input, useQuery, useValue } from '@hermes/plugin-sdk'
import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'pi-team'
// One height for both column headers, one for both text blocks: the borders line up.
const HEADER_H = '28px'
// A short fall-off below each header and text block. Black alpha, because a shadow has no theme colour.
const SOFT_SHADOW = '0 2px 4px -2px rgba(0, 0, 0, 0.55)'
// A short band under a label or a header: the only shadow shape this panel uses.
// The same soft gradient the project divider uses: 12% at the edge, gone in 4px.
const BAND_H = '4px'
const BAND_BG = 'linear-gradient(to bottom, rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0))'
// Both text blocks share one height and scroll inside it.
const TEXT_H = '100px'
// The thread's bubble area starts 150 px taller than a plain text block, so its header sits that much
// higher on the card: the block is pinned to the bottom, so growing it upward is the same as lifting that
// header. `100 + 50` was his first step and `+ 100` his second, kept as arithmetic so the numbers stay visible.
const THREAD_MIN_H = `${100 + 50 + 100}px`
// Tree geometry: a node owns its line, so a level cannot break into loose segments.
// The line hangs under the icon, so the icon column and the line are one axis.
const GUIDE_STEP_N = 18
const ROW_PAD_N = 10
const GUIDE_STEP = `${GUIDE_STEP_N}px`
// One value for the row's two sides: a row and a header keep the same air left and right,
// so a highlight sits in the middle of its row instead of hugging one edge.
const ROW_PAD = `${ROW_PAD_N}px`
const ICON_SIZE = 12
// The line hangs under the icon's centre, and a child's box starts one GUIDE_STEP to the right of
// its parent's — so in the child's own coordinates that axis sits at ICON_CENTER − GUIDE_STEP, and
// the stub reaches from there to the child icon's LEFT edge, GUIDE_STEP − ICON_SIZE/2. All three
// derive from ROW_PAD: when it moved 6 → 10 the two hand-written values stayed behind, which put
// every spine 4px outside its icons and left a 4px gap at the end of every stub.
const ICON_CENTER = `${ROW_PAD_N + ICON_SIZE / 2}px`
const LINE_X_N = ROW_PAD_N + ICON_SIZE / 2 - GUIDE_STEP_N
const LINE_X = `${LINE_X_N}px`
// The stub closes on the glyph, not on its box: a 1.75px stroke inside a 12px box leaves one empty
// pixel column at the box edge, and a line that stops there reads as "does not reach the icon".
// One extra pixel lands on that column — measured at 2×, it merges with the stroke instead of
// cutting into it.
const STUB_OVERLAP = 1
const STUB_W_N = GUIDE_STEP_N - ICON_SIZE / 2 + STUB_OVERLAP
const STUB_W = `${STUB_W_N}px`
// The tick starts ON the spine's column, not one pixel right of it: at a fractional display scale a
// 1px border snaps to one device pixel, so a tick starting a whole CSS pixel to the right landed two
// device columns away and left a hole at the corner (measured at 1.65: the spine on column 33, the
// tick from 35, column 34 empty). The overlap is a single pixel, and it is painted at 40% of the tone
// so the junction does not darken into a dot.
const STUB_CORNER = 'color-mix(in srgb, var(--ui-text-tertiary) 25%, transparent)'
// The trunk leaves the ICON, not the icon's box: a glyph's ink stops about 1.5px above the box
// bottom (the folder path ends at 20 of 24), so a segment that starts on the box hangs in the air
// under the folder. Two pixels put it inside the bottom stroke, where the stroke is full opacity
// and the segment's 0.45 paint reads as the same line.
const TRUNK_OVERLAP = 2
// The tertiary tone rather than the border tone: the elbow must stay visible on a highlighted row,
// where a border-coloured line washes out. At 0.7 it measures 3.5:1 against the surface, the floor for
// a graphic; the old 45% of quaternary measured 1.65:1.
const STROKE = 'var(--ui-text-tertiary)'
const GUIDE_OPACITY = 0.7

const LINE = {
  position: 'absolute',
  width: 0,
  borderLeft: `1px solid ${STROKE}`,
  opacity: GUIDE_OPACITY,
  pointerEvents: 'none'
}

// One palette for the three states the tree reports.
const RUN_COLOR = '#1A6543'
const ASK_COLOR = '#0762B4'
const ASK_OUTLINE = '#044A8A'
const BAD_COLOR = '#8A1C0E'
// The hexes above are FILL colours: white sits on the question blue, and the green and the red frame a
// row. Written as words on the panel's own surface they measure 1.9–2.9:1, under the 4.5:1 floor for
// text this small, so a word takes half its state and half the surface's brightest text:
// running 7.1:1, question 7.3:1, failure 5.9:1. Fills, outlines and the ball keep the hexes.
const RUN_TEXT = `color-mix(in srgb, ${RUN_COLOR} 50%, var(--ui-text-primary))`
const ASK_TEXT = `color-mix(in srgb, ${ASK_COLOR} 50%, var(--ui-text-primary))`
const BAD_TEXT = `color-mix(in srgb, ${BAD_COLOR} 50%, var(--ui-text-primary))`
// 85%: white on this fill reaches 4.6:1, the threshold for text this small.
const ASK_BG = 'rgba(7, 98, 180, 0.85)'
// The third speaker: pi. Ochre, measured 4.81:1 on the dark panel and 3.38:1 on the light one — the only
// honey that clears the graphic floor on both, which is why it is not a brighter amber.
const PI_COLOR = '#A97D14'
const PI_TEXT = `color-mix(in srgb, ${PI_COLOR} 50%, var(--ui-text-primary))`

const ASK_BG_SOFT = 'rgba(7, 98, 180, 0.18)'
// A question row keeps its blue on hover: the wash deepens and the label brightens to text-secondary,
// the same two paints the band's control uses. Without this the wash wins the style branch and the
// row answers nothing while a plain feature's row answers with a fill.
const ASK_BG_HOVER = 'rgba(7, 98, 180, 0.28)'
const BAD_STATES = ['failed', 'error', 'stopped']
const DONE_COLOR = 'var(--ui-text-tertiary)'

const isBad = lane => BAD_STATES.includes(lane.state) || Boolean(lane.last_error)

const mark = (sign, count, color) =>
  jsxs('span', {
    className: 'flex items-baseline gap-0.5',
    style: { color },
    children: [jsx('span', { style: { fontWeight: 600 }, children: sign }), jsx('span', { children: String(count) })]
  }, sign)

/** How many lanes of a node sit in each of the four groups. Shelved lanes count nowhere. */
function countStates(lanes) {
  const counts = { ask: 0, bad: 0, run: 0, done: 0 }
  for (const lane of lanes) {
    // A handed lane has left the agent's hands; a closed one is done with. Neither counts,
    // unless a closed lane failed — that survives the cleanup.
    if (!lane || lane.handed) continue
    if (lane.shelved && !isBad(lane)) continue
    if (isBad(lane)) counts.bad += 1
    else if (lane.state === 'waiting') counts.ask += 1
    else if (lane.state === 'running') counts.run += 1
    else if (lane.state === 'done') counts.done += 1
  }
  return counts
}

/** The colour a state is FRAMED in, wherever the state frames something. */
function stateColour(lane) {
  if (isBad(lane)) return BAD_COLOR
  if (lane.state === 'running') return RUN_COLOR
  if (lane.state === 'waiting') return ASK_COLOR
  if (lane.state === 'done') return `color-mix(in srgb, ${RUN_COLOR} 70%, transparent)`
  return undefined
}

/** The colour a state is WRITTEN in: the same hue at half strength, legible on the surface. */
function stateText(lane) {
  if (isBad(lane)) return BAD_TEXT
  if (lane.state === 'running') return RUN_TEXT
  if (lane.state === 'waiting') return ASK_TEXT
  return undefined
}

/** A gear that turns while a lane works: the word is replaced by the motion. */
function Gear() {
  return jsx('svg', {
    viewBox: '0 0 24 24',
    width: 12,
    height: 12,
    fill: 'none',
    stroke: RUN_TEXT,
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-label': 'running',
    style: { display: 'block', flex: 'none' },
    ref: element => {
      if (!element || element.dataset.piGear) return
      element.dataset.piGear = '1'
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      element.animate(
        [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
        { duration: 1800, iterations: Infinity, easing: 'linear' }
      )
    },
    children: [
      jsx('path', {
        d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z'
      }, 'gear'),
      jsx('circle', { cx: 12, cy: 12, r: 3 }, 'hub')
    ]
  })
}


/** A ball that runs from a working lane's stub, up its line, into the feature's icon. */
const BALL = 4
const BALL_SHIFT = 0.5

function Runner({ last }) {
  return jsx('span', {
    'aria-hidden': true,
    style: {
      position: 'absolute',
      left: LINE_X,
      top: '50%',
      // The margins put the ball's centre where it moves from, and BALL_SHIFT nudges it
      // off the 1px stroke so the body reads to the right of the line.
      width: `${BALL}px`,
      height: `${BALL}px`,
      marginLeft: `${-(BALL / 2) + BALL_SHIFT}px`,
      // The last row of a level carries the end of the line, where the body reads a pixel high.
      marginTop: `${-BALL / 2 + (last ? 1 : 0)}px`,
      borderRadius: '999px',
      background: RUN_COLOR,
      pointerEvents: 'none',
      opacity: 0
    },
    ref: element => {
      if (!element || element.dataset.piRunner) return
      const rowBox = element.parentElement
      const kids = element.closest('[data-pi-kids]')
      const featureBox = kids && kids.previousElementSibling
      if (!rowBox || !featureBox) return
      element.dataset.piRunner = '1'
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

      // Distances come from the DOM: the row heights and the icon's place are what the
      // geometry actually is, not what the styles claimed.
      const rowRect = rowBox.getBoundingClientRect()
      const featureRect = featureBox.getBoundingClientRect()
      const icon = featureBox.querySelector('svg')
      const iconRect = icon ? icon.getBoundingClientRect() : null

      const base = parseFloat(LINE_X) + BALL_SHIFT
      const stubStart = parseFloat(STUB_W) - BALL_SHIFT
      const rowMiddle = rowRect.top + rowRect.height / 2

      // Up the line to the feature row, then into the folder: it ends on the folder's
      // bottom edge, under the glyph, where it is hidden and can vanish.
      const intoFolder = iconRect
        ? iconRect.bottom - rowMiddle
        : featureRect.top + featureRect.height / 2 - rowMiddle
      // The folder sits on this line within a pixel or so; a nudge that small reads as a
      // sideways twitch at the end, so it is dropped. A real offset still gets followed.
      const underFolder = iconRect
        ? (() => {
            const dx = iconRect.left + iconRect.width / 2 - rowRect.left - base
            return Math.abs(dx) > 2 ? dx : 0
          })()
        : 0

      const animation = element.animate(
        [
          // Along the stub, up the line, then right into the folder and gone inside it.
          { transform: `translate(${stubStart}px, 0px) scale(1)`, opacity: 0, offset: 0 },
          { transform: `translate(${stubStart - 2}px, 0px) scale(1)`, opacity: 1, offset: 0.05 },
          { transform: 'translate(0px, 0px) scale(1)', opacity: 1, offset: 0.2 },
          { transform: `translate(0px, ${intoFolder}px) scale(1)`, opacity: 1, offset: 0.7 },
          { transform: `translate(${underFolder}px, ${intoFolder}px) scale(1)`, opacity: 1, offset: 0.88 },
          // Reached the folder's bottom edge: gone behind it, no fade in open space.
          { transform: `translate(${underFolder}px, ${intoFolder}px) scale(0.6)`, opacity: 1, offset: 0.97 },
          { transform: `translate(${underFolder}px, ${intoFolder}px) scale(0.2)`, opacity: 0, offset: 1 }
        ],
        { duration: 2400, iterations: Infinity, easing: 'linear' }
      )
      // One clock for every ball: each one starts where the others already are, so two
      // running lanes never show two different phases.
      const origin = (window.__piTeamSpin ||= performance.now())
      animation.currentTime = (performance.now() - origin) % 2400
    }
  })
}

// The icon set ships only the open folder, so both states are drawn here, in the
// same 24-grid and stroke as the rest of the panel.
const FOLDER_CLOSED = 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'
const FOLDER_OPEN =
  'm6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2'

function FolderIcon({ open }) {
  return jsx('svg', {
    viewBox: '0 0 24 24',
    width: ICON_SIZE,
    height: ICON_SIZE,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    // Measured against the label: the glyph's ink centres half a pixel under the cap
    // height of the name, so it comes up by that half.
    style: { display: 'block', transform: 'translateY(-0.5px)' },
    children: jsx('path', { d: open ? FOLDER_OPEN : FOLDER_CLOSED })
  })
}

/** The folder a feature will be: a dashed outline with a plus inside it. */
function FolderPlus() {
  return jsxs('svg', {
    viewBox: '0 0 24 24',
    width: ICON_SIZE,
    height: ICON_SIZE,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    style: { display: 'block', transform: 'translateY(-0.5px)' },
    children: [
      jsx('path', { d: FOLDER_CLOSED, strokeDasharray: '2.5 2.5', key: 'folder' }),
      jsx('path', { d: 'M12 10.5v3.6M10.2 12.3h3.6', key: 'plus' })
    ]
  })
}

/** A row, the segment of its level's line that belongs to it, and its children.
 *  Every measurement here is row-relative: a percentage of the node would put the
 *  stub and the end of the line in the middle of the children instead of the row. */
function TreeRow({ last, orphan, trunk, runner, row, children, tail, trunkTail }) {
  const blocks = (Array.isArray(children) ? children : [children]).filter(Boolean)
  // How far this row's segment runs past its own box: exactly the air to the row below.
  // Features stand a gap apart, so the extension fills that gap; lanes stand shoulder to
  // shoulder, so an extension there lands on the next lane's own segment, paints the same
  // pixel twice and shows as a brighter 4px piece on the line.
  const tailPx = tail === undefined ? parseInt(FEATURE_GAP, 10) : Number(tail)
  const tailBottom = tailPx ? `-${tailPx}px` : '0px'
  // The trunk reaches its first child, and that air is the CHILD container's top padding, which is
  // not the same number as the gap between siblings: a feature indents its lanes by FEATURE_GAP, a
  // group row does not indent anything. One value for both painted 4px over the first lane.
  const trunkTailPx = trunkTail === undefined ? tailPx : Number(trunkTail)
  const trunkBottom = trunkTailPx ? `-${trunkTailPx}px` : '0px'

  // The last row stops at its own middle, so its half is measured inside the row.
  // Every other row runs on beside its children, so its line spans the whole node.
  const insideRow = last ? { ...LINE, left: LINE_X, top: 0, height: '50%' } : null
  // Runs on past the row so the air between rows does not cut the line.
  const wholeNode = last || orphan ? null : { ...LINE, left: LINE_X, top: 0, bottom: tailBottom }

  return jsxs('div', {
    // The node is the box the full-height line is measured against.
    style: { position: 'relative' },
    children: [
      jsxs('div', {
        // A row that owns children sits above them, so the ball can pass under it.
        style: { position: 'relative', zIndex: blocks.length ? 1 : undefined },
        children: [
          row,
          insideRow ? jsx('span', { 'aria-hidden': true, style: insideRow }) : null,
          orphan
            ? null
            : jsx('span', {
                'aria-hidden': true,
                style: {
                  position: 'absolute',
                  left: LINE_X,
                  top: '50%',
                  width: STUB_W,
                  // A top BORDER, not a 1px background box: at a fractional display scale a background
                  // box straddles two device rows while a border snaps to one, so the ticks read twice
                  // as thick as the spines beside them (measured at 1.65: two rows against one column).
                  borderTop: `1px solid ${STROKE}`,
                  // The corner pixel the tick owns, so the junction cannot open into a hole.
                  borderLeft: `1px solid ${STUB_CORNER}`,
                  boxSizing: 'border-box',
                  opacity: GUIDE_OPACITY,
                  pointerEvents: 'none'
                }
              }),
          trunk
            ? jsx('span', {
                'aria-hidden': true,
                style: {
                  ...LINE,
                  left: ICON_CENTER,
                  top: `calc(50% + ${ICON_SIZE / 2 - TRUNK_OVERLAP}px)`,
                  bottom: trunkBottom
                }
              })
            : null,
          runner ? jsx(Runner, { last }) : null
        ]
      }),
      ...blocks,
      wholeNode ? jsx('span', { 'aria-hidden': true, style: wholeNode }) : null
    ]
  })
}

const POLL_MS = 3000
const REST = { timeoutMs: 8000 }

const selectedLane = atom('')
// Where a feature asked for in one line is written, and which feature the right pane shows.
const composeAtom = atom(null)
const selectedFeature = atom(null)
const selectedProject = atom(null)
const composeProject = atom(false)
// The settings screen replaces the right column, like a compose card; the atom is what the gear sets.
const showSettings = atom(false)



// Hover paint belongs to the label, not to the row: the icon must stay outside it.
const ROW_PY = '6px'
const HEADER_PY = '4px'
const BAND_PY = 4
// One value for both: the air under the panel header and the air around the divider are
// the same 4px, so the first project and the next one start from the same place.
const PROJECT_GAP = '4px'
// How far a selected lane's fill fades out at its right edge.
const ROW_FADE = 14
// Air between the rows of one project, so a feature does not sit on the project's edge.
const FEATURE_GAP = '4px'
// The divider between two projects is a groove of two pixels: a light line, then a dark one.
// Black alpha alone cannot separate anything on a dark theme — 12% of black over #171715 moves three
// units out of 255, so the old two-fade band read as a smudge and the line inside it disappeared.
// The light line is the theme's own quaternary tone, so it inverts with the theme; the dark line stays
// black because a groove's lower edge is shadow on any surface.
const PROJECT_SEP_HI = 'color-mix(in srgb, var(--ui-text-quaternary) 35%, transparent)'
const PROJECT_SEP_LO = 'rgba(0, 0, 0, 0.45)'
// Air on both sides, on top of the list's own gap between blocks: 6 + PROJECT_GAP 4 = the same 10px
// the list keeps at its own top and bottom, so a project's row is one rhythm away from anything.
const PROJECT_SEP_AIR = '6px'
// The label rides a pixel lower inside its line box, which is where the eye wants it.
const TEXT_NUDGE = { transform: 'translateY(1px)' }

const rowClass = 'flex w-full items-start gap-1 px-2.5 text-left transition-colors'

// Painted by state, not by a group-hover class: the panel cannot rely on a utility
// the app's own stylesheet was not built with.
// Padding and an equal negative margin: the band grows without moving the row.
const bandStyle = {
  padding: `${BAND_PY}px 4px`,
  margin: `-${BAND_PY}px 0`,
  borderRadius: '4px'
}
// One height for every HEADER band, so a project, a feature and the review row measure alike.
// 16px of content plus 2·BAND_PY paints a 24px band. The control inside a header band uses the
// same number as its height, and the label's line box (~13px for 10px text) stays under the
// floor, so nothing but the floor can set the height. Content-box is explicit: the app may set
// border-box globally, which would charge the padding against this number instead of adding it.
const BAND_MIN_H_N = 16
const BAND_MIN_H = `${BAND_MIN_H_N}px`
const headerBandStyle = { ...bandStyle, minHeight: BAND_MIN_H, boxSizing: 'content-box' }
// A control in the STATE area: the hover band's height, the card's own width, the word centred — the
// same size as the buttons at the foot of a compose card. Declared here, after the band numbers it
// multiplies: a const that reads them earlier dies on the temporal dead zone.
const STATE_CONTROL_CLASS =
  'mx-2.5 my-1 flex shrink-0 items-center justify-center rounded border border-(--ui-stroke-secondary) text-[0.6875rem]'
// A control in that row takes CAPS; `in review` keeps the plain class, because it is a message standing
// where the control stood, not a thing to press. One gesture, one meaning: a word you can press is caps.
const STATE_ACTION_CLASS = `${STATE_CONTROL_CLASS} uppercase`
// The app's composer measures 42px outer with a 40px fill: our thread composer copies it.
const COMPOSER_H_N = 40
// One line of the composer's own text: the floor for the field's height, and the height the field
// keeps while the writing still fits beside the SEND. The BOX keeps its 42px through `minHeight`, so an
// empty field stays one line tall instead of one line plus padding. The field itself has no ceiling —
// it grows with its text and the thread block above it rises, so nothing ever needs a scroll bar.
const COMPOSER_LINE_H_N = 12
// The SEND: 32px fills the field's inner 40 with an even 4px of air above it and 4px below.
const SEND_H_N = BAND_MIN_H_N + 2 * BAND_PY + 8
// Air between the writing and the SEND: the gap a line stops short of while the two share a row, and
// the space above the SEND's row once it moves under the writing.
const COMPOSER_GAP_N = 4
// The lane's model stands on a row of its own above the box: the panel's standard control height, so the
// line reads as one more row of the card and not as part of the field.
const MODEL_ROW_H_N = BAND_MIN_H_N + 2 * BAND_PY
// The field's own padding, 2px at the left and 6px at the right. It is part of the field's width, so a
// line's real room is the field minus their sum.
const FIELD_PAD_L_N = 2
const FIELD_PAD_R_N = 6
const FIELD_PAD_N = FIELD_PAD_L_N + FIELD_PAD_R_N
// The box's own padding, 4px on each side.
const COMPOSER_PAD_N = 8
// The box's top edge, dragged up: 5 px first, then 10 more. The box is pinned to the card's bottom edge,
// so the extra height lifts that edge and leaves everything inside centred.
const COMPOSER_EXTRA_N = 5 + 10

/** The height this text needs when it is wrapped at a given width, in the element's own font metrics.
 *  The mirror wraps at the width it is GIVEN, never at the element's current padding: a measurement
 *  that depends on the very layout it decides flips back and forth on every keystroke. */
function measureWrappedHeight(element, style, width) {
  if (typeof document === 'undefined' || !element || !(width > 0)) return COMPOSER_LINE_H_N
  const mirror = document.createElement('div')
  mirror.style.cssText = [
    'position:absolute',
    'left:-9999px',
    'top:0',
    'visibility:hidden',
    'pointer-events:none',
    'box-sizing:content-box',
    `width:${width}px`,
    `font-family:${style.fontFamily}`,
    `font-size:${style.fontSize}`,
    `line-height:${style.lineHeight}`,
    `letter-spacing:${style.letterSpacing}`,
    'white-space:pre-wrap',
    'overflow-wrap:break-word',
    'word-break:break-word'
  ].join(';')
  mirror.textContent = element.value
  document.body.appendChild(mirror)
  const height = mirror.scrollHeight
  document.body.removeChild(mirror)
  return Math.max(height, COMPOSER_LINE_H_N)
}

/** The width one line of this text needs when nothing wraps it. `white-space: pre` with an auto width,
 *  so the answer depends on the text alone and never on the shape this number decides. */
function measureLineWidth(element, style, text) {
  if (typeof document === 'undefined' || !element || !text) return 0
  const mirror = document.createElement('span')
  mirror.style.cssText = [
    'position:absolute',
    'left:-9999px',
    'top:0',
    'visibility:hidden',
    'pointer-events:none',
    'display:inline-block',
    'white-space:pre',
    `font-family:${style.fontFamily}`,
    `font-size:${style.fontSize}`,
    `line-height:${style.lineHeight}`,
    `letter-spacing:${style.letterSpacing}`
  ].join(';')
  mirror.textContent = text
  document.body.appendChild(mirror)
  const width = mirror.getBoundingClientRect().width
  document.body.removeChild(mirror)
  return width
}

/** How tall the writing is, and whether its line still ends before the button.

 *  ONE decision from two numbers that do not depend on the shape it picks: the line's UNWRAPPED width
 *  against the room beside the button, and a typed break. Once the line would reach the button the writing
 *  takes the whole box, above it. The chip sits under the writing and takes no part in this test. */
function measureField(element) {
  const fallback = { height: COMPOSER_LINE_H_N, inline: true }
  if (typeof document === 'undefined' || !element) return fallback
  const box = element.closest ? element.closest('[data-composer]') : null
  if (!box || !box.clientWidth) return fallback
  const style = window.getComputedStyle(element)
  // The box's inner width: `clientWidth` keeps its padding and drops its border.
  const inner = box.clientWidth - COMPOSER_PAD_N
  const send = box.querySelector('[data-send]')
  // The room a line has while the button stands beside it — the number the decision reads.
  const beside = inner - (send ? send.getBoundingClientRect().width : 0) - COMPOSER_GAP_N - FIELD_PAD_N
  const text = `${element.value || ''}`
  // A line break is a second line by definition, whatever its width says.
  const inline = text.indexOf('\n') === -1 && measureLineWidth(element, style, text) <= beside
  // The height is measured at the width the field will really have in that shape.
  return { height: measureWrappedHeight(element, style, inline ? beside : inner - FIELD_PAD_N), inline }
}
const STATE_CONTROL_STYLE = {
  height: `${BAND_MIN_H_N + 2 * BAND_PY}px`,
  boxSizing: 'border-box'
}
const labelBand = ''
const labelBandOn = 'bg-(--chrome-action-hover)'


function firstLine(text) {
  if (!text) return ''
  const line = text.split('\n').find(part => part.trim())
  return line ? line.trim().slice(0, 80) : ''
}

function LaneRow({ lane, active, onPick }) {
  const [hover, setHover] = useState(false)
  const snippet = lane.shelved ? lane.shelved_reason : firstLine(lane.last_text) || lane.task
  const dim = lane.shelved ? 'opacity-55' : ''
  const asked = lane.state === 'waiting'
  const bad = isBad(lane)
  // The outline states the lane's condition once; the motion belongs to the gear and the ball.
  const outline = lane.state === 'running'
    ? RUN_COLOR
    : asked
      ? ASK_OUTLINE
      : bad
        ? BAD_COLOR
        : null
  // The selected row has no ring: the selection figure draws its frame, and a second line would sit
  // ten pixels inside it.
  const ring = active ? null : outline
  // A selected lane lets its fill go: solid under the text, then a gradient to nothing at the right edge, so
  // the row dissolves toward the right part instead of ending on a hard line.
  // A question lane already carries the 85% fill, so the plain hover paint would land under it and do
  // nothing: the pointer deepens the same blue to solid instead. White on it goes 4.6:1 → 6.2:1.
  const softFill = asked ? (hover ? ASK_COLOR : ASK_BG) : 'var(--chrome-action-hover)'
  const fill = active
    ? `linear-gradient(to right, ${softFill} calc(100% - ${ROW_FADE}px), rgba(0,0,0,0))`
    : softFill
  // A selected lane's fill also runs the last ten pixels to the divider, so it ends where the right part begins
  // rather than short of it.
  const bandFill =
    asked || active || hover
      ? { ...bandStyle, background: fill, ...(active ? { marginRight: `-${ROW_PAD}` } : {}) }
      : bandStyle
  const statusColor = asked ? '#ffffff' : stateText(lane)
  // The frame colour, not the text colour: a question row writes white on blue.
  const frameColor = asked ? ASK_COLOR : bad ? BAD_COLOR : lane.state === 'running' ? RUN_COLOR : DONE_COLOR
  const className = [rowClass, dim]
    .filter(Boolean)
    .join(' ')

  return jsxs('button', {
    type: 'button',
    onClick: onPick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    // The right pane is framed in this row's colour: the box and the colour are measured there.
    'data-pi-selected': active ? '1' : undefined,
    'data-pi-colour': active ? frameColor : undefined,
    className,
    // The highlight starts at the icon, so the stub and the line stay outside it.
    // One style object only — a second key here is silently dropped by JavaScript.
    style: {
      // A clicked button takes focus and the app paints a ring round the label band; the panel
      // draws its own selection frame, so the ring reads as a second, leftover outline.
      outline: 'none',
      position: 'relative',
      marginLeft: ROW_PAD,
      width: `calc(100% - ${ROW_PAD})`,
      paddingTop: ROW_PY,
      paddingBottom: ROW_PY,
      paddingLeft: 0,
      // The header rows keep 8px on the right; a lane's class would leave 10 and its box
      // would end two pixels short of theirs.
      paddingRight: '10px'
    },
    children: [
      // Centre of the row, which is where the stub arrives: a two-line row put the
      // icon on its first line and left it half a line above the connector.
      jsx('span', {
        className: 'flex shrink-0 items-center justify-center self-center',
        style: { width: `${ICON_SIZE}px`, height: `${ICON_SIZE}px` },
        children: jsx(icons.Terminal, { size: ICON_SIZE })
      }),
      jsxs('span', {
        className: `min-w-0 flex-1 ${labelBand}`,
        'data-pi-band': '',
        style: ring ? { ...bandFill, boxShadow: `inset 0 0 0 0.5px ${ring}` } : bandFill,
        children: [
          jsxs('span', {
            className: 'flex items-baseline gap-2',
            children: [
              jsx('span', {
                className: `truncate font-mono text-[0.6875rem] ${asked ? 'font-medium' : ''}`,
                style: asked ? { color: '#ffffff' } : undefined,
                children: lane.lane
              }),
              jsx('span', {
                className: 'ml-auto flex shrink-0 items-center gap-1 text-[0.625rem]',
                style: { color: statusColor || 'var(--ui-text-tertiary)' },
                // A working lane says it with motion; the rest keep their word, and a
                // question carries the same mark the headers use.
                children: lane.state === 'running' ? jsx(Gear, {}) : asked ? `? ${lane.state}` : lane.state
              })
            ]
          }),
          jsx('span', {
            className: 'block truncate text-[0.625rem]',
            style: { color: asked ? 'rgba(255, 255, 255, 0.82)' : 'var(--ui-text-tertiary)' },
            children: snippet || '—'
          })
        ]
      })
    ]
  })
}

const collapsedAtom = atom({})

// What the right pane is framed by: the selected row's own box, in the row's own colour.
const selectedBox = atom(null)


// The right pane shows exactly one thing. Every pick clears the other five states first — the settings
// screen included: a click on a tree row must close it and open what was clicked. A pick made while a
// feature card or a compose field was open used to leave that card on screen, which reads as "I selected
// another element and the pane is still old".
function showLane(name) {
  showSettings.set(false)
  composeAtom.set(null)
  composeProject.set(false)
  selectedProject.set(null)
  selectedFeature.set(null)
  selectedLane.set(name)
}


function showFeature(project, feature) {
  showSettings.set(false)
  composeAtom.set(null)
  composeProject.set(false)
  selectedProject.set(null)
  selectedLane.set('')
  selectedFeature.set({ project, feature })
}


function showProject(name) {
  showSettings.set(false)
  composeAtom.set(null)
  composeProject.set(false)
  selectedLane.set('')
  selectedFeature.set(null)
  selectedProject.set(name)
}


/** Nothing is selected: the right pane says so and no figure is drawn. */
function clearPane() {
  showSettings.set(false)
  composeAtom.set(null)
  composeProject.set(false)
  selectedProject.set(null)
  selectedFeature.set(null)
  selectedLane.set('')
}


function showComposeFeature(project) {
  showSettings.set(false)
  composeProject.set(false)
  selectedLane.set('')
  selectedFeature.set(null)
  selectedProject.set(null)
  composeAtom.set({ project })
}


function showComposeProject() {
  showSettings.set(false)
  composeAtom.set(null)
  selectedLane.set('')
  selectedFeature.set(null)
  selectedProject.set(null)
  composeProject.set(true)
}


/** The frame exists only for a row wholly inside the strip under the header.

    Pure on purpose: the rule is then checkable with four numbers instead of a browser.
 */
const HEADER_STEP = 28

function visibleFrame(rawTop, rawBottom, limit) {
  if (rawTop < HEADER_STEP || rawBottom > limit) return null
  return { top: rawTop, height: rawBottom - rawTop }
}


/** The figure's path from a box: the band's frame open on the right, joined to the pane. */
function framePath(box) {
  const radius = 4
  // Half a pixel in from the panel's edges: a 1px stroke centred on 0 or width would be cut by the clip.
  const edgeT = 0.5
  const edgeR = box.width - 0.5
  const edgeB = box.height - 0.5
  const seam = box.seam
  const paneOnly = box.top === null

  if (paneOnly) {
    // The row is out of sight: the pane keeps its frame and the seam becomes its left side.
    return (
      `M ${seam} ${edgeT + radius} Q ${seam} ${edgeT} ${seam + radius} ${edgeT} ` +
      `L ${edgeR - radius} ${edgeT} Q ${edgeR} ${edgeT} ${edgeR} ${edgeT + radius} ` +
      `L ${edgeR} ${edgeB - radius} Q ${edgeR} ${edgeB} ${edgeR - radius} ${edgeB} ` +
      `L ${seam + radius} ${edgeB} Q ${seam} ${edgeB} ${seam} ${edgeB - radius} Z`
    )
  }

  const left = box.left
  const top = box.top
  const bottom = box.top + box.rowHeight
  return (
    `M ${left + radius} ${top} L ${seam - radius} ${top} ` +
    `Q ${seam} ${top} ${seam} ${top - radius} ` +
    `L ${seam} ${edgeT + radius} Q ${seam} ${edgeT} ${seam + radius} ${edgeT} ` +
    `L ${edgeR - radius} ${edgeT} Q ${edgeR} ${edgeT} ${edgeR} ${edgeT + radius} ` +
    `L ${edgeR} ${edgeB - radius} Q ${edgeR} ${edgeB} ${edgeR - radius} ${edgeB} ` +
    `L ${seam + radius} ${edgeB} Q ${seam} ${edgeB} ${seam} ${edgeB - radius} ` +
    `L ${seam} ${bottom + radius} Q ${seam} ${bottom} ${seam - radius} ${bottom} ` +
    `L ${left + radius} ${bottom} ` +
    `Q ${left} ${bottom} ${left} ${bottom - radius} ` +
    `L ${left} ${top + radius} Q ${left} ${top} ${left + radius} ${top} Z`
  )
}


/** Paint an existing figure without React: the same frame, in the same frame as the scroll. */
function paintFrame(box) {
  const root = document.querySelector('[data-pi-root]')
  const svg = root && root.querySelector('[data-pi-frame]')
  if (!svg) return false
  const path = svg.querySelector('[data-pi-path]')
  const up = svg.querySelector('[data-pi-seam-top]')
  const down = svg.querySelector('[data-pi-seam-bottom]')
  if (!path || !up || !down) return false
  const seam = box.seam + 0.5
  const radius = 4
  const notch = box.top !== null
  const top = notch ? box.top - radius : 0
  const bottom = notch ? box.top + box.rowHeight + radius : 0
  path.setAttribute('d', framePath(box))
  up.setAttribute('x1', seam); up.setAttribute('x2', seam)
  up.setAttribute('y1', 0.5); up.setAttribute('y2', top)
  down.setAttribute('x1', seam); down.setAttribute('x2', seam)
  down.setAttribute('y1', bottom); down.setAttribute('y2', notch ? box.height - 0.5 : 0)
  return true
}


function measureSelection() {
  const root = document.querySelector('[data-pi-root]')
  const row = root && root.querySelector('[data-pi-selected]')
  if (!root || !row) {
    if (selectedBox.get()) selectedBox.set(null)
    return
  }
  // The band, not the row: the row keeps its own state ring and the figure continues from that ring's
  // right edge into the pane.
  const band = row.querySelector('[data-pi-band]') || row
  const outer = root.getBoundingClientRect()
  // The panel carries a 1px border; the overlay sits inside it. Without this the figure is drawn a pixel
  // up and left, and its right and bottom edges fall under the border.
  const borderX = Math.round((outer.width - root.clientWidth) / 2)
  const borderY = Math.round((outer.height - root.clientHeight) / 2)
  const box = band.getBoundingClientRect()
  // The frame is drawn only while the row is wholly inside the visible strip under the header. A cut
  // notch reads as a broken figure, and a row scrolled away must not leave a frame behind.
  const frame = visibleFrame(
    Math.round(box.top - outer.top) - borderY,
    Math.round(box.bottom - outer.top) - borderY,
    root.clientHeight
  )
  const next = {
    width: root.clientWidth,
    height: root.clientHeight,
    seam: Math.round(root.clientWidth / 2),
    left: Math.round(box.left - outer.left) - borderX,
    right: Math.round(box.right - outer.left) - borderX,
    // No notch when the row is out of sight: the pane stays framed in the row's colour, seam closed.
    top: frame ? frame.top : null,
    rowHeight: frame ? frame.height : 0,
    color: row.getAttribute('data-pi-colour') || 'var(--ui-text-tertiary)'
  }
  const current = selectedBox.get()
  const sameShape =
    current &&
    current.width === next.width &&
    current.height === next.height &&
    current.color === next.color
  if (sameShape) {
    // Same box, new place: paint it straight into the SVG, one frame, no render.
    paintFrame(next)
    return
  }
  selectedBox.set(next)
}


/** One line around the selected row and the right pane: the seam opens where the row is. */
function SelectionOutline() {
  const box = useValue(selectedBox)
  // Subscribe to what moves the box. Without these two reads the outline stays on the row that was
  // selected when this component last rendered — the box is measured in a ref, and a ref only runs
  // on a render.
  useValue(selectedLane)
  useValue(selectedFeature)
  // Collapsing a feature takes its lane rows out of the DOM: without this read the frame keeps the box
  // it measured before the rows left, which reads as an outline stuck in the old place.
  useValue(collapsedAtom)
  // And the panel's own size: a resized pane moves both the seam and the row.
  useValue(host.state.viewport)
  // And every scroll: the tree moves under a fixed frame, and nothing else here re-renders when it does.
  // This atom already updates once per frame, so it doubles as the scroll signal.
  useValue(scrollPill)
  // Measure after the frame, not during the commit: the row's final box is only settled once the
  // whole panel has painted.
  const probe = jsx('span', {
    style: { display: 'none' },
    ref: () => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => measureSelection())
      else measureSelection()
    }
  })
  const seam = box ? box.seam : 0
  const top = box ? box.top : 0
  const bottom = box ? box.top + box.rowHeight : 0
  const figure = box ? framePath(box) : ''

  return jsxs('div', {
    'aria-hidden': true,
    style: { position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 },
    children: [
      probe,
      box
        ? jsxs('svg', {
            'data-pi-frame': '',
            width: box.width,
            height: box.height,
            viewBox: `0 0 ${box.width} ${box.height}`,
            style: { position: 'absolute', inset: 0, pointerEvents: 'none' },
            children: [
              // The seam above the row, and below it: the selected row is the only gap. With the row out
              // of sight the figure closes over the seam and these two have nothing to draw.
              box.top === null
                ? null
                : jsx('line', {
                'data-pi-seam-top': '',
                x1: seam + 0.5,
                y1: 0,
                x2: seam + 0.5,
                // Stops where the fillet starts, or its end pokes into the rounded corner.
                y2: top - 4,
                stroke: 'var(--ui-stroke-secondary)',
                strokeWidth: 1
              }),
              box.top === null
                ? null
                : jsx('line', {
                'data-pi-seam-bottom': '',
                x1: seam + 0.5,
                y1: bottom + 4,
                x2: seam + 0.5,
                y2: box.height,
                stroke: 'var(--ui-stroke-secondary)',
                strokeWidth: 1
              }),
              jsx('path', {
                'data-pi-path': '',
                d: figure,
                fill: 'none',
                stroke: box.color,
                strokeWidth: 1,
                strokeLinejoin: 'round'
              })
            ]
          })
        : jsx('div', {
            style: {
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: '50%',
              width: '1px',
              background: 'var(--ui-stroke-secondary)'
            }
          })
    ]
  })
}

// A thin pill on the divider: the side under the cursor, 44px, drag to scroll.
const scrollPill = atom({ hover: 'tree', tree: 0, pane: 0, visible: false })
const PILL_H = 44
let pillTimer = null


function noteHover(side) {
  scrollPill.set({ ...scrollPill.get(), hover: side })
}


let pendingScroll = null


function reportScroll(side, element) {
  if (!element) return
  // The frame is written here, synchronously: a scroll event arrives before the frame is painted, so a
  // rect read and three attribute writes still land in the same picture. The pill below keeps its frame
  // budget — it is decoration and may lag by one.
  measureSelection()
  const span = element.scrollHeight - element.clientHeight
  // Keep only the newest position, and write it at most once per frame: a wheel fires dozens
  // of events and every atom write re-renders the whole panel.
  pendingScroll = { side, progress: span > 0 ? element.scrollTop / span : 0, span }
  if (!reportScroll.frame) {
    const raf =
      typeof requestAnimationFrame === 'function' ? requestAnimationFrame : fn => setTimeout(fn, 16)
    reportScroll.frame = raf(() => {
      reportScroll.frame = null
      if (!pendingScroll) return
      const { side: which, progress, span: room } = pendingScroll
      pendingScroll = null
      scrollPill.set({ ...scrollPill.get(), [which]: progress, visible: room > 0 })
    })
  }
  if (pillTimer) clearTimeout(pillTimer)
  pillTimer = setTimeout(() => {
    scrollPill.set({ ...scrollPill.get(), visible: false })
  }, 1000)
}


function pillTarget(side) {
  const column = document.querySelector(`[data-pi-side="${side}"]`)
  return column ? column.querySelector('[data-pi-scroll]') : null
}


/** A scroll area with no native bar: the bar is drawn into a strip this box clips away.

    CSS cannot hide it here — the app styles ::-webkit-scrollbar, and a styled scrollbar ignores
    scrollbar-width. Fourteen pixels of negative margin put the bar outside the visible edge.
 */
function Scroller({ side, grow, className, style, children }) {
  return jsx('div', {
    style: {
      overflow: 'hidden',
      minHeight: 0,
      ...(grow ? { flex: '1 1 auto' } : { height: '100%' })
    },
    children: jsx('div', {
      className: `pi-team-scroll h-full ${className || ''}`,
      'data-pi-scroll': side,
      // Full width: the content must equal the column, or right-aligned values get cut.
      // The bar is hidden by the rule below, which beats the app's own ::-webkit-scrollbar.
      style: { ...(style || {}), width: '100%', overflowY: 'auto' },
      onScroll: event => reportScroll(side, event.currentTarget),
      children
    })
  })
}


function ScrollPill() {
  const state = useValue(scrollPill)
  if (!state.visible) return null
  const side = state.hover === 'pane' ? 'pane' : 'tree'
  const progress = Math.min(1, Math.max(0, Number(state[side]) || 0))

  const onDown = event => {
    const element = pillTarget(side)
    const track = event.currentTarget.parentElement
    if (!element || !track) return
    event.preventDefault()
    const box = track.getBoundingClientRect()
    const move = moveEvent => {
      const ratio = (moveEvent.clientY - box.top - PILL_H / 2) / Math.max(1, box.height - PILL_H)
      const clamped = Math.min(1, Math.max(0, ratio))
      const span = element.scrollHeight - element.clientHeight
      element.scrollTop = clamped * span
      scrollPill.set({ ...scrollPill.get(), [side]: clamped, visible: true })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (pillTimer) clearTimeout(pillTimer)
      pillTimer = setTimeout(() => scrollPill.set({ ...scrollPill.get(), visible: false }), 700)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return jsx('div', {
    title: 'drag to scroll',
    onPointerDown: onDown,
    style: {
      position: 'absolute',
      left: 'calc(50% - 1.5px)',
      width: '3px',
      height: `${PILL_H}px`,
      top: `calc(${progress} * (100% - ${PILL_H}px))`,
      borderRadius: '999px',
      background: 'var(--ui-text-quaternary)',
      opacity: 0.55,
      cursor: 'grab',
      touchAction: 'none',
      // The wrapper ignores the mouse so the columns keep their clicks; the pill takes them back.
      pointerEvents: 'auto',
      zIndex: 6,
      transition: 'opacity 180ms linear'
    }
  })
}


// A hover that moves the word and the box between two paints needs a fade, or it snaps.
const HOVER_FADE = 'background-color 120ms linear, color 120ms linear, border-color 120ms linear'

/** Hover as state, not a class. The app's build carries no `--ui-fill-*` token and generated no
 *  `hover:text-(--ui-accent)` utility, so both classes painted nothing and left dead controls.
 *  An inline value always applies. The tag belongs to the caller, so a real <button> stays one. */
function HoverBox({ tag, title, onClick, className, style, hoverFill, hoverColour, children, ...rest }) {
  // Any other prop passes through untouched: the panel's probes and measurements anchor on data-* names.
  const [over, setOver] = useState(false)
  const base = style || {}
  const paints = {}
  if (hoverFill) paints.background = over ? hoverFill : base.background || 'transparent'
  if (hoverColour) paints.color = over ? hoverColour : base.color
  return jsx(tag === 'button' ? 'button' : 'span', {
    ...rest,
    ...(tag === 'button' ? { type: 'button' } : { role: 'button', tabIndex: 0 }),
    title: title || '',
    onClick: event => {
      if (event && event.stopPropagation) event.stopPropagation()
      if (onClick) onClick(event)
    },
    onMouseEnter: () => setOver(true),
    onMouseLeave: () => setOver(false),
    className,
    style: { ...base, ...paints, transition: base.transition || HOVER_FADE },
    children
  })
}

/** One control inside a header band: a word, or a square glyph box. The fill the app really has is
 *  `--ui-bg-tertiary`, and the word brightens to `--ui-text-secondary`. */
function HeaderControl({ title, onClick, label, glyph, size, fontSize, colour, hoverColour, border }) {
  return jsx(HoverBox, {
    title,
    onClick,
    // Not a <button>: the whole header row is already one, and a button inside a button is
    // invalid — the browser rearranges it and the row drifts.
    className: 'flex shrink-0 items-center justify-center rounded border uppercase',
    style: {
      // The box sits half a pixel above the text's axis.
      transform: 'translateY(-0.5px)',
      height: BAND_MIN_H,
      ...(size ? { width: size } : { padding: '0 5px' }),
      fontSize: fontSize || '10.5px',
      lineHeight: 1,
      borderColor: border || 'var(--ui-stroke-secondary)',
      color: colour || 'var(--ui-text-tertiary)',
      cursor: 'pointer'
    },
    hoverFill: 'var(--ui-bg-tertiary)',
    hoverColour: hoverColour || colour || 'var(--ui-text-secondary)',
    children: glyph || jsx('span', {
      // The box stays where it is; only the word drops one pixel inside it.
      style: { display: 'block', transform: 'translate(0.5px, 0.5px)' },
      children: label
    })
  })
}

function ListHeader({ label, counts, plain, action, open, onToggle, dim, tag, selected, colour }) {
  const [hover, setHover] = useState(false)
  const [asking, setAsking] = useState(false)
  const hasCounts = Boolean(counts && (counts.ask || counts.bad || counts.run || counts.done))
  const hasPlain = plain !== undefined && plain !== null
  const groups = hasCounts
    ? [
        counts.ask ? mark('?', counts.ask, ASK_TEXT) : null,
        counts.bad ? mark('!', counts.bad, BAD_TEXT) : null,
        counts.run
          ? jsxs(
              'span',
              {
                className: 'flex items-center gap-0.5',
                style: { color: RUN_TEXT },
                children: [
                  jsx('span', {
                    style: { display: 'flex', transform: 'translateY(-2px)' },
                    children: jsx(Gear, {})
                  }),
                  jsx('span', { children: String(counts.run) })
                ]
              },
              'run'
            )
          : null,
        counts.done ? mark('✓', counts.done, DONE_COLOR) : null
      ]
    : null
  return jsxs('div', {
    className: `flex items-center ${dim || ''}`,
    style: { position: 'relative' },
    children: [
      jsx('button', {
        type: 'button',
        onClick: onToggle,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        'data-pi-selected': selected ? '1' : undefined,
        'data-pi-colour': selected ? colour : undefined,
        className:
          'flex min-w-0 flex-1 items-center gap-1 pr-2.5 text-left text-[0.625rem] uppercase tracking-wide text-(--ui-text-tertiary)',
        // One style object, and no focus ring: the panel draws its own selection frame.
        style: {
          marginLeft: ROW_PAD,
          width: `calc(100% - ${ROW_PAD})`,
          paddingTop: HEADER_PY,
          paddingBottom: HEADER_PY,
          outline: 'none'
        },
        children: [
          jsx('span', {
            className: 'flex shrink-0 items-center justify-center',
            style: { width: `${ICON_SIZE}px` },
            children: jsx(FolderIcon, { open })
          }),
          jsxs('span', {
            className: `flex min-w-0 flex-1 items-center gap-1 ${labelBand}`,
            'data-pi-band': '',
            style: counts && counts.ask
              ? { ...headerBandStyle, background: hover ? ASK_BG_HOVER : ASK_BG_SOFT }
              : hover
                ? { ...headerBandStyle, background: 'var(--chrome-action-hover)' }
                : headerBandStyle,
            children: [
              jsx('span', {
                className: 'truncate',
                // Shrinks when the name is long, so the counters keep their place on the right
                // edge instead of being pushed inwards by the overflow.
                style: {
                  ...TEXT_NUDGE,
                  flex: '0 1 auto',
                  minWidth: 0,
                  ...(hover ? { color: 'var(--ui-text-secondary)' } : null)
                },
                children: label
              }),
              tag
                ? jsx('span', {
                    className: 'shrink-0 uppercase',
                    style: { ...TEXT_NUDGE, color: 'var(--ui-text-tertiary)', fontSize: '10.5px' },
                    children: tag
                  })
                : null,
              // A create action has nothing to confirm: one click opens the field.
              action && action.instant
                ? jsx(HeaderControl, {
                    title: action.title,
                    label: action.label,
                    onClick: action.onClick
                  })
                : null,
              action && !action.instant
                ? asking
                  ? jsxs('span', {
                      className: 'flex shrink-0 items-center gap-1',
                      children: [
                        jsx(
                          HeaderControl,
                          {
                            title: 'cancel',
                            glyph: '✕',
                            size: BAND_MIN_H,
                            fontSize: '12px',
                            colour: BAD_TEXT,
                            hoverColour: BAD_TEXT,
                            border: BAD_TEXT,
                            onClick: () => setAsking(false)
                          },
                          'cancel'
                        ),
                        jsx(
                          HeaderControl,
                          {
                            title: action.title,
                            glyph: '✓',
                            size: BAND_MIN_H,
                            fontSize: '12px',
                            colour: RUN_TEXT,
                            hoverColour: RUN_TEXT,
                            border: RUN_TEXT,
                            onClick: () => {
                              setAsking(false)
                              action.onClick()
                            }
                          },
                          'go'
                        )
                      ]
                    })
                  : jsx(HeaderControl, {
                      title: action.title,
                      label: action.label,
                      onClick: () => setAsking(true)
                    })
                : null,
              hasCounts || hasPlain
                ? jsxs('span', {
                    className: 'ml-auto flex shrink-0 items-center gap-1.5 pl-2',
                    style: TEXT_NUDGE,
                    children: [
                      hasCounts ? groups : null,
                      // A plain grey total stands next to the marks, for a group that is
                      // one kind by definition.
                      hasPlain
                        ? jsx('span', {
                            style: { color: 'var(--ui-text-tertiary)' },
                            children: String(plain)
                          })
                        : null
                    ]
                  })
                : null
            ]
          })
        ]
      }),
    ]
  })
}

function LaneList({ ctx }) {
  const query = useQuery({
    queryKey: ['pi-team', 'lanes'],
    queryFn: () => ctx.rest('/lanes', REST),
    refetchInterval: POLL_MS
  })
  const current = useValue(selectedLane)
  const pickedFeature = useValue(selectedFeature)
  const cwd = useValue(host.state.cwd)
  // Stored ids survive a reload; runtime ids do not, and openSession takes the stored one.
  // Both hooks run unconditionally: a conditional one makes the count vary per render.
  const storedSessionId = useValue(host.state.focusedStoredSessionId)
  const runtimeSessionId = useValue(host.state.activeSessionId)
  const sessionId = storedSessionId || runtimeSessionId
  const collapsed = useValue(collapsedAtom)
  const lanes = (query.data && query.data.lanes) || []

  const toggle = key => collapsedAtom.set({ ...collapsed, [key]: !collapsed[key] })
  const isOpen = key => !collapsed[key]

  const [askUpdate, setAskUpdate] = useState(false)
  const registry = (query.data && query.data.registry) || []
  const registryByName = new Map(registry.map(entry => [entry.name, entry]))

  const matchesCwd = (repo, name) =>
    repo && cwd && (cwd === repo || cwd.startsWith(repo + '/')) ? name : ''
  const autoProject =
    lanes.reduce((found, lane) => found || matchesCwd(lane.repo, lane.project), '') ||
    registry.reduce((found, entry) => found || matchesCwd(entry.repo, entry.name), '')
  const focused = autoProject

  const laneByProject = new Map()
  for (const lane of lanes) {
    const project = lane.project || '—'
    if (!laneByProject.has(project)) laneByProject.set(project, [])
    laneByProject.get(project).push(lane)
  }
  const projectNames = new Set([
    ...laneByProject.keys(),
    ...registry.map(entry => entry.name)
  ])
  const projects = [...projectNames].sort()

  const renderLane = (lane, last) =>
    jsx(
      TreeRow,
      {
        last,
        // Lane rows touch: their own extension would overlap the next lane's segment.
        tail: 0,
        runner: lane.state === 'running',
        row: jsx(LaneRow, {
          lane,
          active: lane.lane === current,
          // A second click on the selected lane releases it; the pane says where to pick next.
          onPick: () => {
            if (lane.lane === current) clearPane()
            else showLane(lane.lane)
          }
        })
      },
      lane.lane
    )

  const projectBlocks = projects.map(project => {
    const all = laneByProject.get(project) || []
    const open = isOpen(`p:${project}`) && (!focused || focused === project)
    const shelved = all.filter(lane => lane.shelved)
    const handed = all.filter(lane => lane.handed && !lane.shelved)
    const active = all.filter(lane => !lane.shelved && !lane.handed)

    const registered = registryByName.get(project)
    const placing = Boolean(registered && registered.state === 'preparation')
    const featureByName = new Map(
      ((registered && registered.features) || []).map(feature => [feature.name, feature])
    )
    const groups = new Map()
    for (const feature of (registered && registered.features) || []) {
      groups.set(feature.name, [])
    }
    for (const lane of active) {
      const key = lane.group || ''
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(lane)
    }

    const groupKeys = [...groups.keys()].sort()

    const featureNodes = groupKeys.map((groupKey, index) => {
      const items = groups.get(groupKey)
      const gkey = `g:${project}/${groupKey}`
      const gopen = isOpen(gkey)
      // The add-feature row opens the block now, so a feature ends the level only when
      // nothing follows it: no review queue and no closed group below.
      const last = index === groupKeys.length - 1 && !handed.length && !shelved.length

      const meta = featureByName.get(groupKey)
      // A placeholder has no name and no lanes yet: it opens its own card, not a list.
      const preparing = Boolean(meta && meta.state === 'preparation')

      // A feature's frame takes the worst news among its lanes, the same rule the counters use.
      const colour = items.some(isBad)
        ? BAD_COLOR
        : items.some(lane => lane.state === 'waiting')
          ? ASK_COLOR
          : items.some(lane => lane.state === 'running')
            ? RUN_COLOR
            : DONE_COLOR
      const chosen = pickedFeature && pickedFeature.feature === groupKey && pickedFeature.project === project

      return jsx(
        TreeRow,
        {
          last,
          trunk: gopen && items.length > 0,
          row: jsx(ListHeader, {
            selected: chosen,
            colour,
            label: preparing ? meta.title || groupKey : groupKey || 'ungrouped',
            // How long it has been waiting for me: a placeholder nobody picked up must show it.
            tag: preparing
              ? (() => {
                  const minutes = Math.floor((Date.now() / 1000 - Number(meta.created || 0)) / 60)
                  return minutes >= 1 ? `preparation · ${minutes}m` : 'preparation'
                })()
              : '',
            dim: preparing ? 'italic' : '',
            // Open: its rows report themselves, so the counts belong to the closed state.
            counts: preparing || gopen ? null : countStates(items),
            open: gopen,
            onToggle: () => {
              if (preparing) {
                showFeature(project, groupKey)
                return
              }
              // A feature has no card of its own. The click only opens or closes it, in both
              // directions: the lane you were reading stays selected, and its frame comes back when the
              // rows return to the tree.
              toggle(gkey)
            }
          }),
          children: [
            gopen && items.length
              ? jsx('div', {
                  'data-pi-kids': '',
                  style: { paddingLeft: GUIDE_STEP, paddingTop: FEATURE_GAP },
                  children: items.map((lane, i) => renderLane(lane, i === items.length - 1))
                })
              : null
          ]
        },
        gkey
      )
    })

    const handedOpen = isOpen(`h:${project}`)
    const handedNode = handed.length
      ? jsx(
          TreeRow,
          {
            last: !shelved.length,
            // The review row has children too, so its line must reach down to them. Without this
            // the segment starts a whole row late and leaves a hole between the folder and the
            // first lane's own segment — the only row in the tree that had no trunk.
            trunk: handedOpen,
            // Its lanes begin at the container's top edge: no padding to fill.
            trunkTail: 0,
            row: jsx(ListHeader, {
              label: 'review',
              plain: handed.length,
              action: {
                label: 'send',
                title: 'put this queue into the chat for a check',
                onClick: () =>
                  ctx.rest('/review/send', {
                    method: 'POST',
                    body: { project, session_key: sessionId },
                    timeoutMs: 15000
                  }).then(() => query.refetch())
              },
              open: handedOpen,
              onToggle: () => {
                toggle(`h:${project}`)
                showLane(`handed:${project}`)
              }
            }),
            children: [
              handedOpen
                ? jsx('div', {
                    style: { paddingLeft: GUIDE_STEP },
                    children: handed.map((lane, i) => renderLane(lane, i === handed.length - 1))
                  })
                : null
            ]
          },
          `handed:${project}`
        )
      : null

    const shelfOpen = isOpen(`s:${project}`)
    const shelfNode = shelved.length
      ? jsx(
          TreeRow,
          {
            last: true,
            trunk: shelfOpen,
            trunkTail: 0,
            row: jsx(ListHeader, {
              label: 'closed',
              counts: (() => {
                const bad = shelved.filter(isBad).length
                return bad ? { ask: 0, bad, run: 0, done: 0 } : null
              })(),
              plain: shelved.length,
              open: shelfOpen,
              onToggle: () => {
                toggle(`s:${project}`)
                showLane(`closed:${project}`)
              }
            }),
            children: [
              shelfOpen
                ? jsx('div', {
                    'data-pi-kids': '',
                    style: { paddingLeft: GUIDE_STEP },
                    children: shelved.map((lane, i) => renderLane(lane, i === shelved.length - 1))
                  })
                : null
            ]
          },
          `shelf:${project}`
        )
      : null

    // The create gesture sits directly under the project: the first row of the block, where the
    // person looks before reading the list. It is the only row of the level when nothing else
    // exists, so the level line ends at it in that one case.
    const addFeatureNode = jsx(
      TreeRow,
      {
        last: featureNodes.length === 0 && !handed.length && !shelved.length,
        row: jsx(HoverBox, {
          tag: 'button',
          title: 'ask for a feature in one line',
          onClick: () => {
            setAskUpdate(false)
            showComposeFeature(project)
          },
          hoverColour: 'var(--ui-accent)',
          className:
            'flex w-full items-center gap-1 text-left text-[0.625rem] uppercase tracking-wide text-(--ui-text-tertiary)',
          style: {
            marginLeft: ROW_PAD,
            width: `calc(100% - ${ROW_PAD})`,
            paddingTop: HEADER_PY,
            paddingBottom: HEADER_PY,
            paddingRight: ROW_PAD,
            outline: 'none'
          },
          children: [
            jsx('span', {
              className: 'flex shrink-0 items-center justify-center',
              style: { width: `${ICON_SIZE}px` },
              children: jsx(FolderPlus, {})
            }),
            jsx('span', {
              // The shape of the band a hovered feature row paints — same left edge, same 24px height,
              // same 4px radius and 4px of padding around the words — drawn as a dashed outline
              // instead of a fill. Its content is 14px, not BAND_MIN_H 16, because the two borders add
              // the missing 2 and the row must stay the height of its siblings.
              className: 'flex min-w-0 items-center',
              style: {
                // As wide as the words, not as wide as the row: the band hugs its own content and
                // may still shrink in a narrow panel.
                flex: '0 1 auto',
                border: '1px dashed currentColor',
                borderRadius: `4px`,
                padding: `${BAND_PY}px 4px`,
                margin: `-${BAND_PY}px 0`,
                minHeight: `${BAND_MIN_H_N - 2}px`,
                boxSizing: 'content-box'
              },
              children: jsx('span', {
                className: 'truncate',
                style: TEXT_NUDGE,
                children: 'new feature'
              })
            })
          ]
        })
      },
      `add:${project}`
    )

    return jsx(
      TreeRow,
      {
        // A project is the top level: no line above it, but its line reaches down.
        orphan: true,
        trunk: open,
        row: jsx(ListHeader, {
          label: project,
          // A project that is only a repository link: it has no lanes and nothing to open yet.
          tag: placing
            ? (() => {
                const minutes = Math.floor((Date.now() / 1000 - Number((registered || {}).created || 0)) / 60)
                return minutes >= 1 ? `preparation · ${minutes}m` : 'preparation'
              })()
            : '',
          dim: placing ? 'italic' : '',
          // A project always sums its own lanes, open or closed.
          counts: placing ? null : countStates(all),
          open,
          onToggle: () => {
            if (placing) {
              showProject(project)
              return
            }
            toggle(`p:${project}`)
          }
        }),
        children: [
          open
            ? jsx('div', {
                style: {
                  paddingLeft: GUIDE_STEP,
                  paddingTop: FEATURE_GAP,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: FEATURE_GAP
                },
                children: [addFeatureNode, ...featureNodes, handedNode, shelfNode]
              })
            : null
        ]
      },
      project
    )
  })

  // A groove between projects: the header band turned on its side.
  const projectTree = projectBlocks.flatMap((block, index) =>
    index === projectBlocks.length - 1
      ? [block]
      : [
          block,
          jsxs('div', {
            'aria-hidden': true,
            style: { pointerEvents: 'none', margin: `${PROJECT_SEP_AIR} 0` },
            children: [
              jsx('div', { style: { height: '1px', background: PROJECT_SEP_HI } }),
              jsx('div', { style: { height: '1px', background: PROJECT_SEP_LO } })
            ]
          }, `sep:${index}`)
        ]
  )

  const emptyHint = jsx('div', {
    className: 'px-2.5 py-2 text-[0.625rem] leading-relaxed text-(--ui-text-tertiary)',
    children: 'No lane yet.'
  })

  return jsxs('div', {
    className: 'flex h-full flex-col text-xs',
    children: [
      jsxs('div', {
        className:
          'flex shrink-0 items-center gap-2 border-b border-(--ui-stroke-secondary) px-2.5 text-[0.625rem] uppercase tracking-wide text-(--ui-text-tertiary)',
        style: { height: HEADER_H },
        children: [
          jsx('span', { children: `projects · ${projects.length}` }),
          jsx(HeaderControl, {
            title: 'add a project by its repository',
            glyph: '+',
            size: BAND_MIN_H,
            fontSize: '11.5px',
            onClick: () => showComposeProject()
          }),
          // The gear sits on the plus's own line and shape: the app's lucide settings icon at 11px, which
          // is the one pictograph this panel allows, because he named it by its picture.
          jsx(HoverBox, {
            'data-settings': 'gear',
            title: 'settings: the API keys the model list needs',
            onClick: () => showSettings.set(true),
            className: 'flex shrink-0 items-center justify-center rounded border',
            style: {
              transform: 'translateY(-0.5px)',
              width: BAND_MIN_H,
              height: BAND_MIN_H,
              borderColor: 'var(--ui-stroke-secondary)',
              color: 'var(--ui-text-tertiary)',
              cursor: 'pointer'
            },
            hoverFill: 'var(--ui-bg-tertiary)',
            hoverColour: 'var(--ui-text-secondary)',
            children: jsx(icons.Settings, { size: 11, strokeWidth: 2 })
          }),
          askUpdate
            ? jsxs('span', {
                className: 'ml-auto flex shrink-0 items-center gap-1',
                children: [
                  jsx(
                    HeaderControl,
                    {
                      title: 'cancel',
                      glyph: '✕',
                      size: BAND_MIN_H,
                      fontSize: '10px',
                      colour: BAD_TEXT,
                      hoverColour: BAD_TEXT,
                      border: BAD_TEXT,
                      onClick: () => setAskUpdate(false)
                    },
                    'cancel'
                  ),
                  jsx(
                    HeaderControl,
                    {
                      title: 'ask the agent to update the plugin',
                      glyph: '✓',
                      size: BAND_MIN_H,
                      fontSize: '10px',
                      colour: RUN_TEXT,
                      hoverColour: RUN_TEXT,
                      border: RUN_TEXT,
                      onClick: () => {
                        setAskUpdate(false)
                        ctx
                          .rest('/update/request', {
                            method: 'POST',
                            body: { session_key: sessionId },
                            timeoutMs: 15000
                          })
                          .then(() => host.notify({ kind: 'info', message: 'update: the request went to the chat' }))
                      }
                    },
                    'go'
                  )
                ]
              })
            : jsx(HoverBox, {
                onClick: () => setAskUpdate(true),
                title: 'ask the agent to pull the repo, copy the files and restart the backend',
                hoverColour: 'var(--ui-accent)',
                className:
                  'ml-auto shrink-0 px-1 text-[0.625rem] uppercase tracking-wide text-(--ui-text-tertiary)',
                children: 'update plugin'
              }),

        ]
      }),
      jsx(Scroller, {
        side: 'tree',
        grow: true,
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: PROJECT_GAP,
          // The same air the rows keep left and right, at the two ends as well.
          paddingTop: '10px',
          paddingBottom: '10px'
        },
        children: lanes.length === 0 ? emptyHint : projectTree
      }),
      query.error
        ? jsx('div', {
            className:
              'border-t border-(--ui-stroke-secondary) px-2.5 py-1.5 text-[0.625rem]',
            // The class named --ui-danger, which the app's build never defines; inline always paints.
            style: { color: BAD_TEXT },
            children: 'backend: enable plugin pi-team'
          })
        : null
    ]
  })
}

function Row({ label, value, color }) {
  return jsxs('div', {
    className: 'flex items-baseline justify-between gap-2 px-2.5 py-[3px]',
    children: [
      jsx('span', { className: 'shrink-0 text-[0.625rem] text-(--ui-text-tertiary)', children: label }),
      jsx('span', {
        className: 'truncate text-right font-mono text-[0.625rem]',
        style: { color: color || 'var(--ui-text-secondary)' },
        children: value
      })
    ]
  })
}

function Section({ title, band, first, right }) {
  // A section that opens a card carries no rule of its own: the card's header already ends in one,
  // and two of them land four pixels apart.
  return jsxs('div', {
    className: `${first ? '' : 'mt-1 border-t border-(--ui-stroke-secondary) '}px-2.5 pt-1.5 pb-0.5 text-[0.625rem] uppercase tracking-wide text-(--ui-text-tertiary)`,
    children: [
      // A value on the title's own line, right aligned: the heading says what the line is about,
      // the value sits where every other value in the card sits.
      right
        ? jsxs('div', {
            className: 'flex items-baseline justify-between gap-2',
            children: [jsx('span', { children: title }), right]
          })
        : title,
      band
        ? jsx('div', {
            'aria-hidden': true,
            style: {
              height: BAND_H,
              marginLeft: '-10px',
              marginRight: '-10px',
              marginTop: '2px',
              background: BAND_BG,
              pointerEvents: 'none'
            }
          })
        : null
    ]
  })
}

/** The one way to link the open chat to this lane's feature, from the right pane. */
function AddSessionRow({ ctx, project, feature, sessionId, linked, onDone }) {
  const [asking, setAsking] = useState(false)

  const link = async () => {
    if (!sessionId) {
      host.notify({ kind: 'error', message: 'no chat session is open' })
      return
    }
    try {
      await ctx.rest('/link', {
        method: 'POST',
        body: { project, feature, session: sessionId },
        timeoutMs: 8000
      })
      setAsking(false)
      onDone()
    } catch (error) {
      host.notify({ kind: 'error', message: `link failed: ${(error && error.message) || error}` })
    }
  }

  // Linking is a decision about a chat: say which chat and which feature before it happens.
  return jsxs('div', {
    className: 'flex flex-col gap-1 px-2.5 py-[3px]',
    children: [
      jsx(HoverBox, {
        tag: 'button',
        onClick: () => setAsking(!asking),
        title: linked ? 'this chat session is already linked' : 'link this chat session to the feature',
        hoverColour: 'var(--ui-accent)',
        className: 'w-full text-left text-[0.625rem] uppercase text-(--ui-text-tertiary)',
        children: linked ? 'this session is linked' : 'add this session +'
      }),
      asking
        ? jsxs('div', {
            className: 'flex items-start gap-1 text-[0.625rem]',
            children: [
              jsx('span', {
                className: 'min-w-0 flex-1',
                style: { color: 'var(--ui-text-secondary)' },
                children: sessionId
                  ? `Chat ${sessionId.slice(0, 18)}… will be linked to ${project}/${feature}.`
                  : 'No chat is open: open one and try again.'
              }),
              jsx(
                HeaderControl,
                {
                  title: 'cancel',
                  glyph: '✕',
                  size: BAND_MIN_H,
                  fontSize: '10px',
                  colour: BAD_TEXT,
                  hoverColour: BAD_TEXT,
                  border: BAD_TEXT,
                  onClick: () => setAsking(false)
                },
                'cancel'
              ),
              jsx(
                HeaderControl,
                {
                  title: 'link',
                  glyph: '✓',
                  size: BAND_MIN_H,
                  fontSize: '10px',
                  colour: RUN_TEXT,
                  hoverColour: RUN_TEXT,
                  border: RUN_TEXT,
                  onClick: link
                },
                'link'
              )
            ]
          })
        : null
    ]
  })
}

function SessionTitle({ ctx, entry, project, feature, onRemove, onChanged }) {
  const query = useQuery({
    queryKey: ['pi-team', 'title', entry.id],
    queryFn: () => host.request('session.title', { session_id: entry.id }),
    staleTime: 60000
  })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const payload = query.data || {}
  const realTitle = String(payload.title || (payload.result && payload.result.title) || '')
  const label = String(entry.label || '')
  const title = label || realTitle
  const shown = title || `${entry.id.slice(0, 12)}…`

  const startEdit = () => {
    setDraft(label || '')
    setEditing(true)
  }

  const save = async () => {
    const next = draft.trim()
    if (!next) {
      setEditing(false)
      return
    }
    try {
      await ctx.rest('/label', {
        method: 'POST',
        body: { project, feature, session: entry.id, label: next },
        timeoutMs: 8000
      })
      setEditing(false)
      onChanged && onChanged()
    } catch (error) {
      host.notify({
        kind: 'error',
        message: `label failed: ${(error && error.message) || error}`
      })
    }
  }

  if (editing) {
    return jsxs('div', {
      className: 'flex items-center gap-1 px-2.5 py-[3px]',
      children: [
        jsx(Input, {
          value: draft,
          autoFocus: true,
          placeholder: 'session name',
          onChange: event => setDraft(event.target.value),
          onKeyDown: event => {
            if (event.key === 'Enter') save()
            if (event.key === 'Escape') setEditing(false)
          },
          className: 'h-5 flex-1 text-[0.625rem]'
        }),
        jsx(HoverBox, {
          tag: 'button',
          onClick: save,
          hoverColour: 'var(--ui-text-primary)',
          className: 'shrink-0 px-1 text-[0.625rem] uppercase text-(--ui-accent)',
          children: 'ok'
        })
      ]
    })
  }

  const iconClass =
    'shrink-0 px-1 leading-none text-(--ui-text-tertiary) hover:text-(--ui-text-secondary)'

  return jsxs('div', {
    className: 'flex items-center gap-0.5 pr-1.5 hover:bg-(--chrome-action-hover)',
    children: [
      jsx('button', {
        type: 'button',
        onClick: () => host.openSession(entry.id),
        title: title ? `open: ${title}` : 'open this session',
        className: 'min-w-0 flex-1 truncate px-2.5 py-[3px] text-left text-[0.625rem] text-(--ui-text-secondary)',
        children: shown
      }),
      jsx('button', {
        type: 'button',
        onClick: startEdit,
        title: 'rename this session',
        className: iconClass,
        children: jsx(icons.Pencil, { size: 11 })
      }),
      jsx('button', {
        type: 'button',
        onClick: () => host.openSession(entry.id),
        title: 'open this session',
        className: iconClass,
        children: jsx(icons.ExternalLink, { size: 11 })
      }),
      jsx(HoverBox, {
        tag: 'button',
        onClick: onRemove,
        title: 'remove this session from the feature',
        // --ui-danger is defined nowhere in the app's build; the panel's own red is the state colour.
        hoverColour: BAD_TEXT,
        className: 'shrink-0 px-1 text-[0.6875rem] leading-none text-(--ui-text-tertiary)',
        children: '×'
      })
    ]
  })
}


function QuestionBlock({ ctx, lane, question, onDone }) {
  const send = body =>
    ctx
      .rest(`/lanes/${encodeURIComponent(lane)}/answer`, {
        method: 'POST',
        body,
        timeoutMs: 8000
      })
      .then(() => onDone && onDone())

  const options = (question.options || []).filter(Boolean)

  return jsxs('div', {
    className: 'px-2.5 py-1.5',
    children: [
      jsx('div', {
        className: 'text-[0.625rem] font-medium text-(--ui-accent)',
        children: 'the lane asks'
      }),
      jsx('div', {
        className: 'mt-0.5 text-[0.6875rem] leading-relaxed text-(--ui-text-primary)',
        children: question.title || question.message || 'a question without text'
      }),
      ...options.map(option =>
        jsx(
          HoverBox,
          {
            tag: 'button',
            className:
              'mt-1 mr-1 rounded border border-(--ui-stroke-secondary) px-1.5 py-0.5 text-[0.625rem] text-(--ui-text-primary)',
            hoverFill: 'var(--ui-bg-tertiary)',
            onClick: () => send({ value: option }),
            children: option
          },
          option
        )
      ),
      jsx('button', {
        className:
          'mt-1 rounded px-1.5 py-0.5 text-[0.625rem] uppercase text-(--ui-text-tertiary) hover:text-(--ui-text-secondary)',
        onClick: () => send({ cancelled: true }),
        children: 'dismiss'
      })
    ]
  })
}

/** One message in a lane's thread: the lane's own words, mine, or Ilja's. */
function Bubble({ who, text, agent }) {
  // Three speakers, three hues: he reads whose words these are before he reads the words. The name over a
  // blue dot is the AGENT'S OWN NAME from the machine (`Jarvis` here), not a constant in this file.
  const name = who === 'jarvis' ? `${agent || 'agent'}`.toLowerCase() : who === 'lane' ? 'pi' : 'user'
  const dot = who === 'jarvis' ? ASK_COLOR : who === 'lane' ? PI_COLOR : RUN_COLOR
  const tone = who === 'jarvis' ? ASK_TEXT : who === 'lane' ? PI_TEXT : RUN_TEXT
  const body =
    who === 'jarvis'
      ? { color: 'var(--ui-text-secondary)' }
      : who === 'user'
        ? { background: 'var(--chrome-action-hover)', color: 'var(--ui-text-primary)' }
        : { color: 'var(--ui-text-tertiary)', fontFamily: 'ui-monospace, monospace' }
  return jsxs('div', {
    className: 'mb-1',
    'data-bubble': who,
    children: [
      // The author rides ABOVE the bubble: a dot in the speaker's own hue and the name in the state-word
      // tone (half the hue, half the panel's text) so it stays readable in either theme.
      jsxs('div', {
        style: { display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' },
        children: [
          jsx('span', {
            'data-dot': who,
            style: {
              width: '5px',
              height: '5px',
              flex: 'none',
              borderRadius: '999px',
              background: dot
            }
          }),
          jsx('span', {
            className: 'text-[0.625rem]',
            style: { color: tone, lineHeight: 1 },
            children: name
          })
        ]
      }),
      // A bubble is a row of the panel, not a chat cloud: the height of a band, the same 4px radius, and
      // a 2px bar on the LEFT in the speaker's hue. The bar replaced a 1px ring he found too solid: the
      // ring could not reach the 3:1 graphic floor on the dark panel at any alpha, the bar clears it on
      // the light one and sits at 2.9:1 on the dark.
      jsx('div', {
        className: 'whitespace-pre-wrap break-words rounded text-[0.625rem] leading-snug',
        style: {
          ...body,
          minHeight: `${BAND_MIN_H_N + 2 * BAND_PY}px`,
          boxSizing: 'border-box',
          padding: `${BAND_PY}px 4px`,
          borderLeft: `2px solid ${dot}`
        },
        children: text
      })
    ]
  })
}

/** The model, as a chip INSIDE the composer: the field's row carries the writing, the model and the
 *  button, the way he drew it. A click opens the chooser above the box. */
function ModelChip({ label, open, onClick }) {
  return jsx(HoverBox, {
    'data-model-chip': 'chip',
    onClick,
    title: 'the model the next run of this lane uses',
    // The chip runs from the name to the button: it takes the whole row it sits on, so its right edge
    // meets `SEND` (stacked) or the box's edge (one line, where the button is on the row above).
    className: 'flex min-w-0 flex-1 items-center rounded',
    style: {
      height: '18px',
      boxSizing: 'border-box',
      padding: '0 5px',
      // Inline as well as the class: the growth is what makes the chip reach the button.
      flex: '1 1 auto',
      minWidth: 0,
      background: 'var(--ui-bg-tertiary)',
      color: 'var(--ui-text-secondary)'
    },
    hoverFill: 'var(--chrome-action-hover)',
    hoverColour: 'var(--ui-text-primary)',
    children: jsx('span', {
      className: 'truncate font-mono text-[0.625rem]',
      // Inline too: the ellipsis must not depend on a utility the app's build may trim.
      style: {
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: 'inherit'
      },
      children: label
    })
  })
}

/** The model chooser: a search over the providers' own catalogues, the results, and the one word that
 *  writes the choice into the lane record. It opens in the flow above the composer, never over it. */
function ModelChooser({ models, providers, current, onSet }) {
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState(null)
  const needle = search.trim().toLowerCase()
  const shown = needle
    ? models.filter(row => `${row.provider}/${row.model} ${row.name || ''}`.toLowerCase().includes(needle))
    : models
  const target = chosen || current
  const down = providers.filter(row => !row.ok)
  const label = { color: 'var(--ui-text-tertiary)' }
  const rowStyle = { height: `${MODEL_ROW_H_N}px`, boxSizing: 'border-box', padding: '0 4px' }
  return jsxs('div', {
    style: { margin: '0 10px 4px', display: 'flex', flexDirection: 'column', gap: '2px' },
    children: [
      jsxs('div', {
        style: { display: 'flex', alignItems: 'center', gap: '4px' },
        children: [
          jsx('input', {
            'data-model-search': 'search',
            value: search,
            autoFocus: true,
            placeholder: 'search id or name',
            onChange: event => setSearch(event.target.value),
            onKeyDown: event => {
              // Enter takes the first result: a search is a pick with one keystroke more.
              if (event.key === 'Enter' && shown.length) {
                event.preventDefault()
                setChosen(shown[0])
              }
            },
            className: 'min-w-0 flex-1 rounded border bg-transparent text-[0.625rem] outline-none',
            style: {
              height: `${MODEL_ROW_H_N}px`,
              boxSizing: 'border-box',
              padding: '0 6px',
              borderColor: 'var(--ui-stroke-secondary)',
              color: 'var(--ui-text-primary)'
            }
          }),
          jsx(HoverBox, {
            'data-model-set': 'set',
            onClick: () => onSet(target),
            title: 'write this model into the lane record',
            className: 'flex shrink-0 items-center justify-center rounded border px-2 text-[0.625rem] uppercase',
            style: {
              height: `${MODEL_ROW_H_N}px`,
              boxSizing: 'border-box',
              borderColor: 'var(--ui-stroke-secondary)',
              color: target ? 'var(--ui-text-secondary)' : 'var(--ui-text-quaternary)'
            },
            hoverFill: 'var(--ui-bg-tertiary)',
            children: 'set'
          })
        ]
      }),
      jsxs('div', {
        'data-model-results': 'results',
        className: 'overflow-y-auto',
        style: { maxHeight: `${MODEL_ROW_H_N * 7}px`, display: 'flex', flexDirection: 'column' },
        children: [
          shown.length
            ? shown.map(row =>
                jsx(
                  HoverBox,
                  {
                    'data-model-option': `${row.provider}/${row.model}`,
                    onClick: () => setChosen(row),
                    title: row.name || row.model,
                    className: 'flex shrink-0 items-center gap-2 rounded',
                    style: rowStyle,
                    hoverFill: 'var(--ui-bg-tertiary)',
                    children: [
                      jsx('span', {
                        className: 'min-w-0 flex-1 truncate font-mono text-[0.625rem]',
                        style: {
                          color:
                            row.provider === (target && target.provider) && row.model === (target && target.model)
                              ? 'var(--ui-text-primary)'
                              : 'var(--ui-text-secondary)'
                        },
                        children: row.model
                      }),
                      jsx('span', { className: 'shrink-0 text-[0.625rem]', style: label, children: row.provider })
                    ]
                  },
                  `${row.provider}/${row.model}`
                )
              )
            : jsx('div', {
                className: 'px-1 py-1 text-[0.625rem]',
                style: label,
                children: models.length ? 'no match' : 'the catalog is empty'
              })
        ]
      }),
      down.length
        ? jsx('div', {
            style: { display: 'flex', flexDirection: 'column' },
            children: down.map(row =>
              jsx(
                'div',
                {
                  className: 'px-1 text-[0.625rem]',
                  style: label,
                  children: `${row.provider}: ${row.error || 'failed'}`
                },
                `down-${row.provider}`
              )
            )
          })
        : null
    ]
  })
}

/** The conversation about one lane, with a box that sends into the chat, not into pi. */
function ThreadView({ ctx, lane, draft, setDraft, onSent }) {
  // The field's height AND shape live in state — React owns them, because a height written straight into
  // the DOM is dropped by the next render.
  const [field, setField] = useState({ height: COMPOSER_LINE_H_N, inline: true })
  // A ref callback settles both when the card opens with text already in the draft: the draft belongs to
  // the pane and outlives a lane switch. The guard makes it a no-op once the numbers agree.
  const settle = node => {
    if (!node) return
    const next = measureField(node)
    setField(prev => (prev.height === next.height && prev.inline === next.inline ? prev : next))
  }
  const messages = lane.thread || []
  // The model lives in the field now: the chip on the writing's row opens the chooser, and the chooser
  // writes the lane record. One query for both, because the catalogue does not change with the lane.
  const modelsQuery = useQuery({ queryKey: ['pi-team', 'models'], queryFn: () => ctx.rest('/models', REST) })
  const catalog = (modelsQuery.data && modelsQuery.data.models) || []
  const modelProviders = (modelsQuery.data && modelsQuery.data.providers) || []
  const [modelOpen, setModelOpen] = useState(false)
  const provider = lane.provider || ''
  const model = lane.model || ''
  const picked = catalog.find(row => row.provider === provider && row.model === model)
  const modelLabel =
    (picked && picked.name) || model.replace(`${provider}/`, '') || (model ? model : 'no model')
  const setModel = next => {
    setModelOpen(false)
    if (!next || !next.model) return
    if (next.provider === provider && next.model === model) return
    ctx
      .rest(`/lanes/${encodeURIComponent(lane.lane)}/model`, {
        method: 'POST',
        body: { provider: next.provider, model: next.model },
        timeoutMs: 8000
      })
      .then(() => onSent())
  }
  // The chip and the button, built once: the chip lives on the row UNDER the writing, so the shape only
  // decides whether the button shares the writing's row or sits beside the chip.
  const chipNode = model
    ? jsx(ModelChip, { label: modelLabel, open: modelOpen, onClick: () => setModelOpen(!modelOpen) })
    : null
  const sendNode = jsx(HoverBox, {
    'data-send': 'send',
    onClick: () => send(),
    className:
      'flex shrink-0 items-center justify-center rounded border border-(--ui-stroke-secondary) px-2 text-[0.625rem] uppercase',
    style: { height: `${SEND_H_N}px`, boxSizing: 'border-box' },
    hoverFill: 'var(--ui-bg-tertiary)',
    children: 'send'
  })
  const send = () => {
    const text = draft.trim()
    if (!text) return
    ctx
      .rest(`/lanes/${encodeURIComponent(lane.lane)}/say`, {
        method: 'POST',
        body: { text },
        timeoutMs: 15000
      })
      .then(() => {
        setDraft('')
        setField({ height: COMPOSER_LINE_H_N, inline: true })
        onSent()
      })
  }
  return jsxs('div', {
    children: [
      // A chat is anchored at the bottom: the scroll box lays its children out from the bottom up
      // (`column-reverse`), so the newest bubble sits on the composer and a short thread hugs that
      // edge instead of hanging from the top. The children are listed newest first because reverse
      // layout reads them the other way round.
      jsxs('div', {
        className: 'overflow-y-auto px-2.5 py-1',
        // A fixed floor as tall as the task block, so a short thread shows its bubbles on the
        // bottom edge instead of hanging at the top, and `38vh` as the ceiling for a long one.
        style: { minHeight: THREAD_MIN_H, maxHeight: '38vh', display: 'flex', flexDirection: 'column-reverse' },
        children: [
          lane.last_text ? jsx(Bubble, { who: 'lane', text: lane.last_text, agent: lane.agent }, 'now') : null,
          messages
            .map((message, index) =>
              jsx(Bubble, { who: message.who, text: message.text, agent: lane.agent }, `${index}-${message.at}`)
            )
            .reverse()
        ]
      }),
      modelOpen
        ? jsx(ModelChooser, {
            models: catalog,
            providers: modelProviders,
            current: model ? { provider, model } : null,
            onSet: setModel
          })
        : null,
      // The composer wears the app's own input field: radius `4`, the accent as its border, the panel's own
      // surface inside. TWO shapes, and the test between them reads the line's unwrapped width:
      //   one line  — a column (writing, then the model chip) that stops at the button, with `SEND` at the
      //               right centred against both rows;
      //   the line reached the button — the writing takes the whole box ABOVE it, and the chip and the
      //               button share the row under. That is the jump he asked for.
      jsxs('div', {
        className: 'flex shrink-0 flex-col',
        'data-composer': 'box',
        // A click anywhere in the box puts the caret in the field: the air around the writing is part of
        // the control, not dead paint. The chip and the button stop their own clicks.
        onClick: event => {
          const field = event.currentTarget.querySelector('textarea')
          if (field) field.focus()
        },
        style: {
          position: 'relative',
          minHeight: `${COMPOSER_H_N + 2 + COMPOSER_EXTRA_N}px`,
          boxSizing: 'border-box',
          // The inner row is centred in the extra height, so the button stays on the box's middle.
          justifyContent: 'center',
          // The box closes the card, so it carries the 8px of air above the window edge itself.
          margin: '0 10px 8px',
          padding: `${COMPOSER_PAD_N / 2}px`,
          borderRadius: '4px',
          border: '1px solid var(--ui-accent)',
          background: 'var(--ui-bg-editor)'
        },
        children: [
          jsxs('div', {
            style: {
              display: 'flex',
              flexDirection: field.inline ? 'row' : 'column',
              alignItems: field.inline ? 'center' : 'stretch',
              gap: `${COMPOSER_GAP_N}px`
            },
            children: [
              jsxs('div', {
                // Beside the button this column stops at it, so the chip's right edge lands on the
                // button's left edge. Above the button the writing owns the whole width and the chip
                // travels down with the button. The gap is the panel's own 4 px, so the writing has air
                // under it before the chip starts.
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: `${COMPOSER_GAP_N}px`,
                  flex: field.inline ? '1 1 auto' : '0 0 auto',
                  minWidth: 0
                },
                children: [jsx('textarea', {
                  value: draft,
                  rows: 1,
                  ref: settle,
                  placeholder: 'say something about this lane',
                  onChange: event => setDraft(event.target.value),
                  onInput: event => setField(measureField(event.currentTarget)),
                  onKeyDown: event => {
                    // Enter sends, Shift+Enter is a new line.
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      send()
                    }
                  },
                  // No `flex-1`: a flex-grown item ignores the height the auto-grow reads, and the field
                  // then never rises — the measurement showed 12px asked, 12px painted.
                  className: 'w-full min-w-0 resize-none border-0 bg-transparent text-[0.625rem] outline-none',
                  style: {
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: `0 ${FIELD_PAD_R_N}px 0 ${FIELD_PAD_L_N}px`,
                    // The height lives in the state, not in a write into the DOM: React drops the write.
                    height: `${field.height}px`,
                    color: 'var(--ui-text-primary)',
                    lineHeight: 1.2,
                    // No scroll bar of its own: the field grows and the whole block rises with it.
                    overflow: 'hidden'
                  }
                }), field.inline ? chipNode : null]
              }),
              field.inline
                ? sendNode
                : jsxs('div', {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: `${COMPOSER_GAP_N}px`
                    },
                    children: [chipNode, sendNode]
                  })
            ]
          })
        ]
      })
    ]
  })
}

/** The merge commit that closed a lane, shown under its card. */
function Receipt({ merge }) {
  return jsxs('div', {
    children: [
      jsx(Row, { label: 'commit', value: merge.short, color: RUN_TEXT }),
      jsx(Row, { label: 'date', value: merge.date }),
      jsx(Row, { label: 'into', value: merge.subject }),
      jsx(Row, {
        label: 'diff',
        value: `${merge.files} files  +${merge.insertions} −${merge.deletions}`
      })
    ]
  })
}

/** Every closed lane of one project, when its group row is picked. */
function GroupList({ title, rows, onPick }) {
  return jsxs(Scroller, {
    side: 'pane',
    className: 'flex flex-col pb-2 text-xs',
    children: [
      jsx('div', {
        className:
          'flex shrink-0 items-center border-b border-(--ui-stroke-secondary) px-2.5 font-mono text-[0.6875rem] text-(--ui-text-secondary)',
        style: { height: HEADER_H },
        children: title
      }),
      rows.length === 0
        ? jsx('div', {
            className: 'px-2.5 py-2 text-[0.625rem] text-(--ui-text-tertiary)',
            children: 'No closed lane yet.'
          })
        : rows.map(row =>
            jsxs(
              'button',
              {
                type: 'button',
                onClick: () => onPick(row.lane),
                className:
                  'flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-(--chrome-action-hover)',
                children: [
                  jsx('span', { className: 'truncate font-mono text-[0.6875rem]', children: row.lane }),
                  jsx('span', {
                    className: 'ml-auto shrink-0 text-[0.625rem] text-(--ui-text-tertiary)',
                    children: row.shelved_reason
                  })
                ]
              },
              row.lane
            )
          )
    ]
  })
}

function LaneStatus({ ctx }) {
  const laneName = useValue(selectedLane)
  const [draft, setDraft] = useState('')
  // A group row of the tree picks a whole list, not one lane.
  const groupMatch = /^(closed|handed):(.+)$/.exec(laneName)
  const groupKind = groupMatch ? groupMatch[1] : null
  const groupProject = groupMatch ? groupMatch[2] : null
  // Both hooks run every render; openSession and /link take the stored id.
  const storedSessionId = useValue(host.state.focusedStoredSessionId)
  const runtimeSessionId = useValue(host.state.activeSessionId)
  const sessionId = storedSessionId || runtimeSessionId
  const query = useQuery({
    queryKey: ['pi-team', 'lane', laneName],
    queryFn: () => ctx.rest(`/lanes/${encodeURIComponent(laneName)}`, REST),
    enabled: Boolean(laneName) && !groupProject,
    refetchInterval: POLL_MS
  })
  const listQuery = useQuery({
    queryKey: ['pi-team', 'lanes'],
    queryFn: () => ctx.rest('/lanes', REST),
    enabled: Boolean(groupProject),
    refetchInterval: POLL_MS
  })

  if (groupKind) {
    const rows = ((listQuery.data && listQuery.data.lanes) || []).filter(
      lane => (groupKind === 'closed' ? lane.shelved : lane.handed) && lane.project === groupProject
    )
    return jsx(GroupList, {
      title: `${groupKind === 'handed' ? 'review' : groupKind} · ${groupProject}`,
      rows,
      onPick: name => showLane(name)
    })
  }

  if (!laneName) {
    return jsx('div', {
      className: 'flex h-full items-center px-2.5 text-[0.625rem] text-(--ui-text-tertiary)',
      children: 'Pick a lane on the left.'
    })
  }
  if (query.error) {
    return jsx('div', {
      className: 'px-2.5 py-2 text-[0.625rem] text-(--ui-text-tertiary)',
      children: 'Lane state unavailable. Is plugin pi-team enabled?'
    })
  }

  const lane = query.data
  if (!lane) {
    return jsx('div', {
      className: 'px-2.5 py-2 text-[0.625rem] text-(--ui-text-tertiary)',
      children: 'Loading…'
    })
  }

  const usage = lane.usage || {}
  const status = lane.status || []
  // The state's own action, cut to the heading's line: a word you can press between `state` and the state
  // word. A handed lane keeps the same slot as a message — `in review` is not a button, so it stays mixed
  // case — and `close` keeps the full-width row it needs, because two words here would not fit in 290 px.
  const stateAction = !lane.shelved && ['done', 'stopped', 'failed', 'error'].includes(lane.state)
    ? lane.handed
      ? jsx('span', {
          // The heading is uppercase; a message keeps its own case, so `normal-case` is not optional here.
          className: 'flex shrink-0 items-center justify-center rounded border px-2 text-[0.625rem] normal-case',
          style: { height: BAND_MIN_H, boxSizing: 'border-box', color: ASK_TEXT, borderColor: ASK_TEXT },
          children: 'in review'
        })
      : jsx(HoverBox, {
          onClick: () =>
            ctx
              .rest(`/lanes/${encodeURIComponent(lane.lane)}/hand`, {
                method: 'POST',
                body: { session_key: sessionId },
                timeoutMs: 8000
              })
              .then(() => query.refetch()),
          title: 'queue this lane for review; send on the review row asks the orchestrator',
          className:
            'flex shrink-0 items-center justify-center rounded border px-2 text-[0.625rem] uppercase',
          style: { height: BAND_MIN_H, boxSizing: 'border-box', color: ASK_TEXT, borderColor: ASK_TEXT },
          hoverFill: 'var(--ui-bg-tertiary)',
          children: 'to review'
        })
    : null

  return jsxs('div', {
    // The card is a column: a fixed header, the areas that scroll, and the thread pinned to the
    // bottom edge so its composer sits where the app's own composer sits.
    className: 'flex h-full min-h-0 flex-col',
    children: [
      jsx('div', {
        className:
          'flex shrink-0 items-center border-b border-(--ui-stroke-secondary) px-2.5 font-mono text-[0.6875rem] text-(--ui-text-secondary)',
        style: { height: HEADER_H },
        children: lane.lane
      }),
      jsxs(Scroller, {
        side: 'pane',
        grow: true,
        className: 'flex flex-col pb-2 text-xs',
        children: [
      lane.question
        ? jsx(QuestionBlock, {
            ctx,
            lane: lane.lane,
            question: lane.question,
            onDone: () => query.refetch()
          })
        : null,
      // Three areas, always in this order: STATUS first, then SESSIONS, then STATE.
      jsx(Section, { title: 'status', first: !lane.question }),
      lane.shelved ? jsx(Row, { label: 'closed', value: lane.shelved_reason }) : null,
      lane.merge ? jsx(Receipt, { merge: lane.merge }) : null,
      jsx(Row, { label: 'branch', value: lane.branch || '—' }),
      jsx(Row, {
        label: 'changes',
        value: `${lane.files} files  +${lane.insertions} −${lane.deletions}`
      }),
      lane.turns ? jsx(Row, { label: 'turns', value: String(lane.turns) }) : null,
      usage.output
        ? jsx(Row, {
            label: 'tokens',
            value: `in ${usage.input} · out ${usage.output} · $${Number(usage.total || 0).toFixed(4)}`
          })
        : null,
      lane.last_tool
        ? jsx(Row, {
            label: 'tool',
            value: lane.last_tool_detail
              ? `${lane.last_tool}: ${lane.last_tool_detail}`
              : lane.last_tool
          })
        : null,
      lane.last_error
        ? jsx(Row, { label: 'error', value: lane.last_error, color: BAD_TEXT })
        : null,

      // A closed lane that did not end well still says why, even after its worktree is gone.
      lane.shelved && isBad(lane)
        ? jsxs('div', {
            children: [
              jsx(Section, { title: 'why', band: true }),
              jsx('div', {
                className:
                  'shrink-0 overflow-y-auto whitespace-pre-wrap break-words px-2.5 py-0.5 font-mono text-[0.625rem] leading-snug text-(--ui-text-secondary)',
                style: { height: TEXT_H },
                children: lane.last_text || '—'
              }),
              lane.stderr ? jsx(Section, { title: 'stderr' }) : null,
              lane.stderr
                ? jsx('div', {
                    className:
                      'shrink-0 overflow-y-auto whitespace-pre-wrap break-words px-2.5 py-0.5 font-mono text-[0.625rem] leading-snug',
                    style: { maxHeight: TEXT_H, color: BAD_TEXT },
                    children: lane.stderr
                  })
                : null
            ]
          })
        : null,
      lane.shelved ? null : jsx(Section, { title: `sessions · ${(lane.feature_sessions || []).length}` }),
      lane.shelved ? null : (lane.feature_sessions || []).map(entry =>
        jsx(
          SessionTitle,
          {
            ctx,
            entry,
            project: lane.project,
            feature: lane.group,
            onChanged: () => query.refetch(),
            onRemove: () =>
              ctx
                .rest('/unlink', {
                  method: 'POST',
                  body: { project: lane.project, feature: lane.group, session: entry.id },
                  timeoutMs: 8000
                })
                .then(() => query.refetch())
          },
          entry.id
        )
      ),

      lane.shelved ? null : jsx(AddSessionRow, {
        ctx,
        project: lane.project,
        feature: lane.group,
        sessionId,
        linked: (lane.feature_sessions || []).some(entry => entry.id === sessionId),
        onDone: () => query.refetch()
      }),

      // THREE things on the heading's line: the word `state`, the one action this state offers, and the
      // state itself. He pointed both arrows at the gap between them: the button belongs there, not on a
      // row of its own under the heading.
      jsx(Section, {
        title: 'state',
        right: jsxs('div', {
          className: 'flex shrink-0 items-center gap-2',
          children: [
            stateAction,
            jsx('span', {
              className: 'shrink-0 font-mono text-[0.6875rem] normal-case',
              style: { color: stateText(lane) || 'var(--ui-text-secondary)' },
              children: lane.state
            })
          ]
        })
      }),
      lane.handed && !lane.shelved
        ? jsx(HoverBox, {
            onClick: () =>
              ctx
                .rest(`/lanes/${encodeURIComponent(lane.lane)}/say`, {
                  method: 'POST',
                  body: { text: 'Close this lane: show the plan first, and delete nothing without my go.' },
                  timeoutMs: 15000
                })
                .then(() => query.refetch()),
            title: 'ask the orchestrator to close this lane; it shows the plan first',
            className: STATE_ACTION_CLASS,
            style: STATE_CONTROL_STYLE,
            hoverFill: 'var(--ui-bg-tertiary)',
            children: 'close'
          })
        : null,
      lane.shelved ? null : jsx(Section, { title: 'task', band: true }),
      lane.shelved
        ? null
        : jsx('div', {
            className:
              'shrink-0 overflow-y-auto whitespace-pre-wrap px-2.5 py-0.5 text-[0.625rem] leading-snug text-(--ui-text-secondary)',
            style: { height: TEXT_H },
            children: lane.task || '—'
          }),

      lane.archived
        ? jsx(Row, { label: 'record', value: 'closed · folder removed, receipt kept' })
        : null,

      // The receipt: what this run changed, file by file, biggest first.
      !lane.shelved && (lane.diff_files || []).length
        ? jsxs('div', {
            children: [
              jsx(Section, {
                title: `diff · ${lane.files} files  +${lane.insertions} −${lane.deletions}`
              }),
              (lane.diff_files || []).slice(0, 12).map(file =>
                jsxs(
                  'div',
                  {
                    className: 'flex items-baseline gap-2 px-2.5 py-[2px] font-mono text-[0.625rem]',
                    children: [
                      jsx('span', {
                        className: 'truncate',
                        style: { color: 'var(--ui-text-secondary)' },
                        children: file.path
                      }),
                      jsx('span', {
                        style: { color: RUN_TEXT, marginLeft: 'auto' },
                        children: file.binary ? 'bin' : `+${file.insertions}`
                      }),
                      jsx('span', {
                        style: {
                          color: file.deletions ? BAD_TEXT : 'var(--ui-text-tertiary)'
                        },
                        children: `−${file.deletions}`
                      })
                    ]
                  },
                  file.path
                )
              )
            ]
          })
        : null,

      (lane.spec_tree || []).length > 0 ? jsx(Section, { title: `specs · ${lane.spec_tree.length}` }) : null,
      (lane.spec_tree || []).slice(0, 40).map(node =>
        jsxs(
          'div',
          {
            className: 'flex items-baseline gap-1 py-[1px] pr-2.5 text-[0.625rem]',
            style: { paddingLeft: `${10 + node.depth * 12}px` },
            children: [
              jsx('span', {
                className: 'shrink-0 text-(--ui-accent)',
                children: (lane.specs || []).includes(node.path) ? '•' : ' '
              }),
              jsx('span', {
                className: 'truncate text-(--ui-text-secondary)',
                children: node.title
              }),
              jsx('span', {
                className: 'ml-auto shrink-0 text-(--ui-text-tertiary)',
                children: node.type === 'task-spec' ? 'task' : ''
              })
            ]
          },
          node.id
        )
      )
        ]
      }),
      // The thread is not part of the scroll: it is the card's bottom, its bubbles grow upward and
      // its composer stays on the edge — level with the app's own input field.
      lane.shelved
        ? null
        : jsx('div', {
            className: 'shrink-0 border-t border-(--ui-stroke-secondary)',
            children: [
              jsx(Section, { title: 'thread', band: true, first: true }),
              jsx(ThreadView, { ctx, lane, draft, setDraft, onSent: () => query.refetch() })
            ]
          })
    ]
  })
}

/** One panel, two areas: the lane list on the left, the selected lane on the right. */
/** One shell for a card: the header strip lines up with the tree's header, nothing overflows. */
function CardShell({ title, children }) {
  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col overflow-hidden',
    children: [
      jsx('div', {
        className:
          'flex shrink-0 items-center border-b border-(--ui-stroke-secondary) px-2.5 font-mono text-[0.6875rem] text-(--ui-text-secondary)',
        style: { height: HEADER_H },
        children: title
      }),
      jsx(Scroller, {
        side: 'pane',
        grow: true,
        className: 'flex min-h-0 flex-col gap-2 px-2.5 py-2',
        children
      })
    ]
  })
}

function ProjectCompose({ ctx, sessionId, onDone }) {
  const [url, setUrl] = useState('')
  const [check, setCheck] = useState(null)
  const [busy, setBusy] = useState(false)

  const runCheck = async () => {
    if (!url.trim() || busy) return
    setBusy(true)
    try {
      const result = await ctx.rest('/projects/check', {
        method: 'POST',
        body: { url: url.trim() },
        timeoutMs: 30000
      })
      setCheck(result)
    } catch (error) {
      setCheck({ ok: false, error: (error && error.message) || String(error) })
    } finally {
      setBusy(false)
    }
  }

  const send = async () => {
    if (!check || !check.ok || busy) return
    setBusy(true)
    try {
      const result = await ctx.rest('/projects/prepare', {
        method: 'POST',
        body: { url: url.trim(), session_key: sessionId },
        timeoutMs: 40000
      })
      host.notify({
        kind: result.message_sent ? 'info' : 'error',
        message: result.message_sent
          ? `${result.name}: project created, the request went to the chat`
          : `${result.name}: project created, but the message was not delivered — write in the chat`
      })
      setUrl('')
      setCheck(null)
      onDone()
    } catch (error) {
      host.notify({ kind: 'error', message: `prepare failed: ${(error && error.message) || error}` })
    } finally {
      setBusy(false)
    }
  }

  return jsx(CardShell, {
    title: 'new project',
    children: [
      jsx('div', {
        className: 'text-[0.6875rem] leading-relaxed text-(--ui-text-tertiary)',
        children:
          'Paste a GitHub repository. The panel checks that it exists and that this machine can read it, then clones it into ~/work, registers it, and the project appears in the tree.'
      }),
      jsx('input', {
        value: url,
        autoFocus: true,
        placeholder: 'owner/repo',
        onChange: event => {
          setUrl(event.target.value)
          setCheck(null)
        },
        onKeyDown: event => {
          if (event.key === 'Enter') runCheck()
        },
        className:
          'w-full min-w-0 rounded border border-(--ui-stroke-secondary) bg-transparent px-2 py-1.5 text-[0.6875rem] outline-none focus:border-(--ui-accent)',
        style: { color: 'var(--ui-text-primary)' }
      }),
      check
        ? jsx('div', {
            className: 'rounded border border-(--ui-stroke-secondary) p-2 text-[0.6875rem] leading-relaxed',
            style: { color: check.ok ? 'var(--ui-text-secondary)' : BAD_TEXT },
            children: check.ok
              ? `${check.slug} · ${check.private ? 'private' : 'public'} · ${check.branch || 'branch unknown'} · clone to ${check.clone_target}${check.clone_exists ? ' (folder exists!)' : ''}`
              : check.error
          })
        : null,
      jsxs('div', {
        className: 'flex shrink-0 items-center gap-2',
        children: [
          jsx(HoverBox, {
            onClick: runCheck,
            hoverFill: 'var(--ui-bg-tertiary)',
            className: 'flex items-center justify-center rounded border px-2 text-[0.6875rem] uppercase',
            style: {
            // The hover band's own size, split three ways, word centred.
            flex: '1 1 0',
            minWidth: 0,
            height: `${BAND_MIN_H_N + 2 * BAND_PY}px`,
            boxSizing: 'border-box',
              color: ASK_TEXT,
              borderColor: ASK_TEXT,
              opacity: busy || !url.trim() ? 0.5 : 1
            },
            children: busy ? 'checking…' : 'check'
          }),
          jsx(HoverBox, {
            onClick: send,
            hoverFill: 'var(--ui-bg-tertiary)',
            className: 'flex items-center justify-center rounded border px-2 text-[0.6875rem] uppercase',
            style: {
            // The hover band's own size, split three ways, word centred.
            flex: '1 1 0',
            minWidth: 0,
            height: `${BAND_MIN_H_N + 2 * BAND_PY}px`,
            boxSizing: 'border-box',
              color: RUN_TEXT,
              borderColor: RUN_TEXT,
              opacity: busy || !check || !check.ok ? 0.5 : 1
            },
            children: 'send'
          }),
          jsx(HoverBox, {
            onClick: onDone,
            hoverFill: 'var(--ui-bg-tertiary)',
            className: 'flex items-center justify-center rounded border px-2 text-[0.6875rem] uppercase',
            style: {
            // The hover band's own size, split three ways, word centred.
            flex: '1 1 0',
            minWidth: 0,
            height: `${BAND_MIN_H_N + 2 * BAND_PY}px`,
            boxSizing: 'border-box',
              color: BAD_TEXT,
              borderColor: BAD_TEXT
            },
            children: 'cancel'
          })
        ]
      })
    ]
  })
}

function ProjectView({ ctx, project, onDone }) {
  const query = useQuery({
    queryKey: ['pi-team', 'lanes'],
    queryFn: () => ctx.rest('/lanes', REST),
    refetchInterval: POLL_MS
  })
  const entry = ((query.data && query.data.registry) || []).find(item => item.name === project) || {}
  const minutes = Math.floor((Date.now() / 1000 - Number(entry.created || 0)) / 60)

  const drop = async () => {
    try {
      await ctx.rest('/projects/cancel', {
        method: 'POST',
        body: { name: project },
        timeoutMs: 8000
      })
      onDone()
    } catch (error) {
      host.notify({ kind: 'error', message: `cancel failed: ${(error && error.message) || error}` })
    }
  }

  return jsx(CardShell, {
    title: `${project} · preparation`,
    children: [
      jsx(Row, { label: 'repository', value: entry.remote || '—' }),
      jsx(Row, { label: 'waiting', value: minutes >= 1 ? `${minutes} min` : 'just now' }),
      jsx('div', {
        className: 'text-[0.6875rem] leading-relaxed text-(--ui-text-tertiary)',
        children:
          'Waiting for the clone. When it lands in ~/work and the project is registered, this placeholder becomes the project itself.'
      }),
      jsx(HoverBox, {
        onClick: drop,
        hoverFill: 'var(--ui-bg-tertiary)',
        className: 'mt-auto flex w-fit items-center justify-center rounded border px-2 py-[2px] text-[0.6875rem] uppercase',
        style: { color: BAD_TEXT, borderColor: BAD_TEXT },
        children: 'drop project'
      })
    ]
  })
}

function FeatureCompose({ ctx, project, sessionId, onDone }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async () => {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      const result = await ctx.rest('/features/prepare', {
        method: 'POST',
        body: { project, text: body, session_key: sessionId },
        timeoutMs: 15000
      })
      host.notify({
        kind: result.message_sent ? 'info' : 'error',
        message: result.message_sent
          ? `${project}: feature created, the request went to the chat`
          : `${project}: feature created, but the message was not delivered — write in the chat`
      })
      setText('')
      onDone()
    } catch (error) {
      host.notify({ kind: 'error', message: `prepare failed: ${(error && error.message) || error}` })
    } finally {
      setBusy(false)
    }
  }

  return jsx(CardShell, {
    title: `new feature · ${project}`,
    children: [
      jsx('div', {
        className: 'text-[0.6875rem] leading-relaxed text-(--ui-text-tertiary)',
        children:
          'Write what you want. The feature appears at once as preparation; the orchestrator gives it a name and the task for pi.'
      }),
      jsx('textarea', {
        value: text,
        onChange: event => setText(event.target.value),
        rows: 4,
        autoFocus: true,
        placeholder: 'for example: an archive page with search by title',
        className:
          'w-full min-w-0 resize-none rounded border border-(--ui-stroke-secondary) bg-transparent px-2 py-1.5 text-[0.6875rem] outline-none focus:border-(--ui-accent)',
        style: { color: 'var(--ui-text-primary)' }
      }),
      jsxs('div', {
        className: 'flex shrink-0 items-center gap-2',
        children: [
          jsx(HoverBox, {
            onClick: send,
            hoverFill: 'var(--ui-bg-tertiary)',
            className: 'flex items-center justify-center rounded border px-2 text-[0.6875rem] uppercase',
            style: {
            // The hover band's own size: 16px of content plus 4px above and below, and the row's full
            // width split between the buttons, with the word centred in each.
            flex: '1 1 0',
            minWidth: 0,
            height: `${BAND_MIN_H_N + 2 * BAND_PY}px`,
            boxSizing: 'border-box',
              color: RUN_TEXT,
              borderColor: RUN_TEXT,
              opacity: busy || !text.trim() ? 0.5 : 1
            },
            children: busy ? 'sending…' : 'send'
          }),
          jsx(HoverBox, {
            onClick: onDone,
            hoverFill: 'var(--ui-bg-tertiary)',
            className: 'flex items-center justify-center rounded border px-2 text-[0.6875rem] uppercase',
            style: {
            // The hover band's own size: 16px of content plus 4px above and below, and the row's full
            // width split between the buttons, with the word centred in each.
            flex: '1 1 0',
            minWidth: 0,
            height: `${BAND_MIN_H_N + 2 * BAND_PY}px`,
            boxSizing: 'border-box',
              color: BAD_TEXT,
              borderColor: BAD_TEXT
            },
            children: 'cancel'
          })
        ]
      })
    ]
  })
}

function FeatureView({ ctx, project, feature, onDone }) {
  const query = useQuery({
    queryKey: ['pi-team', 'lanes'],
    queryFn: () => ctx.rest('/lanes', REST),
    refetchInterval: POLL_MS
  })
  const registry = (query.data && query.data.registry) || []
  const entry = registry.find(item => item.name === project)
  const meta = ((entry && entry.features) || []).find(item => item.name === feature) || {}
  const chats = meta.sessions || []
  const preparing = meta.state === 'preparation'
  const lanes = ((query.data && query.data.lanes) || []).filter(
    lane => lane.project === project && lane.group === feature && !lane.shelved
  )

  const drop = async () => {
    try {
      // Only a placeholder reaches this card, so only its own route is called.
      await ctx.rest('/features/cancel', {
        method: 'POST',
        body: { project, feature },
        timeoutMs: 8000
      })
      onDone()
    } catch (error) {
      host.notify({ kind: 'error', message: `cancel failed: ${(error && error.message) || error}` })
    }
  }

  return jsx(CardShell, {
    title: `${project} / ${feature}${preparing ? ' · preparation' : ''}`,
    children: [
      preparing
        ? jsx('div', {
            className: 'whitespace-pre-wrap break-words text-[0.8125rem]',
            style: { color: 'var(--ui-text-primary)' },
            children: meta.title || feature
          })
        : jsx(Row, { label: 'feature', value: feature }),
      jsx(Row, {
        label: 'chat',
        value: chats.length ? 'linked' : 'no chat',
        color: chats.length ? undefined : 'var(--ui-text-tertiary)'
      }),
      jsx(Row, { label: 'lanes', value: String(lanes.length) }),
      lanes.length
        ? jsx('div', {
            className: 'flex flex-col',
            children: lanes.map(lane =>
              jsx(
                HoverBox,
                {
                  tag: 'button',
                  onClick: () => {
                    showLane(lane.lane)
                  },
                  // A lane row in the feature card picks a lane, like a tree row does: same fill.
                  hoverFill: 'var(--chrome-action-hover)',
                  className: 'flex items-center gap-2 py-[3px] text-left text-[0.6875rem]',
                  children: [
                    jsx('span', {
                      className: 'min-w-0 flex-1 truncate font-mono',
                      style: { color: 'var(--ui-text-secondary)' },
                      children: lane.lane
                    }),
                    jsx('span', {
                      className: 'shrink-0 text-[0.625rem]',
                      style: { color: stateText(lane) || 'var(--ui-text-tertiary)' },
                      children: lane.state
                    })
                  ]
                },
                lane.lane
              )
            )
          })
        : null,
      preparing && meta.request
        ? jsx('div', {
            className:
              'whitespace-pre-wrap break-words rounded border border-(--ui-stroke-secondary) p-2 text-[0.6875rem] leading-relaxed',
            style: { color: 'var(--ui-text-secondary)' },
            children: meta.request
          })
        : null,
      jsx('div', {
        className: 'text-[0.6875rem] leading-relaxed text-(--ui-text-tertiary)',
        children: preparing
          ? 'Waiting for a name, a task for pi and its first lane. Until it has a lane, the feature can be dropped.'
          : 'Pick a lane below, or write in the thread of one to send work back.'
      }),
      preparing
        ? jsx(HoverBox, {
            onClick: drop,
            hoverFill: 'var(--ui-bg-tertiary)',
            className:
              'mt-auto flex w-fit items-center justify-center rounded border px-2 py-[2px] text-[0.6875rem] uppercase',
            style: { color: BAD_TEXT, borderColor: BAD_TEXT },
            children: 'drop feature'
          })
        : null
    ]
  })
}

/** The panel's own settings: its light palette and the API keys the model list needs. A panel cannot
 *  read or write a file, so both sit behind the backend — one settings record, and `$HERMES_HOME/.env`
 *  for the keys. A saved key is never sent back: the row says `set` and nothing more. */
function SettingsView({ ctx, data, onChanged }) {
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const keys = (data && data.keys) || []
  const post = (path, body) => ctx.rest(path, { method: 'POST', body, timeoutMs: 8000 }).then(() => onChanged())
  const save = () => {
    const keyName = editing || name.trim().toUpperCase()
    if (!keyName) return
    post('/settings/key', { name: keyName, value: value.trim() }).then(() => {
      setEditing(null)
      setAdding(false)
      setName('')
      setValue('')
    })
  }
  const rowStyle = { height: `${MODEL_ROW_H_N}px`, boxSizing: 'border-box', padding: '0 4px' }
  const inputClass = 'min-w-0 flex-1 rounded border bg-transparent text-[0.625rem] outline-none'
  const inputStyle = {
    height: `${MODEL_ROW_H_N}px`,
    boxSizing: 'border-box',
    padding: '0 6px',
    borderColor: 'var(--ui-stroke-secondary)',
    color: 'var(--ui-text-primary)'
  }
  const word = {
    className: 'shrink-0 text-[0.625rem] uppercase tracking-wide',
    style: { color: 'var(--ui-text-tertiary)' }
  }
  const field = (placeholder, bound, secret) =>
    jsx('input', {
      value: bound.value,
      autoFocus: true,
      type: secret ? 'password' : 'text',
      placeholder,
      onChange: event => bound.set(event.target.value),
      onKeyDown: event => {
        if (event.key === 'Enter') save()
        if (event.key === 'Escape') {
          setEditing(null)
          setAdding(false)
          setName('')
          setValue('')
        }
      },
      className: inputClass,
      style: inputStyle
    })
  const saveRow = jsx('div', {
    style: { display: 'flex', alignItems: 'center', gap: '4px' },
    children: [
      // The value field is always the value: the name stands on its own row when a new key is added.
      field('paste the key; empty clears it', { value, set: setValue }, true),
      jsx(HoverBox, {
        onClick: save,
        title: 'write this key into ~/.hermes/.env',
        className: 'flex shrink-0 items-center justify-center rounded border px-2 text-[0.625rem] uppercase',
        style: {
          height: `${MODEL_ROW_H_N}px`,
          boxSizing: 'border-box',
          borderColor: 'var(--ui-stroke-secondary)',
          color: 'var(--ui-text-secondary)'
        },
        hoverFill: 'var(--ui-bg-tertiary)',
        children: 'save'
      })
    ]
  })
  const nameRow = adding
    ? jsx('div', {
        style: { display: 'flex', alignItems: 'center', gap: '4px' },
        children: field('provider, for example anthropic', { value: name, set: setName }, false)
      })
    : null
  return jsx(CardShell, {
    title: jsxs('div', {
      className: 'flex w-full items-center justify-between',
      children: [
        jsx('span', { children: 'settings' }),
        jsx(HoverBox, {
          onClick: () => showSettings.set(false),
          title: 'close the settings',
          className: 'shrink-0 rounded px-1 text-[0.625rem] uppercase tracking-wide',
          style: { color: 'var(--ui-text-tertiary)' },
          hoverColour: 'var(--ui-text-primary)',
          children: 'close'
        })
      ]
    }),
    children: [
      // No shadow band and no theme switch: the panel takes the app's look, and each section is closed by
      // one plain 1px rule so the column reads as a list of blocks.
      jsx(Section, { title: 'api keys', first: true }),
      jsx('div', {
        className: 'text-[0.625rem] leading-relaxed',
        style: { color: 'var(--ui-text-tertiary)' },
        children: 'A key is written into ~/.hermes/.env and never read back. Empty clears it. The model list follows on its next fetch.'
      }),
      ...keys.flatMap((row, index) => {
        const isEditing = editing === row.name
        return isEditing
          ? [jsx('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' }, children: saveRow }, `edit-${row.name}`)]
          : [
              jsx(
                HoverBox,
                {
                  onClick: () => {
                    setEditing(row.name)
                    setAdding(false)
                    setName('')
                    setValue('')
                  },
                  title: `set ${row.name}`,
                  className: 'flex shrink-0 items-center gap-2 rounded',
                  // One plain rule between rows: the settings screen carries no shadow and no band.
                  style: {
                    ...rowStyle,
                    borderBottom: index === keys.length - 1 ? 'none' : '1px solid var(--ui-stroke-secondary)'
                  },
                  hoverFill: 'var(--ui-bg-tertiary)',
                  children: [
                    jsx('span', {
                      className: 'min-w-0 flex-1 truncate font-mono text-[0.625rem]',
                      style: { color: row.set ? 'var(--ui-text-secondary)' : 'var(--ui-text-tertiary)' },
                      // The row names the provider, not the variable: no underscores on this screen.
                      children: row.label || row.name
                    }),
                    jsx('span', { ...word, children: row.set ? 'set' : 'not set' })
                  ]
                },
                `key-${row.name}`
              )
            ]
      }),
      adding
        ? jsx('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' }, children: [nameRow, saveRow] })
        : jsx(HoverBox, {
            onClick: () => {
              setAdding(true)
              setEditing(null)
              setName('')
              setValue('')
            },
            title: 'add a key that is not on the list',
            className: 'flex shrink-0 items-center justify-center rounded border text-[0.625rem] uppercase',
            style: {
              height: `${MODEL_ROW_H_N}px`,
              boxSizing: 'border-box',
              marginTop: '4px',
              borderColor: 'var(--ui-stroke-secondary)',
              color: 'var(--ui-text-tertiary)'
            },
            hoverFill: 'var(--ui-bg-tertiary)',
            children: 'add key'
          })
    ]
  })
}

function TeamPane({ ctx }) {
  const settingsOpen = useValue(showSettings)
  // The keys the model list needs come from one record on the backend. The panel takes the app's theme:
  // every colour is an app token, so there is no second palette to keep in step.
  const settingsQuery = useQuery({
    queryKey: ['pi-team', 'settings'],
    queryFn: () => ctx.rest('/settings', REST)
  })
  const compose = useValue(composeAtom)
  const feature = useValue(selectedFeature)
  const project = useValue(selectedProject)
  const newProject = useValue(composeProject)
  const storedSessionId = useValue(host.state.focusedStoredSessionId)
  const runtimeSessionId = useValue(host.state.activeSessionId)
  const sessionId = storedSessionId || runtimeSessionId
  return jsxs('div', {
    className: 'relative flex h-full min-h-0 overflow-hidden',
    'data-pi-root': '',
    // One frame for the whole panel. A single border on the root, not four on the pieces:
    // an inset ring would be painted under the columns and never show.
    style: { border: '1px solid var(--ui-stroke-secondary)', boxSizing: 'border-box' },
    children: [
      jsx('style', {
        children:
          '.pi-team-scroll::-webkit-scrollbar{width:0;height:0;display:none}' +
          '.pi-team-scroll{scrollbar-width:none}'
      }),
      jsx('div', {
        // 50 / 50, and inline: an arbitrary width class is not in the app's stylesheet.
        className: 'flex shrink-0 flex-col',
        'data-pi-side': 'tree',
        // Clip at the seam: the scroll area runs fourteen pixels wide to lose its native bar,
        // and without this a row's highlight paints over the divider.
        style: { flex: '0 0 50%', width: '50%', minWidth: 0, overflow: 'hidden' },
        onMouseEnter: () => noteHover('tree'),
        children: jsx(LaneList, { ctx })
      }),
      jsx('div', {
        className: 'flex min-w-0 flex-1 flex-col overflow-hidden',
        'data-pi-side': 'pane',
        style: { flex: '1 1 50%', width: '50%', minWidth: 0 },
        onMouseEnter: () => noteHover('pane'),
        children: settingsOpen
          ? jsx(SettingsView, {
              ctx,
              data: settingsQuery.data,
              onChanged: () => settingsQuery.refetch()
            })
          : newProject
          ? jsx(ProjectCompose, {
              ctx,
              sessionId,
              onDone: () => composeProject.set(false)
            })
          : project
            ? jsx(ProjectView, {
                ctx,
                project,
                onDone: () => selectedProject.set(null)
              })
            : compose
          ? jsx(FeatureCompose, {
              ctx,
              project: compose.project,
              sessionId,
              onDone: () => composeAtom.set(null)
            })
          : feature
            ? jsx(FeatureView, {
                ctx,
                project: feature.project,
                feature: feature.feature,
                onDone: () => selectedFeature.set(null)
              })
            : jsx(LaneStatus, { ctx })
      }),
      jsx(SelectionOutline, {}),
      jsx('div', {
        // The track starts under the header: a pill in the header would sit on the title.
        style: {
          position: 'absolute',
          left: 0,
          right: 0,
          top: HEADER_H,
          bottom: 0,
          pointerEvents: 'none',
          zIndex: 5
        },
        children: jsx(ScrollPill, {})
      }),
      // One shadow for the whole width: per-header shadows doubled up at the seam. The settings screen
      // carries none — it is a flat column of rows closed by 1px rules.
      settingsOpen
        ? null
        : jsx('div', {
            'aria-hidden': true,
            style: {
              position: 'absolute',
              left: 0,
              right: 0,
              top: HEADER_H,
              height: BAND_H,
              // A gradient, not a box-shadow: it paints one band across both columns.
              background: BAND_BG,
              pointerEvents: 'none'
            }
          })
    ]
  })
}

export default {
  id: ID,
  name: 'pi-team',
  register(ctx) {
    ctx.i18n.register({
      en: { lanes: 'Lanes', status: 'Lane status', pick: 'Pick a lane on the left.' }
    })

    ctx.register({
      id: 'team',
      area: 'panes',
      title: 'pi team',
      data: {
        placement: 'right',
        dock: { pane: 'workspace', pos: 'right', enforce: true },
        width: '620px',
        minWidth: '380px'
      },
      render: () => jsx(TeamPane, { ctx })
    })
  }
}
