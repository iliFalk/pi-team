def close_lanes(argv: list) -> int:
    """Close lanes for good: merge their branch, then write the closed marker.

    Nothing lands on the shelf by accident — this is the only path into it.
    """
    parser = argparse.ArgumentParser(prog="pi-lane close")
    parser.add_argument("lanes", nargs="+")
    parser.add_argument("--no-merge", action="store_true", help="record the close without merging")
    parser.add_argument("--reason", default="", help="why it is closed; defaults to the merge")
    parser.add_argument("--keep", action="store_true", help="keep the worktree, branch and lane folder")
    parser.add_argument("--yes", action="store_true", help="confirm the deletion; without it only the plan prints")
    parser.add_argument("--auto", action="store_true",
                        help="merge and close without a word when the gate, the critic and the merge agree")
    args = parser.parse_args(argv)

    root = hermes_home() / "lanes"
    failed = 0
    for name in args.lanes:
        lane_dir = root / name
        record = read_json(lane_dir / "lane.json")
        if not record:
            print(f"{name}: no such lane", file=sys.stderr)
            failed += 1
            continue
        if record.get("closed_at"):
            print(f"{name}: already closed")
            continue
        repo = str(record.get("repo") or "")
        branch = str(record.get("branch") or f"lane/{name}")
        worktree = Path(str(record.get("worktree") or ""))
        state = str(record.get("state") or "")
        if state == "running" and pid_alive(record.get("pid")):
            print(f"{name}: still running — stop it first", file=sys.stderr)
            failed += 1
            continue

        if args.auto:
            blockers = lane_blockers(name, record, "close")
            if blockers:
                print(f"{name}: not closed — {', '.join(blockers)}", file=sys.stderr)
                failed += 1
                continue
            print(f"{name}: auto-close — gate and critic agree, merging without a word")
            args.yes = True

        if not args.yes and not args.no_merge:
            # Say exactly what disappears before anything does.
            default_name = _default_branch(repo) if repo and Path(repo).is_dir() else "?"
            rc_c, commits, _ = _git(worktree, "rev-list", "--count", f"{default_name}..HEAD") if worktree.is_dir() else (1, "0", "")
            rc_d, dirty, _ = _git(str(worktree), "status", "--porcelain") if worktree.is_dir() else (1, "", "")
            changed = len([l for l in dirty.splitlines() if l.strip()])
            size = 0
            if lane_dir.is_dir():
                size = sum(f.stat().st_size for f in lane_dir.rglob("*") if f.is_file())
            print(f"{name}: nothing done yet — this is the plan")
            print(f"  merge   {branch} → {default_name}"
                  + (f" ({commits.strip()} commits)" if worktree.is_dir() else " (no worktree)"))
            print(f"  commit  {changed} uncommitted file(s) from the lane" if changed else "  commit  nothing uncommitted")
            print(f"  delete  worktree {worktree}" if worktree.is_dir() else "  delete  no worktree")
            print(f"  delete  branch {branch}")
            print(f"  delete  folder {lane_dir} ({size // 1024}K)")
            sessions = pi_session_files(worktree, str(record.get("session_id") or "")) if worktree.is_dir() else []
            session_kb = sum(f.stat().st_size for f in sessions) // 1024
            print(f"  delete  pi session {pi_session_dir(worktree)} ({session_kb}K)" if sessions or worktree.is_dir()
                  else "  delete  no pi session")
            print(f"  keep    one receipt line in {(root / 'closed.jsonl')}")
            print("")
            print("  Nothing is lost. The work lands in the main branch as commits, and every one of")
            print("  them stays in the history: it can be shown, copied or turned into a new branch")
            print("  later. The worktree, the branch and the folder go only to free space and to keep")
            print("  the panel free of dead lanes — the code itself lives on in the main branch.")
            print("")
            print(f"  rerun with --yes to carry it out")
            continue

        # A lane does not commit, so its work is still uncommitted here: commit it on the lane
        # branch before the merge, or the merge would carry nothing.
        if worktree.is_dir():
            rc_s, dirty, _ = _git(str(worktree), "status", "--porcelain")
            if rc_s == 0 and dirty.strip():
                _git(str(worktree), "add", "-A")
                summary = str(record.get("task") or name).strip().splitlines()[0][:70]
                _git(
                    str(worktree), "-c", "user.name=pi-lane", "-c", "user.email=pi-lane@local",
                    "commit", "-m", f"Lane {name}: {summary}",
                )
                print(f"{name}: committed its work on {branch}")

        default = _default_branch(repo) if repo and Path(repo).is_dir() else ""
        merged_sha = ""
        merged_subject = ""
        merged_date = ""
        reason = args.reason
        if default and not args.no_merge:
            rc, _, _ = _git(repo, "rev-parse", "--verify", "--quiet", branch)
            if rc == 0:
                rc_merged, _, _ = _git(repo, "merge-base", "--is-ancestor", branch, default)
                if rc_merged != 0:
                    rc_m, out_m, err_m = _git(repo, "merge", "--no-ff", branch, "-m", f"Merge lane {name}")
                    if rc_m != 0:
                        print(f"{name}: merge failed — {err_m or out_m}", file=sys.stderr)
                        failed += 1
                        continue
                rc_s, sha, _ = _git(repo, "rev-parse", default)
                if rc_s == 0:
                    merged_sha = sha
                    _, subject, _ = _git(repo, "log", "-1", "--format=%s", sha)
                    merged_subject = subject
                    _, date, _ = _git(repo, "log", "-1", "--format=%ad", "--date=short", sha)
                    merged_date = date
                reason = reason or f"closed after merge into {default}"
        if not reason:
            reason = "closed by hand"

        record["closed_at"] = int(time.time())
        record["closed_reason"] = reason
        if merged_sha:
            files, added, removed = _shortstat(repo, merged_sha)
            record.update({
                "merge_sha": merged_sha,
                "merge_subject": merged_subject,
                "closed_date": merged_date,
                "merge_files": files,
                "merge_insertions": added,
                "merge_deletions": removed,
            })
        lane_dir.mkdir(parents=True, exist_ok=True)
        (lane_dir / "lane.json").write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        # One line for the journal, so closed lanes stay visible after their folder is gone.
        receipt = {
            "lane": name,
            "project": record.get("project"),
            "group": record.get("group"),
            "branch": branch,
            "state": state or "done",
            "closed_at": record["closed_at"],
            "closed_reason": reason,
            "merge_sha": merged_sha,
            "merge_subject": merged_subject,
            "closed_date": merged_date,
            "merge_files": record.get("merge_files", 0),
            "merge_insertions": record.get("merge_insertions", 0),
            "merge_deletions": record.get("merge_deletions", 0),
            "base": default,
            # The bill dies with the lane: `close` deletes the record and the pi session, so the receipt
            # is the only place left to say what the lane cost. Measured: after a close, the spend was
            # unrecoverable and a run could not be totalled.
            "usage": record.get("usage") or {},
            "review_usage": (record.get("review") or {}).get("usage") or {},
            "cost_usd": round(
                float((record.get("usage") or {}).get("cost_usd") or 0)
                + float(((record.get("review") or {}).get("usage") or {}).get("cost_usd") or 0), 6),
            "result_status": record.get("result_status") or "",
            "review_p0": len((record.get("review") or {}).get("p0") or []),
            "review_p1": len((record.get("review") or {}).get("p1") or []),
            "autonomy": record.get("autonomy") or "",
        }
        (root / "closed.jsonl").open("a", encoding="utf-8").write(
            json.dumps(receipt, ensure_ascii=False) + "\n"
        )

        cleaned = []
        if not args.keep:
            if worktree.is_dir():
                rc_w, _, err_w = _git(repo, "worktree", "remove", "--force", str(worktree))
                cleaned.append("worktree" if rc_w == 0 else f"worktree kept ({err_w})")
            if branch and repo:
                rc_b, _, _ = _git(repo, "branch", "-d", branch)
                if rc_b != 0:
                    _git(repo, "branch", "-D", branch)
                cleaned.append("branch")
            for leftover in (lane_dir / "events.jsonl", lane_dir / "stderr.txt", lane_dir / "thread.jsonl",
                             lane_dir / "lane.json", lane_dir / "question.json", lane_dir / "answer.json"):
                leftover.unlink(missing_ok=True)
            try:
                lane_dir.rmdir()
                cleaned.append("lane folder")
            except OSError:
                pass
            # pi keeps its own history beside the worktree: without this the folder outlives
            # the lane and turns into a 90K orphan per lane.
            session_files = pi_session_files(worktree, str(record.get("session_id") or ""))
            for item in session_files:
                item.unlink(missing_ok=True)
            folder = pi_session_dir(worktree)
            if session_files and folder.is_dir():
                try:
                    folder.rmdir()
                except OSError:
                    pass
            if session_files:
                cleaned.append("pi session")

        extra = f" · merged {merged_sha[:7]} into {default}" if merged_sha else ""
        tail = f" · removed {', '.join(cleaned)}" if cleaned else ""
        print(f"{name}: closed{extra}{tail}")

    return 1 if failed else 0


