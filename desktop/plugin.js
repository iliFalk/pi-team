/**
 * pi-team — pi lanes in the Hermes desktop.
 *
 * Left pane: one row per lane — name, state, the first line of its last message.
 * Right pane: the selected lane — task, the last text the agent wrote, last tool,
 * changes, plan, touched specs.
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
// Tree geometry: a node owns its line, so a level cannot break into loose segments.
// The line hangs under the icon, so the icon column and the line are one axis.
const GUIDE_STEP = '18px'
// One value for the row's two sides: a row and a header keep the same air left and right,
// so a highlight sits in the middle of its row instead of hugging one edge.
const ROW_PAD = '10px'
const ICON_SIZE = 12
const ICON_CENTER = '12px'
const LINE_X = '-6px'
const STUB_W = '12px'
// Quaternary rather than the border tone: the elbow must stay visible on a
// highlighted row, where a border-coloured line washes out.
const STROKE = 'var(--ui-text-quaternary)'

const LINE = {
  position: 'absolute',
  width: 0,
  borderLeft: `1px solid ${STROKE}`,
  opacity: 0.45,
  pointerEvents: 'none'
}

// One palette for the three states the tree reports.
const RUN_COLOR = '#1A6543'
const ASK_COLOR = '#0762B4'
const ASK_OUTLINE = '#044A8A'
const BAD_COLOR = '#8A1C0E'
// 85%: white on this fill reaches 4.6:1, the threshold for text this small.
const ASK_BG = 'rgba(7, 98, 180, 0.85)'
const ASK_BG_SOFT = 'rgba(7, 98, 180, 0.18)'
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

/** The colour a state is written in, wherever the state is written. */
function stateColour(lane) {
  if (isBad(lane)) return BAD_COLOR
  if (lane.state === 'running') return RUN_COLOR
  if (lane.state === 'waiting') return ASK_COLOR
  if (lane.state === 'done') return `color-mix(in srgb, ${RUN_COLOR} 70%, transparent)`
  return undefined
}

