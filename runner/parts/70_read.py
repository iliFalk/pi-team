EVAL_DIR_NAME = "eval"


def _eval_dir() -> Path:
    folder = hermes_home() / EVAL_DIR_NAME
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _eval_cases() -> dict:
    data = read_json(_eval_dir() / "cases.json") or {}
    return data if isinstance(data, dict) else {}


def _write_eval_cases(cases: dict) -> None:
    path = _eval_dir() / "cases.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(cases, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def _receipts() -> list:
    """Every closed-lane receipt: the only record a closed lane leaves behind."""
    path = hermes_home() / "lanes" / "closed.jsonl"
    if not path.is_file():
        return []
    out = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict):
            out.append(row)
    return out


def eval_add(argv: list) -> int:
    """Record one eval case: the task text, the gates that decide pass, and an optional seed tree."""
    parser = argparse.ArgumentParser(prog="pi-lane eval add")
    parser.add_argument("name")
    parser.add_argument("--task-file", required=True)
    parser.add_argument("--gate", action="append", default=[], help="a pass/fail command; repeatable")
    parser.add_argument("--seed", default="", help="a directory copied into each run as the starting tree")
    args = parser.parse_args(argv)
    task_path = Path(args.task_file).expanduser()
    if not task_path.is_file():
        print(f"no task file: {task_path}", file=sys.stderr)
        return 1
    if not args.gate:
        print("eval add: pass at least one --gate \"<command>\"", file=sys.stderr)
        return 2
    cases = _eval_cases()
    cases[args.name] = {
        "task": task_path.read_text(encoding="utf-8"),
        "gates": list(args.gate),
        "seed": str(Path(args.seed).expanduser()) if args.seed else "",
    }
    _write_eval_cases(cases)
    print(f"{args.name}: case stored — {len(cases[args.name]['task'])} chars, {len(args.gate)} gate(s)")
    return 0


def eval_list(argv: list) -> int:
    parser = argparse.ArgumentParser(prog="pi-lane eval list")
    parser.parse_args(argv)
    cases = _eval_cases()
    if not cases:
        print("no eval cases — `pi-lane eval add <name> --task-file … --gate \"…\"`")
        return 0
    for name, case in sorted(cases.items()):
        print(f"{name}\t{len(case.get('task') or '')} chars\t{len(case.get('gates') or [])} gate(s)"
              f"\tseed {case.get('seed') or '-'}")
    return 0


def eval_run(argv: list) -> int:
    """Run one case as one lane on a fresh copy of the seed, then judge it with the case's gates.

    A bench that counts only the orchestrator made lanes look cheap; this one reads the lane's own bill
    from the record and writes gate results beside it, so a model change is a row, not an opinion.
    """
    parser = argparse.ArgumentParser(prog="pi-lane eval run")
    parser.add_argument("name")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--provider", default=DEFAULT_PROVIDER)
    parser.add_argument("--thinking", default="low")
    parser.add_argument("--root", default=str(Path.home() / "work" / "eval"))
    parser.add_argument("--max-usd", type=float, default=0.0)
    parser.add_argument("--keep", action="store_true", help="keep the lane record and its worktree")
    args = parser.parse_args(argv)
    cases = _eval_cases()
    case = cases.get(args.name)
    if not case:
        print(f"no such case: {args.name}", file=sys.stderr)
        return 1
    stamp = time.strftime("%Y%m%d-%H%M%S")
    model_slug = re.sub(r"[^A-Za-z0-9._-]+", "-", args.model)
    repo = Path(args.root).expanduser() / f"{args.name}-{model_slug}-{stamp}"
    repo.mkdir(parents=True, exist_ok=True)
    seed = str(case.get("seed") or "")
    if seed and Path(seed).is_dir():
        subprocess.run(f"cp -a {seed.rstrip('/')}/. {repo}/", shell=True, check=False)
        if not Path(repo, ".git").exists():
            _git(str(repo), "init", "-q", "-b", "main")
    else:
        repo.mkdir(parents=True, exist_ok=True)
        _git(str(repo), "init", "-q", "-b", "main")
        Path(repo, ".gitkeep").write_text("placeholder\n", encoding="utf-8")
    _git(str(repo), "add", "-A")
    _git(str(repo), "-c", "user.name=eval", "-c", "user.email=eval@local", "commit", "-qm", "seed")

    lane = f"eval-{args.name}-{model_slug}"[:56]
    open_argv = [lane, str(case.get("task") or ""), "--repo", str(repo),
                 "--model", args.model, "--provider", args.provider, "--thinking", args.thinking,
                 "--autonomy", "auto"]
    if args.max_usd:
        open_argv += ["--max-usd", str(args.max_usd)]
    started = time.time()
    print(f"? {args.name} on {args.model} — lane {lane} in {repo}")
    rc = open_lane(open_argv)
    wall = int(time.time() - started)
    record = read_json(hermes_home() / "lanes" / lane / "lane.json") or {}

    gates = []
    for command in case.get("gates") or []:
        done = subprocess.run(command, shell=True, cwd=str(repo), capture_output=True, text=True,
                              timeout=1800, check=False)
        gates.append({"cmd": command, "exit": int(done.returncode)})
        print(f"$ {command}   -> exit {done.returncode}")
    passed = rc == 0 and all(gate["exit"] == 0 for gate in gates)
    usage = record.get("usage") or {}
    review = (record.get("review") or {}).get("usage") or {}
    row = {
        "case": args.name,
        "model": args.model,
        "provider": args.provider,
        "thinking": args.thinking,
        "at": int(time.time()),
        "wall_seconds": wall,
        "tokens": {key: usage.get(key) for key in ("input", "output", "cache_read", "turns")},
        "cost_usd": round(float(usage.get("cost_usd") or 0) + float(review.get("cost_usd") or 0), 6),
        "state": record.get("state") or "gone",
        "pass": passed,
        "gates": gates,
        "repo": str(repo),
        "lane": lane,
    }
    with (_eval_dir() / "results.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"{'PASS' if passed else 'FAIL'} {args.name} · {args.model} · {wall}s · "
          f"${row['cost_usd']:.4f} · {row['tokens'].get('output') or 0} out")
    if not args.keep:
        print(f"  keep the evidence with: --keep, or read {row['repo']}")
    return 0 if passed else 1


