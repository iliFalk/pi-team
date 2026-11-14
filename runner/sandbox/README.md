# runner/sandbox — prove a runner change for zero dollars

`pi` here is a **stub**: it answers one assistant turn whose last line is a valid `RESULT`, writes one
file into the worktree, then waits like a real RPC server until it is terminated. No provider, no key,
no tokens. Put it first on `PATH` and the runner drives it like the real thing.

```sh
bash runner/sandbox/case-plan-gate.sh     # plan gates + gate --plan + the refusals
bash runner/sandbox/case-spec.sh          # spec check/cover/tasks + a lane's criteria + the gate refusal
```

Both scripts make their own `mktemp` directory (`sandbox …` printed on the first line), start with
`HERMES_HOME` inside it and never touch `~/.hermes`. `PI_LANE=<path>` runs a different copy of the
runner, which is how a change is proven before it is installed.

The stub's `RESULT` carries `acs` when `STUB_ACS` is set (`STUB_ACS=AC1,AC2`), which is what the
criteria cases need.

A real lane costs money and minutes; these two spend seconds. Two defects were found here that no
syntax check could see: a `select` + `readline` loop that lost the second event of a burst, and a
`wait --all` that read a missing record as finished.
