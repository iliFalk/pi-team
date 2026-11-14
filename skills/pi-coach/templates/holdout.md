# Holdout — the acceptance the writer never sees

The gate lives in the repository, so the agent that writes the code reads it. A measured run showed the
price: tests carried the criteria in their names and asserted something else, and the gate stayed green
while `sync` never called `scan`.

A holdout is the other half of acceptance. Scenarios live outside the repository, are written **before**
any lane opens, and are run against the merged tree afterwards.

    $HERMES_HOME/holdout/<plan>/01-dry-run-changes-nothing.py
    $HERMES_HOME/holdout/<plan>/02-sync-prints-the-summary.sh

```sh
pi-lane holdout <plan>              # run every scenario in the merged tree, record holdout_check
pi-lane holdout <plan> --json       # one object: ok, sha, scenarios
```

## What a scenario is

A program with one job and two outcomes. Exit `0` means the behaviour holds; any other code means it does
not, and the last lines of its output are the evidence a person reads.

    #!/usr/bin/env python3
    """AC22: `music report` prints artist, album, tracks, seconds — and nothing else."""
    import os, subprocess, sys, tempfile
    from pathlib import Path

    repo = Path(os.environ["HOLDOUT_REPO"])
    work = Path(tempfile.mkdtemp())
    ...                      # build a fixture: config, a fake resolver, two WAV files
    done = subprocess.run([str(repo / "bin" / "music"), "--config", str(cfg), "report"],
                          capture_output=True, text=True)
    print(done.stdout, done.stderr)

    header = done.stdout.splitlines()[0].split() if done.stdout else []
    if header != ["artist", "album", "tracks", "seconds"]:
        sys.exit(1)          # the requirement says which columns, in which order
    sys.exit(0 if done.returncode == 0 else 1)

## Rules that make it a check

1. **Write it from the requirement, not from the code.** Quote the criterion in the docstring; the
   scenario is the criterion made runnable. If you write it after reading the diff, it inherits the diff's
   assumptions and proves nothing.
2. **Assert the surface the requirement names.** Header case, column order, exit codes, file names. A
   measured pair of runs implemented the same behaviour and failed each other's gate on header case
   alone — that is what "unspecified surface" looks like.
3. **One behaviour per scenario, named by number.** `01-`, `02-` run in name order; a failing name is the
   whole report.
4. **It runs in the merged tree** (`HOLDOUT_REPO`), after the branches are in. A scenario that passes in a
   worktree proves nothing about what shipped.
5. **`close --auto` refuses without a green holdout at HEAD.** Say so before a run starts, so nobody
   expects an unattended merge.
6. **Do not hand the scenarios to a lane.** Not in the brief, not in the repository, not in a message. A
   writer that reads the acceptance tunes to it — that is not dishonesty, it is what a visible target does.
