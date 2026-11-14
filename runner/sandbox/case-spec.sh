#!/usr/bin/env bash
# Prove the requirement layer: spec check / cover / tasks, lane acs, and the gate's refusal.
# Same stub pi as case.sh; zero provider spend.
set -u
SCR="$HOME/.hermes/cache/scratch/pi-gate-plan"
export HERMES_HOME="$SCR/home-spec"
export PATH="$SCR/bin:$PATH"
export STUB_ACS="AC1,AC2"
RUNNER="$HOME/.hermes/scripts/pi-lane"
REPO="$SCR/spec-repo"
fail=0
ok()  { echo "OK   $*"; }
bad() { echo "FAIL $*"; fail=1; }

pkill -f 'scripts/pi-lane (alpha|beta)' 2>/dev/null
sleep 0.5
rm -rf "$HERMES_HOME" "$REPO"
mkdir -p "$HERMES_HOME/lanes" "$REPO/spec" "$REPO/tests"

cd "$REPO" || exit 1
git init -q .; git config user.email t@t.t; git config user.name t
printf 'import unittest\n\n\nclass Ok(unittest.TestCase):\n    def test_ok(self):\n        self.assertTrue(True)\n' > tests/test_ok.py
cat > spec/requirements.md <<'MD'
# Requirements

AC1  WHEN `music sync` runs on a fixture tree THE SYSTEM SHALL print `added N, missing N, failed N`.
AC2  WHEN a track is already in the index THE SYSTEM SHALL NOT download it again.
AC3  WHILE the resolver fails THE SYSTEM SHALL record the reason and continue the batch.
MD
printf 'import unittest\n\n\nclass Must(unittest.TestCase):\n    def test_ac1_counts(self):\n        self.assertTrue(True)\n' > tests/test_must.py
git add -A && git commit -qm init

echo "== spec check"
"$RUNNER" spec check --repo "$REPO" && ok "valid requirements file accepted" || bad "check refused a valid file"
printf 'AC4  the parser is robust\n' > "$SCR/bad-req.md"
out=$("$RUNNER" spec check --repo "$REPO" --file "$SCR/bad-req.md" 2>&1); rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q "no SHALL" && ok "a criterion without SHALL is refused" || bad "check accepted: $out"
printf 'AC1  WHEN x THE SYSTEM SHALL y.\nAC1  WHEN z THE SYSTEM SHALL w.\n' > "$SCR/dup-req.md"
out=$("$RUNNER" spec check --repo "$REPO" --file "$SCR/dup-req.md" 2>&1)
echo "$out" | grep -q "already used" && ok "duplicate id refused" || bad "duplicate id accepted: $out"

echo "== spec cover"
out=$("$RUNNER" spec cover --repo "$REPO" 2>&1); rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q "AC2 *NOT COVERED" && echo "$out" | grep -q "coverage 1/3" \
  && ok "coverage names the two uncovered ids" || bad "cover: rc=$rc $out"
out=$("$RUNNER" spec cover --repo "$REPO" --acs AC1 2>&1); rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -q "coverage 1/1" && ok "--acs narrows to one lane's slice" || bad "cover --acs: rc=$rc $out"
printf 'AC2 named in a gate script\nAC3 recorded\n' > gate-probe.txt
mkdir -p gates && printf '#!/bin/sh\necho "checking AC2 and AC3"\ntrue\n' > gates/check.sh
out=$("$RUNNER" spec cover --repo "$REPO" 2>&1); rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -q "coverage 3/3" && ok "a gate script line counts as a proof" || bad "cover after gates/: rc=$rc $out"

echo "== a mention is not a proof"
printf 'import unittest\n\n\nclass Must(unittest.TestCase):\n    def test_other(self):  # AC3\n        self.assertTrue(True)\n' > "$REPO/tests/test_must.py"
rm -rf "$REPO/gates"
out=$("$RUNNER" spec cover --repo "$REPO" 2>&1); rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q "AC1 *MENTIONED\|AC1 *NOT COVERED" && echo "$out" | grep -q "AC3 *MENTIONED" \
  && ok "a comment naming the id does not cover it" || bad "comment counted as proof: rc=$rc $out"
printf 'import unittest\n\n\nclass Must(unittest.TestCase):\n    def test_ac1_counts(self):\n        self.assertTrue(True)\n    def test_ac3_recorded(self):\n        self.assertTrue(True)\n' > "$REPO/tests/test_must.py"
out=$("$RUNNER" spec cover --repo "$REPO" --acs AC1,AC3 2>&1); rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -q "coverage 2/2" && ok "the id in the test name covers it" || bad "named test not accepted: rc=$rc $out"

echo "== spec tasks"
cat > "$SCR/plan-spec.json" <<JSON
{"id": "spec-run", "repo": "$REPO",
 "gates": ["python3 -m unittest discover -s tests"],
 "lanes": [
   {"name": "alpha", "task": "write stub_alpha.txt", "touch": ["tests/test_must.py"], "acs": ["AC1"]},
   {"name": "beta", "task": "write stub_beta.txt", "touch": ["gates/check.sh"], "acs": ["AC2", "AC3"]}
 ]}
