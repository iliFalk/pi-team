#!/usr/bin/env bash
# Prove the mutation check: a survivor is a hole, the tree is restored, and the close refuses without it.
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
cat > music.py <<'PY'
def add(a, b):
    return a + b


def is_adult(age):
    return age >= 18
PY
cat > tests/test_music.py <<'PY'
import unittest

import music


class Music(unittest.TestCase):
    def test_ac1_adds(self):
        self.assertEqual(music.add(2, 3), 5)
PY
git add -A && git commit -qm init
SHA=$(git rev-parse HEAD)

echo "== a survivor is a hole"
out=$("$RUNNER" mutate --repo "$REPO" --cmd "python3 -m unittest discover -s tests" --max 4 2>&1); rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q "mutation score 0/1" && ok "an untested branch survives and fails the check" \
  || bad "mutate: rc=$rc $out"
echo "$out" | grep -q "survivors: music.py:6" && ok "the survivor is named by file and line" || bad "no survivor named: $out"

echo "== the tree is untouched"
[ "$(git rev-parse HEAD)" = "$SHA" ] && [ -z "$(git status --porcelain)" ] && ok "the tree ends clean at the same sha" \
  || bad "the mutation run dirtied the tree"

echo "== a test that covers it turns the score green"
cat > tests/test_music.py <<'PY'
import unittest

import music


class Music(unittest.TestCase):
    def test_ac1_adds(self):
        self.assertEqual(music.add(2, 3), 5)

    def test_adult(self):
        self.assertTrue(music.is_adult(18))
        self.assertFalse(music.is_adult(17))
PY
git add -A && git -c user.email=t@t.t -c user.name=t commit -qm "test the boundary"
out=$("$RUNNER" mutate --repo "$REPO" --cmd "python3 -m unittest discover -s tests" --max 4 2>&1); rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -q "every sampled mutant killed" && ok "every sampled mutant is killed" || bad "green mutate: rc=$rc $out"

echo "== a dirty tree is refused"
echo "x = 1" >> music.py
out=$("$RUNNER" mutate --repo "$REPO" --cmd "true" 2>&1); rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q "tree is dirty" && ok "a dirty tree is refused" || bad "dirty: rc=$rc $out"
git checkout -- music.py

echo "== a plan that asks for it blocks the close"
printf '{"id": "mut-run", "repo": "%s", "mutation": true, "gates": ["python3 -m unittest discover -s tests"], "lanes": [{"name": "alpha", "task": "write stub_alpha.txt", "acs": ["AC1"]}]}\n' "$REPO" > "$SCR/plan.json"
"$RUNNER" plan "$SCR/plan.json" --timeout 120 >/dev/null 2>&1
"$RUNNER" wait --all alpha --timeout 120 >/dev/null 2>&1
git -C "$REPO/.worktrees/alpha" add -A 2>/dev/null
git -C "$REPO/.worktrees/alpha" -c user.email=t@t.t -c user.name=t commit -qm "lane alpha" 2>/dev/null
git -C "$REPO" merge -q --no-ff lane/alpha -m "merge alpha" 2>/dev/null
out=$("$RUNNER" close alpha --auto 2>&1); rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q "asks for a mutation check" && ok "close --auto refuses without the mutation check" \
  || bad "auto-close: rc=$rc $out"
"$RUNNER" mutate --plan mut-run --max 4 >/dev/null 2>&1; echo "mutate --plan rc=$?"
python3 - "$SCR" <<'PY' && ok "mutation_check sits on the lane record" || bad "no mutation_check on the record"
import json, os, sys
rec = json.load(open(os.path.join(sys.argv[1], "home/lanes/alpha/lane.json")))
mut = rec.get("mutation") or {}
assert mut.get("ok") is True, mut
assert mut.get("killed") == mut.get("total") >= 1, mut
PY

echo "== exit $fail"
exit $fail
