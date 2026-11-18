#!/usr/bin/env bash
# Prove the executor path — `pi-lane --executor pf` — against a stub `pf`. Zero provider spend.
#
# What it checks, one line each:
#   * the argv contract `pf session` receives (dir, worktree, lane, mode, provider, model, thinking, autonomy);
#   * the fields the layer copies back from the executor (usage, runs, submission_id, projected_count);
#   * the repair turn when a durable turn settles without a RESULT line;
#   * a question under `--autonomy ask`: `wait` returns 3, `answer` lands, the lane finishes;
#   * a `stop_reason` from the executor settles the lane as `stopped`;
#   * `resume` calls the executor with `--mode resume`, not a second open.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SCR=$(mktemp -d)
export HERMES_HOME="$SCR/home"
export PATH="$SCR/bin:$PATH"
RUNNER="${PI_LANE:-$(cd "$(dirname "$0")/.." && pwd)/pi-lane}"
REPO="$SCR/repo"
LOG="$SCR/pf.log"
mkdir -p "$SCR/bin" "$HERMES_HOME/lanes" "$REPO/tests"
cp "$HERE/pf" "$SCR/bin/pf"; chmod +x "$SCR/bin/pf"
echo "sandbox $SCR"
fail=0
ok()  { echo "OK   $*"; }
bad() { echo "FAIL $*"; fail=1; }
knobs() { printf '%s\n' "$1" > "$SCR/bin/stub_pf.json"; }
knobs '{"STUB_PF_LOG": "'"$LOG"'"}'

cd "$REPO" || exit 1
git init -q .
git config user.email t@t.t; git config user.name t
printf 'placeholder\n' > README.md
git add -A && git commit -qm "init"

state() { python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['state'])" "$HERMES_HOME/lanes/$1/lane.json"; }
field() { python3 -c "import json,sys;r=json.load(open(sys.argv[1]));print(r.get(sys.argv[2],''))" "$HERMES_HOME/lanes/$1/lane.json" "$2"; }

echo "== a lane runs on the stub executor"
"$RUNNER" alpha "write stub_alpha.txt" --repo "$REPO" --executor pf --autonomy auto >"$SCR/open.out" 2>&1
grep -q "durable turn done" "$SCR/open.out" && ok "the lane settled through the executor" || { bad "no durable turn"; sed 's/^/     /' "$SCR/open.out"; }
[ "$(state alpha)" = done ] && ok "state done" || bad "state $(state alpha)"
[ "$(field alpha result_status)" = ok ] && ok "RESULT parsed from the executor's events.jsonl" || bad "result_status $(field alpha result_status)"
[ "$(field alpha projected_count)" = 1 ] && ok "projected_count copied back" || bad "projected_count $(field alpha projected_count)"
python3 - "$LOG" <<'PY' && ok "argv contract: dir, worktree, lane, mode open, provider, model, thinking, autonomy" || bad "argv contract"
import json, sys
rows = [json.loads(line) for line in open(sys.argv[1])]
row = rows[0]
need = {"mode": "open", "lane": "alpha", "provider": "nvidia", "thinking": "medium", "autonomy": "auto"}
wrong = {k: (row.get(k), v) for k, v in need.items() if row.get(k) != v}
if not row.get("dir") or not row.get("worktree") or not row.get("model"):
    wrong["missing"] = row
print(json.dumps(wrong) if wrong else "ok")
sys.exit(1 if wrong else 0)
PY

echo "== a durable turn without a RESULT line gets one repair turn"
knobs '{"STUB_PF_LOG": "'"$LOG"'", "STUB_PF_NO_RESULT": "1"}'
"$RUNNER" bravo "write stub_bravo.txt" --repo "$REPO" --executor pf --autonomy auto >"$SCR/repair.out" 2>&1
calls=$(python3 -c "import json,sys;print(sum(1 for l in open(sys.argv[1]) if json.loads(l)['lane']=='bravo'))" "$LOG")
[ "$calls" = 2 ] && ok "two calls: the turn and the repair" || bad "$calls call(s), expected 2"
[ "$(field bravo result_repairs)" = 1 ] && ok "result_repairs 1" || bad "result_repairs $(field bravo result_repairs)"
[ "$(state bravo)" = done ] && ok "the repair produced a clean RESULT" || bad "state $(state bravo)"

echo "== --autonomy ask parks the lane, answer lands, the lane finishes"
knobs '{"STUB_PF_LOG": "'"$LOG"'", "STUB_PF_ASK": "1"}'
"$RUNNER" charlie "write stub_charlie.txt" --repo "$REPO" --executor pf --autonomy ask --question-timeout 90 >"$SCR/ask.out" 2>&1 &
opener=$!
sleep 3
"$RUNNER" wait charlie --timeout 10 >"$SCR/wait1.out" 2>&1; code=$?
[ "$code" = 3 ] && ok "wait answered 3 while the executor waits on a question" || bad "wait exit $code"
[ -f "$HERMES_HOME/lanes/charlie/question.json" ] && ok "question.json is the executor's" || bad "no question.json"
"$RUNNER" answer charlie "Yes" >"$SCR/answer.out" 2>&1
"$RUNNER" wait charlie --timeout 60 >/dev/null 2>&1
wait "$opener" 2>/dev/null
[ "$(state charlie)" = done ] && ok "answered, then done" || bad "state $(state charlie)"

echo "== a stop_reason from the executor settles the lane as stopped"
knobs '{"STUB_PF_LOG": "'"$LOG"'", "STUB_PF_STOP": "max_turns 1 >= 1"}'
"$RUNNER" delta "write stub_delta.txt" --repo "$REPO" --executor pf --autonomy auto >"$SCR/stop.out" 2>&1
[ "$(state delta)" = stopped ] && ok "state stopped" || bad "state $(state delta)"
[ "$(field delta stop_reason)" = "max_turns 1 >= 1" ] && ok "stop_reason carried from the record" || bad "stop_reason $(field delta stop_reason)"

echo "== resume calls the executor with --mode resume"
knobs '{"STUB_PF_LOG": "'"$LOG"'"}'
python3 - "$HERMES_HOME/lanes/alpha/lane.json" <<'PY'
import json, sys
path = sys.argv[1]
record = json.load(open(path))
record["state"] = "running"
record["pid"] = 999999
json.dump(record, open(path, "w"))
PY
"$RUNNER" resume alpha >"$SCR/resume.out" 2>&1
mode=$(python3 -c "
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if json.loads(l)['lane'] == 'alpha']
print(rows[-1]['mode'] if len(rows) > 1 else 'only-one-call')" "$LOG")
[ "$mode" = resume ] && ok "the second call carries --mode resume" || bad "mode $mode"
[ "$(state alpha)" = done ] && ok "resumed lane is done again" || bad "state $(state alpha)"

echo
if [ "$fail" = 0 ]; then echo "all OK — sandbox $SCR"; else echo "FAILURES — logs in $SCR"; fi
exit "$fail"
