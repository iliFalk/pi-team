# pi RPC mode: the headless host contract

`pi --mode rpc` turns the coding agent into a JSONL server on stdio. It is the only headless mode that
can ask the user a question, so any lane host should use it.

## Modes, and what each one can do

| Mode | Asks a question | Notes |
|---|---|---|
| default (TTY) | yes | needs a real terminal |
| `-p` / print | no — tool answers "UI not available" | cleanest for a one-shot pipe |
| `--mode json` | no | the old lane runner used this |
| `--mode rpc` | yes, to the host | line protocol on stdin/stdout; the host is the UI |

## Start and drive

```sh
pi --mode rpc --session-id <name> --provider <p> --model <m> --thinking <low|medium|high>
```

- Write commands to stdin as one JSON object per line.
- Prompt: `{"type":"prompt","message":"<task>"}`.
- Events arrive on stdout, also one JSON object per line. Append every line to an `events.jsonl`
  unchanged: that file is the record the pane and the verifier read.
- `--session-id` keeps continuity across runs; `--no-session` starts clean.

## Events worth handling

- `message_end` — a finished message; take the last one with `message.role == "assistant"` whose
  `content[]` has a `type: "text"` part. This is the lane's answer.
- `extension_ui_request` — an extension wants the user. `method` is `select`, `confirm`, `input`,
  `editor` (a question, blocks) or `notify` (fire-and-forget, does not block). A question carries `id`,
  `title`, optional `message`, and `options` for `select`.
- `agent_end` — the turn is over. **The process is not.** See below.

## Answering a question

```json
{"type":"extension_ui_response","id":"<id from the request>","value":"<chosen option string>"}
{"type":"extension_ui_response","id":"<id from the request>","cancelled":true}
```

The run resumes after the response for that id. `value` is the option string the request carried, not an
index.

## Host lifetime

RPC mode is a server, not a one-shot: after `agent_end` it waits for the next command and never exits by
itself. A host that blocks reading stdout until EOF hangs with the work already done, the record stuck at
`running` and `exit: null`. The correct order is: break on `agent_end` (or on the child exiting), drain
what is already buffered, close stdin, then `terminate()` and take the return code.

## Practical notes

- Read stdout with `select` and a short timeout, not blocking `readline` — the host must stay responsive
to answer files while the agent is quiet.
- Provider keys are not in the shell. A host loads `NVIDIA_API_KEY` and the other keys from
  `~/.hermes/.env` itself, and never prints a value.
- A project-local `.pi/mcp.json` or `.pi/prompts/` is ignored without `--approve`; a dead MCP server logs a
  warning on start and does not block the lane.
- `scripts/probe-rpc-question.py` starts a host against a throwaway repo and proves the dialog path on
  this machine before you wire anything into a plugin.
