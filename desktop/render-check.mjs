/**
 * Render the pi-team components outside the app: strip the three real imports,
 * stub the SDK, and call every component with fake data. A ReferenceError in
 * render (a variable deleted but still used, say) shows up here instead of as
 * "failed to render" in the panel.
 *
 *   node desktop/render-check.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const here = new URL('.', import.meta.url).pathname
const src = readFileSync(here + 'plugin.js', 'utf8')

const stubs = `
const jsx = (type, props) => ({ type, props })
const jsxs = (type, props) => ({ type, props })
const atom = (value) => {
  const box = { value }
  box.get = () => box.value
  box.set = (next) => { box.value = next }
  return box
}
const useValue = (a) => (a && a.value !== undefined ? a.value : '')
const useState = (value) => [value, () => {}]
const useQuery = (options) => ({ data: globalThis.__DATA__, error: null, refetch: () => {} })
const host = {
  state: {
    cwd: atom('/home/ilja/work/demo-app'),
    focusedStoredSessionId: atom('local-abc'),
    activeSessionId: atom('runtime-1'),
    activeSessionId_: null
  },
  request: async () => ({}),
  openSession: () => {},
  notify: () => {}
}
const Input = () => null
const Button = () => null
const ConfirmDialog = () => null
const icons = { Pencil: () => null, ExternalLink: () => null }
`

let body = src
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/^export default \{/m, 'const PI_TEAM_DEFAULT = {')

const fakeLane = {
  lane: 'theme-picker',
  task: 'Add a theme row to the settings panel.',
  project: 'demo',
  group: 'settings-menu',
  repo: '/home/ilja/work/demo-app',
  worktree: '/home/ilja/work/demo-app/.worktrees/theme-picker',
  branch: 'lane/theme-picker',
  state: 'running',
  started: 1,
  finished: null,
  exit: 0,
  files: 2,
  insertions: 42,
  deletions: 1,
  specs: ['SPEC.md'],
  spec_tree: [{ title: 'SPEC', type: 'spec', path: 'SPEC.md', depth: 0 }],
  plan: { done: 1, total: 3, items: [{ title: 'read the files', status: 'done' }] },
  status: [{ code: 'M', path: 'app.js' }],
  shelved: false,
  shelved_reason: '',
  last_text: 'Done. Changes verified.',
  last_tool: 'edit',
  last_tool_detail: 'app.js',
  last_error: '',
  turns: 3,
  usage: { input: 10, output: 20, total: 0.001 },
  feature_sessions: [{ id: 'local-abc', linked_at: 1, label: 'Демо' }],
  question: {
    id: 'q1',
    method: 'select',
    title: 'Which file?',
    message: '',
    options: ['a.txt', 'b.txt'],
    asked_at: 1
  }
}

const data = {
  lanes: [fakeLane],
  count: 1,
  registry: [{ name: 'demo', repo: '/home/ilja/work/demo-app', features: [{ name: 'settings-menu', title: 'Settings menu', sessions: [] }] }]
}

const probe = `
${stubs}
globalThis.__DATA__ = ${JSON.stringify(data)}
${body}

const ctx = { rest: async () => ({}), i18n: { register: () => {} }, register: () => {} }

const results = {}
selectedLane.set('theme-picker')

for (const name of ['LaneList', 'LaneRow', 'ListHeader', 'Section', 'Row', 'LaneStatus', 'TeamPane', 'SessionTitle', 'AddSessionRow', 'QuestionBlock', 'FeatureCompose', 'FeatureView', 'ProjectCompose', 'ProjectView', 'ScrollPill', 'Scroller', 'FolderPlus', 'SelectionOutline', 'visibleFrame', 'frameParts', 'handoverFade']) {
  const fn = eval(name)
  try {
    const out = fn({
      ctx,
      lane: ${JSON.stringify(fakeLane.lane)},
      entry: { id: 'local-abc', linked_at: 1, label: 'Демо' },
      project: 'demo',
      feature: 'settings-menu',
      sessionId: 'local-abc',
      linked: true,
      onRemove: () => {},
      onChanged: () => {},
      onDone: () => {},
      question: ${JSON.stringify(fakeLane.question)},
      lane: ${JSON.stringify(fakeLane)},
      label: 'demo',
      count: 1,
      open: true,
      onToggle: () => {},
      title: 'sessions · 1',
      band: true,
      onPick: () => {}
    })
    results[name] = 'ok (' + JSON.stringify(out).length + ' chars)'
  } catch (error) {
    results[name] = 'FAIL ' + error.name + ': ' + error.message
  }
}
console.log(JSON.stringify(results, null, 1))
`

writeFileSync('/tmp/pi-team-render.mjs', probe)
try {
  const out = execFileSync('node', ['/tmp/pi-team-render.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  console.log(out)
} catch (error) {
  console.log('run failed:', error.stdout || '', error.stderr || error.message)
}
