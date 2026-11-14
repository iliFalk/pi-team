def assistant_texts(lane_dir) -> list:
    """The lane's own final texts, oldest first, read from the tail of its event stream."""
    path = Path(lane_dir) / "events.jsonl"
    out: list = []
    try:
        lines = path.read_text(errors="replace").splitlines()[-400:]
    except OSError:
        return out
    for line in lines:
        try:
            event = json.loads(line)
        except Exception:
            continue
        if isinstance(event, dict) and event.get("type") == "message_end":
            text = assistant_text(event)
            if text and text.strip():
                out.append(text.strip())
    return out


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _git(repo: str, *args: str) -> tuple:
    done = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)
    return done.returncode, done.stdout.strip(), done.stderr.strip()


def _default_branch(repo: str) -> str:
    rc, out, _ = _git(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")
    if rc == 0 and out:
        return out.split("/", 1)[-1]
    for candidate in ("main", "master"):
        rc, _, _ = _git(repo, "rev-parse", "--verify", "--quiet", candidate)
        if rc == 0:
            return candidate
    return ""


def _shortstat(repo: str, sha: str) -> tuple:
    rc, out, _ = _git(repo, "show", "--shortstat", "--format=", sha)
    if rc != 0:
        return 0, 0, 0
    files = re.search(r"(\d+) files? changed", out)
    added = re.search(r"(\d+) insertions?\+?\)?", out)
    removed = re.search(r"(\d+) deletions?", out)
    return (
        int(files.group(1)) if files else 0,
        int(added.group(1)) if added else 0,
        int(removed.group(1)) if removed else 0,
    )


def pi_session_dir(worktree: Path) -> Path:
    """Where pi keeps the session of a lane: one folder per worktree path, encoded."""
    key = str(worktree.resolve()).lstrip("/").replace("/", "-")
    return Path.home() / ".pi" / "agent" / "sessions" / f"--{key}--"


def pi_session_files(worktree: Path, session_id: str) -> list:
    folder = pi_session_dir(worktree)
    if not folder.is_dir():
        return []
    return sorted(folder.glob(f"*_{session_id}.jsonl"))


def auto_answer(question: dict) -> tuple:
    """The runner's own reply to a dialog when the lane runs autonomously: `(payload, why)`.

    A lane that stops for a person costs waiting time; in `auto` it decides and the decision goes into
    its thread, so the choice can be audited instead of guessed. A destructive confirmation is always
    refused: nothing is deleted unattended.
    """
    method = str(question.get("method") or "")
    options = [str(option) for option in (question.get("options") or [])]
    text = " ".join(str(question.get(key) or "") for key in ("title", "message")).lower()
    if method == "select":
        pick = options[0] if options else ""
        return {"value": pick}, f"first option: {pick or '(none offered)'}"
    if method == "confirm":
        if any(word in text for word in DESTRUCTIVE_WORDS):
            nope = next((o for o in options if o.strip().lower() in ("no", "cancel", "abort")), "")
            return {"value": nope or "No"}, "refused — the dialog names a destructive action"
        yes = next((o for o in options if o.strip().lower() in ("yes", "ok", "continue", "allow")), "")
        return {"value": yes or "Yes"}, "allowed — nothing destructive in the dialog"
    return {"cancelled": True}, "no value supplied — the lane decides and states the assumption"


def lane_facts(name: str, record: dict) -> dict:
    """Everything a gate, a hand and a close must agree on, read once.

    The three verbs used to ask these questions in three places, and every defect of one afternoon came
    from that: a skipped review deadlocked the close, a stale claim was only checked in one verb, and a
    lane's own bill was lost because nobody looked. One reader means one answer.
    """
    repo = str(record.get("repo") or "")
    branch = str(record.get("branch") or f"lane/{name}")
    facts = {
        "repo": repo, "branch": branch, "head": "", "gate": "none", "gate_at": str(record.get("checked_sha") or ""),
        "result": str(record.get("result_status") or "missing"),
        "claim": "none", "claim_why": "",
        "review": str(record.get("review_status") or ""),
        "p0": len((record.get("review") or {}).get("p0") or []),
        "p1": len((record.get("review") or {}).get("p1") or []),
        "merged": False, "conflict": False, "dirty": 0,
        "acs": {"declared": [], "covered": [], "missing": [], "where": {}, "reported": [],
                "unreported": []},
    }
    if repo and Path(repo).is_dir():
        rc, head, _ = _git(repo, "rev-parse", "HEAD")
        if rc == 0 and head:
            facts["head"] = head
        if facts["gate_at"] and facts["head"]:
            facts["gate"] = "ok" if facts["gate_at"] == facts["head"] else "stale"
        elif facts["gate_at"]:
            facts["gate"] = "unconfirmed"
        rc, _, _ = _git(repo, "merge-base", "--is-ancestor", branch, "HEAD")
        facts["merged"] = rc == 0
        if not facts["merged"]:
            done = subprocess.run(["git", "-C", repo, "merge-tree", "--write-tree", "HEAD", branch],
                                  capture_output=True, text=True, check=False)
            facts["conflict"] = done.returncode != 0
    check = record.get("verify_check") or {}
    if check:
        facts["claim"] = "match" if check.get("match") else "mismatch"
        facts["claim_why"] = str(check.get("why") or "")
    worktree = str(record.get("worktree") or "")
    if worktree and Path(worktree).is_dir():
        rc, out, _ = _git(worktree, "status", "--porcelain")
        facts["dirty"] = len([line for line in out.splitlines() if line.strip()]) if rc == 0 else 0

    # Criteria: declared on the record, reported in the RESULT, proven by a test or a gate script.
    # Before the merge the proof can only live in the lane's own worktree, so that is where it is
    # looked for; after the merge the repository is the tree that counts, and so is the gate.
    declared = _ac_list(record.get("acs") or [])
    if declared:
        reported = _ac_list((record.get("result") or {}).get("acs") or [])
        root = repo if facts["merged"] else (worktree if worktree and Path(worktree).is_dir() else repo)
        summary = spec_summary(root, declared) if root and Path(root).is_dir() else {
            "covered": [], "missing": declared, "where": {}}
        facts["acs"] = {
            "declared": declared, "covered": summary["covered"], "missing": summary["missing"],
            "unproven": summary.get("unproven") or [], "mentioned": summary.get("mentioned") or {},
            "where": summary.get("where") or {}, "reported": reported,
            "unreported": [ac_id for ac_id in declared if ac_id not in reported],
            "root": root,
        }
    return facts


def lane_blockers(name: str, record: dict, stage: str, *, allow_missing_result: bool = False,
                  accept_claim: bool = False) -> list:
    """Why this lane cannot be filed (`hand`) or closed (`close`) yet. Empty list means it can."""
    facts = lane_facts(name, record)
    blockers = []
    if facts["gate"] == "none":
        blockers.append("no gate recorded — merge it and run `pi-lane gate`")
    elif facts["gate"] == "stale":
        blockers.append(f"the gate ran at {facts['gate_at'][:7]}, HEAD is {facts['head'][:7]}")
    elif facts["gate"] == "unconfirmed":
        blockers.append("the recorded gate sha cannot be checked against a HEAD")
    if facts["result"] != "ok" and not allow_missing_result:
        blockers.append("no valid RESULT — the lane's last text must end with RESULT: {\"files\": […], …}")
    if facts["claim"] == "mismatch" and not accept_claim:
        blockers.append(f"the verify claim does not match the gate — {facts['claim_why']}")
    acs = facts.get("acs") or {}
    if acs.get("missing"):
        blockers.append(f"criteria covered nowhere in {acs.get('root')}: {', '.join(acs['missing'])}")
    if acs.get("unproven"):
        sites = ", ".join(f"{ac_id} ({acs['mentioned'][ac_id]})" for ac_id in acs["unproven"])
        blockers.append(f"criteria mentioned but not proven: {sites} — the id belongs in the test's own "
                        "name, a comment is not a proof")
    if acs.get("unreported"):
        blockers.append(f"the RESULT names no {', '.join(acs['unreported'])} — its `acs` list must carry "
                        "every criterion the lane answers")
    if stage == "close":
        plan_id = str(record.get("plan") or "")
        hold = record.get("holdout") or {}
        if plan_id and not hold:
            blockers.append(f"no holdout for plan {plan_id} — write the scenarios in "
                            f"$HERMES_HOME/holdout/{plan_id}/ and run `pi-lane holdout {plan_id}`")
        elif plan_id and not hold.get("ok"):
            failed = [item.get("name") for item in (hold.get("scenarios") or []) if item.get("exit")]
            blockers.append(f"the holdout failed: {', '.join(failed) or 'no scenario ran'}")
        elif plan_id and facts["head"] and hold.get("sha") and hold["sha"] != facts["head"]:
            blockers.append(f"the holdout ran at {str(hold['sha'])[:7]}, HEAD is {facts['head'][:7]}")
        snapshot = read_json(hermes_home() / "plans" / plan_id / "plan.json") if plan_id else None
        if plan_id and (snapshot or {}).get("mutation"):
            mutant = record.get("mutation") or {}
            if not mutant:
                blockers.append(f"the plan asks for a mutation check — `pi-lane mutate --plan {plan_id}`")
            elif not mutant.get("ok"):
                blockers.append(f"the mutation score is {mutant.get('score')} — survivors: "
                                f"{', '.join(mutant.get('survivors') or [])}")
            elif facts["head"] and mutant.get("sha") and mutant["sha"] != facts["head"]:
                blockers.append(f"the mutation check ran at {str(mutant['sha'])[:7]}, HEAD is {facts['head'][:7]}")
        if facts["review"] not in ("ok", "skipped"):
            blockers.append("no critic review")
        elif facts["p0"]:
            blockers.append(f"the critic reported {facts['p0']} P0")
        if not facts["merged"] and facts["conflict"]:
            blockers.append("the merge would conflict")
    return blockers
