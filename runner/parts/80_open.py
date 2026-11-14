def open_lane(argv: list) -> int:
    parser = argparse.ArgumentParser(
        prog="pi-lane",
        epilog=(
            "verbs with the lane lifecycle: pi-lane wait <lane> [--timeout S] [--json] (block until it finishes or asks), "
            "pi-lane wait --all [lane …] (block on several at once, 3 if any asks), "
            "pi-lane gate <lane …> --cmd \"…\" (run the gates in the MERGED tree and record the check), "
            "pi-lane review (print the review shelf instead of injecting it), pi-lane digest <lane> (a compact record), "
            "pi-lane hand <lane> (file for review), "
            "pi-lane check <lane> (record that its work was read), "
            "pi-lane close <lane> [--no-merge] [--yes|--auto], "
            "pi-lane say <lane> \"text\", pi-lane answer <lane> \"value\", pi-lane list, "
            "pi-lane report [--repo P] (what can close, what is blocked, what it cost), "
            "pi-lane status [--repo P] (gate, claim, critic and cost per lane), pi-lane ledger [lane …] (tokens and money per lane), "
            "pi-lane dry-merge <lane …> (branches merged in memory, conflicts named), "
            "pi-lane reap (mark lanes whose runner is gone), pi-lane resume <lane> (continue one in "
            "its own session), "
            "pi-lane budget <lane> [--max-usd N] [--max-turns N] [--idle-timeout S]"
        ),
    )
    parser.add_argument("lane")
    parser.add_argument("task")
    parser.add_argument("--repo", default="", help="repository path; resolved from the registry when omitted")
    parser.add_argument("--project", default="", help="registered project name")
    parser.add_argument("--feature", "--group", dest="feature", default="", help="feature name inside the project")
    parser.add_argument("--provider", default=DEFAULT_PROVIDER)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--thinking", default=DEFAULT_THINKING)
    parser.add_argument("--question-timeout", type=int, default=1800)
    parser.add_argument("--max-usd", type=float, default=DEFAULT_MAX_USD,
                        help="stop the lane when its bill reaches this many dollars (0 = no cap)")
    parser.add_argument("--max-turns", type=int, default=DEFAULT_MAX_TURNS,
                        help="stop the lane after this many assistant messages in one run (0 = no cap)")
    parser.add_argument("--idle-timeout", type=int, default=DEFAULT_IDLE_TIMEOUT,
                        help="stop the lane after this many seconds without an event (0 = no cap)")
    parser.add_argument("--touch", action="append", default=[], metavar="GLOB",
                        help="a path or glob this lane owns; repeatable. Two lanes in flight with an "
                             "intersecting write-set are refused")
    parser.add_argument("--allow-overlap", action="store_true",
                        help="let this lane start although a lane in flight names the same file")
    parser.add_argument("--review-provider", default=DEFAULT_REVIEW_PROVIDER,
                        help="which provider the critic at `hand` uses (another vendor by default)")
    parser.add_argument("--review-model", default=DEFAULT_REVIEW_MODEL)
    parser.add_argument("--plan", default="", help="the plan that opened this lane; `pi-lane plan` sets it")
    parser.add_argument("--autonomy", choices=("auto", "ask"), default=DEFAULT_AUTONOMY,
                        help="auto: the lane answers its own dialogs; ask: a dialog parks it in waiting")
    args = parser.parse_args(argv)

    if not LANE_RE.match(args.lane):
        fail(f"bad lane name: {args.lane}")

    # A brief is input tokens for this lane, every time. Show its size; a slice brief is under 2.5 KB.
    brief_bytes = len(args.task.encode("utf-8"))
    note = " — a slice brief is under 2500" if brief_bytes > 3000 else ""
    print(f"brief: {brief_bytes} bytes{note}", file=sys.stderr)

    project = args.project
    repo_path = args.repo
    if project:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import pireg  # noqa: E402

        entry = pireg.project(pireg.load(), project)
        if entry is None:
            fail(f"unknown project: {project} — register it with pi-project add")
        repo_path = str(entry.get("repo") or "")
        if not repo_path:
            fail(f"project {project} has no repo path")
    if not repo_path:
        fail("pass --project or --repo")
    repo = os.path.realpath(repo_path)
    if not Path(repo, ".git").exists():
        fail(f"not a git repo: {repo}")
    project = project or Path(repo).name
    if not any(
        os.access(os.path.join(folder, "pi"), os.X_OK)
        for folder in os.environ.get("PATH", "").split(os.pathsep)
        if folder
    ):
        fail("pi not found")

    load_env_keys()

    lane = args.lane
    worktree = Path(repo) / ".worktrees" / lane
    branch = f"lane/{lane}"

    # Guards: one running lane per name in a repository, and a warning when the
    # same feature already has a lane in flight. No lock files: the record and
    # its pid are the truth.
    in_flight: list = []
    for record in lane_records():
        running = str(record.get("state")) == "running" and pid_alive(record.get("pid"))
        if not running:
            continue
        if record.get("lane") == lane and record.get("repo") == repo:
            fail(f"lane {lane} is already running in {repo}")
        if record.get("repo") == repo and args.feature and record.get("group") == args.feature.strip():
            in_flight.append(str(record.get("lane")))
    if in_flight:
        print(
            f"pi-lane: note — feature {args.feature} already has a lane in flight: {', '.join(in_flight)}",
            file=sys.stderr,
        )

    # Declared write-sets: worktrees stop write races, not semantic ones. Two lanes in flight that
    # name the same file merge into a conflict, or the second silently replaces the first's reasoning.
    my_touches = [path for path in (normalise_touch(item) for item in args.touch) if path]
    if my_touches:
        for record in lane_records():
            if record.get("repo") != repo or record.get("lane") == lane:
                continue
            if str(record.get("state")) not in ("running", "waiting"):
                continue
            theirs = [normalise_touch(item) for item in (record.get("touches") or [])]
            shared = touch_overlap(my_touches, theirs)
            if not shared:
                continue
            message = (f"write-set overlaps lane {record.get('lane')}: {', '.join(shared[:6])} — "
                       f"a slice that must touch a shared file starts after that lane merges")
            if args.allow_overlap:
                print(f"pi-lane: warning — {message}", file=sys.stderr)
            else:
                fail(message + " (override with --allow-overlap)")
    lane_dir = hermes_home() / "lanes" / lane
    lane_dir.mkdir(parents=True, exist_ok=True)
    events_path = lane_dir / "events.jsonl"
    stderr_path = lane_dir / "stderr.txt"
    question_path = lane_dir / "question.json"
    answer_path = lane_dir / "answer.json"
    for stale in (question_path, answer_path):
        if stale.exists():
            stale.unlink()
    events_path.write_text("", encoding="utf-8")

    if not worktree.is_dir():
        created = False
        for extra in (["-b", branch], []):
            done = subprocess.run(
                ["git", "-C", repo, "worktree", "add", "-q", str(worktree), *extra],
                capture_output=True, text=True, check=False,
            )
            if done.returncode == 0:
                created = True
                break
        if not created:
            fail(f"git worktree add failed for {worktree}")
    ensure_excludes(repo)

    record = {
        "lane": lane,
        "task": args.task,
        "project": project,
        "group": args.feature.strip(),
        "repo": repo,
        "worktree": str(worktree),
        "branch": branch,
        "base_sha": _git(repo, "rev-parse", _default_branch(repo))[1] or "",
        "session_id": f"{Path(repo).name}-{lane}",
        "provider": args.provider,
        "model": args.model,
        "thinking": args.thinking,
        "state": "running",
        "pid": os.getpid(),
        "started": int(time.time()),
        "exit": None,
        "touches": my_touches,
        "review_provider": args.review_provider,
        "review_model": args.review_model,
        "autonomy": args.autonomy,
        "plan": args.plan or None,
        "budget": {
            "max_usd": args.max_usd,
            "max_turns": args.max_turns,
            "idle_timeout": args.idle_timeout,
        },
    }
    write_record(lane_dir, record)
    return run_session(lane_dir, record, lane, worktree, args.task, args.question_timeout)
