# pi-team

Coding lanes for the Hermes desktop: one panel, one row per lane, the whole lane beside it.

A lane is one worktree plus one headless [`pi`](https://github.com/earendil-works/pi) run. The panel shows
where every lane is — running, waiting on a question, done, in review — with the text it last wrote, the
diff it made, the plan it follows, and a thread you can answer in. Nothing hides in a chat log: a lane that
waits for you says so on the card.

| | |
|---|---|
| **Instead of** | asking the agent "what is running?" and reading a wall of text |
| **You get** | a tree of projects → features → lanes, and one card per lane with `SEND`, `TO REVIEW`, `ANSWER`, `CLOSE` |
| **It ships** | a desktop panel, a dashboard API behind it, and the `pi-coach` procedure registered as a skill |

## Install

1. **The plugin.** In the Hermes desktop: Settings → Plugins → search `pi-team` → Install. Without the
   catalog: `hermes plugins install iliFalk/pi-team`. One install carries both halves — the panel
   (`desktop/plugin.js`) and the backend (`dashboard/`) — plus the skill `pi-team:pi-coach`.
2. **The runner.** Lanes are started by `pi-lane`, which is not a plugin file:

   ```sh
   cp runner/pi-lane runner/pireg.py runner/pi-feature ~/.hermes/scripts/
   chmod +x ~/.hermes/scripts/pi-lane ~/.hermes/scripts/pi-feature
   ```

3. **The coding agent.** `npm install -g --ignore-scripts @earendil-works/pi-coding-agent` (1.4.0 or
   newer), and a provider key in Hermes Settings → Providers.
4. **Buttons that speak.** A panel button puts a message into the chat through the gateway. Off by
   default:

   ```sh
   hermes config set plugins.entries.pi-team.allow_gateway_injection true
   ```

5. **Restart the gateway.** `dashboard/plugin_api.py` is imported once, when `hermes-serve` starts.

The panel appears beside the chat. A fresh install has no lanes, so the right column opens on `start here`
with the five steps above and one button that adds the first project.

## See it with data before you have any

```sh
pi-team-demo              # a scratch repo in ~/work/pi-team-demo and three lanes
pi-team-demo --remove     # the lanes, their worktrees and branches, the project entry, the repo
```

The fixture writes three fixed lane records — one waiting on a question, one in review, one checked — so
the card can be seen without spending tokens. It removes exactly what it wrote; a lane from a real run is
never touched.

## Use

| Where | What it does |
|---|---|
| Left pane | projects, their features and the lanes inside each one |
| `+` in the `projects` header | add a project by its repository URL; the agent clones it into `~/work` |
| `+` on a feature | a feature asked for in one line; the agent names it after |
| `+` / `✓` on a feature | link the current chat session to the feature, or drop the link |
| Right pane | state, branch, changes, plan, spec tree, sessions of the selected thing |
| Lane card | last text, last tool, tokens, the question with its answers, the diff, the thread |
| `TO REVIEW`, then the queue's `SEND` | file finished lanes for review, then put the whole queue in the chat |
| `CLOSE` | merge and close a lane — the only path onto the shelf |

The procedure itself is the skill `pi-team:pi-coach`: how to start a lane, what to check before it ships,
when to answer instead of asking.

## Settings

Nothing to configure in the panel. It reads provider keys through Hermes's own secret scope and only
reports whether a key is set; add or change keys in Hermes Settings → Providers.

## What it touches

Disclosed because you should know before you install:

- **Network.** The panel asks three model catalogues for their model ids over HTTPS —
  `integrate.api.nvidia.com`, `api.deepseek.com`, `openrouter.ai` — with the profile's key, cached for ten
  minutes. Adding a project runs `git clone` on the URL you paste, over https or ssh.
- **Reads outside its own data.** `~/.hermes/lanes/<lane>/` (record, event stream, question, thread), the
  git state of the worktrees it shows, `~/.hermes/plugin-data/pi-team/projects.json`, and the agent's name
  from `~/.hermes/SOUL.md`.
- **Writes.** Lane records and the project registry, only through the routes it serves. The panel never
  writes a provider key and never reads one back.
- **Shell and processes.** `git status`, `git diff`, `git log`, `git worktree` and `git clone` in your
  repositories, and `pi` as a child process of `pi-lane`, with your permissions. A lane is a real coding
  agent with real access to the worktree it runs in.
- **Background work.** No daemon. The panel polls `/lanes` while a window is open, and a lane keeps
  running only as long as its `pi` process does.
- **No self-update.** The plugin never replaces its own files. A catalog install is pinned to one commit;
  updates come from `hermes plugins update pi-team` or from a fresh install.

## Repository layout

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

## Checks

```sh
node --check desktop/plugin.js
node desktop/props-check.mjs      # two style keys in one props object
node desktop/render-check.mjs     # every component rendered outside the app
python3 -m py_compile dashboard/plugin_api.py __init__.py pi_team_state.py
hermes plugins validate .         # the catalog gate
```

## License

MIT.
