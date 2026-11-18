#!/usr/bin/env bash
# Prove what a receipt says about the MERGE: whose commit it names, and how much the lane changed.
#
# The failure this case exists for, measured on 2026-11-18: three lanes were merged by hand (the
# documented order is merge, gate, hand) and then closed one by one. Every receipt recorded the base's
# current HEAD, so all three named the LAST lane's merge commit and its subject, and one lane's file count
# was its neighbour's. Zero dollars: both lanes run on the stub `pi`.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SCR=$(mktemp -d)
export HERMES_HOME="$SCR/home"
export PATH="$SCR/bin:$PATH"
RUNNER="${PI_LANE:-$(cd "$(dirname "$0")/.." && pwd)/pi-lane}"
REPO="$SCR/repo"
mkdir -p "$SCR/bin" "$HERMES_HOME/lanes" "$REPO/tests"
cp "$HERE/pi" "$SCR/bin/pi"; chmod +x "$SCR/bin/pi"
echo "sandbox $SCR"
fail=0
ok()  { echo "OK   $*"; }
bad() { echo "FAIL $*"; fail=1; }

cd "$REPO" || exit 1
git init -q .
git config user.email t@t.t; git config user.name t
printf 'import unittest\n\n\nclass Ok(unittest.TestCase):\n    def test_ok(self):\n        self.assertTrue(True)\n' > tests/test_ok.py
printf 'placeholder\n' > README.md
git add -A && git commit -qm "init"

# alpha and beta are merged BY HAND; gamma is left for `close` to merge itself.
for l in alpha beta gamma; do
  "$RUNNER" "$l" "write stub_$l.txt" --repo "$REPO" --autonomy auto >"$SCR/$l.out" 2>&1
done
"$RUNNER" wait --all alpha beta gamma >/dev/null 2>&1
for l in alpha beta; do
  git -C "$REPO/.worktrees/$l" add -A
  git -C "$REPO/.worktrees/$l" -c user.email=t@t.t -c user.name=t commit -qm "Lane $l"
  git -C "$REPO" merge -q --no-ff "lane/$l" -m "Merge lane $l"
done
for l in alpha beta gamma; do
  "$RUNNER" close "$l" --yes >"$SCR/close-$l.out" 2>&1
done

echo "== what the three receipts say"
python3 - "$HERMES_HOME/lanes/closed.jsonl" <<'PY'
import json, sys
rows = [json.loads(line) for line in open(sys.argv[1]) if line.strip()]
by = {row["lane"]: row for row in rows}
for name in ("alpha", "beta", "gamma"):
    row = by.get(name, {})
    print("     %-6s %s | %s | by %s | %s file(s) +%s" % (
        name, str(row.get("merge_sha"))[:7], row.get("merge_subject"),
        row.get("merged_by"), row.get("merge_files"), row.get("merge_insertions")))
sha = {name: by.get(name, {}).get("merge_sha") for name in by}
subject = {name: by.get(name, {}).get("merge_subject") for name in by}
files = {name: by.get(name, {}).get("merge_files") for name in by}
who = {name: by.get(name, {}).get("merged_by") for name in by}
problems = []
if len(set(sha.get(n) for n in ("alpha", "beta"))) != 2:
    problems.append("alpha and beta name the same merge commit")
if subject.get("alpha") != "Merge lane alpha" or subject.get("beta") != "Merge lane beta":
    problems.append("a receipt carries another lane's subject")
if who.get("alpha") != "orchestrator" or who.get("beta") != "orchestrator":
    problems.append("a hand-merged lane does not say merged_by orchestrator")
if who.get("gamma") != "close":
    problems.append("a lane merged by close does not say merged_by close")
if files.get("alpha") != 1 or files.get("beta") != 1:
    problems.append("a lane counts a file it did not write")
print("     problems:", problems or "none")
sys.exit(1 if problems else 0)
PY
[ $? -eq 0 ] && ok "each receipt names its own merge, its own subject and its own file" \
  || bad "receipt merge attribution"

echo
if [ "$fail" = 0 ]; then echo "all OK — sandbox $SCR"; else echo "FAILURES — logs in $SCR"; fi
exit "$fail"
