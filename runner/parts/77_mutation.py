"""mutate: does the suite notice when the code is wrong?

A green suite says the tests pass; it says nothing about whether they would fail if the code were
different. Mutation testing answers that the cheap way: change one thing in the source, run the tests,
and require them to break. A mutant that survives is a hole with a file and a line.

    pi-lane mutate --plan <id> [--cmd "python3 -m unittest discover -s tests"]
                   [--max 12] [--timeout 900] [--min 1.0] [--files "music/*.py"]

Rules that keep it honest:

- **The tree is read-only for the run.** A dirty tree is refused, every file is restored byte for byte
  after its mutant, and the run ends with the same sha it started at. A mutation tool that leaves a
  half-edit behind is worse than none.
- **One mutant, one test run.** The operators are the ones a wrong thought usually flips: `==`/`!=`,
  `<`/`<=`, `>`/`>=`, `and`/`or`.
- **A non-zero exit is a kill**, including a crash: the suite noticed. A timeout is a survival, because
  a suite that hangs has not judged anything.
- `--min` is the score a run must reach; the default is every sampled mutant killed. The sample is
  bounded by `--max`, because 89 tests × 40 mutants is an hour.
"""
import os
import subprocess
import sys
import time
from pathlib import Path

MUTATION_RULES = (
    (" == ", " != "),
    (" != ", " == "),
    (" <= ", " < "),
    (" >= ", " > "),
    (" < ", " <= "),
    (" > ", " >= "),
    (" and ", " or "),
    (" or ", " and "),
)
MUTATION_SKIP_DIRS = {".git", ".worktrees", "node_modules", "__pycache__", "tests", "gates",
                      ".venv", "venv", "build", "dist"}


def _mutation_targets(repo: str, pattern: str) -> list:
    root = Path(repo)
    files = sorted(root.glob(pattern)) if pattern else sorted(root.rglob("*.py"))
    out = []
    for path in files:
        if not path.is_file():
            continue
        if any(part in MUTATION_SKIP_DIRS for part in path.parts):
            continue
        out.append(path)
    return out


def _mutation_candidates(path: Path) -> list:
    """One candidate per line: an operator a wrong thought would flip, in code and not in prose.

    A docstring is where the first run of this check produced three false survivors: `"artist and title"`
    sits in prose, nothing tests it, and the score blamed the tests. So docstrings, comments and imports
    are skipped — a mutant must land on behaviour, or the score measures the checker instead of the code.
    """
    out = []
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return out
    fence_marks = ('"""', "'''")
    in_doc = False
    for number, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        opened = sum(line.count(mark) for mark in fence_marks)
        if opened:
            # A line holding a fence is a docstring boundary, a one-line docstring, or prose inside one.
            # None of them is behaviour, and a mutant there measures the checker, not the tests.
            if opened % 2:
                in_doc = not in_doc
            continue
        if in_doc or not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith(("import ", "from ")):
            continue
        for before, after in MUTATION_RULES:
            if before in line:
                out.append((number, before, after))
                break
    return out