/** A gear that turns while a lane works: the word is replaced by the motion. */
function Gear() {
  return jsx('svg', {
    viewBox: '0 0 24 24',
    width: 12,
    height: 12,
    fill: 'none',
    stroke: RUN_COLOR,
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
function TreeRow({ last, orphan, trunk, runner, row, children }) {
  const blocks = (Array.isArray(children) ? children : [children]).filter(Boolean)

  // The last row stops at its own middle, so its half is measured inside the row.
  // Every other row runs on beside its children, so its line spans the whole node.
  const insideRow = last ? { ...LINE, left: LINE_X, top: 0, height: '50%' } : null
  // Runs on past the row so the air between rows does not cut the line.
  const wholeNode = last || orphan ? null : { ...LINE, left: LINE_X, top: 0, bottom: `-${FEATURE_GAP}` }

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
                  height: '1px',
                  background: STROKE,
                  opacity: 0.45,
                  pointerEvents: 'none'
                }
              }),
          trunk
            ? jsx('span', {
                'aria-hidden': true,
                style: {
                  ...LINE,
                  left: ICON_CENTER,
                  top: `calc(50% + ${ICON_SIZE / 2}px)`,
                  bottom: `-${FEATURE_GAP}`
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



// Hover paint belongs to the label, not to the row: the icon must stay outside it.
const ROW_PY = '6px'
const HEADER_PY = '4px'
const BAND_PY = 4
// One value for both: the air under the panel header and the air around the divider are
// the same 4px, so the first project and the next one start from the same place.
const PROJECT_GAP = '4px'
// Air between the rows of one project, so a feature does not sit on the project's edge.
const FEATURE_GAP = '4px'
// A line of its own with the shadow outside it: dark beside the line, fading away from it.
const PROJECT_SEP_H = '4px'
const PROJECT_SEP_SHADOW = '4px'
// No paint of its own: the band shows the panel's own background between the two shadows.
const PROJECT_SEP_LINE = 'transparent'
const PROJECT_SEP_UP = 'linear-gradient(to top, rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0))'
const PROJECT_SEP_DOWN = 'linear-gradient(to bottom, rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0))'
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
  const bandFill = asked
    ? { ...bandStyle, background: ASK_BG }
    : active || hover
      ? { ...bandStyle, background: 'var(--chrome-action-hover)' }
      : bandStyle
  const statusColor = asked ? '#ffffff' : bad ? BAD_COLOR : lane.state === 'running' ? RUN_COLOR : undefined
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
                style: { color: statusColor || 'var(--ui-text-quaternary)' },
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


// The right pane shows exactly one thing. Every pick clears the other four states first: a lane picked
// while a feature card or a compose field was open used to leave that card on screen, which reads as
// "I selected another element and the pane is still old".
function showLane(name) {
  composeAtom.set(null)
  composeProject.set(false)
  selectedProject.set(null)
  selectedFeature.set(null)
  selectedLane.set(name)
}


function showFeature(project, feature) {
  composeAtom.set(null)
  composeProject.set(false)
  selectedProject.set(null)
  selectedLane.set('')
  selectedFeature.set({ project, feature })
}


function showProject(name) {
  composeAtom.set(null)
  composeProject.set(false)
  selectedLane.set('')
  selectedFeature.set(null)
  selectedProject.set(name)
}


/** Nothing is selected: the right pane says so and no figure is drawn. */
function clearPane() {
  composeAtom.set(null)
  composeProject.set(false)
  selectedProject.set(null)
  selectedFeature.set(null)
  selectedLane.set('')
}


function showComposeFeature(project) {
  composeProject.set(false)
  selectedLane.set('')
  selectedFeature.set(null)
  selectedProject.set(null)
  composeAtom.set({ project })
}


function showComposeProject() {
  composeAtom.set(null)
  selectedLane.set('')
  selectedFeature.set(null)
  selectedProject.set(null)
  composeProject.set(true)
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
  const box = band.getBoundingClientRect()
  // A scrolled-away row would put the notch outside the panel: keep it inside the visible strip.
  const header = 28
  const top = Math.max(Math.round(box.top - outer.top), header)
  const bottom = Math.min(Math.round(box.bottom - outer.top), Math.round(outer.height))
  if (bottom - top < 10) {
    if (selectedBox.get()) selectedBox.set(null)
    return
  }
  const next = {
    width: Math.round(outer.width),
    height: Math.round(outer.height),
    seam: Math.round(outer.width / 2),
    left: Math.round(box.left - outer.left),
    right: Math.round(box.right - outer.left),
    top,
    rowHeight: bottom - top,
    color: row.getAttribute('data-pi-colour') || 'var(--ui-text-tertiary)'
  }
  const current = selectedBox.get()
  if (
    current &&
    current.width === next.width &&
    current.height === next.height &&
    current.left === next.left &&
    current.top === next.top &&
    current.rowHeight === next.rowHeight &&
    current.color === next.color
  ) {
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
  // Measure after the frame, not during the commit: the row's final box is only settled once the
  // whole panel has painted.
  const probe = jsx('span', {
    style: { display: 'none' },
    ref: () => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => measureSelection())
      else measureSelection()
    }
  })
  const radius = 4
  const seam = box ? box.seam : 0
  const top = box ? box.top : 0
  const bottom = box ? box.top + box.rowHeight : 0
  // Open path: it starts at the band's top-right corner, runs round the pane and returns to the
  // band's bottom-right corner. The row's own ring closes the figure on its left side.
  // Closed figure: the band's frame (open on the right) plus the pane, one line around both.
  const figure = box
    ? `M ${box.left + radius} ${top} L ${seam} ${top} L ${seam} ${radius} Q ${seam} 0 ${seam + radius} 0 ` +
      `L ${box.width - radius} 0 Q ${box.width} 0 ${box.width} ${radius} ` +
      `L ${box.width} ${box.height - radius} Q ${box.width} ${box.height} ${box.width - radius} ${box.height} ` +
      `L ${seam + radius} ${box.height} Q ${seam} ${box.height} ${seam} ${box.height - radius} ` +
      `L ${seam} ${bottom} L ${box.left + radius} ${bottom} ` +
      `Q ${box.left} ${bottom} ${box.left} ${bottom - radius} ` +
      `L ${box.left} ${top + radius} Q ${box.left} ${top} ${box.left + radius} ${top} Z`
    : ''

  return jsxs('div', {
    'aria-hidden': true,
    style: { position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 },
    children: [
      probe,
      box
        ? jsxs('svg', {
            width: box.width,
            height: box.height,
            viewBox: `0 0 ${box.width} ${box.height}`,
            style: { position: 'absolute', inset: 0, pointerEvents: 'none' },
            children: [
              // The seam above the row, and below it: the selected row is the only gap.
              jsx('line', {
                x1: seam + 0.5,
                y1: 0,
                x2: seam + 0.5,
                y2: top,
                stroke: 'var(--ui-stroke-secondary)',
                strokeWidth: 1
              }),
              jsx('line', {
                x1: seam + 0.5,
                y1: bottom,
                x2: seam + 0.5,
                y2: box.height,
                stroke: 'var(--ui-stroke-secondary)',
                strokeWidth: 1
              }),
              jsx('path', {
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


function ListHeader({ label, counts, plain, action, open, onToggle, dim, tag, selected, colour }) {
  const [hover, setHover] = useState(false)
  const [asking, setAsking] = useState(false)
  const hasCounts = Boolean(counts && (counts.ask || counts.bad || counts.run || counts.done))
  const hasPlain = plain !== undefined && plain !== null
  const groups = hasCounts
    ? [
        counts.ask ? mark('?', counts.ask, ASK_COLOR) : null,
        counts.bad ? mark('!', counts.bad, BAD_COLOR) : null,
        counts.run
          ? jsxs(
              'span',
              {
                className: 'flex items-center gap-0.5',
                style: { color: RUN_COLOR },
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
          'flex min-w-0 flex-1 items-center gap-1 pr-2.5 text-left text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary)',
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
              ? { ...bandStyle, background: ASK_BG_SOFT }
              : hover
                ? { ...bandStyle, background: 'var(--chrome-action-hover)' }
                : bandStyle,
            children: [
              jsx('span', {
                className: 'truncate',
                // Shrinks when the name is long, so the counters keep their place on the right
                // edge instead of being pushed inwards by the overflow.
                style: { ...TEXT_NUDGE, flex: '0 1 auto', minWidth: 0 },
                children: label
              }),
              tag
                ? jsx('span', {
                    className: 'shrink-0 uppercase',
                    style: { ...TEXT_NUDGE, color: 'var(--ui-text-quaternary)', fontSize: '10.5px' },
                    children: tag
                  })
                : null,
              // A create action has nothing to confirm: one click opens the field.
              action && action.instant
                ? jsx('span', {
                    role: 'button',
                    tabIndex: 0,
                    title: action.title || '',
                    onClick: event => {
                      event.stopPropagation()
                      action.onClick()
                    },
                    className:
                      'shrink-0 rounded border border-(--ui-stroke-secondary) uppercase hover:bg-(--ui-fill-tertiary)',
                    style: {
                      transform: 'translateY(-0.5px)',
                      display: 'flex',
                      alignItems: 'center',
                      height: '18px',
                      padding: '0 5px',
                      fontSize: '11.5px',
                      lineHeight: 1
                    },
                    children: jsx('span', {
                      style: { display: 'block', transform: 'translate(0.5px, 0.5px)' },
                      children: action.label
                    })
                  })
                : null,
              action && !action.instant
                ? asking
                  ? jsxs('span', {
                      className: 'flex shrink-0 items-center gap-1',
                      style: { transform: 'translateY(-0.5px)' },
                      children: [
                        jsx('span', {
                          role: 'button',
                          tabIndex: 0,
                          title: 'cancel',
                          onClick: event => {
                            event.stopPropagation()
                            setAsking(false)
                          },
                          className: 'flex items-center justify-center rounded border',
                          style: {
                            color: BAD_COLOR,
                            borderColor: BAD_COLOR,
                            width: '18px',
                            height: '18px',
                            fontSize: '13px',
                            lineHeight: 1
                          },
                          children: '✕'
                        }),
                        jsx('span', {
                          role: 'button',
                          tabIndex: 0,
                          title: action.title || '',
                          onClick: event => {
                            event.stopPropagation()
                            setAsking(false)
                            action.onClick()
                          },
                          className: 'flex items-center justify-center rounded border',
                          style: {
                            color: RUN_COLOR,
                            borderColor: RUN_COLOR,
                            width: '18px',
                            height: '18px',
                            fontSize: '13px',
                            lineHeight: 1
                          },
                          children: '✓'
                        })
                      ]
                    })
                  : jsx('span', {
                      // Not a button: the whole header is already one, and a button inside a
                      // button is invalid — the browser rearranges it and the row drifts.
                      role: 'button',
                      tabIndex: 0,
                      onClick: event => {
                        event.stopPropagation()
                        setAsking(true)
                      },
                      title: action.title || '',
                      className:
                        'shrink-0 rounded border border-(--ui-stroke-secondary) uppercase hover:bg-(--ui-fill-tertiary)',
                      style: {
                        // The box sits half a pixel above the text's axis.
                        transform: 'translateY(-0.5px)',
                        display: 'flex',
                        alignItems: 'center',
                        height: '18px',
                        padding: '0 5px',
                        fontSize: '11.5px',
                        lineHeight: 1
                      },
                      children: jsx('span', {
                        // The box stays where it is; only the word drops one pixel inside it.
                        style: { display: 'block', transform: 'translate(0.5px, 0.5px)' },
                        children: action.label
                      })
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
                            style: { color: 'var(--ui-text-quaternary)' },
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
        runner: lane.state === 'running',
        row: jsx(LaneRow, {
          lane,
          active: lane.lane === current,
          onPick: () => {
            showLane(lane.lane)
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
      // The add-feature row closes the block, so no feature above it ends the level.
      const last = false

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
              // A feature has no card of its own. The click opens or closes it and keeps the lane you
              // were reading — unless that lane lives in THIS feature: then the pick is done and the
              // pane empties, which is how the selection is released.
              toggle(gkey)
              const chosen = (lanes || []).find(lane => lane.lane === current)
              if (chosen && chosen.project === project && (chosen.group || '') === groupKey) {
                clearPane()
              }
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
            last: false,
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
            last: false,
            trunk: shelfOpen,
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
                children: [
                  ...featureNodes,
                  handedNode,
                  shelfNode,
                  jsx(
                    TreeRow,
                    {
                      last: true,
                      row: jsx('button', {
                        type: 'button',
                        title: 'ask for a feature in one line',
                        onClick: () => {
                          setAskUpdate(false)
                          showComposeFeature(project)
                        },
                        className:
                          'flex w-full items-center gap-1 text-left text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary) hover:text-(--ui-accent)',
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
                            className: 'truncate',
                            style: TEXT_NUDGE,
                            children: 'new feature'
                          })
                        ]
                      })
                    },
                    `add:${project}`
                  )
                ]
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
            style: { pointerEvents: 'none' },
            children: [
              jsx('div', { style: { height: PROJECT_SEP_SHADOW, background: PROJECT_SEP_UP } }),
              jsx('div', { style: { height: PROJECT_SEP_H, background: PROJECT_SEP_LINE } }),
              jsx('div', { style: { height: PROJECT_SEP_SHADOW, background: PROJECT_SEP_DOWN } })
            ]
          }, `sep:${index}`)
        ]
  )

  const emptyHint = jsx('div', {
    className: 'px-2.5 py-2 text-[0.625rem] leading-relaxed text-(--ui-text-quaternary)',
    children: 'No lane yet.'
  })

  return jsxs('div', {
    className: 'flex h-full flex-col text-xs',
    children: [
      jsxs('div', {
        className:
          'flex shrink-0 items-center gap-2 border-b border-(--ui-stroke-secondary) px-2.5 text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary)',
        style: { height: HEADER_H },
        children: [
          jsx('span', { children: `projects · ${projects.length}` }),
          jsx('span', {
            role: 'button',
            tabIndex: 0,
            title: 'add a project by its repository',
            onClick: () => {
              showComposeProject()
            },
            className:
              'flex shrink-0 items-center justify-center rounded border border-(--ui-stroke-secondary) hover:bg-(--ui-fill-tertiary)',
            style: { width: '16px', height: '16px', lineHeight: 1, fontSize: '11.5px' },
            children: '+'
          }),
          askUpdate
            ? jsxs('span', {
                className: 'ml-auto flex shrink-0 items-center gap-1',
                children: [
                  jsx('span', {
                    role: 'button',
                    tabIndex: 0,
                    title: 'cancel',
                    onClick: () => setAskUpdate(false),
                    className: 'flex items-center justify-center rounded border text-[0.625rem]',
                    style: { color: BAD_COLOR, borderColor: BAD_COLOR, width: '16px', height: '16px', lineHeight: 1 },
                    children: '✕'
                  }),
                  jsx('span', {
                    role: 'button',
                    tabIndex: 0,
                    title: 'ask the agent to update the plugin',
                    onClick: () => {
                      setAskUpdate(false)
                      ctx
                        .rest('/update/request', {
                          method: 'POST',
                          body: { session_key: sessionId },
                          timeoutMs: 15000
                        })
                        .then(() => host.notify({ kind: 'info', message: 'update: the request went to the chat' }))
                    },
                    className: 'flex items-center justify-center rounded border text-[0.625rem]',
                    style: { color: RUN_COLOR, borderColor: RUN_COLOR, width: '16px', height: '16px', lineHeight: 1 },
                    children: '✓'
                  })
                ]
              })
            : jsx('span', {
                role: 'button',
                tabIndex: 0,
                onClick: () => setAskUpdate(true),
                title: 'ask the agent to pull the repo, copy the files and restart the backend',
                className:
                  'ml-auto shrink-0 px-1 text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary) hover:text-(--ui-accent)',
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
              'border-t border-(--ui-stroke-secondary) px-2.5 py-1.5 text-[0.625rem] text-(--ui-danger)',
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
      jsx('span', { className: 'shrink-0 text-[0.625rem] text-(--ui-text-quaternary)', children: label }),
      jsx('span', {
        className: 'truncate text-right font-mono text-[0.625rem]',
        style: { color: color || 'var(--ui-text-secondary)' },
        children: value
      })
    ]
  })
}

function Section({ title, band }) {
  return jsxs('div', {
    className:
      'mt-1 border-t border-(--ui-stroke-secondary) px-2.5 pt-1.5 pb-0.5 text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary)',
    children: [
      title,
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
      jsx('button', {
        type: 'button',
        onClick: () => setAsking(!asking),
        title: linked ? 'this chat session is already linked' : 'link this chat session to the feature',
        className:
          'w-full text-left text-[0.625rem] text-(--ui-text-quaternary) hover:text-(--ui-accent)',
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
              jsx('span', {
                role: 'button',
                tabIndex: 0,
                title: 'cancel',
                onClick: () => setAsking(false),
                className: 'flex shrink-0 items-center justify-center rounded border',
                style: { color: BAD_COLOR, borderColor: BAD_COLOR, width: '16px', height: '16px', lineHeight: 1 },
                children: '✕'
              }),
              jsx('span', {
                role: 'button',
                tabIndex: 0,
                title: 'link',
                onClick: link,
                className: 'flex shrink-0 items-center justify-center rounded border',
                style: { color: RUN_COLOR, borderColor: RUN_COLOR, width: '16px', height: '16px', lineHeight: 1 },
                children: '✓'
              })
            ]
          })
        : null
    ]
  })
}

function planGlyph(status) {
  if (status === 'done') return '✓'
  if (status === 'in_progress') return '▸'
  return '·'
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
        jsx('button', {
          type: 'button',
          onClick: save,
          className: 'shrink-0 px-1 text-[0.625rem] text-(--ui-accent)',
          children: 'ok'
        })
      ]
    })
  }

  const iconClass =
    'shrink-0 px-1 leading-none text-(--ui-text-quaternary) hover:text-(--ui-text-secondary)'

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
      jsx('button', {
        type: 'button',
        onClick: onRemove,
        title: 'remove this session from the feature',
        className:
          'shrink-0 px-1 text-[0.6875rem] leading-none text-(--ui-text-quaternary) hover:text-(--ui-danger)',
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
          'button',
          {
            className:
              'mt-1 mr-1 rounded border border-(--ui-stroke-secondary) px-1.5 py-0.5 text-[0.625rem] text-(--ui-text-primary) hover:bg-(--ui-fill-tertiary)',
            onClick: () => send({ value: option }),
            children: option
          },
          option
        )
      ),
      jsx('button', {
        className:
          'mt-1 rounded px-1.5 py-0.5 text-[0.625rem] text-(--ui-text-quaternary) hover:text-(--ui-text-secondary)',
        onClick: () => send({ cancelled: true }),
        children: 'dismiss'
      })
    ]
  })
}

/** One message in a lane's thread: the lane's own words, mine, or Ilja's. */
function Bubble({ who, text }) {
  const label = who === 'jarvis' ? 'me' : who === 'lane' ? 'lane' : 'you'
  const style =
    who === 'jarvis'
      ? { borderLeft: `2px solid ${RUN_COLOR}`, paddingLeft: '4px', color: 'var(--ui-text-secondary)' }
      : who === 'user'
        ? { background: 'var(--chrome-action-hover)', color: 'var(--ui-text-primary)' }
        : { color: 'var(--ui-text-quaternary)', fontFamily: 'ui-monospace, monospace' }
  return jsxs('div', {
    className: 'mb-1 whitespace-pre-wrap break-words rounded px-1 py-0.5 text-[0.625rem] leading-snug',
    style,
    children: [
      jsx('span', {
        className: 'mr-1 text-[0.5625rem] uppercase',
        style: { opacity: 0.65 },
        children: label
      }),
      text
    ]
  })
}

/** The conversation about one lane, with a box that sends into the chat, not into pi. */
function ThreadView({ ctx, lane, draft, setDraft, onSent }) {
  const messages = lane.thread || []
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
        onSent()
      })
  }
  return jsxs('div', {
    children: [
      jsxs('div', {
        className: 'overflow-y-auto px-2.5 py-1',
        style: { maxHeight: '38vh' },
        children: [
          lane.last_text ? jsx(Bubble, { who: 'lane', text: lane.last_text }, 'now') : null,
          messages.map((message, index) =>
            jsx(Bubble, { who: message.who, text: message.text }, `${index}-${message.at}`)
          )
        ]
      }),
      jsxs('div', {
        className: 'flex shrink-0 items-center gap-1 px-2.5 py-1',
        children: [
          jsx(Input, {
            value: draft,
            placeholder: 'say something about this lane',
            onChange: event => setDraft(event.target.value),
            onKeyDown: event => {
              if (event.key === 'Enter') send()
            },
            className: 'h-6 flex-1 text-[0.625rem]'
          }),
          jsx('span', {
            role: 'button',
            tabIndex: 0,
            onClick: send,
            className:
              'shrink-0 rounded border border-(--ui-stroke-secondary) px-1.5 py-0.5 text-[0.625rem] hover:bg-(--ui-fill-tertiary)',
            children: 'send'
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
      jsx(Section, { title: 'merge' }),
      jsx(Row, { label: 'commit', value: merge.short, color: RUN_COLOR }),
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
            className: 'px-2.5 py-2 text-[0.625rem] text-(--ui-text-quaternary)',
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
                    className: 'ml-auto shrink-0 text-[0.625rem] text-(--ui-text-quaternary)',
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
      className: 'flex h-full items-center px-2.5 text-[0.625rem] text-(--ui-text-quaternary)',
      children: 'Pick a lane on the left.'
    })
  }
  if (query.error) {
    return jsx('div', {
      className: 'px-2.5 py-2 text-[0.625rem] text-(--ui-text-quaternary)',
      children: 'Lane state unavailable. Is plugin pi-team enabled?'
    })
  }

  const lane = query.data
  if (!lane) {
    return jsx('div', {
      className: 'px-2.5 py-2 text-[0.625rem] text-(--ui-text-quaternary)',
      children: 'Loading…'
    })
  }

  const plan = lane.plan
  const usage = lane.usage || {}
  const status = lane.status || []

  return jsxs(Scroller, {
    side: 'pane',
    className: 'flex flex-col pb-2 text-xs',
    children: [
      jsx('div', {
        className:
          'flex shrink-0 items-center border-b border-(--ui-stroke-secondary) px-2.5 font-mono text-[0.6875rem] text-(--ui-text-secondary)',
        style: { height: HEADER_H },
        children: lane.lane
      }),
      lane.question
        ? jsx(QuestionBlock, {
            ctx,
            lane: lane.lane,
            question: lane.question,
            onDone: () => query.refetch()
          })
        : null,
      jsx(Row, { label: 'state', value: lane.state, color: stateColour(lane) }),
      !lane.shelved && ['done', 'stopped', 'failed', 'error'].includes(lane.state)
        ? lane.handed
          ? jsx('span', {
              className: 'mx-2.5 my-1 shrink-0 rounded border px-1.5 py-0.5 text-[0.625rem]',
              style: { color: ASK_COLOR, borderColor: ASK_COLOR },
              children: 'in review'
            })
          : jsx('span', {
              role: 'button',
              tabIndex: 0,
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
                'mx-2.5 my-1 shrink-0 rounded border border-(--ui-stroke-secondary) px-1.5 py-0.5 text-[0.625rem] hover:bg-(--ui-fill-tertiary)',
              children: 'to review'
            })
        : null,
      lane.shelved ? jsx(Row, { label: 'closed', value: lane.shelved_reason }) : null,
      lane.merge ? jsx(Receipt, { merge: lane.merge }) : null,
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
                    style: { maxHeight: TEXT_H, color: BAD_COLOR },
                    children: lane.stderr
                  })
                : null
            ]
          })
        : null,
      lane.handed && !lane.shelved
        ? jsx('span', {
            role: 'button',
            tabIndex: 0,
            onClick: () =>
              ctx
                .rest(`/lanes/${encodeURIComponent(lane.lane)}/say`, {
                  method: 'POST',
                  body: { text: 'Close this lane: show the plan first, and delete nothing without my go.' },
                  timeoutMs: 15000
                })
                .then(() => query.refetch()),
            title: 'ask the orchestrator to close this lane; it shows the plan first',
            className:
              'mx-2.5 my-1 shrink-0 self-start rounded border border-(--ui-stroke-secondary) px-1.5 py-0.5 text-[0.625rem] hover:bg-(--ui-fill-tertiary)',
            children: 'close'
          })
        : null,
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
        ? jsx(Row, { label: 'error', value: lane.last_error, color: BAD_COLOR })
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
        : jsx(Section, { title: 'thread', band: true }),
      lane.archived
        ? null
        : jsx(ThreadView, { ctx, lane, draft, setDraft, onSent: () => query.refetch() }),

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
                        style: { color: RUN_COLOR, marginLeft: 'auto' },
                        children: file.binary ? 'bin' : `+${file.insertions}`
                      }),
                      jsx('span', {
                        style: {
                          color: file.deletions ? BAD_COLOR : 'var(--ui-text-quaternary)'
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

      lane.shelved ? null : jsx(Section, { title: plan ? `plan ${plan.done}/${plan.total}` : 'plan' }),
      lane.shelved ? null : plan
        ? (plan.items || []).slice(0, 10).map((item, index) =>
            jsx(Row, { label: planGlyph(item.status), value: item.title }, `${index}-${item.title}`)
          )
        : jsx('div', {
            className: 'px-2.5 py-0.5 text-[0.625rem] text-(--ui-text-quaternary)',
            children: 'no plan'
          }),

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
                className: 'ml-auto shrink-0 text-(--ui-text-quaternary)',
                children: node.type === 'task-spec' ? 'task' : ''
              })
            ]
          },
          node.id
        )
      )
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
          : `${result.name}: project created, but the message was not delivered — write to me in the chat`
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
        className: 'text-[0.6875rem] leading-relaxed text-(--ui-text-quaternary)',
        children:
          'Paste a GitHub repository. I check that it exists and that this machine can read it, then clone it into ~/work, register it, and the project appears in the tree.'
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
            style: { color: check.ok ? 'var(--ui-text-secondary)' : BAD_COLOR },
            children: check.ok
              ? `${check.slug} · ${check.private ? 'private' : 'public'} · ${check.branch || 'branch unknown'} · clone to ${check.clone_target}${check.clone_exists ? ' (folder exists!)' : ''}`
              : check.error
          })
        : null,
      jsxs('div', {
        className: 'flex shrink-0 items-center gap-2',
        children: [
          jsx('span', {
            role: 'button',
            tabIndex: 0,
            onClick: runCheck,
            className: 'flex items-center justify-center rounded border px-2 py-[2px] text-[0.6875rem]',
            style: { color: ASK_COLOR, borderColor: ASK_COLOR, opacity: busy || !url.trim() ? 0.5 : 1 },
            children: busy ? 'checking…' : 'check'
          }),
          jsx('span', {
            role: 'button',
            tabIndex: 0,
            onClick: send,
            className: 'flex items-center justify-center rounded border px-2 py-[2px] text-[0.6875rem]',
            style: {
              color: RUN_COLOR,
              borderColor: RUN_COLOR,
              opacity: busy || !check || !check.ok ? 0.5 : 1
            },
            children: 'send'
          }),
          jsx('span', {
            role: 'button',
            tabIndex: 0,
            onClick: onDone,
            className: 'flex items-center justify-center rounded border px-2 py-[2px] text-[0.6875rem]',
            style: { color: BAD_COLOR, borderColor: BAD_COLOR },
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
        className: 'text-[0.6875rem] leading-relaxed text-(--ui-text-quaternary)',
        children:
          'Waiting for the clone. When it lands in ~/work and the project is registered, this placeholder becomes the project itself.'
      }),
      jsx('span', {
        role: 'button',
        tabIndex: 0,
        onClick: drop,
        className: 'mt-auto flex w-fit items-center justify-center rounded border px-2 py-[2px] text-[0.6875rem]',
        style: { color: BAD_COLOR, borderColor: BAD_COLOR },
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
          : `${project}: feature created, but the message was not delivered — write to me in the chat`
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
        className: 'text-[0.6875rem] leading-relaxed text-(--ui-text-quaternary)',
        children:
          'Write what you want. The feature appears at once as preparation; I give it a name and the task for pi.'
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
          jsx('span', {
            role: 'button',
            tabIndex: 0,
            onClick: send,
            className: 'flex items-center justify-center rounded border px-2 py-[2px] text-[0.6875rem]',
            style: { color: RUN_COLOR, borderColor: RUN_COLOR, opacity: busy || !text.trim() ? 0.5 : 1 },
            children: busy ? 'sending…' : 'send'
          }),
          jsx('span', {
            role: 'button',
            tabIndex: 0,
            onClick: onDone,
            className: 'flex items-center justify-center rounded border px-2 py-[2px] text-[0.6875rem]',
            style: { color: BAD_COLOR, borderColor: BAD_COLOR },
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
        color: chats.length ? undefined : 'var(--ui-text-quaternary)'
      }),
      jsx(Row, { label: 'lanes', value: String(lanes.length) }),
      lanes.length
        ? jsx('div', {
            className: 'flex flex-col',
            children: lanes.map(lane =>
              jsx(
                'button',
                {
                  type: 'button',
                  onClick: () => {
                    showLane(lane.lane)
                  },
                  className: 'flex items-center gap-2 py-[3px] text-left text-[0.6875rem]',
                  children: [
                    jsx('span', {
                      className: 'min-w-0 flex-1 truncate font-mono',
                      style: { color: 'var(--ui-text-secondary)' },
                      children: lane.lane
                    }),
                    jsx('span', {
                      className: 'shrink-0 text-[0.625rem]',
                      style: { color: stateColour(lane) || 'var(--ui-text-quaternary)' },
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
        className: 'text-[0.6875rem] leading-relaxed text-(--ui-text-quaternary)',
        children: preparing
          ? 'Waiting for a name, a task for pi and its first lane. Until it has a lane, the feature can be dropped.'
          : 'Pick a lane below, or write in the thread of one to send work back.'
      }),
      preparing
        ? jsx('span', {
            role: 'button',
            tabIndex: 0,
            onClick: drop,
            className:
              'mt-auto flex w-fit items-center justify-center rounded border px-2 py-[2px] text-[0.6875rem]',
            style: { color: BAD_COLOR, borderColor: BAD_COLOR },
            children: 'drop feature'
          })
        : null
    ]
  })
}

function TeamPane({ ctx }) {
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
        children: newProject
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
      // One shadow for the whole width: per-header shadows doubled up at the seam.
      jsx('div', {
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
