"""plan: open a whole run of lanes from one file.

The orchestrator used to spell each lane out in its own shell call with a heredoc: 85 such calls in one
measured run, 136 in another, and every one of them is context it paid for twice — once to write, once to
read back. One JSON file holds the plan, and the runner spawns one detached process per lane, so the lanes
still run in parallel.

    pi-lane plan run.json [--json]

    {
      "repo": "/home/ilja/work/bench10-lane",
      "id": "music-sdd",
      "gates": ["python3 -m unittest discover -s tests", "music sync --dry-run --root fixture"],
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

`gates` are the commands that decide the run. They live in the plan and nowhere else, because a gate runs in
the MERGED tree: a command attached to one lane would answer for the whole repository. `pi-lane plan` writes
the plan to `$HERMES_HOME/plans/<id>/plan.json`, so `pi-lane gate --plan <id>` finds both the commands and
every lane that carries the id — after a `/tmp` cleanup has eaten the file the run was opened from.
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
    for ac_id in _ac_list(entry.get("acs") or []):
        argv += ["--acs", ac_id]
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


PLAN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def _plan_gates(spec: dict, lanes: list) -> list:
    """The commands that decide the run, read from the plan and nowhere else.

    A gate runs in the MERGED tree, so a command attached to one lane would answer for the whole
    repository — that is why a lane-level `gates` is refused instead of merged. Silence is worse:
    a key that is read by nobody is a lie in the file.
    """
    gates = spec.get("gates") or []
    if not isinstance(gates, list):
        raise SystemExit("plan: gates must be a list of commands")
    out = []
    for command in gates:
        text = str(command).strip()
        if not text:
            raise SystemExit("plan: an empty gate command")
        if text not in out:
            out.append(text)
    for name, _, entry in lanes:
        if entry.get("acs"):
            bad = _ac_problems(_ac_list(entry.get("acs") or []))
            if bad:
                raise SystemExit(f"plan: lane {name} names criteria that are not ids: {', '.join(bad)}")
        if entry.get("gates"):
            raise SystemExit(f"plan: lane {name} carries gates — gates belong to the plan, "
                             "because a gate runs in the merged tree")
    return out


def _plan_acs(lanes: list, repo: str) -> dict:
    """Which criteria each lane answers, checked against the requirements file before any spend.

    A typo in an id is invisible until the gate refuses the whole run, and a run whose requirements
    file does not exist has nothing to answer for: both are refused here, at open.
    """
    declared = {}
    for name, _, entry in lanes:
        ids = _ac_list(entry.get("acs") or [])
        if ids:
            declared[name] = ids
    if not declared:
        return {}
    path = spec_path(repo)
    criteria = spec_criteria(path)
    if not criteria:
        raise SystemExit(f"plan: lanes declare criteria but {path} holds none — write the requirements "
                         "file before the run, as templates/requirements.md shows")
    known = {ac_id for ac_id, _, _ in criteria}
    unknown = sorted({ac_id for ids in declared.values() for ac_id in ids if ac_id not in known})
    if unknown:
        raise SystemExit(f"plan: declared criteria missing from {path}: {', '.join(unknown)}")
    return declared


def _write_plan_snapshot(plan_id: str, spec: dict, repo: str, gates: list, lanes: list) -> Path:
    """Keep the run's own copy of the plan, so `/tmp` cannot take the gates with it.

    The orchestrator writes its plan under `<parent>/.run/<repo>/`, and one cleanup cut a task file
    out from under a live run. `gate --plan <id>` reads this snapshot, never the file the run was
    opened from.
    """
    folder = hermes_home() / "plans" / plan_id
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "plan.json"
    snapshot = {
        "id": plan_id,
        "repo": repo,
        "gates": list(gates),
        "lanes": [name for name, _, _ in lanes],
        "acs": {name: _ac_list(entry.get("acs") or []) for name, _, entry in lanes},
        "waves": spec.get("waves") or None,
        "opened_at": int(time.time()),
    }
    path.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
    return path


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
    gates = _plan_gates(spec, lanes)
    declared = _plan_acs(lanes, repo)
    plan_id = str(spec.get("id") or f"{Path(repo).name}-{time.strftime('%H%M%S')}")
    if not PLAN_ID_RE.match(plan_id):
        print("plan: an id holds letters, digits, dot, dash and underscore only", file=sys.stderr)
        return 1
    snapshot = _write_plan_snapshot(plan_id, spec, repo, gates, lanes)
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
        if gates:
            print(f"gates: {len(gates)}, kept in {snapshot} — `pi-lane gate --plan {plan_id}`")
        else:
            print("gates: none — a plan without gates leaves the checks to the orchestrator's memory")
        print("check them with `pi-lane status` or `pi-lane report`")
    return 0