def mutate(argv: list) -> int:
    parser = argparse.ArgumentParser(prog="pi-lane mutate")
    parser.add_argument("--plan", default="", help="the plan id whose lanes this check belongs to")
    parser.add_argument("--repo", default="", help="the repository; taken from the plan's lanes when omitted")
    parser.add_argument("--cmd", action="append", default=[],
                        help="the test command to run per mutant; defaults to the plan's first gate")
    parser.add_argument("--files", default="", help="a glob inside the repository, e.g. 'music/*.py'")
    parser.add_argument("--max", type=int, default=12, help="how many mutants to try")
    parser.add_argument("--timeout", type=int, default=900, help="seconds per mutant")
    parser.add_argument("--min", type=float, default=1.0, help="score below which the check fails")
    args = parser.parse_args(argv)

    records = [record for record in lane_records()
               if args.plan and record.get("plan") == args.plan and not record.get("closed_at")]
    repo = os.path.realpath(args.repo) if args.repo else ""
    command = ""
    if args.plan:
        snapshot = read_json(hermes_home() / "plans" / args.plan / "plan.json") or {}
        gates = snapshot.get("gates") or []
        command = str(gates[0]) if gates else ""
        if not repo:
            repos = {os.path.realpath(str(record.get("repo") or "")) for record in records}
            repos.discard("")
            if len(repos) == 1:
                repo = repos.pop()
    if args.cmd:
        command = str(args.cmd[0])
    if not command:
        command = "python3 -m unittest discover -s tests"
    if not repo:
        print("pi-lane mutate: pass --repo or a plan whose lanes name one", file=sys.stderr)
        return 2
    if not Path(repo, ".git").exists():
        print(f"pi-lane mutate: not a git repository: {repo}", file=sys.stderr)
        return 1

    rc, head, err = _git(repo, "rev-parse", "HEAD")
    if rc != 0:
        print(f"{repo}: git says: {err}", file=sys.stderr)
        return 1
    # Tracked changes only: a stray `__pycache__` is not a half-edited file, and the subprocess below is
    # told not to write bytecode so the tree it leaves is the tree it found.
    rc, dirty, _ = _git(repo, "status", "--porcelain", "--untracked-files=no")
    if dirty.strip():
        print("pi-lane mutate: the tree is dirty — commit first, the run must end at the sha it started at",
              file=sys.stderr)
        return 1
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

    candidates = []
    for path in _mutation_targets(repo, args.files):
        for number, before, after in _mutation_candidates(path):
            candidates.append((path, number, before, after))
            if len(candidates) >= args.max:
                break
        if len(candidates) >= args.max:
            break
    if not candidates:
        print("pi-lane mutate: no mutation point found — widen --files", file=sys.stderr)
        return 1

    print(f"$ {command}   (per mutant, in {repo})")
    results = []
    for path, number, before, after in candidates:
        original = path.read_text(encoding="utf-8")
        lines = original.splitlines(keepends=True)
        index = number - 1
        mutated = lines[index].replace(before, after, 1)
        label = f"{str(path.relative_to(Path(repo)))}:{number}"
        started = time.time()
        verdict = "survived"
        try:
            lines[index] = mutated
            path.write_text("".join(lines), encoding="utf-8")
            try:
                env = dict(os.environ)
                env["PYTHONDONTWRITEBYTECODE"] = "1"
                done = subprocess.run(command, shell=True, cwd=repo, capture_output=True, text=True,
                                      timeout=args.timeout, env=env)
                verdict = "killed" if done.returncode != 0 else "survived"
                tail = ((done.stdout or "") + (done.stderr or "")).strip().splitlines()[-3:]
            except subprocess.TimeoutExpired:
                verdict = "survived"
                tail = [f"timeout after {args.timeout}s — a suite that hangs judged nothing"]
        finally:
            path.write_text(original, encoding="utf-8")
            restored = path.read_text(encoding="utf-8") == original
        if not restored:
            print(f"{label}: could not restore the file — stop and check the tree", file=sys.stderr)
            return 1
        seconds = int(time.time() - started)
        print(f"{label:44s} {before.strip():3s} → {after.strip():3s}  {verdict:8s} {seconds:3d}s")
        if verdict != "killed":
            for line in tail:
                print(f"    {line}")
        results.append({"site": label, "from": before.strip(), "to": after.strip(),
                        "verdict": verdict, "seconds": seconds})

    killed = sum(1 for item in results if item["verdict"] == "killed")
    score = round(killed / len(results), 4) if results else 0.0
    ok = score >= args.min
    check = {"ok": ok, "sha": head, "ran_at": int(time.time()), "score": score,
             "killed": killed, "total": len(results), "cmd": command,
             "survivors": [item["site"] for item in results if item["verdict"] != "killed"]}
    for record in records:
        record["mutation"] = check
        write_record(hermes_home() / "lanes" / str(record.get("lane")), record)

    rc, after_head, _ = _git(repo, "rev-parse", "HEAD")
    if after_head != head:
        print(f"the tree moved during the run: {head[:7]} → {after_head[:7]}", file=sys.stderr)
        return 1
    print(f"mutation score {killed}/{len(results)} at {head[:7]}"
          + (f" — survivors: {', '.join(check['survivors'])}" if check["survivors"] else " — every sampled mutant killed"))
    return 0 if ok else 1
