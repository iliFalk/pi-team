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
// Tree geometry lives in inline styles: an injected stylesheet did not reach the pane.
const GUIDE_STEP = '14px'
const STROKE = 'var(--ui-stroke-secondary)'
const guideStyle = { position: 'relative', marginLeft: GUIDE_STEP, marginTop: '-9px', paddingTop: '9px' }
const lineStyle = {
  position: 'absolute',
  left: 0,
  top: 0,
  bottom: '14px',
  width: 0,
  borderLeft: `1px solid ${STROKE}`,
  opacity: 0.7,
  pointerEvents: 'none'
}
const tickStyle = {
  position: 'absolute',
  left: '-1px',
  top: '50%',
  width: '9px',
  height: '1px',
  background: STROKE,
  opacity: 0.7,
  pointerEvents: 'none'
}
const BAND_BG = 'linear-gradient(to bottom, rgba(0, 0, 0, 0.32), rgba(0, 0, 0, 0))'
const TEXT_H = '100px'

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


const rowClass =
  'flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-(--chrome-action-hover)'

function stateDot(state) {
  if (state === 'running') return 'bg-(--ui-accent)'
  if (state === 'failed') return 'bg-(--ui-danger)'
  if (state === 'done') return 'bg-(--ui-text-tertiary)'
  return 'bg-(--ui-text-quaternary)'
}

function firstLine(text) {
  if (!text) return ''
  const line = text.split('\n').find(part => part.trim())
  return line ? line.trim().slice(0, 80) : ''
}

function LaneRow({ lane, active, onPick, tick }) {
  const snippet = lane.shelved ? lane.shelved_reason : firstLine(lane.last_text) || lane.task
  const dim = lane.shelved ? 'opacity-55' : ''
  const live = lane.state === 'running' ? 'pi-team-run' : lane.state === 'waiting' ? 'pi-team-asks' : ''
  const className = [
    rowClass,
    active ? 'bg-(--chrome-action-hover)' : '',
    dim,
    live,
    live ? 'rounded-md' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return jsxs('button', {
    type: 'button',
    onClick: onPick,
    className,
    style: { position: 'relative' },
    children: [
      tick ? jsx('span', { 'aria-hidden': true, style: tickStyle }) : null,
      jsx('span', {
        className: `mt-1.5 inline-block size-1.5 shrink-0 rounded-full ${stateDot(lane.state)}`
      }),
      jsxs('span', {
        className: 'min-w-0 flex-1',
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


function ListHeader({ label, count, open, onToggle, dim, tick }) {
  return jsxs('div', {
    className: `flex items-center border-b border-(--ui-stroke-secondary) ${dim || ''}`,
    style: { position: 'relative' },
    children: [
      jsx('button', {
        type: 'button',
        onClick: onToggle,
        className:
          'flex min-w-0 flex-1 items-center gap-1 px-2 py-1 text-left text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary) hover:bg-(--chrome-action-hover)',
        children: [
          tick ? jsx('span', { 'aria-hidden': true, style: tickStyle }) : null,
          jsx('span', { className: 'w-2 shrink-0', children: open ? '▾' : '▸' }),
          jsx('span', { className: 'truncate', children: label }),
          jsx('span', { className: 'ml-auto shrink-0 pl-2', children: String(count) })
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

  const renderLane = lane =>
    jsx(
      LaneRow,
      {
        lane,
        tick: true,
        active: lane.lane === current,
        onPick: () => selectedLane.set(lane.lane)
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

    const groupBlocks = [...groups.keys()].sort().flatMap(groupKey => {
      const items = groups.get(groupKey)
      const gkey = `g:${project}/${groupKey}`
      const gopen = isOpen(gkey)

      return [
        jsx(
          ListHeader,
          {
            label: groupKey || 'ungrouped',
            count: items.length,
            tick: true,
            open: gopen,
            onToggle: () => toggle(gkey)
          },
          gkey
        ),
        ...(gopen ? [jsx(
            'div',
            {
              style: guideStyle,
              children: [jsx('span', { 'aria-hidden': true, style: lineStyle }), ...items.map(renderLane)]
            },
            `kids:${gkey}`
          )] : [])
      ]
    })

    return jsxs(
      'div',
      {
        className: '',
        children: [
          jsx(ListHeader, {
            label: project,
            count: all.length,
            open,
            onToggle: () => toggle(`p:${project}`)
          }),
          ...(open
            ? [
                jsx(
                  'div',
                  {
                    style: guideStyle,
                    children: [
                      jsx('span', { 'aria-hidden': true, style: lineStyle }),
                      ...groupBlocks,
                      ...(shelved.length > 0
                        ? [
                            jsx(
                              ListHeader,
                              {
                                label: 'shelf',
                                count: shelved.length,
                                tick: true,
                                open: isOpen(`s:${project}`),
                                onToggle: () => toggle(`s:${project}`)
                              },
                              `s:${project}`
                            ),
                            ...(isOpen(`s:${project}`)
                              ? [jsx(
                                'div',
                                {
                                  style: guideStyle,
                                  children: [jsx('span', { 'aria-hidden': true, style: lineStyle }), ...shelved.map(renderLane)]
                                },
                                `shelf:${project}`
                              )]
                              : [])
                          ]
                        : [])
                    ]
                  },
                  `body:${project}`
                )
              ]
            : [])
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
    className: 'border-b border-(--ui-stroke-secondary) px-2.5 py-1.5',
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
        className: 'flex w-[240px] shrink-0 flex-col border-r border-(--ui-stroke-secondary)',
        children: jsx(LaneList, { ctx })
      }),
      jsx('div', {
        className: 'flex min-w-0 flex-1 flex-col',
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
