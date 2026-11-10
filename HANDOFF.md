# pi-team — handoff for the next chat

Version 1.0 is built, checked and delivered. The next step is not code: the plugin goes out for a hackathon.

## Where things stand

Branch `main`, HEAD `270664b`, `origin/main` matches.

| File | sha256 | Installed at |
|---|---|---|
| `desktop/plugin.js` | `7d88b5d3…` (3834 lines, 155 450 bytes) | `~/.hermes/desktop-plugins/pi-team/plugin.js` |
| `plugin/dashboard/plugin_api.py` | `f8a81a59…` | `~/.hermes/plugins/pi-team/dashboard/plugin_api.py` |
| `runner/pi-lane` | `e92507f8…` | `~/.hermes/scripts/pi-lane` |

Client `casamac` (Arch aarch64) carries the same panel byte for byte and its own `render-check` reads 27/27
with no failure. Gates on the agent machine: `node --check` ok, `render-check` 27/27, `props-check` ok,
both Python files parse.

The desktop app on `casamac` connects to `https://remote.falknest.com`, which is this agent machine's backend,
so the routes below are the ones the window really calls.

## What v1.0 does

- One panel, two areas: the tree of projects → features → lanes on the left, the selected thing on the right.
- The lane card answers the whole question "what is this lane doing": STATUS (commit, diff, turns, tokens,
  error), SESSIONS, STATE with the one action the state offers, the lane's question with its answers, the TASK
  window, the DIFF window, the thread with its composer.
- The thread's composer holds the writing, the model and `SEND` in one field; the model comes from the
  providers' own catalogues and is written into the lane record; a lane's question is answered from the card.

## Five rules that break easily

1. **Everything on the card is locked except the thread.** Head, TASK window and DIFF window are
   `flexShrink: 0` and keep `TASK_H` (49 px); only the thread grows and shrinks. A shrink weight on a window
   makes `DIFF` slide up and down — that was rejected twice.
2. **The composer has two shapes and stands 57 px tall.** One line: a column (writing, then the model chip)
   stops at the button, `SEND` centred across both rows. The line reaches the button: the writing takes the
   whole box above it. `57 = 40 fill + 2 border + 5 + 10` (two pixel drags he asked for).
3. **The question block: pick, then answer.** A click only selects; `ANSWER` (bottom right, opposite
   `DISMISS`) sends. `+` opens a field whose `ADD` folds the words into the row — pi still receives the bare
   option string, the words follow as a thread note.
4. **The review lifecycle.** `TO REVIEW` writes `handed_at` and says nothing (the lane reads `in review`);
   `SEND` on the `REVIEW` row posts the whole queue and is the only trigger of a check; `pi-lane check <lane>`
   writes `checked_at` + `checked_sha` and the lane reads `reviewed`; only then does `CLOSE` appear, and a
   commit after the check hides it again. Every consequential control confirms with `✕`/`✓`.
5. **Case says what a word does.** A word you can press is caps (`SEND`, `TO REVIEW`, `ANSWER`, `DISMISS`);
   a message where a control stood, a value, a model id and a placeholder keep their own case. The thread's
   three speakers carry the panel's hues: honey `#A97D14` you, blue `#0762B4` the agent, `#76B900` pi, each a
   5 px dot and a lowercase word above the message.

## Where the knowledge lives

- Skill `pi-coach` (948 lines) — the lane procedure, the panel's rules and its signal phrases.
- Skill `hermes-desktop-plugins` § `references/panel-visuals.md` — the measured recipes: the composer, the
  anchored thread, the locked areas, the bubble frame, the pixel checks.
- `DESIGN.md` — the panel's own numbers and the reason behind each.
- Vault: `raw/projects/pi-team/` — handoff, panel design note, architecture.
- `docs/DEVELOPMENT.md` — architecture and the Python half.

## Before you post it for the hackathon

1. **`README.md` is stale.** It still names a `»` header control and a `plan` in the payload, both removed, and
   says "nothing to configure" although there is a settings screen with API keys. Rewrite it for a stranger:
   one paragraph, one screenshot, one run command.
2. **`docs/DEVELOPMENT.md` lists four routes; the code has twenty-one** (`/settings`, `/settings/key`, `/models`,
   `/lanes/<lane>/model|say|hand|answer`, `/review/send`, `/update/request`, the compose and cancel routes). Fix
   the table or drop it and point at the module.
3. **Decide private → public.** `LICENSE` is MIT and the copyright line is in place. `clients.json`,
   `~/.hermes/lanes` and the vault paths live outside the repo; check the text for anything else that names a
   host or a person who is not the owner.
4. **A fresh machine has no lanes and the panel shows an empty tree.** Ship a demo fixture — a small repo plus
   three lane records — or a script that seeds one, and say in the README how to remove it.
5. **The runner is required.** Without `~/.hermes/scripts/pi-lane` there is nothing to manage; the backend is
   imported once at `hermes-serve` start, so a change to `plugin/` needs a restart.
6. **`allow_gateway_injection` must be on**, or every button in the panel is silent. The README already has the
   command; keep it.
7. **Screenshots.** Ask Ilja for the window: `casamac` is online and its panel is the current build.

## Open items from v1.0

- The card clips its composer below about 500 px of height: the thread is already 0 and nothing is left to give.
- `in review` stays a message in mixed case while `TO REVIEW` is a control in caps. That is the decision.
