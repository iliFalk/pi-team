def gate_lanes(argv: list) -> int:
    """Run the project gates in the MERGED tree and record the check on each lane.

    Two refusals make this verb worth having. A lane whose branch is not yet an ancestor of HEAD
    was never merged, so a green run here would bless work that is not in the tree. And lanes from
    different repositories cannot share one gate run, because one command set would answer for both.
    On success it writes `checked_at` and `checked_sha` — the same pair the panel reads to offer
    CLOSE. With `--plan` the lanes and the commands come from the plan snapshot: the run carried
    the gates in its plan file, so nobody retypes them and nobody forgets one.
    """
    parser = argparse.ArgumentParser(prog="pi-lane gate")
    parser.add_argument("lanes", nargs="*", help="the lanes to stamp; --plan finds them by plan id")
    parser.add_argument("--plan", default="",
                        help="take the lanes and the commands from the plan snapshot at $HERMES_HOME/plans/<id>")
    parser.add_argument("--cmd", action="append", default=[], help="a gate command; repeatable")
    parser.add_argument("--cwd", default="", help="run here instead of the repository root")
    parser.add_argument("--timeout", type=int, default=1800, help="seconds per command")
    args = parser.parse_args(argv)

    lanes = list(args.lanes)
    plan_cmds = []
    if args.plan:
        snapshot = read_json(hermes_home() / "plans" / args.plan / "plan.json")
        if snapshot is None:
            print(f"plan {args.plan}: no snapshot in {hermes_home() / 'plans'}", file=sys.stderr)
            return 1
        if lanes:
            print("pi-lane gate: name lanes or pass --plan, not both", file=sys.stderr)
            return 2
        plan_cmds = [str(command) for command in (snapshot.get("gates") or [])]
    cmds = plan_cmds + [command for command in args.cmd if command not in plan_cmds]
    if not cmds:
        # Answer about the plan before the lanes: the gate commands are the deterministic half,
        # and a lane's record appears a moment after `plan` returns.
        print("pi-lane gate: pass at least one --cmd \"<command>\" "
              "or a plan that carries gates", file=sys.stderr)
        return 2
    if args.plan and not lanes:
        lanes = [str(record.get("lane")) for record in lane_records()
                 if record.get("plan") == args.plan and not record.get("closed_at")]
        if not lanes:
            print(f"plan {args.plan}: no open lane carries it", file=sys.stderr)
            return 1

    records = {}
    repos = set()
    for lane in lanes:
        record = read_json(hermes_home() / "lanes" / lane / "lane.json")
        if record is None:
            print(f"{lane}: no such lane", file=sys.stderr)
            return 1
        if record.get("closed_at"):
            print(f"{lane}: already closed", file=sys.stderr)
            return 1
        repo = str(record.get("repo") or "")
        if not repo:
            print(f"{lane}: the record carries no repository", file=sys.stderr)
            return 1
        records[lane] = record
        repos.add(os.path.realpath(repo))
    if len(repos) != 1:
        print(f"lanes span {len(repos)} repositories: {', '.join(sorted(repos))}", file=sys.stderr)
        return 1
    repo = repos.pop()
    workdir = os.path.realpath(args.cwd) if args.cwd else repo

    rc, head, err = _git(repo, "rev-parse", "HEAD")
    if rc != 0:
        print(f"{repo}: git says: {err}", file=sys.stderr)
        return 1

    # The whole point: a gate that runs next to unmerged work proves nothing about the tree.
    unmerged = []
    for lane, record in records.items():
        branch = str(record.get("branch") or "")
        if not branch:
            continue
        rc, _, _ = _git(repo, "merge-base", "--is-ancestor", branch, "HEAD")
        if rc != 0:
            unmerged.append(lane)
    if unmerged:
        print(f"refusing: not merged into HEAD ({head[:7]}): {', '.join(sorted(unmerged))}", file=sys.stderr)
        print("merge them first — a gate here would bless work that is not in the tree", file=sys.stderr)
        return 1

    started = time.time()
    results = []
    for command in cmds:
        print(f"$ {command}   (in {workdir})")
        try:
            done = subprocess.run(command, shell=True, cwd=workdir, capture_output=True, text=True,
                                  timeout=args.timeout)
        except subprocess.TimeoutExpired:
            print(f"timeout after {args.timeout}s: {command}", file=sys.stderr)
            return 1
        output = ((done.stdout or "") + (done.stderr or "")).strip()
        tail = "\n".join(output.splitlines()[-12:])
        if tail:
            print(tail)
        print(f"-> exit {done.returncode}")
        if done.returncode != 0:
            print(f"gate failed, nothing recorded: {command}", file=sys.stderr)
            return 1
        results.append((command, done.returncode))

    for lane, record in records.items():
        record["checked_at"] = int(time.time())
        record["checked_sha"] = head
        record["gate_cmds"] = list(cmds)
        record["gate_seconds"] = int(time.time() - started)
        # A RESULT claims a verify command and its exit code. The gate is the tree the work lands in, so
        # compare the claim with what actually ran there: a lane that says "green" about a command nobody
        # ran, or about a command that failed here, is the defect the critic cannot see.
        claim = (record.get("result") or {}).get("verify") or {}
        claimed_cmd = " ".join(str(claim.get("cmd") or "").split())
        check = {"claimed": claim, "gate": [{"cmd": c, "exit": e} for c, e in results], "match": True, "why": ""}
        if not claimed_cmd:
            check["match"] = False
            check["why"] = "the lane claimed no verify command"
        else:
            same = [exit_code for cmd, exit_code in results if " ".join(cmd.split()) == claimed_cmd]
            if not same:
                check["match"] = False
                check["why"] = "the claimed command is not one of the gate commands"
            else:
                try:
                    claimed_exit = int(claim.get("exit"))
                except (TypeError, ValueError):
                    claimed_exit = None
                if claimed_exit is None or claimed_exit != int(same[0]):
                    check["match"] = False
                    check["why"] = f"claimed exit {claim.get('exit')}, the gate ran it with exit {same[0]}"
        record["verify_check"] = check
        if not check["match"]:
            print(f"{lane}: verify claim does not match the gate — {check['why']}", file=sys.stderr)
        write_record(hermes_home() / "lanes" / lane, record)
    print(f"gate ok — checked {len(records)} lane(s) at {head[:7]}")
    return 0