def eval_capture(argv: list) -> int:
    """Turn a finished run into one row, so two arms are compared by a machine and not by memory.

    A run leaves its evidence in four places — the lane records and their receipts, the plan snapshot, the
    repository's requirements file and the holdout's verdict — and none of them is the table an evening of
    experiments needs. This reads all four, runs the case's gates, and appends one line to `results.jsonl`.

    The two numbers the runner cannot know are passed in, and they are named `--wall` and
    `--orchestrator-usd` so nobody can quietly leave them at zero.
    """
    parser = argparse.ArgumentParser(prog="pi-lane eval capture")
    parser.add_argument("case", help="the eval case this run belongs to")
    parser.add_argument("--repo", required=True, help="the repository the run built")
    parser.add_argument("--plan", default="", help="the plan id the lanes carry")
    parser.add_argument("--wall", type=int, default=0, help="seconds the run took, as measured outside")
    parser.add_argument("--orchestrator-usd", type=float, default=0.0,
                        help="what the orchestrator itself spent; the lanes are summed here")
    parser.add_argument("--note", default="", help="one line on what this arm did differently")
    parser.add_argument("--no-gates", action="store_true", help="do not run the case's gate commands")
    args = parser.parse_args(argv)
    repo = os.path.realpath(Path(args.repo).expanduser())
    if not Path(repo, ".git").exists():
        print(f"eval capture: not a git repository: {repo}", file=sys.stderr)
        return 1
    cases = _eval_cases()
    case = cases.get(args.case)
    if case is None:
        print(f"eval capture: no such case: {args.case} (eval add makes one)", file=sys.stderr)
        return 1

    planned = set()
    if args.plan:
        snapshot = read_json(hermes_home() / "plans" / args.plan / "plan.json") or {}
        planned = set(snapshot.get("lanes") or [])

    # A finished lane leaves a receipt and no folder, so both are the same population: read the records
    # that still exist, add the receipts of the ones that closed, and never count a lane twice.
    lanes = [record for record in lane_records()
             if os.path.realpath(str(record.get("repo") or "")) == repo
             and (not args.plan or record.get("plan") == args.plan)]
    name = Path(repo).name
    receipts = []
    for receipt in _receipts():
        # Receipts carry no repository path, only the project name, and one benchmark owns one repository —
        # so the name is the join. Filtering them by the plan's lane list dropped the lanes a run opened
        # outside the plan (a `repair`), which is exactly the work a comparison must see.
        if str(receipt.get("project") or "") != name:
            continue
        receipts.append(receipt)
    lane_usd = (sum(float((record.get("usage") or {}).get("cost_usd") or 0) for record in lanes)
                + sum(float(receipt.get("cost_usd") or 0) for receipt in receipts))
    critic_usd = (sum(float(((record.get("review") or {}).get("usage") or {}).get("cost_usd") or 0)
                      for record in lanes)
                  + sum(float((receipt.get("review_usage") or {}).get("cost_usd")
                              or receipt.get("review_cost_usd") or 0)
                        for receipt in receipts))
    repairs = sum(int(record.get("result_repairs") or 0) for record in lanes)
    lanes = lanes + receipts
    extra = sorted(str(item.get("lane")) for item in lanes
                   if planned and item.get("lane") not in planned)

    gates = []
    if not args.no_gates:
        for command in case.get("gates") or []:
            try:
                done = subprocess.run(command, shell=True, cwd=repo, capture_output=True, text=True,
                                      timeout=1800)
                gates.append({"cmd": command, "exit": done.returncode})
            except subprocess.TimeoutExpired:
                gates.append({"cmd": command, "exit": 124})

    criteria = spec_criteria(spec_path(repo))
    summary = spec_summary(repo, [ac_id for ac_id, _, _ in criteria]) if criteria else {
        "declared": [], "covered": [], "unproven": [], "missing": []}
    holds = [record.get("holdout") or {} for record in lanes if record.get("holdout")]
    holdout = max(holds, key=lambda item: item.get("ran_at") or 0) if holds else {}

    row = {
        "case": args.case,
        "at": int(time.time()),
        "repo": repo,
        "plan": args.plan or "",
        "wall_seconds": int(args.wall),
        "lanes": len(lanes),
        "extra_lanes": extra,
        # A receipt's `cost_usd` already includes its critic (`usage` + `review_usage`), while a live
        # record's `usage.cost_usd` does not — so the critic is reported beside the total, never added to
        # it a second time.
        "lane_usd": round(lane_usd, 6),
        "critic_usd": round(critic_usd, 6),
        "orchestrator_usd": round(float(args.orchestrator_usd), 6),
        "cost_usd": round(lane_usd + float(args.orchestrator_usd), 6),
        "repairs": repairs,
        "gates": gates,
        "pass": bool(gates) and all(not gate["exit"] for gate in gates),
        "criteria": {"declared": len(summary.get("declared") or []),
                     "covered": len(summary.get("covered") or []),
                     "unproven": summary.get("unproven") or [],
                     "missing": summary.get("missing") or []},
        "holdout": {"ok": bool(holdout.get("ok")), "sha": holdout.get("sha") or "",
                    "scenarios": len(holdout.get("scenarios") or [])} if holdout else {},
        "receipts": len(receipts),
        "note": args.note,
    }
    path = _eval_dir() / "results.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"{args.case}: captured — {'pass' if row['pass'] else 'fail'} · "
          f"{row['lanes']} lane(s) · ${row['cost_usd']:.4f} · criteria "
          f"{row['criteria']['covered']}/{row['criteria']['declared']} · "
          f"holdout {'ok' if row['holdout'].get('ok') else 'no'}")
    return 0 if row["pass"] else 1


