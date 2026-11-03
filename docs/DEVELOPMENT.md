# pi-team — development

## What this repository holds

- `desktop/plugin.js` — the two panes. Plain ESM, loaded by the Hermes desktop app, no build step.
- `skills/pi-coach/` — the procedure for the agent that opens and verifies lanes.

The backend stays on the gateway machine: `~/.hermes/plugins/pi-team/`. This repository does not ship
it, because the desktop half is what a second machine needs.

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
| `/lanes` | GET | every lane plus the registry |
| `/lanes/<lane>` | GET | one lane with per-file status, plan and feature sessions |
| `/link` | POST | `{project, feature, session}` — attach a session to a feature |
| `/unlink` | POST | the same body — drop the link |

The backend module is imported once, at `hermes-serve` start. An edit reaches the live route only after
`systemctl --user restart hermes-serve`.

## The Python half

The panes read their data from `plugin_api.py`, so both halves ship here and the repo is the source of both.

```sh
# desktop half: what the window loads
cp desktop/plugin.js ~/.hermes/desktop-plugins/pi-team/plugin.js

# agent half: what the gateway imports, then restart the backend that mounts it
cp -r plugin/* ~/.hermes/plugins/pi-team/
systemctl --user restart hermes-serve
```

The desktop file hot-reloads; the Python file does not — a changed route, field or fix is served only after
that restart. `plugin/plugin.yaml` stays inside the folder: a manifest at the repo root would make an
Install-from-Git claim the agent half too and duplicate a gateway copy that is already there.

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