def check_lane(argv: list) -> int:
    """Record that the orchestrator read this lane's work: `checked_at` and the worktree's HEAD.

    The panel shows a lane as `reviewed` — and offers its CLOSE control — only while that sha is still the
    worktree's HEAD, so a check can never stand for work that landed after it.
    """
    parser = argparse.ArgumentParser(prog="pi-lane check")
    parser.add_argument("lane")
    args = parser.parse_args(argv)
    lane_dir = hermes_home() / "lanes" / args.lane
    record = read_json(lane_dir / "lane.json")
    if record is None:
        print(f"no such lane: {args.lane}", file=sys.stderr)
        return 1
    worktree = str(record.get("worktree") or "")
    if not worktree or not Path(worktree).is_dir():
        print(f"{args.lane}: no worktree to check", file=sys.stderr)
        return 1
    rc, sha, err = _git(worktree, "rev-parse", "HEAD")
    if rc != 0:
        print(f"{args.lane}: git says: {err}", file=sys.stderr)
        return 1
    record["checked_at"] = int(time.time())
    record["checked_sha"] = sha
    write_record(lane_dir, record)
    print(f"{args.lane}: checked at {sha[:7]}")
    return 0


def say_in_thread(argv: list) -> int:
    """Append an orchestrator reply into a lane's thread. Nothing is sent to pi."""
    parser = argparse.ArgumentParser(prog="pi-lane say")
    parser.add_argument("lane")
    parser.add_argument("text")
    args = parser.parse_args(argv)
    lane_dir = hermes_home() / "lanes" / args.lane
    if not (lane_dir / "lane.json").exists():
        print(f"no such lane: {args.lane}", file=sys.stderr)
        return 1
    entry = {"who": "jarvis", "at": int(time.time()), "text": args.text}
    with (lane_dir / "thread.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(f"{args.lane}: said")
    return 0


def hand_lane(argv: list) -> int:
    """File a finished lane for review: `handed_at`, the field the panel reads as TO REVIEW.

    Same field the panel's route writes, so an orchestrator in a chat session reaches the review
    shelf without the desktop being open. Refuses a lane whose `checked_sha` is not HEAD of the tree
    the work lands in — a hand is a claim that somebody read this exact work.
    """
    parser = argparse.ArgumentParser(prog="pi-lane hand")
    parser.add_argument("lane")
    parser.add_argument("--allow-missing-result", action="store_true",
                        help="file a lane whose last text carried no valid RESULT object")
    parser.add_argument("--no-review", action="store_true",
                        help="file the lane without the critic pass on another model")
    parser.add_argument("--accept-p0", action="store_true",
                        help="file the lane although the critic reported P0 findings")
    parser.add_argument("--accept-claim", action="store_true",
                        help="file the lane although its RESULT claim does not match the gate")
    args = parser.parse_args(argv)
    lane_dir = hermes_home() / "lanes" / args.lane
    record = read_json(lane_dir / "lane.json")
    if record is None:
        print(f"no such lane: {args.lane}", file=sys.stderr)
        return 1
    if record.get("closed_at"):
        print(f"{args.lane}: already closed", file=sys.stderr)
        return 1
    if record.get("state") in ("running", "waiting"):
        print(f"{args.lane}: still {record.get('state')} — a lane is filed when it has finished", file=sys.stderr)
        return 1
    blockers = lane_blockers(args.lane, record, "hand",
                             allow_missing_result=args.allow_missing_result,
                             accept_claim=args.accept_claim)
    if blockers:
        for reason in blockers:
            print(f"{args.lane}: cannot hand — {reason}", file=sys.stderr)
        return 1
    review = None
    if not args.no_review:
        review = run_review(lane_dir, record, args.lane)
        if review:
            p0 = review.get("p0") or []
            p1 = review.get("p1") or []
            spent = float((review.get("usage") or {}).get("cost_usd") or 0)
            print(f"{args.lane}: critic {review.get('model')} — P0 {len(p0)} · P1 {len(p1)} · "
                  f"${spent:.4f} · {review.get('seconds')}s")
            if review.get("status") != "ok":
                print(f"{args.lane}: critic wrote no REVIEW line ({review.get('status')}) — "
                      f"read {lane_dir / 'review.json'}", file=sys.stderr)
            for item in p0[:5]:
                print(f"  P0 {item}", file=sys.stderr)
            for item in p1[:5]:
                print(f"  P1 {item}", file=sys.stderr)
            if p0 and not args.accept_p0:
                print(f"{args.lane}: refused — {len(p0)} P0 finding(s). Fix them, run the gate again, "
                      f"then hand; `--accept-p0` files it anyway", file=sys.stderr)
                return 1
    record["handed_at"] = int(time.time())
    write_record(lane_dir, record)
    files, added, removed = _shortstat(str(record.get("repo") or ""), str(record.get("branch") or ""))
    print(f"{args.lane}: in review — {files} files +{added} -{removed}")
    return 0


def answer_lane(argv: list) -> int:
    """Answer the question a waiting lane parked in `question.json`, from any host."""
    parser = argparse.ArgumentParser(prog="pi-lane answer")
    parser.add_argument("lane")
    parser.add_argument("value")
    args = parser.parse_args(argv)
    lane_dir = hermes_home() / "lanes" / args.lane
    if not (lane_dir / "lane.json").exists():
        print(f"no such lane: {args.lane}", file=sys.stderr)
        return 1
    question = read_json(lane_dir / "question.json")
    payload: dict = {"value": args.value}
    if isinstance(question, dict) and question.get("id"):
        payload["id"] = question["id"]
    tmp = lane_dir / "answer.json.tmp"
    tmp.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, lane_dir / "answer.json")
    print(f"{args.lane}: answered")
    return 0


