"""holdout: the acceptance scenarios the writer never sees.

A gate lives in the repository, so the agent that writes the code reads it, and a measured run showed what
that costs: tests named after the criteria, asserting something else, all green. The holdout is the other
half of the acceptance — scenarios kept outside the repository, written before any lane opens, run against
the merged tree and recorded on the lanes that carry the plan.

    $HERMES_HOME/holdout/<plan>/          one executable per scenario: its name is its label
    01-sync-prints-the-summary.py         exit 0 = the behaviour holds, anything else = it does not
    02-dry-run-changes-nothing.sh

    pi-lane holdout <plan> [--dir PATH] [--timeout SECONDS] [--json]

Rules that make it a check and not a second wish list:

- The writing agent never reads `$HERMES_HOME`: the scenarios are not in its worktree and not in its brief.
- A scenario is a program, not prose: it starts the real CLI or imports the package and asserts what a
  reader of the requirement would assert. Exit code is the verdict, printed lines are the evidence.
- It runs in the MERGED tree, after the lane branches are in — the same tree `gate` runs in — so a scenario
  cannot bless a worktree that was never merged.
- `close --auto` refuses without a green holdout at HEAD. A merge nobody verified stays a merge a person
  asked for.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HOLDOUT_DIR = "holdout"
SCENARIO_SUFFIXES = (".py", ".sh")


def holdout_folder(plan_id: str, path: str = "") -> Path:
    return Path(path).expanduser() if path else hermes_home() / HOLDOUT_DIR / plan_id


def holdout_scenarios(folder: Path) -> list:
    """Every executable scenario in the folder, in name order — the name carries the label."""
    if not folder.is_dir():
        return []
    out = []
    for path in sorted(folder.iterdir()):
        if not path.is_file() or path.name.startswith((".", "_")):
            continue
        if path.suffix not in SCENARIO_SUFFIXES:
            continue
        out.append(path)
    return out


def _run_scenario(path: Path, repo: str, timeout: int) -> dict:
    """One scenario, in the merged tree, with its exit code and the tail of what it printed."""
    if path.suffix == ".py":
        argv = [sys.executable, str(path)]
    elif os.access(path, os.X_OK):
        argv = [str(path)]
    else:
        argv = ["sh", str(path)]
    env = dict(os.environ)
    env["HOLDOUT_REPO"] = repo
    started = time.time()
    try:
        done = subprocess.run(argv, cwd=repo, capture_output=True, text=True, timeout=timeout, env=env)
    except subprocess.TimeoutExpired:
        return {"name": path.name, "exit": 124, "seconds": timeout, "tail": f"timeout after {timeout}s"}
    except OSError as error:
        return {"name": path.name, "exit": 126, "seconds": 0, "tail": str(error)}
    output = ((done.stdout or "") + (done.stderr or "")).strip()
    tail = "\n".join(output.splitlines()[-15:])
    return {"name": path.name, "exit": done.returncode, "seconds": int(time.time() - started), "tail": tail}


def holdout(argv: list) -> int:
    parser = argparse.ArgumentParser(prog="pi-lane holdout")
    parser.add_argument("plan", nargs="?", default="", help="the plan id whose lanes this acceptance covers")
    parser.add_argument("--dir", default="", help="read scenarios from here instead of $HERMES_HOME/holdout/<plan>")
    parser.add_argument("--repo", default="", help="run against this repository when no lane carries the plan")
    parser.add_argument("--timeout", type=int, default=600, help="seconds per scenario")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not args.plan and not args.dir:
        print("pi-lane holdout: pass a plan id or --dir", file=sys.stderr)
        return 2

    folder = holdout_folder(args.plan, args.dir)
    scenarios = holdout_scenarios(folder)
    if not scenarios:
        print(f"holdout: no scenario in {folder} — write one per criterion a reader would check, "
              "before any lane opens", file=sys.stderr)
        return 1

    records = [record for record in lane_records()
               if args.plan and record.get("plan") == args.plan and not record.get("closed_at")]
    repo = os.path.realpath(args.repo) if args.repo else ""
    if not repo:
        repos = {os.path.realpath(str(record.get("repo") or "")) for record in records}
        repos.discard("")
        if len(repos) != 1:
            print(f"holdout: {len(repos)} repositories among the lanes of {args.plan}; pass --repo",
                  file=sys.stderr)
            return 1
        repo = repos.pop()
    if not Path(repo, ".git").exists():
        print(f"holdout: not a git repository: {repo}", file=sys.stderr)
        return 1

    rc, head, err = _git(repo, "rev-parse", "HEAD")
    if rc != 0:
        print(f"{repo}: git says: {err}", file=sys.stderr)
        return 1

    # The same refusal as `gate`: a scenario that runs beside unmerged work proves nothing about the tree.
    unmerged = []
    for record in records:
        branch = str(record.get("branch") or "")
        if not branch:
            continue
        rc, _, _ = _git(repo, "merge-base", "--is-ancestor", branch, "HEAD")
        if rc != 0:
            unmerged.append(str(record.get("lane")))
    if unmerged:
        print(f"refusing: not merged into HEAD ({head[:7]}): {', '.join(sorted(unmerged))}", file=sys.stderr)
        return 1

    results = []
    for path in scenarios:
        result = _run_scenario(path, repo, args.timeout)
        results.append(result)
        if not args.json:
            mark = "ok  " if result["exit"] == 0 else f"exit {result['exit']}"
            print(f"{path.name:44s} {mark:8s} {result['seconds']:4d}s")
            if result["tail"]:
                for line in result["tail"].splitlines():
                    print(f"    {line}")
    ok = all(result["exit"] == 0 for result in results)
    check = {"ok": ok, "sha": head, "ran_at": int(time.time()), "dir": str(folder),
             "scenarios": [{"name": r["name"], "exit": r["exit"]} for r in results]}

    for record in records:
        record["holdout"] = check
        write_record(hermes_home() / "lanes" / str(record.get("lane")), record)

    if args.json:
        print(json.dumps(check, ensure_ascii=False))
    else:
        failed = [r["name"] for r in results if r["exit"] != 0]
        if failed:
            print(f"holdout FAILED at {head[:7]}: {', '.join(failed)}")
        else:
            print(f"holdout ok — {len(results)} scenario(s) at {head[:7]}, recorded on {len(records)} lane(s)")
    return 0 if ok else 1