JSON
out=$("$RUNNER" spec tasks "$SCR/plan-spec.json" 2>&1); rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -q "| \`beta\` | \`gates/check.sh\` | AC2, AC3 |" && ok "tasks table generated from the plan" \
  || bad "spec tasks: rc=$rc $out"
"$RUNNER" spec tasks "$SCR/plan-spec.json" --write >/dev/null 2>&1; [ -f "$REPO/spec/tasks.md" ] && ok "tasks.md written" || bad "no tasks.md"
sed -i 's/"AC2", "AC3"/"AC2", "AC9"/' "$SCR/plan-spec.json"
out=$("$RUNNER" spec tasks "$SCR/plan-spec.json" 2>&1); rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q "AC9" && ok "unknown criterion refused before any lane" || bad "unknown id accepted: $out"
sed -i 's/"AC2", "AC9"/"AC2", "AC3"/' "$SCR/plan-spec.json"
git add -A && git -c user.email=t@t.t -c user.name=t commit -qm "requirements, gates, tests"

echo "== a lane that names criteria it does not prove"
rm -rf "$REPO"/gates "$REPO"/tests/test_must.py
out=$("$RUNNER" plan "$SCR/plan-spec.json" --timeout 120 2>&1); rc=$?
echo "$out" | grep -q "gates: 1" && ok "plan opened with the gates and the criteria" || bad "plan: rc=$rc $out"
"$RUNNER" wait --all alpha beta --timeout 120 >/dev/null
for l in alpha beta; do
  python3 - "$l" <<'PY' || bad "$l did not carry its acs"
import json, os, sys
rec = json.load(open(os.path.join(os.environ['HERMES_HOME'], 'lanes', sys.argv[1], 'lane.json')))
assert rec.get('state') == 'done', rec.get('state')
assert rec.get('acs'), rec.get('acs')
PY
done
ok "both lanes done and each record names its criteria"
for l in alpha beta; do git -C "$REPO/.worktrees/$l" add -A; git -C "$REPO/.worktrees/$l" -c user.email=t@t.t -c user.name=t commit -qm "lane $l"; done
git merge -q --no-ff lane/alpha lane/beta -m "merge lanes"
out=$("$RUNNER" gate --plan spec-run 2>&1); rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q "criteria not proven" && echo "$out" | grep -q "AC1" \
  && ok "gate refuses while a declared criterion is covered nowhere" || bad "gate: rc=$rc $out"
python3 - "$l" <<'PY'
import json, os
rec = json.load(open(os.path.join(os.environ['HERMES_HOME'], 'lanes', 'alpha', 'lane.json')))
assert not rec.get('checked_sha'), rec.get('checked_sha')
PY
ok "nothing was stamped"

echo "== proof added, gate passes"
mkdir -p "$REPO/tests"
printf 'import unittest\n\n\nclass Must(unittest.TestCase):\n    def test_ac1_counts(self):  # AC1\n        self.assertTrue(True)\n    def test_ac2_index(self):  # AC2\n        self.assertTrue(True)\n    def test_ac3_resolver(self):  # AC3\n        self.assertTrue(True)\n' > "$REPO/tests/test_must.py"
git add -A && git -c user.email=t@t.t -c user.name=t commit -qm "the tests the criteria need"
"$RUNNER" gate --plan spec-run >"$SCR/gate.out" 2>&1; rc=$?
[ $rc -eq 0 ] && ok "gate --plan passes once every declared id is named" || bad "gate after proof: rc=$rc $(cat "$SCR/gate.out")"
"$RUNNER" digest alpha | grep -q "acs       1/1" && ok "digest prints the coverage" || bad "digest has no coverage line"
"$RUNNER" report | grep -q "acs 1/1" && ok "report prints coverage per lane" || bad "report has no coverage line"

echo "== plan refuses criteria it cannot find"
cat > "$SCR/plan-badacs.json" <<JSON
{"id": "bad-acs", "repo": "$REPO", "lanes": [{"name": "gamma", "task": "x", "acs": ["AC9"]}]}
JSON
out=$("$RUNNER" plan "$SCR/plan-badacs.json" 2>&1); rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q "AC9" && ok "plan refuses an id the requirements file lacks" || bad "plan accepted AC9: $out"
mkdir -p "$SCR/noreq" && (cd "$SCR/noreq" && git init -q . && git config user.email t@t.t && git config user.name t && echo x > a && git add -A && git commit -qm i)
cat > "$SCR/plan-noreq.json" <<JSON
{"id": "no-req", "repo": "$SCR/noreq", "lanes": [{"name": "delta", "task": "x", "acs": ["AC1"]}]}
JSON
out=$("$RUNNER" plan "$SCR/plan-noreq.json" 2>&1); rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q "holds none" && ok "plan refuses criteria without a requirements file" || bad "plan accepted: $out"

echo "== exit $fail"
exit $fail