def list_lanes(argv: list) -> int:
    """Print lanes with the state the panel shows, so an agent can pick one without the UI."""
    rows = []
    for record in lane_records():
        rows.append(record)
    rows.sort(key=lambda r: r.get("started") or 0, reverse=True)
    if not rows:
        print("no lanes")
        return 0
    for r in rows:
        if r.get("closed_at"):
            shelf = "closed"
        elif r.get("handed_at"):
            shelf = "review"
        elif str(r.get("state")) in ("running", "waiting"):
            shelf = str(r.get("state"))
        else:
            shelf = "idle"
        usage = r.get("usage") or {}
        review = r.get("review") or {}
        cost = float(usage.get("cost_usd") or 0) + float((review.get("usage") or {}).get("cost_usd") or 0)
        p0 = len(review.get("p0") or [])
        stop = str(r.get("stop_reason") or "-").split(" —")[0]
        print(f"{r.get('lane')}\t{shelf}\t{r.get('project') or '-'}\t${cost:.4f}\tP0 {p0}\t"
              f"{r.get('autonomy') or '-'}\t{stop}\t{(r.get('task') or '')[:60]}")
    return 0


def _lane_state(lane: str) -> tuple[str, dict | None, dict | None]:
    lane_dir = hermes_home() / "lanes" / lane
    record = read_json(lane_dir / "lane.json")
    question = read_json(lane_dir / "question.json") if record and record.get("state") == "waiting" else None
    return (str(record.get("state") or "") if record else "gone"), record, question


