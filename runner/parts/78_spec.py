"""spec: the requirement layer a run has to answer for.

The task says what to build; nothing in a lane brief says what proves it. Six criteria in a plan, six
`gates` commands, and the only link between them is prose nobody greps. This part adds the file, the
check and the coverage search, so a criterion that no test proves stops the run at the gate instead of
turning up in a review a week later.

    spec/requirements.md      AC1  WHEN … THE SYSTEM SHALL …      written once, by the orchestrator
    spec/tasks.md             lane → the files it owns → the criteria it answers (generated)
    spec/design.md            what the slices must agree on (the contract lane writes it)

    pi-lane spec check  [--repo P] [--file F]
    pi-lane spec cover  [--repo P] [--file F] [--acs AC1,AC3] [--json]
    pi-lane spec tasks  <plan.json> [--write]

`check` reads the requirements file; `cover` looks for each id in `tests/` and `gates/`; `tasks` writes
the table a reviewer reads. A lane declares the ids it answers (`--acs AC1,AC3`, or `"acs": [...]` in a
plan), reports them back in its `RESULT`, and `gate` refuses to record a check while one of them is
covered nowhere in the merged tree.
"""
import json
import os
import re
from pathlib import Path

REQUIREMENTS_FILE = "spec/requirements.md"
DESIGN_FILE = "spec/design.md"
TASKS_FILE = "spec/tasks.md"
AC_ID_RE = re.compile(r"^AC\d+$")
AC_LINE_RE = re.compile(r"^\s*(AC\d+)\b(.*)$")
EARS_TRIGGERS = ("WHEN", "WHILE", "WHERE", "IF")
COVER_DIRS = ("tests", "gates")
SKIP_DIRS = {".git", ".worktrees", "node_modules", "__pycache__", ".venv", "venv", ".mypy_cache"}


def spec_path(repo: str, file: str = "") -> Path:
    return Path(file).expanduser() if file else Path(repo) / REQUIREMENTS_FILE


def spec_criteria(path: Path) -> list:
    """Every criterion line as (id, text, line number). Prose between them is not a criterion."""
    out = []
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return out
    for number, line in enumerate(text.splitlines(), 1):
        match = AC_LINE_RE.match(line)
        if not match:
            continue
        out.append((match.group(1), match.group(2).strip(), number))
    return out


def spec_problems(criteria: list, path: Path) -> list:
    """What makes this file useless as ground truth, in the order a person would fix it."""
    problems = []
    if not path.is_file():
        return [f"no requirements file at {path}"]
    if not criteria:
        return [f"{path} carries no criterion — one line per AC<n>, as in templates/requirements.md"]
    seen = {}
    for ac_id, text, number in criteria:
        if ac_id in seen:
            problems.append(f"line {number}: {ac_id} already used on line {seen[ac_id]}")
        else:
            seen[ac_id] = number
        if not text:
            problems.append(f"line {number}: {ac_id} has no text")
            continue
        upper = text.upper()
        if "SHALL" not in upper:
            problems.append(f"line {number}: {ac_id} states no SHALL — a criterion names an observable result")
        if not any(trigger in upper.split() for trigger in EARS_TRIGGERS):
            problems.append(f"line {number}: {ac_id} names no trigger "
                            f"({'/'.join(EARS_TRIGGERS)} … THE SYSTEM SHALL …)")
    return problems


def _cover_files(repo: str):
    """Every file that can carry a proof: tests/, gates/ and the test modules at the root."""
    root = Path(repo)
    if not root.is_dir():
        return
    candidates = []
    for name in COVER_DIRS:
        base = root / name
        if base.is_dir():
            candidates.extend(sorted(base.rglob("*")))
    candidates.extend(sorted(root.glob("test_*.py")))
    for path in candidates:
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        yield path


def spec_covered(repo: str, ids: list) -> dict:
    """Which of these ids appears in a test or a gate script, and where.

    One match is proof of a trace, not of a good test: the location is printed so the critic and the
    orchestrator can read the line. A missing id is the failure this exists for.
    """
    wanted = {ac_id: [] for ac_id in ids}
    if not wanted:
        return {}
    patterns = {ac_id: re.compile(rf"(?<![A-Za-z0-9]){re.escape(ac_id)}(?![0-9])", re.IGNORECASE)
                for ac_id in wanted}
    for path in _cover_files(repo):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for ac_id, pattern in patterns.items():
            if not wanted[ac_id] and pattern.search(text):
                try:
                    relative = str(path.relative_to(Path(repo)))
                except ValueError:
                    relative = str(path)
                line = next((number for number, body in enumerate(text.splitlines(), 1)
                             if pattern.search(body)), 1)
                wanted[ac_id] = [f"{relative}:{line}"]
    return wanted


def spec_summary(repo: str, ids: list) -> dict:
    """The one shape every reader uses: declared, covered, missing."""
    found = spec_covered(repo, ids)
    covered = [ac_id for ac_id in ids if found.get(ac_id)]
    missing = [ac_id for ac_id in ids if not found.get(ac_id)]
    return {"declared": list(ids), "covered": covered, "missing": missing,
            "where": {k: v[0] for k, v in found.items() if v}}


