#!/usr/bin/env bash
# Prove `plan gates` + `gate --plan` against a stub pi. Zero provider spend, seconds of wall time.
# Expects: every line marked OK; a failure prints FAIL and the script stops.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SCR=$(mktemp -d)
export HERMES_HOME="$SCR/home"
export PATH="$SCR/bin:$PATH"
RUNNER="${PI_LANE:-$HOME/.hermes/scripts/pi-lane}"
REPO="$SCR/repo"
mkdir -p "$SCR/bin" "$HERMES_HOME/lanes" "$REPO/tests"
cp "$HERE/pi" "$SCR/bin/pi"; chmod +x "$SCR/bin/pi"
echo "sandbox $SCR"
fail=0
ok()   { echo "OK   $*"; }
bad()  { echo "FAIL $*"; fail=1; }


cd "$REPO" || exit 1
git init -q .
git config user.email t@t.t; git config user.name t
printf 'import unittest\n\n\nclass Ok(unittest.TestCase):\n    def test_ok(self):\n        self.assertTrue(True)\n' > tests/test_ok.py
printf 'placeholder\n' > README.md
git add -A && git commit -qm "init"

cat > "$SCR/plan.json" <<JSON
{
  "id": "sandbox-plan",
  "repo": "$REPO",
  "gates": ["python3 -m unittest discover -s tests", "test -f README.md"],
  "lanes": [
    {"name": "alpha", "task": "write stub_alpha.txt"},
    {"name": "beta",  "task": "write stub_beta.txt"}
  ],
  "waves": [["alpha", "beta"]]
}
JSON

echo "== plan opens both lanes and keeps the gates"
"$RUNNER" plan "$SCR/plan.json" --timeout 120 | tee "$SCR/plan.out"
grep -q "gates: 2, kept in" "$SCR/plan.out" && ok "plan printed the gate count and the snapshot path" \
  || bad "plan did not report its gates"
[ -f "$HERMES_HOME/plans/sandbox-plan/plan.json" ] && ok "snapshot written" || bad "no snapshot"

echo "== wait"
"$RUNNER" wait --all alpha beta --timeout 120 >/dev/null
for l in alpha beta; do
  state=$(python3 -c "import json,os;print(json.load(open(os.environ['HERMES_HOME']+'/lanes/$l/lane.json'))['state'])")
  plan=$(python3 -c "import json,os;print(json.load(open(os.environ['HERMES_HOME']+'/lanes/$l/lane.json')).get('plan'))")
  [ "$state" = done ] && [ "$plan" = sandbox-plan ] && ok "$l done, record carries plan sandbox-plan" \
    || bad "$l state=$state plan=$plan"
done

echo "== commit each slice, then gate refuses an unmerged branch"
for l in alpha beta; do
  git -C "$REPO/.worktrees/$l" add -A
  git -C "$REPO/.worktrees/$l" -c user.email=t@t.t -c user.name=t commit -qm "lane $l"
done
out=$("$RUNNER" gate --plan sandbox-plan 2>&1); rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q "not merged" && ok "unmerged lanes refused (exit $rc)" \
  || bad "unmerged gate did not refuse: rc=$rc $out"

echo "== merge, then gate --plan"
git merge -q --no-ff lane/alpha lane/beta -m "merge lanes"
"$RUNNER" gate --plan sandbox-plan; rc=$?
[ $rc -eq 0 ] && ok "gate --plan ran exit 0" || bad "gate --plan failed rc=$rc"
for l in alpha beta; do
  python3 - "$l" <<'PY' && ok "$l stamped with both plan commands" || bad "$l not stamped"
import json, os, sys
rec = json.load(open(os.path.join(os.environ['HERMES_HOME'], 'lanes', sys.argv[1], 'lane.json')))
assert rec.get('checked_sha'), rec
assert rec.get('gate_cmds') == ["python3 -m unittest discover -s tests", "test -f README.md"], rec.get('gate_cmds')
PY
done

echo "== negative cases"
"$RUNNER" gate --plan no-such-plan >/dev/null 2>&1; [ $? -eq 1 ] && ok "unknown plan -> exit 1" || bad "unknown plan did not exit 1"
"$RUNNER" gate --plan sandbox-plan alpha >/dev/null 2>&1; [ $? -eq 2 ] && ok "lanes and --plan together -> exit 2" || bad "mixing did not exit 2"

cat > "$SCR/plan-lane-gates.json" <<JSON
{"id": "bad-plan", "repo": "$REPO", "lanes": [{"name": "gamma", "task": "x", "gates": ["true"]}]}
JSON
out=$("$RUNNER" plan "$SCR/plan-lane-gates.json" 2>&1); rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q "carries gates" && ok "lane-level gates refused" || bad "lane-level gates accepted: $out"

cat > "$SCR/plan-nogates.json" <<JSON
{"id": "bare-plan", "repo": "$REPO", "lanes": [{"name": "delta", "task": "x"}]}
JSON
out=$("$RUNNER" plan "$SCR/plan-nogates.json" 2>&1); rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -q "gates: none" && ok "a plan without gates still opens" \
  || bad "plan without gates: $out"
out=$("$RUNNER" gate --plan bare-plan 2>&1); rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q "at least one --cmd" && ok "plan without gates -> refused" \
  || bad "gate on a gateless plan did not refuse: rc=$rc $out"

echo "== exit $fail"
exit $fail
