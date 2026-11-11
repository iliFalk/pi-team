# pi-team

**A workbench for coding lanes inside Hermes.** One panel, one row per lane, the whole lane beside it.

You start work the way you already do — by talking to your agent. pi-team turns that into visible,
parallel, reviewable lanes: each one a git worktree plus a headless [`pi`](https://github.com/earendil-works/pi)
run, with its own branch, its own diff and its own question when it gets stuck.

| | |
|---|---|
| **Without it** | five agents, five terminals, and you as the router: "what is running?", "which one is stuck?", "what did it change?" |
| **With it** | a tree of projects → features → lanes, and one card per lane: task, plan, diff, thread, `ANSWER`, `TO REVIEW`, `CLOSE` |
| **What ships** | a desktop panel, a dashboard API behind it, and the `pi-coach` procedure as a skill — all from one install |

<!-- screenshot: docs/panel.png (the panel docked right, two lanes running) — add before the catalog PR -->

## Requirements

| Needs | Why |
|---|---|
| Hermes Agent `>= 0.23.0` | the plugin host that serves a dashboard API |
| Hermes Desktop | the panel is a Desktop SDK extension, not a web page |
| [`pi`](https://github.com/earendil-works/pi) `1.4.0` or newer | every lane is one headless `pi` run |
| `git` | a lane is a worktree cut from your repository |
| a provider key in Hermes | lanes take their model from the providers Hermes already knows |

## Install

One action, both halves — the panel and the backend behind it — plus the skill `pi-team:pi-coach`.

**In the desktop:** Settings → Plugins → Install from Git → paste `iliFalk/pi-team`, and say yes when it
offers to enable the plugin. The app copies the panel half itself.

**From a shell instead:**

```sh
hermes plugins install iliFalk/pi-team     # then connect the desktop app once: it copies the panel half
```

**Then restart the gateway**, so the dashboard API is imported:

```sh
systemctl --user restart hermes-serve
```

The plugin places its runner — `pi-lane`, `pi-feature`, `pi-team-demo` — in `~/.hermes/scripts` on its
first start. Files already there are left alone, so a local edit survives an update.

The panel appears beside the chat. Until a lane exists it opens on `start here` and draws nothing else.

## Before the first lane

The install brings the panel, the runner and the procedure. Two things are left.

1. **The coding agent**, which every lane runs: `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`,
   and a provider key in Hermes Settings → Providers.
2. **Buttons that speak.** A panel button puts a message into the chat through the gateway. Off by default:

   ```sh
   hermes config set plugins.entries.pi-team.allow_gateway_injection true
   ```

`~/.hermes/scripts` is not on `PATH` by default, and the agent calls `pi-lane` by name. Add the
directory once, so both you and the agent find it:

```sh
echo 'export PATH="$HOME/.hermes/scripts:$PATH"' >> ~/.bashrc
```

## Your first lane

1. Press `+` in the `projects` header, paste a repository URL. The project appears at once; the agent clones
   it into `~/work`.
2. Ask for a feature in one line — *"a settings menu with a theme row"*. A lane starts on its own worktree
   and branch.
3. Watch the row. When the lane needs a decision, its card says so: pick an option, press `ANSWER`, and it
   continues.
4. `TO REVIEW` files a finished lane; the queue's `SEND` puts the whole queue into the chat; `CLOSE` merges
   and shelves it. Nothing closes before a check.

## The panel

| Where | What it does |
|---|---|
| Left pane | projects, their features and the lanes inside each one; the current project follows your chat |
| Right pane | state, branch, changes, plan, spec tree, sessions of the selected thing |
| Lane card | last text, last tool, tokens, the question with its answers, the diff, the thread |
| `+` / `✓` on a feature | link the current chat session to the feature, or drop the link |
| `SEND` | send the thread's message, the lane's model and your answer in one field |
| `TO REVIEW` → queue `SEND` | file finished lanes, then hand the whole queue to the agent |
| `CLOSE` | merge and close — the only path onto the shelf |

The procedure behind the buttons is the skill `pi-team:pi-coach`: how to start a lane, what to check before
it ships, when to answer instead of asking.

## See it working before you have any lanes

```sh
~/.hermes/scripts/pi-team-demo            # a scratch repo in ~/work/pi-team-demo and three lanes
~/.hermes/scripts/pi-team-demo --remove   # the lanes, their worktrees and branches, the project entry, the repo
```

Three fixed lane records — one waiting on a question, one in review, one checked — so the card can be seen
without spending tokens. It removes exactly what it wrote; a lane from a real run is never touched.

## How it works

| Piece | What it is |
|---|---|
| `desktop/plugin.js` | the panel, an ESM module loaded by the Desktop SDK. No build step |
| `dashboard/plugin_api.py` | 18 routes under `/api/plugins/pi-team/`, served by the plugin host |
| `runner/pi-lane` | starts one headless `pi` run per lane, parks its questions, records its events |
| `skills/pi-coach` | the procedure the agent follows, registered as `pi-team:pi-coach` |

The plugin itself runs no agent. Hermes is the orchestrator: it opens lanes, answers what they ask and
decides what ships — so the memory, the skills and the vault that the work feeds are Hermes's own.

## What it touches

Disclosed because you should know before you install:

- **Network.** The panel asks three model catalogues for their model ids over HTTPS —
  `integrate.api.nvidia.com`, `api.deepseek.com`, `openrouter.ai` — with the profile's key, cached for ten
  minutes. Adding a project runs `git clone` on the URL you paste, over https or ssh.
- **Reads outside its own data.** `~/.hermes/lanes/<lane>/` (record, event stream, question, thread), the git
  state of the worktrees it shows, `~/.hermes/plugin-data/pi-team/projects.json`, and the agent's name from
  `~/.hermes/SOUL.md`.
- **Credentials.** Provider keys come only through Hermes's secret scope. The panel reports whether a key is
  set and never reads or writes one; add keys in Hermes Settings → Providers.
- **Writes.** Lane records and the project registry, only through the routes it serves.
- **Shell and processes.** `git status`, `git diff`, `git log`, `git worktree` and `git clone` in your
  repositories, and `pi` as a child process of `pi-lane`, with your permissions. A lane is a real coding agent
  with real access to the worktree it runs in.
- **Background work.** No daemon. The panel polls `/lanes` while a window is open, and a lane keeps running
  only as long as its `pi` process does.
- **No self-update.** The plugin never replaces its own files. An install is pinned to one commit; updates
  come from `hermes plugins update pi-team` or a fresh install.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Panel missing after install | the desktop app has not reloaded — Command-K → Reload desktop plugins |
| Panel is there, no data, no error | the backend half was imported before Hermes restarted — `systemctl --user restart hermes-serve` |
| Buttons do nothing | `plugins.entries.pi-team.allow_gateway_injection` is off — step 4 above |
| `start here` and nothing else | no project yet — press `+`, or run `~/.hermes/scripts/pi-team-demo` to see the card with data |
| A lane reads `stopped` | its `pi` process died; the record keeps the last event and `stderr.txt` says why |

## Development

```
plugin.yaml            the manifest: name, version, requires_hermes
__init__.py            register(): hands the plugin context over, publishes the skill
pi_team_state.py       the one module the two halves share
dashboard/             the lane API served under /api/plugins/pi-team/
desktop/plugin.js      the panel; ESM, no build step
desktop/*.mjs          the two checks that run before a change ships
runner/                pi-lane, pi-feature, pireg.py, pi-team-demo
skills/pi-coach/       the procedure, its reference and its probe script
docs/DEVELOPMENT.md    architecture, data, routes
```

```sh
node --check desktop/plugin.js
node desktop/props-check.mjs      # two style keys in one props object
node desktop/render-check.mjs     # every component rendered outside the app
python3 -m py_compile dashboard/plugin_api.py __init__.py pi_team_state.py
hermes plugins validate .         # the catalog gate
```

## Lineage and license

The lane model follows [ThinkRail](https://github.com/JetBrains/thinkrail) (JetBrains): one task, one
worktree, specs that stay alive. pi-team takes that board out of the IDE and runs it inside Hermes.

MIT.
