def main() -> int:
    if len(sys.argv) > 2 and sys.argv[1] == "wait" and "--all" in sys.argv[2:]:
        return wait_all(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "reap":
        return reap(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "resume":
        return resume_lane(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "plan":
        return plan(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "spec":
        return spec(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "report":
        return report(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "status":
        return status(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "ledger":
        return ledger(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "dry-merge":
        return dry_merge(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "budget":
        return set_budget(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "review":
        return review_queue(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "digest":
        return digest_lane(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "gate":
        return gate_lanes(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "wait":
        return wait_lane(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "hand":
        return hand_lane(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "answer":
        return answer_lane(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "list":
        return list_lanes(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "close":
        return close_lanes(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "check":
        return check_lane(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "say":
        return say_in_thread(sys.argv[2:])
    if len(sys.argv) > 2 and sys.argv[1] == "eval" and sys.argv[2] in ("add", "list", "run", "table"):
        sub = sys.argv[2]
        rest = sys.argv[3:]
        return {"add": eval_add, "list": eval_list, "run": eval_run, "table": eval_table}[sub](rest)
    if len(sys.argv) > 1 and sys.argv[1] == "continue":
        return continue_lane(sys.argv[2:])

    return open_lane(sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
