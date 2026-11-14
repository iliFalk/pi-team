"""plan: open a whole run of lanes from one file.

The orchestrator used to spell each lane out in its own shell call with a heredoc: 85 such calls in one
measured run, 136 in another, and every one of them is context it paid for twice — once to write, once to
read back. One JSON file holds the plan, and the runner spawns one detached process per lane, so the lanes
still run in parallel.

    pi-lane plan run.json [--json]

    {
      "repo": "/home/ilja/work/bench10-lane",
      "provider": "opencode-go",
      "model": "deepseek-v4.1-flash",
      "autonomy": "auto",
      "lanes": [
        {"name": "contract", "brief": "contract-brief.md", "touch": ["music/_contract.py"], "thinking": "low"},
        {"name": "pipeline", "task": "inline brief text", "touch": ["music/ingest.py"], "thinking": "medium"}
      ],
      "waves": [["contract"], ["pipeline", "library", "shell"]]
    }

`brief` is a file path (relative to the plan file), `task` is inline text. A plan with `waves` opens wave 1,
waits for it to settle, then opens the next — the dependency order, spelled out instead of remembered. A plan
without `waves` opens every lane at once.
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

PLAN_TERMINAL = ("done", "failed", "stopped", "cancelled", "error")


def _plan_lanes(spec: dict, base: Path) -> list:
    lanes = spec.get("lanes")
    if not isinstance(lanes, list) or not lanes:
        raise SystemExit("plan: no lanes")
    out = []
    for entry in lanes:
        if not isinstance(entry, dict):
            raise SystemExit("plan: every lane is an object")
        name = str(entry.get("name") or "").strip()
        if not name:
            raise SystemExit("plan: a lane has no name")
        task = str(entry.get("task") or "")
        brief = str(entry.get("brief") or "")
        if brief and not task:
            path = Path(brief)
            if not path.is_absolute():
                path = base / path
            if not path.is_file():
                raise SystemExit(f"plan: no brief file for lane {name}: {path}")
            task = path.read_text(encoding="utf-8").strip()
        if not task:
            raise SystemExit(f"plan: lane {name} has neither task nor brief")
        out.append((name, task, entry))
    return out


def _spawn(name: str, task: str, entry: dict, spec: dict, repo: str, plan_id: str) -> int:
    argv = [sys.executable, str(Path(__file__).resolve()), name, task, "--repo", repo,
            "--plan", plan_id]
    for key, flag in (("provider", "--provider"), ("model", "--model"), ("thinking", "--thinking"),
                      ("autonomy", "--autonomy"), ("feature", "--feature"), ("group", "--feature"),
                      ("max_usd", "--max-usd"), ("max_turns", "--max-turns"),
                      ("idle_timeout", "--idle-timeout")):
        value = entry.get(key, spec.get(key))
        if value not in (None, ""):
            argv += [flag, str(value)]
    for pattern in entry.get("touch") or spec.get("touch") or []:
        argv += ["--touch", str(pattern)]
    child = subprocess.Popen(argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             stdin=subprocess.DEVNULL, start_new_session=True, cwd=str(Path.home()))
    return child.pid


def _wait_names(names: list, timeout: int, grace: int = 30) -> list:
    """Block until every named lane reaches a terminal state; return the ones that are not.

    A lane whose record does not exist yet is PENDING, not finished: the child writes its record a moment
    after it is spawned, and treating the gap as done made the second wave start before the first ended —
    measured, lane `b` started nine seconds before lane `a` finished.
    """
    started = time.monotonic()
    deadline = started + timeout
    while True:
        pending, missing = [], []
        for name in names:
            record = read_json(hermes_home() / "lanes" / name / "lane.json")
            if record is None:
                missing.append(name)
                continue
            state = str(record.get("state") or "")
            if record.get("closed_at") or state in PLAN_TERMINAL:
                continue
            pending.append(name)
        if not pending and not missing:
            return []
        if missing and not pending and time.monotonic() - started > grace:
            return missing
        if time.monotonic() > deadline:
            return pending + missing
        time.sleep(2)


def plan(argv: list) -> int:
    parser = argparse.ArgumentParser(prog="pi-lane plan")
    parser.add_argument("file")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--timeout", type=int, default=3600, help="seconds to wait per wave")
    args = parser.parse_args(argv)
    path = Path(args.file).expanduser()
    if not path.is_file():
        print(f"plan: no such file: {path}", file=sys.stderr)
        return 1
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as error:
        print(f"plan: not JSON — {error}", file=sys.stderr)
        return 1
    base = path.parent
    lanes = _plan_lanes(spec, base)
    repo = str(spec.get("repo") or "")
    if not repo:
        print("plan: no repository", file=sys.stderr)
        return 1
    waves = spec.get("waves")
    if not isinstance(waves, list) or not waves:
        waves = [None]  # one wave, every lane at once
    known = {name for name, _, _ in lanes}
    if waves != [None]:
        flat = [name for wave in waves for name in wave]
        if sorted(flat) != sorted(known):
            print("plan: waves and lanes do not name the same lanes", file=sys.stderr)
            return 1
    plan_id = str(spec.get("id") or f"{Path(repo).name}-{time.strftime('%H%M%S')}")
    by_name = {name: (task, entry) for name, task, entry in lanes}
    opened = []
    for wave in waves:
        names = [name for name, _, _ in lanes] if wave is None else [str(item) for item in wave]
        for name in names:
            task, entry = by_name[name]
            opened.append({"lane": name, "pid": _spawn(name, task, entry, spec, repo, plan_id)})
        if wave is not None:
            stuck = _wait_names(names, args.timeout)
            for item in opened:
                item.setdefault("wave", names.index(item["lane"]) if item["lane"] in names else None)
            if stuck:
                print(f"plan: wave stuck after {args.timeout}s: {', '.join(stuck)}", file=sys.stderr)
                break
    if args.json:
        print(json.dumps({"plan": plan_id, "opened": opened}, ensure_ascii=False))
    else:
        print(f"plan {plan_id}: opened {len(opened)} lane(s) in {Path(repo).name}")
        for item in opened:
            print(f"  {item['lane']:16s} pid {item['pid']}")
        print("check them with `pi-lane status` or `pi-lane report`")
    return 0