def eval_table(argv: list) -> int:
    """Print every recorded result as a table, so two models on one case are one glance apart."""
    parser = argparse.ArgumentParser(prog="pi-lane eval table")
    parser.add_argument("name", nargs="?")
    args = parser.parse_args(argv)
    path = _eval_dir() / "results.jsonl"
    if not path.is_file():
        print("no eval results yet")
        return 0
    rows = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if args.name and row.get("case") != args.name:
            continue
        rows.append(row)
    if not rows:
        print("no eval results for that case")
        return 0
    print(f"{'case':18s} {'arm':26s} {'res':5s} {'wall':>6s} {'lanes':>5s} {'usd':>8s} "
          f"{'crit':>7s} {'hold':4s}  gates")
    for row in sorted(rows, key=lambda r: (r.get("case") or "", r.get("at") or 0)):
        failures = sum(1 for gate in row.get("gates") or [] if gate.get("exit"))
        gates = "ok" if not failures else f"{failures} fail"
        criteria = row.get("criteria") or {}
        arms = f"{criteria.get('covered', 0)}/{criteria.get('declared', 0)}" if criteria else "-"
        holdout = "ok" if (row.get("holdout") or {}).get("ok") else "no"
        arm = str(row.get("note") or row.get("plan") or row.get("model") or "")[:26]
        print(f"{str(row.get('case'))[:18]:18s} {arm:26s} "
              f"{'pass' if row.get('pass') else 'fail':5s} {int(row.get('wall_seconds') or 0):5d}s "
              f"{int(row.get('lanes') or 0):5d} {float(row.get('cost_usd') or 0):8.4f} "
              f"{float(row.get('critic_usd') or 0):7.4f} {holdout:4s}  {gates}  acs {arms}")
    return 0


