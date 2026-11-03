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

import { atom, Button, ConfirmDialog, host, Input, useQuery, useValue } from '@hermes/plugin-sdk'
import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'pi-team'
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

function LaneRow({ lane, active, onPick }) {
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
    children: [
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
const focusAtom = atom('')

function ListHeader({ label, count, open, onToggle, onFocus, action, dim }) {
  return jsxs('div', {
    className: `flex items-center border-b border-(--ui-stroke-secondary) ${dim || ''}`,
    children: [
      jsx('button', {
        type: 'button',
        onClick: onToggle,
        className:
          'flex min-w-0 flex-1 items-center gap-1 px-2 py-1 text-left text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary) hover:bg-(--chrome-action-hover)',
        children: [
          jsx('span', { className: 'w-2 shrink-0', children: open ? '▾' : '▸' }),
          jsx('span', { className: 'truncate', children: label }),
          jsx('span', { className: 'ml-auto shrink-0 pl-2', children: String(count) })
        ]
      }),
      action
        ? jsx('button', {
            type: 'button',
            onClick: action.onClick,
            title: action.title,
            className: `px-1.5 py-1 text-[0.6875rem] hover:text-(--ui-text-secondary) ${
              action.active ? 'text-(--ui-accent)' : 'text-(--ui-text-quaternary)'
            }`,
            children: action.glyph
          })
        : null,
      onFocus
        ? jsx('button', {
            type: 'button',
            onClick: onFocus,
            title: 'focus this project',
            className:
              'px-2 py-1 text-[0.6875rem] text-(--ui-text-quaternary) hover:text-(--ui-text-secondary)',
            children: '»'
          })
        : null
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
  const override = useValue(focusAtom)
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

  const linkFeature = (projectName, featureName, linked) =>
    ctx
      .rest(linked ? '/unlink' : '/link', {
        method: 'POST',
        body: { project: projectName, feature: featureName, session: sessionId },
        timeoutMs: 8000
      })
      .then(() => query.refetch())

  const registry = (query.data && query.data.registry) || []
  const registryByName = new Map(registry.map(entry => [entry.name, entry]))

  const matchesCwd = (repo, name) =>
    repo && cwd && (cwd === repo || cwd.startsWith(repo + '/')) ? name : ''
  const autoProject =
    lanes.reduce((found, lane) => found || matchesCwd(lane.repo, lane.project), '') ||
    registry.reduce((found, entry) => found || matchesCwd(entry.repo, entry.name), '')
  const focused = override || autoProject

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
      'div',
      {
        className: 'pl-3',
        children: jsx(LaneRow, {
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

    const groupBlocks = [...groups.keys()].sort().flatMap(groupKey => {
      const items = groups.get(groupKey)
      const gkey = `g:${project}/${groupKey}`
      const gopen = isOpen(gkey)
      const registeredFeature = ((registered && registered.features) || []).find(
        feature => feature.name === groupKey
      )
      const linked =
        Boolean(sessionId) &&
        Boolean(
          registeredFeature &&
            (registeredFeature.sessions || []).some(entry => entry.id === sessionId)
        )
      const action = registeredFeature
        ? {
            glyph: linked ? '✓' : '+',
            active: linked,
            title: linked ? 'this session is linked — click to remove' : 'link this session to the feature',
            onClick: () => linkFeature(project, groupKey, linked)
          }
        : null
      return [
        jsx(
          ListHeader,
          {
            label: groupKey || 'ungrouped',
            count: items.length,
            open: gopen,
            onToggle: () => toggle(gkey),
            action,
            dim: 'pl-2'
          },
          gkey
        ),
        ...(gopen ? items.map(renderLane) : [])
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
            onToggle: () => toggle(`p:${project}`),
            onFocus: () => focusAtom.set(project)
          }),
          ...(open
            ? [
                ...groupBlocks,
                ...(shelved.length > 0
                  ? [
                      jsx(
                        ListHeader,
                        {
                          label: 'shelf',
                          count: shelved.length,
                          open: isOpen(`s:${project}`),
                          onToggle: () => toggle(`s:${project}`),
                          dim: 'pl-2'
                        },
                        `s:${project}`
                      ),
                      ...(isOpen(`s:${project}`) ? shelved.map(renderLane) : [])
                    ]
                  : [])
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
          'flex items-center gap-2 border-b border-(--ui-stroke-secondary) px-2.5 py-1.5 text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary)',
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
          override
            ? jsx('button', {
                type: 'button',
                onClick: () => focusAtom.set(''),
                className: 'normal-case text-(--ui-text-tertiary) hover:text-foreground',
                children: 'clear focus'
              })
            : null
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

function Section({ title }) {
  return jsx('div', {
    className:
      'mt-1 border-t border-(--ui-stroke-secondary) px-2.5 pt-1.5 pb-0.5 text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary)',
    children: title
  })
}

function planGlyph(status) {
  if (status === 'done') return '✓'
  if (status === 'in_progress') return '▸'
  return '·'
}

const titleDraft = atom('')

function SessionTitle({ entry, project, feature, onRemove }) {
  const query = useQuery({
    queryKey: ['pi-team', 'title', entry.id],
    queryFn: () => host.request('session.title', { session_id: entry.id }),
    staleTime: 60000
  })
  const payload = query.data || {}
  const title = String(payload.title || (payload.result && payload.result.title) || '')
  return jsxs('div', {
    className: 'flex items-center gap-1 pr-1.5 hover:bg-(--chrome-action-hover)',
    children: [
      jsxs('button', {
        type: 'button',
        onClick: () => host.openSession(entry.id),
        title: title ? `open: ${title}` : 'open this session',
        className: 'flex min-w-0 flex-1 items-baseline justify-between gap-2 px-2.5 py-[3px] text-left',
        children: [
          jsx('span', {
            className: 'truncate text-[0.625rem] text-(--ui-text-secondary)',
            children: title || entry.id
          }),
          jsx('span', {
            className: 'shrink-0 text-[0.625rem] text-(--ui-text-quaternary)',
            children: '↗'
          })
        ]
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

function RenameSession() {
  // Stored ids survive a reload; runtime ids do not, and openSession takes the stored one.
  // Both hooks run unconditionally: a conditional one makes the count vary per render.
  const storedSessionId = useValue(host.state.focusedStoredSessionId)
  const runtimeSessionId = useValue(host.state.activeSessionId)
  const sessionId = storedSessionId || runtimeSessionId
  const draft = useValue(titleDraft)
  const [busy, setBusy] = useState(false)

  const apply = async () => {
    const title = draft.trim()
    if (!title || !sessionId || busy) return
    setBusy(true)
    try {
      await host.request('session.title', { session_id: sessionId, title })
      titleDraft.set('')
    } finally {
      setBusy(false)
    }
  }

  return jsxs('div', {
    className: 'flex items-center gap-1 border-t border-(--ui-stroke-secondary) px-2 py-1.5',
    children: [
      jsx(Input, {
        value: draft,
        placeholder: 'name this session',
        onChange: event => titleDraft.set(event.target.value),
        className: 'h-6 flex-1 text-[0.625rem]'
      }),
      jsx(Button, {
        type: 'button',
        onClick: apply,
        disabled: busy,
        children: busy ? '…' : 'set'
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
          'border-b border-(--ui-stroke-secondary) px-2.5 py-1.5 font-mono text-[0.6875rem] text-(--ui-text-secondary)',
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

      (lane.feature_sessions || []).length > 0
        ? jsx(Section, { title: `sessions · ${lane.feature_sessions.length}` })
        : null,
      (lane.feature_sessions || []).map(entry =>
        jsx(
          SessionTitle,
          {
            entry,
            project: lane.project,
            feature: lane.group,
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
      jsx(RenameSession, {}),

      jsx(Section, { title: 'task' }),
      jsx('div', {
        className: 'px-2.5 py-0.5 text-[0.625rem] text-(--ui-text-secondary)',
        children: lane.task || '—'
      }),

      jsx(Section, { title: 'last message' }),
      jsx('div', {
        className:
          'whitespace-pre-wrap px-2.5 py-0.5 font-mono text-[0.625rem] leading-relaxed text-(--ui-text-secondary)',
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
    className: 'flex h-full min-h-0',
    children: [
      jsx('div', {
        className: 'flex w-[240px] shrink-0 flex-col border-r border-(--ui-stroke-secondary)',
        children: jsx(LaneList, { ctx })
      }),
      jsx('div', {
        className: 'flex min-w-0 flex-1 flex-col',
        children: jsx(LaneStatus, { ctx })
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
