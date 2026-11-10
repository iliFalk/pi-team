# pi-team — development

## What this repository holds

- `desktop/plugin.js` — the two panes. Plain ESM, loaded by the Hermes desktop app, no build step.
- `dashboard/plugin_api.py` — the lane API, mounted at `/api/plugins/pi-team/` by the plugin host.
- `__init__.py` and `pi_team_state.py` — the entry point, which publishes the skill and hands the plugin
  context to the API, and the one module both halves share.
- `skills/pi-coach/` — the procedure for the agent that opens and verifies lanes.
- `runner/` — `pi-lane`, `pi-feature`, `pireg.py`, and the `pi-team-demo` fixture.

The backend runs on the gateway machine, in `~/.hermes/plugins/pi-team/`. One catalog install carries both
halves: the app loads `desktop/plugin.js`, the gateway imports `dashboard/`.

## Architecture

The server holds the truth and the logic. The client only draws.

| Layer | Lives on | Holds |
|---|---|---|
| Lane record | gateway machine, `~/.hermes/lanes/<lane>/` | `lane.json`, `events.jsonl`, `question.json`, `stderr.txt` |
| Worktree | gateway machine, `<repo>/.worktrees/<lane>` | the code of one lane |
| Registry | gateway machine, `~/.hermes/plugin-data/pi-team/projects.json` | projects, features, linked sessions |
| Backend | gateway machine, `/api/plugins/pi-team/` | `GET /lanes`, `GET /lanes/<lane>`, `POST /link`, `POST /unlink` |
| Panes | app machine, `~/.hermes/desktop-plugins/pi-team/plugin.js` | layout, poll every 3 seconds, drawing |

The panes read `/api/plugins/pi-team/…` on the gateway the window is connected to. A window connected
to another gateway shows that gateway's lanes, which are usually none.

## Tree

Project → Feature → Lane. The project is one repository. The feature is what the work is about. The
lane is one slice of it. Projects and features exist before the first lane, because the registry holds
them; the panel draws empty nodes.

## Data the panes read

| Field | Source |
|---|---|
| state | `lane.json`: `running`, `waiting`, `done`, `failed`, `stopped` |
| last text, last tool, turns, tokens, cost | `events.jsonl`, last message of the run |
| question | `question.json`: `id`, `method`, `title`, `options` |
| changes | `git status --porcelain`, `git diff HEAD --stat` in the worktree |
| plan | `.thinkrail/context/todos/<session-id>.json` of the worktree |
| specs | every `SPEC.md` with `id` and `type`, ordered by the `parent` chain |
| shelf | why a finished lane left the active list: merged, quiet, or worktree gone |
| sessions | registry: the sessions linked to the lane's feature |

## Backend routes

| Route | Method | Effect |
|---|---|---|
| `/lanes` | GET | every lane, plus the project registry |
| `/lanes/<lane>` | GET | one lane with per-file status and the last text |
| `/link` | POST | `{project, feature, session}` — attach a session to a feature |
| `/unlink` | POST | the same body — drop the link |
| `/label` | POST | name a linked session inside the panel; the real session keeps its title |
| `/settings` | GET | which provider keys this profile holds — a flag, never a value |
| `/models` | GET | the providers' own model ids, one status row per provider |
| `/lanes/<lane>/model` | POST | pin the provider and the model of a lane |
| `/lanes/<lane>/say` | POST | put a message about a lane into the chat |
| `/lanes/<lane>/answer` | POST | answer the question a lane waits on: write `answer.json` |
| `/lanes/<lane>/hand` | POST | file a finished lane on the review shelf |
| `/review/send` | POST | put the whole review queue into the chat as one list |
| `/projects/check` | POST | check a repository before anything is promised |
| `/projects/prepare` | POST | a project asked for by its URL: it appears at once, the agent clones |
| `/projects/cancel` | POST | drop a project placeholder that was never cloned |
| `/features/prepare` | POST | a feature asked for in one line: it appears at once |
| `/features/cancel` | POST | drop a placeholder that never became a feature |
| `/update/request` | POST | ask the agent to update the plugin; the route only injects the message |

There is **no route that writes the plugin's own files**. A catalog install is pinned to one commit, and a
plugin that pulls and replaces itself would move an installed copy to a commit nobody reviewed. The panel's
`✓` on the update control calls `/update/request`, which puts the request into the chat; the agent does the
copy.

The backend module is imported once, at `hermes-serve` start. An edit reaches the live route only after
`systemctl --user restart hermes-serve`.

## Check a change before it ships

The panel has no build step, so a stale variable or a typo reaches the window as "failed to render" with no
line number. Render the components outside the app first:

```sh
node desktop/render-check.mjs
```

It strips the three real imports, stubs the SDK with fake lane data, and calls every component; a failure
prints the component and the exception. Every entry must say `ok`.

## The Python half

The panes read their data from `plugin_api.py`, so both halves ship here and the repo is the source of both.

```sh
# desktop half: what the window loads
cp desktop/plugin.js ~/.hermes/desktop-plugins/pi-team/plugin.js

# agent half: what the gateway imports, then restart the backend that mounts it
cp -r plugin.yaml __init__.py pi_team_state.py dashboard skills runner ~/.hermes/plugins/pi-team/
systemctl --user restart hermes-serve
```

The desktop file hot-reloads; the Python file does not — a changed route, field or fix is served only after
that restart. `plugin.yaml` sits at the repository root, so one catalog install gives the app the panel and
the gateway the API: the pinned commit is the same tree for both halves.

## The coding block

Every project carries the same block at the top of its `AGENTS.md`. It sets the working rules for a lane:
ask only on architectural decisions, take the smallest complete change, leave the change uncommitted,
and end with what was skipped and which risk remains.

The canonical text is `skills/pi-coach/templates/ponytail-block.md`. A project copy opens with
`<!-- ponytail v1 — generated block. Edit the template, not this copy. -->`. Change the template, then
copy it into the project again; never edit a copy in place.

## Update

1. Replace `desktop/plugin.js` in this repository.
2. On the app machine: Settings → Plugins → Rescan. A copy installed from Git keeps its marker and
   refreshes from the source.
3. For a hand-copied install, copy the file again and press Command-K → Reload desktop plugins.

## Removal

1. Delete `~/.hermes/desktop-plugins/pi-team/` on the app machine, then reload the desktop plugins.
2. On the gateway machine remove the agent plugin with `hermes plugins remove pi-team` if the backend
   is no longer needed. Lane records stay under `~/.hermes/lanes` until they are deleted.

## Checks

- `node --check desktop/plugin.js` — the file must stay plain, uncompiled ESM.
- `python3 -c "import ast,pathlib;ast.parse(pathlib.Path('../../plugins/pi-team/dashboard/plugin_api.py').read_text())"`
  against the gateway copy, when the backend changed.

## Licence

MIT.
