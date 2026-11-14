def run_review(lane_dir: Path, record: dict, lane: str) -> dict | None:
    """One read-only pass over the lane by a critic on another model.

    The lane's own model carries the author's blind spots; this one reads the brief, the diff and the
    lane's claim, and reports only what breaks. It is billed into `review.usage`, never into the lane.
    """
    worktree = Path(str(record.get("worktree") or ""))
    repo = str(record.get("repo") or "")
    branch = str(record.get("branch") or "")
    if not worktree.is_dir() or not repo:
        return None
    base = str(record.get("base_sha") or "")
    if not base:
        rc, out, _ = _git(repo, "merge-base", _default_branch(repo), branch)
        if rc == 0 and out:
            base = out
    rc, diff, err = _git(str(worktree), "diff", base or "HEAD")
    if rc != 0:
        print(f"{lane}: review — git says: {err}", file=sys.stderr)
        return None
    if not diff.strip():
        # Nothing to read is not a finding, and it must not deadlock the close: record an honest skipped
        # review so `hand` and `close --auto` see that the critic looked and found no work to judge.
        print(f"{lane}: review — no diff against {str(base)[:7] or 'HEAD'}; skipped", file=sys.stderr)
        payload = {"status": "skipped", "p0": [], "p1": [], "notes": ["the lane changed nothing"],
                   "provider": DEFAULT_REVIEW_PROVIDER, "model": "none", "seconds": 0,
                   "usage": {"input": 0, "output": 0, "cache_read": 0, "cost_usd": 0.0, "turns": 0},
                   "at": int(time.time())}
        (lane_dir / "review.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
                                              encoding="utf-8")
        record["review"] = payload
        record["review_status"] = "skipped"
        write_record(lane_dir, record)
        return payload
    rc, status, _ = _git(str(worktree), "status", "--porcelain")
    if len(diff) > 60000:
        diff = diff[:60000] + "\n… diff cut at 60000 characters\n"
    # The critic cannot judge a criterion it cannot find. Hand it the id, the test named for it and the
    # line, plus the hidden acceptance when one ran: a name in a test proves a trace, not a proof.
    facts = lane_facts(lane, record)
    acs_map = facts.get("acs") or {}
    if acs_map.get("declared"):
        lines = []
        for ac_id in acs_map["declared"]:
            where = (acs_map.get("where") or {}).get(ac_id)
            if where:
                lines.append(f"  {ac_id}: {where}")
            elif ac_id in (acs_map.get("unproven") or []):
                lines.append(f"  {ac_id}: MENTIONED ONLY at {(acs_map.get('mentioned') or {}).get(ac_id)}")
            else:
                lines.append(f"  {ac_id}: no proof")
        acs_text = "\n".join(lines)
    else:
        acs_text = "(the lane declares none)"
    hold = record.get("holdout") or {}
    if hold:
        failed = [item.get("name") for item in (hold.get("scenarios") or []) if item.get("exit")]
        holdout_text = (f"{'green' if hold.get('ok') else 'RED'} at {str(hold.get('sha'))[:7]}, "
                        f"{len(hold.get('scenarios') or [])} scenario(s)"
                        + (f", failed: {', '.join(failed)}" if failed else "")
                        + f", folder {hold.get('dir')}")
    else:
        holdout_text = "(none was run for this plan)"

    prompt = REVIEW_PROMPT.format(
        brief=" ".join(str(record.get("task") or "").split())[:4000],
        touches=", ".join(record.get("touches") or []) or "(none declared)",
        acs=acs_text,
        holdout=holdout_text,
        result=json.dumps(record.get("result"), ensure_ascii=False) if record.get("result") else "(none)",
        claim=(json.dumps(record.get("verify_check"), ensure_ascii=False)
               if record.get("verify_check") else "(the gate has not run on this lane yet)"),
        status=status[:4000] or "(clean)",
        diff=diff or "(no changes against the base)",
    )
    provider = str(record.get("review_provider") or DEFAULT_REVIEW_PROVIDER)
    model = str(record.get("review_model") or DEFAULT_REVIEW_MODEL)
    load_env_keys()
    cmd = [
        "pi", "-p", "-nt", "--no-session", "--mode", "json",
        "--provider", provider, "--model", model, "--thinking", "low", prompt,
    ]
    started = time.monotonic()
    try:
        done = subprocess.run(
            cmd, capture_output=True, text=True, timeout=REVIEW_TIMEOUT,
            stdin=subprocess.DEVNULL, cwd=str(worktree), check=False,
        )
    except subprocess.TimeoutExpired:
        print(f"{lane}: review — the critic timed out after {REVIEW_TIMEOUT}s", file=sys.stderr)
        return None
    text = ""
    usage = {"input": 0, "output": 0, "cache_read": 0, "cost_usd": 0.0, "turns": 0}
    for line in done.stdout.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if event.get("type") != "message_end":
            continue
        message = event.get("message") or {}
        if message.get("role") != "assistant":
            continue
        said = assistant_text(event)
        if said:
            text = said
        raw = message.get("usage")
        if isinstance(raw, dict):
            usage["input"] += int(raw.get("input") or 0)
            usage["output"] += int(raw.get("output") or 0)
            usage["cache_read"] += int(raw.get("cacheRead") or 0)
            usage["cost_usd"] = round(usage["cost_usd"]
                                      + float((raw.get("cost") or {}).get("total") or 0), 6)
            usage["turns"] += 1
    review, review_status = parse_review(text)
    payload = {
        "status": review_status,
        "p0": (review or {}).get("p0") or [],
        "p1": (review or {}).get("p1") or [],
        "notes": (review or {}).get("notes") or [],
        "provider": provider,
        "model": model,
        "seconds": int(time.monotonic() - started),
        "usage": usage,
        "at": int(time.time()),
    }
    if review_status != "ok":
        payload["said"] = text[:2000]
    (lane_dir / "review.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
                                          encoding="utf-8")
    record["review"] = payload
    record["review_status"] = review_status
    write_record(lane_dir, record)
    return payload


