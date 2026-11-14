def _read_lines(fd: int, pending: bytes, timeout: float):
    """One OS read of a pi event pipe, split into whole lines.

    `select` answers for the OS pipe, never for what Python has already buffered. A pi that writes
    two events in one burst — the normal case at the end of a turn, `message_end` then `agent_end` —
    left the second line inside the reader's buffer while select reported the pipe empty, and the
    lane hung until its idle timeout with the work already done. Measured with a stub pi: the first
    read carried both lines, the loop saw one and waited. Reading the bytes here keeps one buffer
    and one truth: an incomplete tail stays in `pending` until its newline arrives.

    Returns (lines, pending, eof).
    """
    ready, _, _ = select.select([fd], [], [], timeout)
    if not ready:
        return [], pending, False
    chunk = os.read(fd, 65536)
    if not chunk:
        return [], b"", True
    *complete, pending = (pending + chunk).split(b"\n")
    return [raw.decode("utf-8", "replace") for raw in complete if raw.strip()], pending, False


def run_session(lane_dir: Path, record: dict, lane: str, worktree: Path, task: str, question_timeout: int,
                repair: bool = True) -> int:
    """One `pi --mode rpc` turn: the lane's first task or a continuation of its session.

    Budget: `record["budget"]` caps the whole lane across continuations — `max_usd` and `max_turns` per
    run, `idle_timeout` seconds without an event. A breach ends the run with state `stopped` and a
    `stop_reason`, so a lane that loops on a failing test cannot spend the night.
    """
    events_path = lane_dir / "events.jsonl"
    stderr_path = lane_dir / "stderr.txt"
    question_path = lane_dir / "question.json"
    answer_path = lane_dir / "answer.json"
    text = ""
    cmd = [
        "pi", "--mode", "rpc", "--session-id", record["session_id"],
        "--provider", record["provider"], "--model", record["model"], "--thinking", record.get("thinking") or DEFAULT_THINKING,
    ]
    text = ""
    exit_code = 0
    finished = False
    budget = record.get("budget") or {}
    autonomy = str(record.get("autonomy") or DEFAULT_AUTONOMY)
    max_usd = float(budget.get("max_usd") or 0)
    max_turns = int(budget.get("max_turns") or 0)
    idle_timeout = int(budget.get("idle_timeout") or 0)
    usage = dict(record.get("usage") or {
        "input": 0, "output": 0, "cache_read": 0, "cache_write": 0,
        "reasoning": 0, "cost_usd": 0.0, "turns": 0,
    })
    turns_here = 0
    stop_reason = ""

    with stderr_path.open("a", encoding="utf-8") as stderr_handle, events_path.open(
        "a", encoding="utf-8"
    ) as events:
        proc = subprocess.Popen(
            cmd, cwd=str(worktree), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=stderr_handle, text=True, bufsize=1,
        )
        assert proc.stdin is not None and proc.stdout is not None
        proc.stdin.write(json.dumps({"type": "prompt", "message": task}) + "\n")
        proc.stdin.flush()

        question: dict | None = None
        question_since = 0.0
        last_activity = time.monotonic()
        last_beat = time.monotonic()

        fd = proc.stdout.fileno()
        pending = b""
        while True:
            lines, pending, eof = _read_lines(fd, pending, POLL_SECONDS)
            if eof:
                break

            if time.monotonic() - last_beat >= 15:
                # Liveness without noise: `reap` and the panel tell a slow lane from a dead one by
                # the heartbeat and the pid, not by the last state change.
                record["heartbeat"] = int(time.time())
                write_record(lane_dir, record)
                last_beat = time.monotonic()

            for line in lines:
                last_activity = time.monotonic()
                if _keep_event(line + "\n"):
                    events.write(line + "\n")
                    events.flush()
                try:
                    event = json.loads(line)
                except ValueError:
                    continue

                kind = event.get("type")
                if kind == "message_end":
                    said = assistant_text(event)
                    if said:
                        text = said
                    message = event.get("message") or {}
                    raw = message.get("usage")
                    if isinstance(raw, dict):
                        # The lane's own bill, kept with the record: the panel read it out of the
                        # session file, and nothing wrote it down, so a run could not be totalled.
                        turns_here += 1
                        usage["input"] += int(raw.get("input") or 0)
                        usage["output"] += int(raw.get("output") or 0)
                        usage["cache_read"] += int(raw.get("cacheRead") or 0)
                        usage["cache_write"] += int(raw.get("cacheWrite") or 0)
                        usage["reasoning"] += int(raw.get("reasoning") or 0)
                        usage["cost_usd"] = round(float(usage.get("cost_usd") or 0)
                                                  + float((raw.get("cost") or {}).get("total") or 0), 6)
                        usage["turns"] = int(usage.get("turns") or 0) + 1
                        record["usage"] = usage
                        write_record(lane_dir, record)
                        if max_usd and usage["cost_usd"] >= max_usd:
                            stop_reason = f"max_usd {usage['cost_usd']:.4f} >= {max_usd:g}"
                        elif max_turns and turns_here >= max_turns:
                            stop_reason = f"max_turns {turns_here} >= {max_turns}"
                elif kind == "extension_ui_request" and event.get("method") in DIALOG_METHODS:
                    dialog = {
                        "id": event.get("id"),
                        "method": event.get("method"),
                        "title": event.get("title") or "",
                        "message": event.get("message") or "",
                        "options": event.get("options") or [],
                        "asked_at": int(time.time()),
                    }
                    if autonomy == "auto":
                        reply, why = auto_answer(dialog)
                        reply.update({"type": "extension_ui_response", "id": dialog["id"]})
                        proc.stdin.write(json.dumps(reply) + "\n")
                        proc.stdin.flush()
                        record["auto_answers"] = int(record.get("auto_answers") or 0) + 1
                        write_record(lane_dir, record)
                        with (lane_dir / "thread.jsonl").open("a", encoding="utf-8") as handle:
                            handle.write(json.dumps({
                                "who": "jarvis", "at": int(time.time()),
                                "text": f"auto-answered {dialog['method']}: {why}",
                            }, ensure_ascii=False) + "\n")
                        print(f"{lane}: auto-answered {dialog['method']} — {why}", file=sys.stderr)
                    else:
                        question = dialog
                        question_since = time.monotonic()
                        question_path.write_text(json.dumps(question, indent=2) + "\n", encoding="utf-8")
                        record["state"] = "waiting"
                        write_record(lane_dir, record)
                elif kind == "agent_end":
                    finished = True

            if question is not None:
                if answer_path.exists():
                    try:
                        answer = json.loads(answer_path.read_text(encoding="utf-8"))
                    except (OSError, ValueError):
                        answer = {}
                    if answer.get("id") in (None, question["id"]):
                        payload: dict = {"type": "extension_ui_response", "id": question["id"]}
                        if answer.get("cancelled"):
                            payload["cancelled"] = True
                        else:
                            payload["value"] = str(answer.get("value", ""))
                        proc.stdin.write(json.dumps(payload) + "\n")
                        proc.stdin.flush()
                        question = None
                        question_path.unlink(missing_ok=True)
                        answer_path.unlink(missing_ok=True)
                        record["state"] = "running"
                        write_record(lane_dir, record)
                elif question_timeout and (time.monotonic() - question_since) > question_timeout:
                    proc.stdin.write(json.dumps({
                        "type": "extension_ui_response", "id": question["id"], "cancelled": True,
                    }) + "\n")
                    proc.stdin.flush()
                    question_path.unlink(missing_ok=True)
                    question = None
                    record["state"] = "running"
                    write_record(lane_dir, record)

            if stop_reason:
                break
            if (
                idle_timeout
                and question is None
                and not finished
                and (time.monotonic() - last_activity) > idle_timeout
            ):
                stop_reason = f"idle {idle_timeout}s without an event"
                break
            if finished or proc.poll() is not None:
                break

        # pi in RPC mode is a server: it stays alive after `agent_end`. Drain
        # whatever is already in the pipe, then stop it ourselves. Same byte reader as the loop,
        # so a line that arrived with the one we broke on is not lost.
        while True:
            lines, pending, eof = _read_lines(fd, pending, 0.2)
            if not lines or eof:
                break
            for line in lines:
                if _keep_event(line + "\n"):
                    events.write(line + "\n")
            events.flush()

        try:
            proc.stdin.close()
        except OSError:
            pass
        if proc.poll() is None:
            # A pi that exits on stdin EOF has a clean exit code coming; terminating it in that gap
            # recorded a finished lane as `failed`. Give the exit a moment before the signal.
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=10)

        exit_code = int(proc.returncode or 0)

    record["finished"] = int(time.time())
    record["exit"] = exit_code
    record["usage"] = usage
    result, result_status = parse_result(text)
    record["result"] = result
    record["result_status"] = result_status
    if result_status != "ok":
        print(f"{lane}: result {result_status} — a lane ends with a RESULT: {{\"files\": [...]}} line",
              file=sys.stderr)
    if stop_reason:
        record["stop_reason"] = stop_reason
        record["state"] = "stopped"
        print(f"{lane}: stopped — {stop_reason}", file=sys.stderr)
    else:
        record.pop("stop_reason", None)
        record["state"] = "done" if (exit_code == 0 and text) else "failed"
    write_record(lane_dir, record)
    question_path.unlink(missing_ok=True)
    if repair and result_status != "ok" and not stop_reason and exit_code == 0 and text:
        # One cheap turn beats a whole orchestrator round: the lane knows what it wrote, so it can turn its
        # last line into the object the hand expects. Measured: a lane wrote `RESULT: PASS` and the
        # orchestrator paid a continue and a turn to fix a format.
        record["result_repairs"] = int(record.get("result_repairs") or 0) + 1
        record["state"] = "running"
        record["finished"] = None
        write_record(lane_dir, record)
        print(f"{lane}: result {result_status} — asking the lane to rewrite that one line", file=sys.stderr)
        fix = ("Your last line must be exactly one line of JSON after the word RESULT:, for example "
               'RESULT: {"files": ["a.py"], "verify": {"cmd": "python3 -m unittest discover -s tests", '
               '"exit": 0}, "risks": [], "followups": []}. '
               "Change nothing else and run no command: reply with the corrected last line only, valid "
               "JSON, no code fence and no text after it.")
        return run_session(lane_dir, record, lane, worktree, fix, question_timeout, repair=False)
    return exit_code