def _report_lane(lane: str, state: str, record: dict | None, question: dict | None,
                 files: int, added: int, removed: int, as_json: bool) -> None:
    if as_json:
        print(json.dumps({
            "lane": lane, "state": state, "files": files, "insertions": added,
            "deletions": removed, "closed": bool((record or {}).get("closed_at")),
            "question": ({"id": question.get("id"), "title": question.get("title") or question.get("message") or ""}
                         if isinstance(question, dict) else None),
        }, ensure_ascii=False))
    elif question is not None:
        print(f"{lane}: waiting — {question.get('title') or question.get('message') or ''}")
    elif state == "done":
        print(f"{lane}: done — {files} files +{added} -{removed}")
    else:
        print(f"{lane}: {state}")


def wait_all(argv: list) -> int:
    """Wait for several lanes at once.

    `pi-lane wait --all` follows every lane that is running or waiting; names may narrow it.
    Returns 3 as soon as ANY lane is waiting on a question, because that one needs a person
    before the others can be merged. This is the verb that makes parallel lanes affordable:
    start three, wait on all three, merge in dependency order.
    """
    parser = argparse.ArgumentParser(prog="pi-lane wait --all")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("lanes", nargs="*")
    parser.add_argument("--timeout", type=int, default=3600, help="seconds; 0 waits forever")
    parser.add_argument("--interval", type=float, default=3.0)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    watch = list(args.lanes)
    if not watch:
        for record in lane_records():
            if str(record.get("state") or "") in ("running", "waiting"):
                watch.append(str(record.get("lane")))
    if not watch:
        if args.json:
            print(json.dumps({"lanes": [], "state": "empty"}))
        else:
            print("no lanes to wait for")
        return 0

    deadline = (time.monotonic() + args.timeout) if args.timeout else None
    printed: dict[str, str] = {}
    while True:
        states: dict[str, str] = {}
        waiting: list[str] = []
        failed = False
        for lane in watch:
            state, record, question = _lane_state(lane)
            if state in ("running", "waiting") and record is not None and not pid_alive(record.get("pid")):
                print(f"{lane}: orphaned — its runner is gone; `pi-lane resume {lane}` picks it up",
                      file=sys.stderr)
                states[lane] = "orphaned"
                failed = True
                continue
            states[lane] = state
            if question is not None:
                waiting.append(lane)
            if state in ("failed", "error"):
                failed = True
            if printed.get(lane) != state or question is not None:
                files = added = removed = 0
                if record and record.get("repo") and record.get("branch"):
                    try:
                        files, added, removed = _shortstat(str(record["repo"]), str(record["branch"]))
                    except Exception:
                        pass
                _report_lane(lane, state, record, question, files, added, removed, args.json)
                printed[lane] = state
        if waiting:
            return 3
        if all(s in ("done", "failed", "stopped", "cancelled", "error", "gone") for s in states.values()):
            if not args.json:
                done = sum(1 for s in states.values() if s == "done")
                print(f"all settled — {done}/{len(watch)} done")
            return 1 if failed else 0
        if deadline is not None and time.monotonic() > deadline:
            pending = ", ".join(f"{k}={v}" for k, v in states.items() if v in ("running", "waiting"))
            print(f"timeout after {args.timeout}s — still: {pending}", file=sys.stderr)
            return 124
        time.sleep(args.interval)