def normalise_touch(pattern: str) -> str:
    """One declared write-set as a repository-relative glob."""
    cleaned = str(pattern or "").strip().replace("\\\\", "/")
    while cleaned.startswith("./"):
        cleaned = cleaned[2:]
    return cleaned.lstrip("/")


def touch_overlap(left: list, right: list) -> list:
    """The globs of two lanes that can name the same file. Worktrees stop write races, not semantics."""
    hits: set = set()
    for first in left:
        for second in right:
            if first == second:
                hits.add(first)
                continue
            plain_first = first.rstrip("*").rstrip("/")
            plain_second = second.rstrip("*").rstrip("/")
            if not plain_first or not plain_second:
                continue
            if plain_first.startswith(plain_second) or plain_second.startswith(plain_first):
                hits.add(first if len(first) <= len(second) else second)
    return sorted(hits)


def dry_merge(argv: list) -> int:
    """Merge branches in memory with `git merge-tree` and report what would conflict.

    A real merge of a lane whose sibling touched the same lines either conflicts or, worse, drops one
    side's reasoning. This answers the question before anything lands.
    """
    parser = argparse.ArgumentParser(prog="pi-lane dry-merge")
    parser.add_argument("lanes", nargs="+")
    args = parser.parse_args(argv)
    records = []
    for name in args.lanes:
        record = read_json(hermes_home() / "lanes" / name / "lane.json")
        if record is None:
            print(f"no such lane: {name}", file=sys.stderr)
            return 1
        records.append(record)
    repos = {str(r.get("repo") or "") for r in records}
    if len(repos) != 1:
        print("dry-merge: lanes come from different repositories", file=sys.stderr)
        return 1
    repo = repos.pop()
    if not repo:
        print("dry-merge: a lane has no repository", file=sys.stderr)
        return 1
    conflicts = 0
    pairs = [(records[0].get("branch"), "HEAD")]
    for previous, following in zip(records, records[1:]):
        pairs.append((previous.get("branch"), following.get("branch")))
    
    for first, second in pairs:
        done = subprocess.run(
            ["git", "-C", repo, "merge-tree", "--write-tree", str(first), str(second)],
            capture_output=True, text=True, check=False,
        )
        label = f"{first} into {second}"
        if done.returncode == 0:
            print(f"clean     {label}")
            continue
        conflicts += 1
        names = sorted({
            line.split(" in ")[-1].strip()
            for line in done.stdout.splitlines()
            if line.startswith("CONFLICT")
        })
        print(f"CONFLICT  {label}" + (f": {', '.join(names[:8])}" if names else ""))
        for line in done.stdout.splitlines():
            if line.startswith("CONFLICT"):
                print(f"          {line}")
    return 1 if conflicts else 0