def review_queue(argv: list) -> int:
    """Print the review shelf: the lanes a person filed, with everything a check needs.

    This is the pull half of the panel's `SEND`: nothing is injected into a chat, the orchestrator
    asks for the queue when it wants to work. Same fields the injected message carried.
    """
    parser = argparse.ArgumentParser(prog="pi-lane review")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    rows = [r for r in lane_records() if r.get("handed_at") and not r.get("closed_at")]
    rows.sort(key=lambda r: r.get("handed_at") or 0)
    if args.json:
        print(json.dumps([{k: r.get(k) for k in ("lane", "project", "group", "state", "task",
                                                 "files", "insertions", "deletions", "worktree")}
                          for r in rows], ensure_ascii=False))
        return 0
    if not rows:
        print("review queue: empty")
        return 0
    print(f"Review queue: {len(rows)} lane(s).")
    for r in rows:
        print(f"- {r.get('project') or '?'}/{r.get('group') or '-'}/{r.get('lane')} — {r.get('state')}"
              f" — {r.get('files', 0)} files +{r.get('insertions', 0)} -{r.get('deletions', 0)}")
        if r.get("task"):
            # The record's `task` is the full brief a lane was given; print its point, not its length.
            head = " ".join(str(r["task"]).split())[:140]
            print(f"  task: {head}")
        texts = assistant_texts(hermes_home() / "lanes" / str(r.get("lane")))
        if texts:
            print(f"  says: {' '.join(texts[-1].split())[:240]}")
        if r.get("worktree"):
            print(f"  look: {r['worktree']} · pi-lane check {r.get('lane')}")
    print("\nCheck each one, report what you found, and wait for his go before closing.")
    return 0


