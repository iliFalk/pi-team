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
const BAND_H = '3px'
const BAND_BG = 'linear-gradient(to bottom, rgba(0, 0, 0, 0.32), rgba(0, 0, 0, 0))'
// Both text blocks share one height and scroll inside it.
const TEXT_H = '100px'
// Tree geometry: a node owns its line, so a level cannot break into loose segments.
// The line hangs under the icon, so the icon column and the line are one axis.
const GUIDE_STEP = '18px'
const ROW_PAD = '6px'
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

/** A dot that breathes while work is going on in a lane of this node. */
function Pulse() {
  return jsx('span', {
    'aria-hidden': true,
    className: 'pi-team-pulse',
    style: {
      display: 'inline-block',
      width: '7px',
      height: '7px',
      borderRadius: '999px',
      background: 'var(--ui-accent)',
      flex: 'none'
    },
    ref: element => {
      if (!element || element.dataset.piPulse) return
      element.dataset.piPulse = '1'
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      element.animate(
        [
          { opacity: 0.35, transform: 'scale(0.85)' },
          { opacity: 1, transform: 'scale(1.1)', offset: 0.5 },
          { opacity: 0.35, transform: 'scale(0.85)' }
        ],
        { duration: 1600, iterations: Infinity, easing: 'ease-in-out' }
      )
    }
  })
}

/** A ball that runs from a working lane's stub, up its line, into the feature's icon. */
const BALL = 4
const BALL_SHIFT = 0.5

function Runner() {
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
      marginTop: `${-BALL / 2}px`,
      borderRadius: '999px',
      background: 'var(--ui-accent)',
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

      element.animate(
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
    children: jsx('path', { d: open ? FOLDER_OPEN : FOLDER_CLOSED })
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
  const wholeNode = last || orphan ? null : { ...LINE, left: LINE_X, top: 0, bottom: 0 }

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
                  bottom: 0
                }
              })
            : null,
          runner ? jsx(Runner, {}) : null
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

// Marching outline for a lane that works right now. Injected once; every colour
// comes from the app's theme variables, so a theme switch needs no plugin change.
const RUN_CSS = `
@property --pi-angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }

@keyframes pi-team-run { to { --pi-angle: 360deg; } }

.pi-team-run {
  position: relative;
}

.pi-team-asks {
  position: relative;
}

.pi-team-run::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  pointer-events: none;
  background: conic-gradient(
    from var(--pi-angle),
    transparent 0deg 230deg,
    var(--ui-accent) 320deg,
    transparent 360deg
  );
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  animation: pi-team-run 2.5s linear infinite;
}

.pi-team-asks::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  pointer-events: none;
  background: var(--ui-accent);
  opacity: 0.45;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}

.pi-team-pulse {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--ui-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-accent) 22%, transparent);
  animation: pi-team-pulse 1.6s ease-in-out infinite;
}

@keyframes pi-team-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.1); }
}

@media (prefers-reduced-motion: reduce) {
  .pi-team-pulse { animation: none; opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .pi-team-run::before { animation: none; opacity: 0.35; }
}

`

function installRunStyle() {
  if (typeof document === 'undefined') return
  if (document.getElementById('pi-team-run-css')) return
  const style = document.createElement('style')
  style.id = 'pi-team-run-css'
  style.textContent = RUN_CSS
  document.head.appendChild(style)
}


// Hover paint belongs to the label, not to the row: the icon must stay outside it.
const ROW_PY = '6px'
const HEADER_PY = '4px'
const BAND_PY = 4

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
  const live = lane.state === 'running' ? 'pi-team-run' : lane.state === 'waiting' ? 'pi-team-asks' : ''
  const className = [rowClass, dim]
    .filter(Boolean)
    .join(' ')

  return jsxs('button', {
    type: 'button',
    onClick: onPick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    className,
    // The highlight starts at the icon, so the stub and the line stay outside it.
    style: {
      position: 'relative',
      marginLeft: ROW_PAD,
      width: `calc(100% - ${ROW_PAD})`,
      paddingTop: ROW_PY,
      paddingBottom: ROW_PY,
      paddingLeft: 0
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
        className: `min-w-0 flex-1 ${active || hover ? labelBandOn : labelBand} ${live}`,
        style: bandStyle,
        children: [
          jsxs('span', {
            className: 'flex items-baseline gap-2',
            children: [
              jsx('span', { className: 'truncate font-mono text-[0.6875rem]', children: lane.lane }),
              jsx('span', {
                className: `ml-auto shrink-0 text-[0.625rem] ${
                  lane.state === 'running' ? 'text-(--ui-accent)' : 'text-(--ui-text-quaternary)'
                }`,
                children: lane.state
              })
            ]
          }),
          jsx('span', {
            className: 'block truncate text-[0.625rem] text-(--ui-text-tertiary)',
            children: snippet || '—'
          })
        ]
      })
    ]
  })
}