def report(argv: list) -> int:
    """The one call an orchestrator makes at the end: what can close, what is blocked and what it cost.

    A finished run used to be read with `status`, `ledger`, `git status`, `gate` and a hand-written list;
    this prints the same facts in the order the orchestrator needs them, from the same reader the verbs use.
    """
    parser = argparse.ArgumentParser(prog="pi-lane report")
    parser.add_argument("--repo", default="", help="only lanes of this repository")
    args = parser.parse_args(argv)
    wanted = os.path.realpath(args.repo) if args.repo else ""
    records = []
    for record in lane_records():
        if wanted and os.path.realpath(str(record.get("repo") or "")) != wanted:
            continue
        if record.get("closed_at"):
            continue
        records.append(record)
    if not records:
        print("no open lanes")
        return 0
    records.sort(key=lambda r: r.get("started") or 0)
    name_of = {id(r): str(r.get("lane")) for r in records}
    repo = str(records[0].get("repo") or "")
    spend = {"lane": 0.0, "critic": 0.0}
    ready = hand_only = blocked = 0
    lines = []
    for record in records:
        name = name_of[id(record)]
        facts = lane_facts(name, record)
        close_blockers = lane_blockers(name, record, "close")
        hand_blockers = lane_blockers(name, record, "hand")
        usage = record.get("usage") or {}
        review_usage = (record.get("review") or {}).get("usage") or {}
        spend["lane"] += float(usage.get("cost_usd") or 0)
        spend["critic"] += float(review_usage.get("cost_usd") or 0)
        if not close_blockers:
            ready += 1
            nxt = "close"
        elif not hand_blockers:
            hand_only += 1
            nxt = "hand"
        else:
            blocked += 1
            nxt = "fix"
        cost = float(usage.get("cost_usd") or 0) + float(review_usage.get("cost_usd") or 0)
        pair = f"{facts['p0']}/{facts['p1']}"
        notes = [f"    {reason}" for reason in (close_blockers or hand_blockers)]
        hold = record.get("holdout") or {}
        if record.get("plan"):
            if hold.get("ok"):
                notes.append(f"    holdout ok at {str(hold.get('sha'))[:7]}")
            elif hold:
                notes.append("    holdout FAILED")
            else:
                notes.append("    holdout not run")
        mutant = record.get("mutation") or {}
        if mutant:
            notes.append(f"    mutation {mutant.get('killed')}/{mutant.get('total')} at "
                         f"{str(mutant.get('sha'))[:7]}")
        acs = facts.get("acs") or {}
        if acs.get("declared"):
            note = f"    acs {len(acs['covered'])}/{len(acs['declared'])}"
            if acs.get("missing"):
                note += f" · covered nowhere: {', '.join(acs['missing'])}"
            if acs.get("unproven"):
                note += f" · mentioned only: {', '.join(acs['unproven'])}"
            if acs.get("unreported"):
                note += f" · missing from the RESULT: {', '.join(acs['unreported'])}"
            notes.append(note)
        lines.append((f"{name:16s} {str(record.get('state')):8s} {facts['gate']:6s} {facts['claim']:8s} "
                      f"{facts['result']:7s} {pair:6s} {cost:8.4f}  {nxt}", notes))
    print(f"run      {Path(repo).name or '?'} · {len(records)} lane(s)")
    print(f"ready    close {ready} · hand {hand_only} · blocked {blocked}")
    print(f"spend    lanes {spend['lane']:.4f} + critic {spend['critic']:.4f} = "
          f"{spend['lane'] + spend['critic']:.4f} USD")
    print(f"{'lane':16s} {'state':8s} {'gate':6s} {'claim':8s} {'result':7s} {'p0/p1':6s} {'usd':>8s}  next")
    for line, reasons in lines:
        print(line)
        for reason in reasons:
            print(reason)
    return 0 if not blocked else 1