def continue_lane(argv: list) -> int:
    """Add a task to a finished lane by running its own session again."""
    parser = argparse.ArgumentParser(prog="pi-lane continue")
    parser.add_argument("lane")
    parser.add_argument("text")
    parser.add_argument("--question-timeout", type=int, default=1800)
    args = parser.parse_args(argv)

    lane_dir = hermes_home() / "lanes" / args.lane
    record = read_json(lane_dir / "lane.json")
    if not record:
        print(f"no such lane: {args.lane}", file=sys.stderr)
        return 1
    if record.get("closed_at"):
        print(f"{args.lane}: closed — open a new lane instead", file=sys.stderr)
        return 1
    if str(record.get("state")) == "running" and pid_alive(record.get("pid")):
        print(f"{args.lane}: still running", file=sys.stderr)
        return 1
    budget = record.get("budget") or {}
    limit = float(budget.get("max_usd") or 0)
    spent = float((record.get("usage") or {}).get("cost_usd") or 0)
    if limit and spent >= limit:
        print(f"{args.lane}: budget spent — ${spent:.4f} of ${limit:g}; raise it with "
              f"`pi-lane budget {args.lane} --max-usd N` or close the lane", file=sys.stderr)
        return 1
    worktree = Path(str(record.get("worktree") or ""))
    if not worktree.is_dir():
        print(f"{args.lane}: its worktree is gone", file=sys.stderr)
        return 1

    with (lane_dir / "thread.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"who": "user", "at": int(time.time()), "text": args.text}, ensure_ascii=False) + "\n")

    record.pop("closed_at", None)
    record.pop("closed_reason", None)
    record["handed_at"] = None
    record["state"] = "running"
    record["pid"] = os.getpid()
    record["started"] = int(time.time())
    record["exit"] = None
    record["finished"] = None
    write_record(lane_dir, record)
    load_env_keys()
    print(f"{args.lane}: continuing")
    return run_session(lane_dir, record, args.lane, worktree, args.text, args.question_timeout)


def reap(argv: list) -> int:
    """Mark lanes whose runner is gone. A `running` record with a dead pid is a crash, not work.

    Nothing else marks it: the panel keeps drawing such a lane as running, and `wait` used to block on
    it forever. The state becomes `stopped` with a reason that names the cure, because a lane's pi
    session survives on disk and `pi-lane resume` continues it.
    """
    parser = argparse.ArgumentParser(prog="pi-lane reap")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    orphaned = []
    for record in lane_records():
        state = str(record.get("state") or "")
        if state not in ("running", "waiting"):
            continue
        if pid_alive(record.get("pid")):
            continue
        lane = str(record.get("lane") or "")
        if not lane:
            continue
        record["state"] = "stopped"
        record["orphaned_at"] = int(time.time())
        record["stop_reason"] = "runner gone — `pi-lane resume` continues it"
        write_record(hermes_home() / "lanes" / lane, record)
        orphaned.append(lane)
    if args.json:
        print(json.dumps({"orphaned": orphaned}))
    elif orphaned:
        for lane in orphaned:
            print(f"{lane}: orphaned — its runner is gone; `pi-lane resume {lane}` continues it")
    else:
        print("no orphaned lanes")
    return 0


def resume_lane(argv: list) -> int:
    """Pick up a lane whose runner died, in the same pi session.

    A crash leaves the record `running` with a dead pid and the worktree intact. pi keeps the session
    on disk under the lane's session id, so resuming sends the last prompt into that same conversation
    instead of paying for the context again. Budget and usage carry over.
    """
    parser = argparse.ArgumentParser(prog="pi-lane resume")
    parser.add_argument("lane")
    parser.add_argument("--question-timeout", type=int, default=1800)
    args = parser.parse_args(argv)
    lane_dir = hermes_home() / "lanes" / args.lane
    record = read_json(lane_dir / "lane.json")
    if record is None:
        print(f"no such lane: {args.lane}", file=sys.stderr)
        return 1
    if record.get("closed_at"):
        print(f"{args.lane}: closed — open a new lane instead", file=sys.stderr)
        return 1
    if pid_alive(record.get("pid")) and str(record.get("state")) in ("running", "waiting"):
        print(f"{args.lane}: still running (pid {record.get('pid')}) — nothing to resume", file=sys.stderr)
        return 1
    worktree = Path(str(record.get("worktree") or ""))
    if not worktree.is_dir():
        print(f"{args.lane}: its worktree is gone; open the slice again", file=sys.stderr)
        return 1
    prompt = str(record.get("task") or "")
    thread_path = lane_dir / "thread.jsonl"
    if thread_path.is_file():
        for line in thread_path.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if entry.get("who") == "user" and str(entry.get("text") or "").strip():
                prompt = str(entry["text"])
    if not prompt:
        print(f"{args.lane}: no prompt to resume", file=sys.stderr)
        return 1
    with thread_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({
            "who": "jarvis", "at": int(time.time()),
            "text": f"resumed after the runner was gone (was {record.get('state')})",
        }, ensure_ascii=False) + "\n")
    record["state"] = "running"
    record["pid"] = os.getpid()
    record["started"] = int(time.time())
    record["resumed_at"] = int(time.time())
    record["exit"] = None
    record["finished"] = None
    record.pop("stop_reason", None)
    record.pop("orphaned_at", None)
    write_record(lane_dir, record)
    load_env_keys()
    print(f"{args.lane}: resumed in session {record.get('session_id')}")
    return run_session(lane_dir, record, args.lane, worktree, prompt, args.question_timeout)