def wait_lane(argv: list) -> int:
    """Block until a lane stops moving on its own: done, failed, or waiting on a question.

    This is what an orchestrator needs instead of `sleep 180` in a loop. Exit codes are the
    contract: 0 terminal state, 3 the lane is waiting for an answer, 124 timeout.
    """
    parser = argparse.ArgumentParser(prog="pi-lane wait")
    parser.add_argument("lane")
    parser.add_argument("--timeout", type=int, default=3600, help="seconds; 0 waits forever")
    parser.add_argument("--interval", type=float, default=2.0)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    lane_dir = hermes_home() / "lanes" / args.lane
    deadline = (time.monotonic() + args.timeout) if args.timeout else None
    seen_printed = ""
    while True:
        record = read_json(lane_dir / "lane.json")
        if record is None:
            if args.json:
                print(json.dumps({"lane": args.lane, "state": "gone"}))
            else:
                print(f"no such lane: {args.lane}", file=sys.stderr)
            return 1
        state = str(record.get("state") or "")
        if state in ("running", "waiting") and not pid_alive(record.get("pid")):
            message = (f"{args.lane}: orphaned — its runner is gone (pid {record.get('pid')}); "
                       f"`pi-lane resume {args.lane}` picks it up")
            if args.json:
                print(json.dumps({"lane": args.lane, "state": "orphaned", "question": None}))
            else:
                print(message)
            return 1
        files = added = removed = 0
        repo = str(record.get("repo") or "")
        branch = str(record.get("branch") or "")
        if repo and branch:
            try:
                files, added, removed = _shortstat(repo, branch)
            except Exception:
                pass
        question = None
        if state == "waiting":
            q = read_json(lane_dir / "question.json")
            if isinstance(q, dict):
                question = {"id": q.get("id"), "title": q.get("title") or q.get("message") or ""}
        if args.json:
            payload = {"lane": args.lane, "state": state, "files": files,
                       "insertions": added, "deletions": removed,
                       "closed": bool(record.get("closed_at")), "question": question}
            print(json.dumps(payload, ensure_ascii=False))
        elif state != seen_printed:
            # One line per state change: a poll loop that repeats itself is noise in an agent's context.
            seen_printed = state
            if question is not None:
                print(f"{args.lane}: waiting — {question['title']}")
            elif state == "done":
                print(f"{args.lane}: done — {files} files +{added} -{removed}")
            else:
                print(f"{args.lane}: {state}")
        if question is not None:
            return 3
        if state in ("done", "failed", "stopped", "cancelled", "error") or record.get("closed_at"):
            return 0 if state == "done" or record.get("closed_at") else 1
        if deadline is not None and time.monotonic() > deadline:
            print(f"{args.lane}: timeout after {args.timeout}s in state {state}", file=sys.stderr)
            return 124
        time.sleep(args.interval)