def status(argv: list) -> int:
    """Everything an orchestrator otherwise gathers with five shell calls, in one table.

    The run that cost 113k input tokens made 55 shell calls, half of them to ask the same four questions
    per lane: is the gate fresh, does the claim hold, what did the critic say, what does the lane cost.
    """
    parser = argparse.ArgumentParser(prog="pi-lane status")
    parser.add_argument("--repo", default="", help="only lanes of this repository")
    args = parser.parse_args(argv)
    wanted = os.path.realpath(args.repo) if args.repo else ""
    rows = []
    for record in lane_records():
        if wanted and os.path.realpath(str(record.get("repo") or "")) != wanted:
            continue
        rows.append(record)
    if not rows:
        print("no lanes")
        return 0
    rows.sort(key=lambda r: r.get("started") or 0, reverse=True)
    print(f"{'lane':18s} {'state':8s} {'gate':6s} {'claim':7s} {'result':7s} {'p0/p1':6s} {'usd':>8s} "
          f"{'files':>5s} {'merged':6s}  stop")
    for record in rows:
        repo = str(record.get("repo") or "")
        checked = str(record.get("checked_sha") or "")
        gate = "none"
        if checked and repo and Path(repo).is_dir():
            rc, head, _ = _git(repo, "rev-parse", "HEAD")
            gate = "ok" if rc == 0 and head == checked else "stale"
        claim = record.get("verify_check") or {}
        claim_state = "-" if not claim else ("match" if claim.get("match") else "MISMATCH")
        status_value = str(record.get("result_status") or "-")
        review = record.get("review") or {}
        usage = record.get("usage") or {}
        cost = float(usage.get("cost_usd") or 0) + float((review.get("usage") or {}).get("cost_usd") or 0)
        worktree = str(record.get("worktree") or "")
        dirty = 0
        if worktree and Path(worktree).is_dir():
            rc, out, _ = _git(worktree, "status", "--porcelain")
            dirty = len([line for line in out.splitlines() if line.strip()]) if rc == 0 else 0
        merged = "-"
        branch = str(record.get("branch") or "")
        if repo and branch and Path(repo).is_dir():
            rc, _, _ = _git(repo, "merge-base", "--is-ancestor", branch, "HEAD")
            merged = "yes" if rc == 0 else "no"
        stop = str(record.get("stop_reason") or "-").split(" —")[0][:24]
        pair = f"{len(review.get('p0') or [])}/{len(review.get('p1') or [])}"
        print(f"{str(record.get('lane'))[:18]:18s} {str(record.get('state'))[:8]:8s} {gate:6s} "
              f"{claim_state:7s} {status_value[:7]:7s} {pair:6s} "
              f"{cost:8.4f} {dirty:5d} {merged:6s}  {stop}")
    return 0


def set_budget(argv: list) -> int:
    """Change a lane's caps. `max_usd` covers the whole lane, so a spent lane refuses a continuation."""
    parser = argparse.ArgumentParser(prog="pi-lane budget")
    parser.add_argument("lane")
    parser.add_argument("--max-usd", type=float, default=None)
    parser.add_argument("--max-turns", type=int, default=None)
    parser.add_argument("--idle-timeout", type=int, default=None)
    args = parser.parse_args(argv)
    lane_dir = hermes_home() / "lanes" / args.lane
    record = read_json(lane_dir / "lane.json")
    if record is None:
        print(f"no such lane: {args.lane}", file=sys.stderr)
        return 1
    budget = dict(record.get("budget") or {})
    for key, value in (
        ("max_usd", args.max_usd), ("max_turns", args.max_turns), ("idle_timeout", args.idle_timeout),
    ):
        if value is not None:
            budget[key] = value
    record["budget"] = budget
    write_record(lane_dir, record)
    print(f"{args.lane}: budget {json.dumps(budget)}")
    return 0


