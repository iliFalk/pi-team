# runner/sandbox — prove a runner change for zero dollars

`pi` and `pf` here are **stubs**.

- `pi` answers one assistant turn whose last line is a valid `RESULT`, writes one file into the worktree,
  then waits like a real RPC server until it is terminated. No provider, no key, no tokens.
- `pf` answers one `pf session` call and returns. It implements the contract the layer depends on — the
  argv, the two files it projects (`lane.json`, `events.jsonl`), and `answer.json` for a question — and
  nothing else. Its knobs are described at the top of the file.

Put the stub directory first on `PATH` and the runner drives it like the real thing.

```sh
bash runner/sandbox/case-plan-gate.sh     # plan gates + gate --plan + the refusals
bash runner/sandbox/case-spec.sh          # spec check/cover/tasks + a lane's criteria + the gate refusal
bash runner/sandbox/case-executor-pf.sh   # the durable executor path, `--executor pf`
bash runner/sandbox/case-close-receipt.sh # what a receipt says about the merge it names
```

Every script makes its own `mktemp` directory (`sandbox …` printed on the first line), starts with
`HERMES_HOME` inside it and never touches `~/.hermes`. `PI_LANE=<path>` runs a different copy of the
runner, which is how a change is proven before it is installed.

The stub's `RESULT` carries `acs` when `STUB_ACS` is set (`STUB_ACS=AC1,AC2`), which is what the
criteria cases need. `pf` knobs travel in `stub_pf.json` beside the stub, not in the environment: the
layer hands a child a minimal environment, so an export never arrives.

`case-executor-pf.sh` covers what only the executor path can break: the argv `pf session` receives, the
fields the layer copies back from the executor's record, the repair turn when a durable turn settles
without a `RESULT` line, a question parked and answered through `pi-lane answer`, a `stop_reason`, and
`resume` calling the executor with `--mode resume` instead of a second open.

`case-close-receipt.sh` covers the receipt's merge attribution: three lanes, two merged by hand and one
by `close`, and every receipt must name its own merge commit, its own subject and its own file count. It
exists because all three once named the last lane's merge and one counted a neighbour's file.

A real lane costs money and minutes; these four spend seconds. Three defects were found here that no
syntax check could see: a `select` + `readline` loop that lost the second event of a burst, a
`wait --all` that read a missing record as finished, a receipt that named another lane's merge, and —
on the executor path — a repair turn nobody had a test for.
