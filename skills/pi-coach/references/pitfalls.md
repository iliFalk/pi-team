# Pitfalls in full

Read this when something does not behave. The five that cost the most are also one line each in `SKILL.md`.

## Pitfalls

- **The runner's run loop is shared by the first run and a continuation.** It lives in `run_session(lane_dir, record, lane, worktree, task, question_timeout)`, which reads `provider`, `model` and `thinking` from the record, so `main()` and `pi-lane continue` behave identically. When you move that block by script, parse before spending a lane: `python3 -c "import ast,pathlib; ast.parse(open(path).read())"`. The block sat inside a `with` in `main()`, so a function needs it DEDENTED by the depth it left; a duplicated assignment at the seam (`text = ""` twice) means the anchor matched the wrong end of the move, not that the code is fine.
- **Prove a runner change with a throwaway lane, not with the panel.** `pi-lane smoke --project <p> --feature <f> "Answer one word: ok. Change nothing." --question-timeout 60` must end `state: done`, `exit: 0`; then `pi-lane continue smoke "one more word"` must print `continuing`, end `done` again and leave MORE lines in `events.jsonl` than the first run. Two states and one line count settle the refactor in a minute; a green syntax check proves nothing about the run loop. Remove the probe lane afterwards (§ probe lane pitfall).
- **The runner is two files that must stay identical.** `~/.hermes/scripts/pi-lane` is what runs on this
  machine; `~/work/pi-team/runner/pi-lane` is what the repository ships and the update route copies to
  another host. Add a subcommand to the live copy, then `cp` it back into the repo and prove it with
  `diff -q runner/pi-lane ~/.hermes/scripts/pi-lane && echo identical` before the commit — a route or a
  subcommand that exists only on the agent machine works there and is missing on every other install.
- **Commit before you merge, or the cleanup eats the work.** A lane never commits, so its changes sit
  uncommitted in the worktree; `git merge --no-ff lane/<lane>` answers `Already up to date`, and the
  `git branch -d` and `worktree remove --force` that follow delete the only copy. Every automated close is
  commit → merge → receipt → remove, and it is proven on a throwaway repository with one uncommitted line
  before it points at a real lane.