def digest_lane(argv: list) -> int:
    """Print one lane as a compact record: task, commits, diff size, gate result, leftovers.

    The point is to make a later 'write a skill from this' cost one call instead of a re-read of
    the repository.
    """
    parser = argparse.ArgumentParser(prog="pi-lane digest")
    parser.add_argument("lane")
    args = parser.parse_args(argv)
    lane_dir = hermes_home() / "lanes" / args.lane
    record = read_json(lane_dir / "lane.json")
    if record is None:
        print(f"no such lane: {args.lane}", file=sys.stderr)
        return 1
    repo = str(record.get("repo") or "")
    branch = str(record.get("branch") or "")
    print(f"lane      {record.get('lane')}  ({record.get('state')})")
    print(f"project   {record.get('project') or '-'} / {record.get('group') or '-'}")
    print(f"task      {' '.join(str(record.get('task') or '').split())[:300]}")
    print(f"model     {record.get('provider') or '?'} / {record.get('model') or '?'}")
    if record.get("handed_at"):
        print(f"handed    yes")
    if record.get("checked_at"):
        print(f"checked   {str(record.get('checked_sha'))[:7]} · {'; '.join(record.get('gate_cmds') or [])}")
    usage = record.get("usage") or _usage_from_session(str(record.get("worktree") or "")) or {}
    if usage:
        print(f"usage     in {int(usage.get('input') or 0)} · out {int(usage.get('output') or 0)} · "
              f"cache {int(usage.get('cache_read') or 0)} · ${float(usage.get('cost_usd') or 0):.4f} · "
              f"{int(usage.get('turns') or 0)} turns")
    if record.get("stop_reason"):
        print(f"stopped   {record['stop_reason']}")
    check = record.get("verify_check") or {}
    if check:
        print(f"verify    {'match' if check.get('match') else 'MISMATCH'}"
              + (f" — {check.get('why')}" if check.get("why") else ""))
    if record.get("autonomy"):
        extra = f" · {record['auto_answers']} auto-answer(s)" if record.get("auto_answers") else ""
        print(f"autonomy  {record.get('autonomy')}{extra}")
    touches = record.get("touches") or []
    if touches:
        print(f"touches   {', '.join(touches)}")
    review = record.get("review") or {}
    if review:
        print(f"review    {review.get('model')} — P0 {len(review.get('p0') or [])} · "
              f"P1 {len(review.get('p1') or [])} · ${float((review.get('usage') or {}).get('cost_usd') or 0):.4f}")
        for item in (review.get("p0") or [])[:3]:
            print(f"  P0 {item}")
        for item in (review.get("p1") or [])[:3]:
            print(f"  P1 {item}")
    status = str(record.get("result_status") or "")
    if status:
        result = record.get("result") or {}
        line = f"result    {status}"
        if result:
            line += f" · {len(result.get('files') or [])} file(s)"
            verify = result.get("verify") or {}
            if verify:
                line += f" · verify exit {verify.get('exit')}"
            if result.get("risks"):
                line += f" · {len(result['risks'])} risk(s)"
        print(line)
        if result.get("followups"):
            print("next      " + "; ".join(str(item) for item in result["followups"][:4]))
    if record.get("last_error"):
        print(f"error     {str(record.get('last_error'))[:200]}")
    if repo and branch:
        rc, log, _ = _git(repo, "log", "--oneline", f"-8", branch)
        if rc == 0 and log:
            print("commits   " + "\n          ".join(log.splitlines()))
        rc, base, _ = _git(repo, "merge-base", branch, "HEAD")
        if rc == 0:
            rc2, stat, _ = _git(repo, "diff", "--stat", f"{base[:12]}..{branch}")
            if rc2 == 0 and stat:
                print("diff      " + "\n          ".join(stat.splitlines()[-4:]))
    texts = assistant_texts(lane_dir)
    if texts:
        print(f"says      {' '.join(texts[-1].split())[:300]}")
    return 0