def _usage_from_session(worktree: str) -> dict | None:
    """Sum a lane's usage from its pi session files, for records written before the runner kept it."""
    if not worktree:
        return None
    folder = hermes_home().parent / ".pi" / "agent" / "sessions" / f"--{worktree.strip('/').replace('/', '-')}--"
    if not folder.is_dir():
        return None
    total = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0, "reasoning": 0,
             "cost_usd": 0.0, "turns": 0}
    seen = False
    for path in sorted(folder.glob("*.jsonl")):
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            message = event.get("message") if isinstance(event.get("message"), dict) else None
            usage = (message or {}).get("usage")
            if not isinstance(usage, dict):
                continue
            seen = True
            total["input"] += int(usage.get("input") or 0)
            total["output"] += int(usage.get("output") or 0)
            total["cache_read"] += int(usage.get("cacheRead") or 0)
            total["cache_write"] += int(usage.get("cacheWrite") or 0)
            total["reasoning"] += int(usage.get("reasoning") or 0)
            total["cost_usd"] = round(total["cost_usd"] + float((usage.get("cost") or {}).get("total") or 0), 6)
            total["turns"] += 1
    return total if seen else None


def ledger(argv: list) -> int:
    """Print tokens and money per lane from the records, plus the total of the run.

    The lane's own `pi` bill used to live only in `~/.pi/agent/sessions`, so a run could not be
    totalled and a lane arm looked cheaper than it was. A record written before the runner kept the
    usage is billed from that session file instead, and marked with `~`.
    """
    parser = argparse.ArgumentParser(prog="pi-lane ledger")
    parser.add_argument("lanes", nargs="*")
    args = parser.parse_args(argv)
    wanted = set(args.lanes)
    rows = [r for r in lane_records() if not wanted or str(r.get("lane")) in wanted]
    if rows:
        rows.sort(key=lambda r: r.get("started") or 0)
        print(f"{'lane':20s} {'state':8s} {'input':>9s} {'output':>8s} {'cache':>9s} {'usd':>9s} {'rev':>7s} {'min':>5s}  model")
    total = {"input": 0, "output": 0, "cache": 0, "usd": 0.0, "rev": 0.0}
    from_session = 0
    for record in rows:
        usage = record.get("usage") or {}
        mark = ""
        if not usage:
            usage = _usage_from_session(str(record.get("worktree") or "")) or {}
            mark = "~" if usage else ""
            from_session += 1 if mark else 0
        review_cost = float(((record.get("review") or {}).get("usage") or {}).get("cost_usd") or 0)
        started = record.get("started") or 0
        finished = record.get("finished") or 0
        minutes = int((finished - started) // 60) if finished and started else 0
        values = {
            "input": int(usage.get("input") or 0),
            "output": int(usage.get("output") or 0),
            "cache": int(usage.get("cache_read") or 0),
            "usd": float(usage.get("cost_usd") or 0),
            "rev": review_cost,
        }
        for key in total:
            total[key] += values[key]
        model = str(record.get("model") or "")
        print(f"{str(record.get('lane')):20s} {str(record.get('state')):8s} {values['input']:9d} "
              f"{values['output']:8d} {values['cache']:9d} {values['usd']:8.4f}{mark:1s} "
              f"{values['rev']:6.4f} {minutes:4d}  {model}")
    if rows:
        print(f"{'total':20s} {'':8s} {total['input']:9d} {total['output']:8d} {total['cache']:9d} "
              f"{total['usd']:8.4f} {total['rev']:6.4f}")
    if from_session:
        print("~ billed from the pi session file: the record was written before the runner kept usage")
    # A closed lane's bill survives only in its receipt, because `close` deletes the record and the pi
    # session. Read it back, or a finished run cannot be totalled at all.
    receipts = []
    closed_path = hermes_home() / "lanes" / "closed.jsonl"
    if closed_path.is_file():
        for line in closed_path.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                receipt = json.loads(line)
            except ValueError:
                continue
            if wanted and str(receipt.get("lane")) not in wanted:
                continue
            if receipt.get("cost_usd"):
                receipts.append(receipt)
    if receipts:
        print()
        print(f"{'closed':20s} {'usd':>8s} {'p0/p1':6s}  merge")
        closed_total = 0.0
        for receipt in receipts[-20:]:
            closed_total += float(receipt.get("cost_usd") or 0)
            pair = f"{receipt.get('review_p0', 0)}/{receipt.get('review_p1', 0)}"
            print(f"{str(receipt.get('lane'))[:20]:20s} {float(receipt.get('cost_usd') or 0):8.4f} "
                  f"{pair:6s}  {str(receipt.get('merge_sha') or '')[:7]} {receipt.get('closed_date')}"
                  f" · {receipt.get('project')}")
        print(f"{'closed total':20s} {closed_total:8.4f}")
    return 0