- **The plugin backend is imported once, at `hermes-serve` start.** An edited
  `~/.hermes/plugins/pi-team/dashboard/plugin_api.py` does not reach the live route. Restart the
  service; the agent session runs inside it, so schedule the restart
  (`systemd-run --user --on-active=120 … systemctl --user restart hermes-serve`) and say that the window
  reconnects. Two minutes is the floor: a shorter timer fires while the reply is still going out and cuts
  the window off before Ilja can read it. Only the Python half needs the restart — a copied `plugin.js`
  arrives with the desktop plugin's own reload — so run the gates and `TestClient` first and let the timer
  be the last act of the turn. That timer still fires during your NEXT turn and ends it mid-write: after such an interruption,
  re-read `git status` and the file you were editing before continuing, and prove the new module loaded by
  the `__pycache__` mtime just after the unit's `start_time` (`systemctl --user show -p ExecStart --value
  hermes-serve`) — a direct `curl` on the route answers `401` before routing and proves nothing.
- **Test a backend route without touching live lanes.** Load `plugin_api.py` by path
  (`importlib.util.spec_from_file_location`), then `FastAPI().include_router(mod.router)` and drive it with
  `TestClient`. `pireg` needs the real `HERMES_HOME` at import, so point that environment variable at a
  `mkdtemp` AFTER the import — the module resolves its home per call — and write one `lanes/<probe>/lane.json`
  there. Assert the whole contract in that run: `200` with the record rewritten, the fields the runner reads
  back still present (`provider`, `model`, `thinking`), `422` for a value off the list, `404` for an unknown
  lane, `422` for an empty body. Order the handler's checks the way a caller probes them — unknown lane `404`
  before the offered pair `422`; reversed, an unknown lane answers `422 not offered` and the test that
  asserts `404` fails on a message about the wrong thing. The import compiles `plugin/dashboard/__pycache__/*.pyc`, which the repo
  TRACKS: `git status` shows it modified after every test run, so `git checkout --
  'plugin/dashboard/__pycache__/…pyc'` before committing — otherwise the commit carries a binary diff of code
  nobody changed. A reader typed `Optional[Dict[str, Any]]` that also serves a JSON list needs an `Any` local
  (`data: Any = _read_json(path)`), or pyright reads `row["provider"]` as `str.__getitem__` and reports a
  type error the code does not have.
- **The app may run on another machine.** The panels are read from
  `$HERMES_HOME/desktop-plugins/pi-team/plugin.js` on the machine that shows them, not from the agent
  machine. Copy the file there and compare sha256. That machine reaches the backend through the `url` in
  its own `connection.json` (`mode: remote`) — the desktop backend, not the gateway port the routes were
  tested on — so a replaced machine joins the tailnet first and the copy waits for SSH to work. Steps:
  `hermes-desktop-plugins` § Ship to another machine.
- **`ask_user_question` asks only under `--mode rpc`.** With `pi -p` or JSON mode it answers "UI not
  available" and the agent states its assumptions in text instead. That is a property of the mode, not a
  broken extension — switch the mode before concluding the tool is unusable.
- **`pi` in RPC mode is a server: it does not exit after `agent_end`.** A host that waits for EOF after
  the turn blocks forever and leaves the record `running` with `exit: null` although the work is done.
  Break on `agent_end`, drain what is already in the pipe, then `terminate()` the child and take its
  return code.
- **Only `select`, `confirm`, `input` and `editor` are questions.** `notify` is fire-and-forget; treating
  every `extension_ui_request` as a dialog parks a question nobody asked and stalls the lane.
- **`pi` exits 0 when the provider never answered.** The runner checks for assistant text and records
  `failed`; trust that state, not the exit code.
- **A new directory brings a trust dialog that a headless run cannot answer.** Project-local
  `.pi/mcp.json` and `.pi/prompts/` load only with `--approve`; without it they are ignored, not broken.
  `AGENTS.md` is the exception — it loads in both cases, so instructions from the repository apply
  even when nothing was approved.
- **A stale `~/.pi/agent/AGENTS.md` overrides every project.** The global file is read by every lane
  and every interactive `pi` session, so a leftover experiment there ("write one file `index.html`,
  create nothing else") contradicts the task of an unrelated lane and looks like the lane disobeying.
  Keep project rules in the project's own `AGENTS.md` and the global file neutral. `--no-context-files`
  silences the repository's rules too, so repair the file instead of passing that flag.
- **A silent MCP server prints in the header on start.** It does not block the lane.
- **The lane dies with the gateway.** The process is a child of it; the `pi` session survives, so a
  follow-up run continues the conversation. Use `setsid` or `systemd-run --user` when a lane must outlive
  a gateway restart.
- **A panel feature exists only when three layers are present.** The runner writes an artifact, the
  backend exposes it in the lane payload, the panel renders it and posts the answer back. Check each
  layer before reporting a feature as working or writing it into this skill: the runner half alone
  leaves a lane parked and invisible to Ilja. Search the artifact name in `dashboard/plugin_api.py` and
  in `plugin.js` — a route list without the field, or a field without the handler, is a half-built flow,
  not a fault in the lane.
- **A probe lane is a live row in Ilja's panel.** A test run (`hello`, `ask2`, a throwaway theme probe)
  leaves `~/.hermes/lanes/<lane>`, a worktree and a branch behind, and the panel draws it as real work; a
  hand-written `sessions` entry in the registry then looks like a link Ilja added himself. After every
  probe: `git -C <repo> worktree remove --force .worktrees/<lane>`, `git -C <repo> worktree prune`,
  `pi-lane close <lane> --no-merge --yes`, drop the session from `projects.json`, and confirm the lane count is
  zero before calling the panel ready.
- **The panel holds no privilege.** It only reads files and git; every action goes through the runner.
- **"failed to render" is a ReferenceError in `plugin.js`, not a data fault.** One `jsx()` prop naming a
  component or helper that is gone takes the whole panel down with a card that names no line, and
  `node --check` passes because the syntax is valid. The same class of break: a DERIVED constant declared
  above the constants it reads (`const SEND_H_N = BAND_MIN_H_N + …` placed before `BAND_MIN_H_N`) throws
  `Cannot access before initialization` at module load, so the pane is blank while every value in the
  expression is correct — declare derived sizes below their sources, next to them. Run `node desktop/render-check.mjs` in
  `~/work/pi-team` (it stubs the SDK) and fix the name before copying the file anywhere. It walks an
  EXPLICIT array of component names, so a reworked component is not covered until its name is in that
  array, and its fixture must carry the props that clear the early returns (`draft`, `action`, `onPick`):
  a missing one leaves the whole branch — and any ReferenceError inside it — unexercised while the check
  prints green. Add the component name and the props together, or the green line answers for a branch that
  never ran.
- **A two-column pane needs BOTH columns inline.** The list gets `style: { width: '50%', minWidth: 0 }` and
  the detail side gets `style: { width: '50%', minWidth: 0 }`, with `overflow: 'hidden'` on each column and
  on the pane root; a `min-w-0` class on the flexible side is not enough. A textarea or a long mono name
  sets a min-content width the detail side will not give back, so it takes width from the list — measured
  122 / 283 instead of 202 / 202 in a 405-px pane — and the whole pane then scrolls sideways: the list's
  text starts at x=0 with words cut at the left edge, which reads as a geometry bug and is a flex one.
- **A feature taken back leaves three traces.** Code, the fields it added to a payload, and the data files
  it wrote (`notified.json`, a pid file, a thread flag). Delete all three, restart the backend, then prove
  the removal with `TestClient`: `404` for its route and zero occurrences of its field in `/lanes`. A `curl`
  status proves nothing — auth answers before routing, so 401 comes back for a path that never existed.


- **Prove the close routine on a disposable repository.** A repo, a worktree on `lane/probe`, one
  uncommitted line and a hand-written `lane.json`: after `pi-lane close`, `git log` must show the lane
  commit AND the merge commit, and the default branch must contain the line.
