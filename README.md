# pi-team

A panel that shows pi coding lanes in the Hermes desktop.

```
demo                 /home/ilja/work/demo
                     features: settings-menu
demo/settings-menu   theme-item    done    +2 files   plan 1/3
```

- **What it is:** a desktop plugin with two panes, plus one skill for the agent that runs the lanes.
- **What it does:** shows every coding lane by project and feature, with the last text the agent wrote, the changes it made and the plan it follows. Answers a lane's question with one click. Without it the work runs blind and a waiting lane stays waiting.
- **What it needs:** the Hermes desktop app, connected to the same Hermes gateway that runs the lanes, and the `pi-team` agent plugin enabled on that gateway.
- **How to start:** open Settings → Plugins in the Hermes desktop, choose Install from Git, paste `iliFalk/pi-team` and tick Desktop. The two panes appear beside the chat.

## Install

1. In the Hermes desktop open Settings → Plugins and choose Install from Git.
2. Paste `iliFalk/pi-team`, tick Desktop, and confirm. The app copies `desktop/plugin.js` into its own plugins folder.
3. Restart the app, or press Command-K and choose Reload desktop plugins.

For a machine that holds a Hermes checkout, copy the file by hand:

```sh
mkdir -p ~/.hermes/desktop-plugins/pi-team
cp desktop/plugin.js ~/.hermes/desktop-plugins/pi-team/
```

The skill goes to the agent machine:

```sh
cp -r skills/pi-coach ~/.hermes/skills/software-development/
```

## Use

| Where | What it does |
|---|---|
| Left pane | projects, their features and the lanes inside each one |
| Header `»` | focuses one project and folds the rest |
| Feature `+` / `✓` | links the current chat session to the feature, or drops the link |
| Right pane | state, branch, changes, plan, spec tree, sessions of the feature |
| Session field | names the current session; the name is the Hermes session title |

## Settings

Nothing to configure. The plugin reads the gateway it is attached to and the lanes under `~/.hermes/lanes`.

## Docs

- `docs/DEVELOPMENT.md` — architecture, backend routes, registry, update and removal
- `skills/pi-coach/SKILL.md` — the procedure the agent follows
- `skills/pi-coach/templates/ponytail-block.md` — the coding block every project carries
- `LICENSE` — MIT
