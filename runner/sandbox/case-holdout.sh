#!/usr/bin/env bash
# Prove the holdout: a scenario outside the repository, the refusals, and the record it writes.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SCR=$(mktemp -d)
export HERMES_HOME="$SCR/home"
export PATH="$SCR/bin:$PATH"
export STUB_ACS="AC1"
RUNNER="${PI_LANE:-$HOME/.hermes/scripts/pi-lane}"
REPO="$SCR/repo"
mkdir -p "$SCR/bin" "$HERMES_HOME/lanes" "$REPO/spec" "$REPO/tests"
cp "$HERE/pi" "$SCR/bin/pi"; chmod +x "$SCR/bin/pi"
echo "sandbox $SCR"
fail=0
ok()  { echo "OK   $*"; }
bad() { echo "FAIL $*"; fail=1; }

cd "$REPO" || exit 1
git init -q .; git config user.email t@t.t; git config user.name t
printf 'AC1  WHEN the pipeline runs THE SYSTEM SHALL write state/likes.json.\n' > spec/requirements.md
printf 'import unittest\n\n\nclass Ok(unittest.TestCase):\n    def test_ac1_writes(self):\n        self.assertTrue(True)\n' > tests/test_ok.py
git add -A && git commit -qm init
printf '{"id": "hold-run", "repo": "%s", "gates": ["true"], "lanes": [{"name": "alpha", "task": "write stub_alpha.txt", "acs": ["AC1"]}]}\n' "$REPO" > "$SCR/plan.json"

echo "== no scenarios, nothing recorded"
out=$("$RUNNER" holdout hold-run 2>&1); rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q "no scenario" && ok "an empty holdout folder is refused" || bad "empty holdout: rc=$rc $out"

"$RUNNER" plan "$SCR/plan.json" --timeout 120 >/dev/null 2>&1
"$RUNNER" wait --all alpha --timeout 120 >/dev/null

echo "== unmerged branch is refused"
mkdir -p "$HERMES_HOME/holdout/hold-run"
printf '#!/usr/bin/env python3\nimport sys\nprint("AC1 ok")\nsys.exit(0)\n' > "$HERMES_HOME/holdout/hold-run/01-ok.py"
git -C "$REPO/.worktrees/alpha" add -A
git -C "$REPO/.worktrees/alpha" -c user.email=t@t.t -c user.name=t commit -qm "lane alpha"
out=$("$RUNNER" holdout hold-run 2>&1); rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q "not merged" && ok "a scenario will not run beside unmerged work" || bad "unmerged: rc=$rc $out"

git -C "$REPO" merge -q --no-ff lane/alpha -m "merge alpha"

echo "== a failing scenario blocks the close"
printf '#!/usr/bin/env python3\nimport sys\nprint("AC1: no state/likes.json")\nsys.exit(1)\n' > "$HERMES_HOME/holdout/hold-run/02-fails.py"
out=$("$RUNNER" holdout hold-run 2>&1); rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q "holdout FAILED" && ok "a failing scenario fails the holdout" || bad "failing scenario: rc=$rc $out"
out=$("$RUNNER" close alpha --auto 2>&1); rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q "holdout failed" && ok "close --auto refuses on a failed holdout" || bad "auto-close: rc=$rc $out"

echo "== green holdout is recorded at HEAD"
rm "$HERMES_HOME/holdout/hold-run/02-fails.py"
"$RUNNER" holdout hold-run >"$SCR/out.txt" 2>&1; rc=$?
[ $rc -eq 0 ] && grep -q "holdout ok — 1 scenario(s)" "$SCR/out.txt" && ok "the holdout passes and names the sha" || bad "green holdout: rc=$rc $(cat "$SCR/out.txt")"
python3 - "$SCR" <<'PY' && ok "holdout_check sits on the lane record with HEAD" || bad "record has no holdout_check"
import json, os, subprocess, sys
home = sys.argv[1] + "/home"
rec = json.load(open(os.path.join(home, "lanes", "alpha", "lane.json")))
hold = rec.get("holdout") or {}
head = subprocess.run(["git", "-C", sys.argv[1] + "/repo", "rev-parse", "HEAD"],
                      capture_output=True, text=True).stdout.strip()
assert hold.get("ok") is True, hold
assert hold.get("sha") == head, (hold.get("sha"), head)
assert [s["name"] for s in hold["scenarios"]] == ["01-ok.py"], hold["scenarios"]
PY

echo "== the critic is handed the criteria map and the holdout"
"$RUNNER" gate alpha --cmd "python3 -m unittest discover -s tests" >/dev/null 2>&1
"$RUNNER" hand alpha >"$SCR/hand.txt" 2>&1; rc=$?
grep -q "critic" "$SCR/hand.txt" && ok "hand ran the critic" || bad "hand: rc=$rc $(tail -3 "$SCR/hand.txt")"
python3 - "$SCR" <<'PY' && ok "the critic saw the AC site and the holdout line" || bad "review.json has no map"
import json, os, sys
review = json.load(open(os.path.join(sys.argv[1], "home/lanes/alpha/review.json")))
notes = " ".join(review.get("notes") or [])
assert "AC1" in notes, notes
assert "holdout" in notes, notes
PY

echo "== a new commit makes the holdout stale"
git -C "$REPO" -c user.email=t@t.t -c user.name=t commit -q --allow-empty -m "after the holdout"
out=$("$RUNNER" close alpha --auto 2>&1); rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q "the holdout ran at" && ok "a holdout older than HEAD is refused" || bad "stale holdout: rc=$rc $out"

echo "== a finished run becomes one eval row"
"$RUNNER" eval add sandbox-case --task-file "$SCR/plan.json" --gate "true" >/dev/null 2>&1
out=$("$RUNNER" eval capture sandbox-case --repo "$REPO" --plan hold-run --wall 42 --orchestrator-usd 0.5 2>&1); rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -q "captured — pass" && ok "capture reads the lanes, the gates and the criteria" || bad "capture: rc=$rc $out"
python3 - "$SCR" <<'PY' && ok "the row carries cost, lanes, criteria and holdout" || bad "row is incomplete"
import json, os, sys
path = os.path.join(sys.argv[1], "home/eval/results.jsonl")
row = json.loads(open(path).read().strip().splitlines()[-1])
assert row["case"] == "sandbox-case", row
assert row["lanes"] == 1, row["lanes"]
assert row["pass"] is True, row["gates"]
assert row["criteria"]["declared"] == 1 and row["criteria"]["covered"] == 1, row["criteria"]
assert row["holdout"].get("ok") is True, row["holdout"]
assert row["orchestrator_usd"] == 0.5 and row["cost_usd"] >= 0.5, row["cost_usd"]
PY
out=$("$RUNNER" eval table 2>&1)
echo "$out" | grep -q "sandbox-case" && ok "eval table prints the row" || bad "table: $out"

echo "== exit $fail"
exit $fail