def spec_check(argv: list) -> int:
    parser = argparse.ArgumentParser(prog="pi-lane spec check")
    parser.add_argument("--repo", default=".", help="the repository that holds spec/")
    parser.add_argument("--file", default="", help="read this file instead of spec/requirements.md")
    args = parser.parse_args(argv)
    repo = os.path.realpath(args.repo)
    path = spec_path(repo, args.file)
    criteria = spec_criteria(path)
    problems = spec_problems(criteria, path)
    if problems:
        for problem in problems:
            print(f"spec: {problem}", file=sys.stderr)
        return 1
    ids = [ac_id for ac_id, _, _ in criteria]
    print(f"spec ok — {len(ids)} criterion(s): {', '.join(ids)}")
    return 0


def spec_cover(argv: list) -> int:
    parser = argparse.ArgumentParser(prog="pi-lane spec cover")
    parser.add_argument("--repo", default=".", help="the repository that holds spec/ and tests/")
    parser.add_argument("--file", default="", help="read this file instead of spec/requirements.md")
    parser.add_argument("--acs", default="", help="only these ids, comma separated (a lane's slice)")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    repo = os.path.realpath(args.repo)
    path = spec_path(repo, args.file)
    criteria = spec_criteria(path)
    problems = spec_problems(criteria, path)
    if problems:
        for problem in problems:
            print(f"spec: {problem}", file=sys.stderr)
        return 1
    wanted = [ac_id for ac_id, _, _ in criteria]
    if args.acs:
        wanted = [piece.strip().upper() for piece in args.acs.split(",") if piece.strip()]
        unknown = [ac_id for ac_id in wanted if ac_id not in {c[0] for c in criteria}]
        if unknown:
            print(f"spec: not in {path}: {', '.join(unknown)}", file=sys.stderr)
            return 1
    summary = spec_summary(repo, wanted)
    if args.json:
        print(json.dumps(summary, ensure_ascii=False))
        return 0 if not summary["missing"] else 1
    for ac_id in summary["covered"]:
        print(f"{ac_id:6s} covered  {summary['where'][ac_id]}")
    for ac_id in summary["missing"]:
        print(f"{ac_id:6s} NOT COVERED — no test or gate script names it in {', '.join(COVER_DIRS)}/")
    print(f"coverage {len(summary['covered'])}/{len(wanted)}")
    return 0 if not summary["missing"] else 1


def spec_tasks(argv: list) -> int:
    """Generate `spec/tasks.md`: which lane owns which files and answers which criteria.

    The plan file already carries the split; this turns it into the one page a reviewer keeps open.
    Unknown ids are refused here, before a lane is opened, because a typo in an id is invisible until
    the gate refuses the whole run.
    """
    parser = argparse.ArgumentParser(prog="pi-lane spec tasks")
    parser.add_argument("file", help="the plan file")
    parser.add_argument("--write", action="store_true", help="write <repo>/spec/tasks.md")
    args = parser.parse_args(argv)
    plan_file = Path(args.file).expanduser()
    try:
        spec = json.loads(plan_file.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        print(f"spec tasks: cannot read {plan_file} — {error}", file=sys.stderr)
        return 1
    repo = str(spec.get("repo") or "")
    if not repo or not Path(repo).is_dir():
        print("spec tasks: the plan names no repository", file=sys.stderr)
        return 1
    lanes = spec.get("lanes") or []
    if not isinstance(lanes, list) or not lanes:
        print("spec tasks: the plan names no lanes", file=sys.stderr)
        return 1
    criteria = spec_criteria(spec_path(repo))
    known = [ac_id for ac_id, _, _ in criteria]
    declared = []
    for entry in lanes:
        declared.extend(str(item).upper() for item in (entry.get("acs") or []))
    unknown = sorted({ac_id for ac_id in declared if ac_id not in known})
    if unknown:
        print(f"spec tasks: no such criterion in {spec_path(repo)}: {', '.join(unknown)}", file=sys.stderr)
        return 1

    rows = ["# Tasks — lane, files, criteria", "",
            f"Generated from `{plan_file.name}` by `pi-lane spec tasks`. Do not edit: change the plan.", "",
            "| Lane | Files it owns | Criteria |", "|---|---|---|"]
    for entry in lanes:
        files = ", ".join(f"`{item}`" for item in (entry.get("touch") or [])) or "—"
        acs = ", ".join(str(item).upper() for item in (entry.get("acs") or [])) or "—"
        rows.append(f"| `{entry.get('name')}` | {files} | {acs} |")
    unclaimed = [ac_id for ac_id in known if ac_id not in {item.upper() for item in declared}]
    if unclaimed:
        rows += ["", f"Unclaimed criteria — no lane answers for them: {', '.join(unclaimed)}"]
    text = "\n".join(rows) + "\n"
    if args.write:
        target = Path(repo) / TASKS_FILE
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
        print(f"spec tasks: wrote {target} ({len(lanes)} lane(s), {len(declared)} claimed id(s))")
        if unclaimed:
            print(f"spec tasks: {len(unclaimed)} criteria claimed by no lane: {', '.join(unclaimed)}")
            return 1
        return 0
    print(text, end="")
    return 0


def spec(argv: list) -> int:
    if not argv or argv[0] not in ("check", "cover", "tasks"):
        print("usage: pi-lane spec check|cover|tasks …", file=sys.stderr)
        return 2
    return {"check": spec_check, "cover": spec_cover, "tasks": spec_tasks}[argv[0]](argv[1:])