const collapsedAtom = atom({})


function ListHeader({ label, count, running, open, onToggle, dim }) {
  const [hover, setHover] = useState(false)
  return jsxs('div', {
    className: `flex items-center ${dim || ''}`,
    style: { position: 'relative' },
    children: [
      jsx('button', {
        type: 'button',
        onClick: onToggle,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        className:
          'flex min-w-0 flex-1 items-center gap-1 pr-2 text-left text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary)',
        style: { marginLeft: ROW_PAD, width: `calc(100% - ${ROW_PAD})`, paddingTop: HEADER_PY, paddingBottom: HEADER_PY },
        children: [
          jsx('span', {
            className: 'flex shrink-0 items-center justify-center',
            style: { width: `${ICON_SIZE}px` },
            children: jsx(FolderIcon, { open })
          }),
          jsxs('span', {
            className: `flex min-w-0 flex-1 items-center gap-1 ${hover ? labelBandOn : labelBand}`,
            style: bandStyle,
            children: [
              jsx('span', { className: 'truncate', children: label }),
              running
                ? jsxs('span', {
                    className: 'ml-auto flex shrink-0 items-center gap-1 pl-2 text-(--ui-accent)',
                    children: [jsx(Pulse, {}), jsx('span', { children: `${running} running` })]
                  })
                : jsx('span', { className: 'ml-auto shrink-0 pl-2', children: String(count) })
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
  const doUpdate = async () => {
    const result = await ctx.rest('/update', { method: 'POST', body: {}, timeoutMs: 90000 })
    const failed = (result.steps || []).filter(step => !step.ok)
    if (failed.length) {
      throw new Error(failed.map(step => `${step.host}: ${step.detail}`).join(' · '))
    }
    host.notify({
      kind: 'info',
      message: `update: ${result.sha256} · ${(result.steps || []).length} targets`
    })
    query.refetch()
  }

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
          onPick: () => selectedLane.set(lane.lane)
        })
      },
      lane.lane
    )

  const projectBlocks = projects.map(project => {
    const all = laneByProject.get(project) || []
    const open = isOpen(`p:${project}`) && (!focused || focused === project)
    const active = all.filter(lane => !lane.shelved)
    const shelved = all.filter(lane => lane.shelved)

    const registered = registryByName.get(project)
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
      const last = index === groupKeys.length - 1 && shelved.length === 0

      return jsx(
        TreeRow,
        {
          last,
          trunk: gopen && items.length > 0,
          row: jsx(ListHeader, {
            label: groupKey || 'ungrouped',
            count: items.length,
            open: gopen,
            onToggle: () => toggle(gkey)
          }),
          children: [
            gopen && items.length
              ? jsx('div', {
                  'data-pi-kids': '',
                  style: { paddingLeft: GUIDE_STEP },
                  children: items.map((lane, i) => renderLane(lane, i === items.length - 1))
                })
              : null
          ]
        },
        gkey
      )
    })

    const shelfOpen = isOpen(`s:${project}`)
    const shelfNode = shelved.length
      ? jsx(
          TreeRow,
          {
            last: true,
            trunk: shelfOpen,
            row: jsx(ListHeader, {
              label: 'shelf',
              count: shelved.length,
              running: shelved.filter(lane => lane.state === 'running').length,
              open: shelfOpen,
              onToggle: () => toggle(`s:${project}`)
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
          count: all.length,
          open,
          onToggle: () => toggle(`p:${project}`)
        }),
        children: [
          open
            ? jsx('div', {
                style: { paddingLeft: GUIDE_STEP },
                children: [...featureNodes, shelfNode]
              })
            : null
        ]
      },
      project
    )
  })

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
          jsx('button', {
            type: 'button',
            onClick: () => setAskUpdate(true),
            title: 'pull the panel from git and refresh every client',
            className:
              'ml-auto shrink-0 px-1 text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary) hover:text-(--ui-accent)',
            children: 'update'
          }),

        ]
      }),
      jsx('div', {
        className: 'min-h-0 flex-1 overflow-y-auto',
        children: lanes.length === 0 ? emptyHint : projectBlocks
      }),
      askUpdate
        ? jsx(ConfirmDialog, {
            open: true,
            onClose: () => setAskUpdate(false),
            onConfirm: doUpdate,
            title: 'Update pi-team',
            description:
              'Pull iliFalk/pi-team and copy plugin.js to every client in clients.json. The version in git replaces the local file, so uncommitted edits are lost.',
            confirmLabel: 'Update'
          })
        : null,
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

function Row({ label, value }) {
  return jsxs('div', {
    className: 'flex items-baseline justify-between gap-2 px-2.5 py-[3px]',
    children: [
      jsx('span', { className: 'shrink-0 text-[0.625rem] text-(--ui-text-quaternary)', children: label }),
      jsx('span', {
        className: 'truncate text-right font-mono text-[0.625rem] text-(--ui-text-secondary)',
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
      onDone()
    } catch (error) {
      host.notify({ kind: 'error', message: `link failed: ${(error && error.message) || error}` })
    }
  }

  return jsx('button', {
    type: 'button',
    onClick: link,
    title: linked ? 'this chat session is already linked' : 'link this chat session to the feature',
    className:
      'w-full px-2.5 py-[3px] text-left text-[0.625rem] text-(--ui-text-quaternary) hover:text-(--ui-accent)',
    children: 'add this session +'
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

function LaneStatus({ ctx }) {
  const laneName = useValue(selectedLane)
  // Both hooks run every render; openSession and /link take the stored id.
  const storedSessionId = useValue(host.state.focusedStoredSessionId)
  const runtimeSessionId = useValue(host.state.activeSessionId)
  const sessionId = storedSessionId || runtimeSessionId
  const query = useQuery({
    queryKey: ['pi-team', 'lane', laneName],
    queryFn: () => ctx.rest(`/lanes/${encodeURIComponent(laneName)}`, REST),
    enabled: Boolean(laneName),
    refetchInterval: POLL_MS
  })

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

  return jsxs('div', {
    className: 'flex h-full flex-col overflow-y-auto pb-2 text-xs',
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
      jsx(Row, { label: 'state', value: lane.state }),
      lane.shelved ? jsx(Row, { label: 'shelf', value: lane.shelved_reason }) : null,
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
      lane.last_error ? jsx(Row, { label: 'error', value: lane.last_error }) : null,

      jsx(Section, { title: `sessions · ${(lane.feature_sessions || []).length}` }),
      (lane.feature_sessions || []).map(entry =>
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

      jsx(AddSessionRow, {
        ctx,
        project: lane.project,
        feature: lane.group,
        sessionId,
        linked: (lane.feature_sessions || []).some(entry => entry.id === sessionId),
        onDone: () => query.refetch()
      }),

      jsx(Section, { title: 'task', band: true }),
      jsx('div', {
        className:
          'shrink-0 overflow-y-auto whitespace-pre-wrap px-2.5 py-0.5 text-[0.625rem] leading-snug text-(--ui-text-secondary)',
        style: { height: TEXT_H },
        children: lane.task || '—'
      }),

      jsx(Section, { title: 'last message', band: true }),
      jsx('div', {
        className:
          'shrink-0 overflow-y-auto whitespace-pre-wrap break-words px-2.5 py-0.5 font-mono text-[0.625rem] leading-snug text-(--ui-text-secondary)',
        style: { height: TEXT_H },
        children: lane.last_text || 'nothing written yet'
      }),

      status.length > 0 ? jsx(Section, { title: 'files' }) : null,
      status.slice(0, 10).map(item => jsx(Row, { label: item.code, value: item.path }, item.path)),

      jsx(Section, { title: plan ? `plan ${plan.done}/${plan.total}` : 'plan' }),
      plan
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
function TeamPane({ ctx }) {
  return jsxs('div', {
    className: 'relative flex h-full min-h-0',
    children: [
      jsx('div', {
        // 40 / 60, and inline: an arbitrary width class is not in the app's stylesheet.
        className: 'flex shrink-0 flex-col border-r border-(--ui-stroke-secondary)',
        style: { width: '40%', minWidth: 0 },
        children: jsx(LaneList, { ctx })
      }),
      jsx('div', {
        className: 'flex min-w-0 flex-1 flex-col',
        style: { width: '60%' },
        children: jsx(LaneStatus, { ctx })
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
    installRunStyle()

    ctx.i18n.register({
      en: { lanes: 'Lanes', status: 'Lane status', pick: 'Pick a lane on the left.' },
      ru: { lanes: 'Полосы', status: 'Статус полосы', pick: 'Выберите полосу слева.' }
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
