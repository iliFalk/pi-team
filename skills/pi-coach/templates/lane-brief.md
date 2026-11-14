# Lane brief — the whole text a lane receives

Fill this; delete every line that does not apply. Budget: 2 500 characters. A brief over 4 000 is a
task description, not a slice, and it is paid for as input tokens by every lane that reads it.

    Lane <name>. Work only inside your worktree. Edit the files now; do not describe a plan.
    Do not commit, do not ask a question — state an assumption in the report and continue.

    ## Your files — create or change these and nothing else
        <path>            <one line: what it holds>
        <path>
        tests/<path>
    Do not create <the files another lane owns>.

    ## Facts you do not need to re-derive
        repository has <state: empty except X / this exists / no pyproject>
        <runtime and version>       <tool available? yes/no>
        test command   <the exact command>
        gate command   <the exact command>

    ## Names this slice must use (the contract other lanes code against)
        <symbol or key>    <signature or meaning>
        <symbol or key>

    ## Done means
        <measurable statement: which command prints what>

    ## Report
        files changed with one line each · the gate output verbatim · assumptions · what you skipped

    ## Last line — the machine-readable report
        End with exactly this shape, one line, after your prose:
        RESULT: {"files": ["<path>", …], "verify": {"cmd": "<the gate command>", "exit": <code>},
                 "risks": ["<what could break>"], "followups": ["<what the next lane must know>"]}
        Nothing else after it. `pi-lane hand` reads this line; a lane without it cannot be filed.

Rules that keep it small:

1. **The slice, never the whole request.** The orchestrator already read the task; a lane that reads it
   again pays for the same tokens a second and a third time.
2. **Facts, not exploration.** Name the runtime, the tools, the state of the tree, and the commands.
   Two `ls` calls per lane disappear when the brief states what is there.
3. **Names, not descriptions.** A contract line is `<symbol> <signature>` — and the signature carries the
   return shape: `-> list[dict]` with the dict keys named, or `-> dict` with its keys named. Two measured
   repair rounds came from a sibling that returned a dict where the first lane expected a list; the brief
   named the function and not its result. The reasoning stays with the orchestrator.
4. **The gate belongs in the brief**, verbatim, so a lane self-checks instead of being re-run.
5. **Thinking level by kind of work:** `--thinking low` for documentation, compose files, config and
   glue; `--thinking medium` for code that must reason about existing behaviour.

Worked example, 1 698 characters:

    Lane pipeline. Work only inside your worktree. Edit the files now; do not describe a plan.
    Do not commit, do not ask a question — state an assumption in the report and continue.

    ## Your files — create these and nothing else
        music/ingest.py     read the likes, merge into <state>/likes.json
        music/resolve.py    resolver seam + call, one track in, one file out
        music/convert.py    ffmpeg/ffprobe wrappers: to .m4a, tags, cover.jpg
        tests/test_ingest.py, tests/test_resolve.py

    Do not create music/__init__.py (namespace package), store.py, library.py, cli.py, README.md,
    docker-compose.yml, state/.

    ## Facts you do not need to re-derive
        repository contains only .gitkeep — music/ and tests/ do not exist yet
        python 3.14, standard library only; ffmpeg and ffprobe are on PATH
        test command   python3 -m unittest discover -s tests
        gate command   same, and design:lint is not used in this project

    ## Names this slice must use
        Channel(spotify_id, artist, title, album, added_at)      dict keys, exactly these
        ResolveResult(ok: bool, path: str|None, error: str|None, source: str)
        convert_to_m4a(config, src: Path, dst: Path) -> None
        FakeResolver(config)   offline, used by the tests
        layout   <root>/<Artist>/<Album>/<NN - Title>.m4a  +  cover.jpg per album

    ## Done means
        python3 -m unittest discover -s tests prints OK with at least 6 tests, and a fake run produces
        .m4a files with artist, title, album and track tags readable by ffprobe.

    ## Report
        files changed, the unittest output verbatim, assumptions, what you skipped and the risk left.
