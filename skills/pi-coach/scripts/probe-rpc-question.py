#!/usr/bin/env python3
"""Prove that a pi lane can ask the user a question on this machine.

    python3 probe-rpc-question.py [repo]

Starts `pi --mode rpc`, asks it to use `ask_user_question`, prints the request it sends, answers the
first dialog and reports whether the run continued. Run it in a throwaway repo; it spends one small
model call. Exit 0 means the dialog channel works.
"""

from __future__ import annotations

import json
import os
import pathlib
import select
import subprocess
import sys
import time

# The variable that holds each provider's key. The probe asks for one of them, never for all.
PROVIDER_KEYS = {
    "nvidia": "NVIDIA_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "opencode": "OPENCODE_API_KEY",
    "opencode-go": "OPENCODE_GO_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
}
DIALOG_METHODS = {"select", "confirm", "input", "editor"}
PROVIDER = os.environ.get("PROBE_PROVIDER", "nvidia")
MODEL = os.environ.get("PROBE_MODEL", "nvidia/nemotron-3.5-super-vl-120b-a12b")
TIMEOUT = 150


def load_key() -> None:
    """Put the probe provider's key into the process, through Hermes's secret scope.

    No file is read here: `agent.secret_scope.get_secret` is the one route to a key, and a key that
    already sits in the environment is left alone.
    """
    name = PROVIDER_KEYS.get(PROVIDER, "")
    if not name or (os.environ.get(name) or "").strip():
        return
    try:
        from agent.secret_scope import get_secret

        value = (get_secret(name) or "").strip()
    except Exception:
        return
    if value:
        os.environ[name] = value


def child_env() -> dict:
    """The environment the probe hands `pi`: a PATH, a HOME, a locale, the one key it needs."""
    env = {
        "PATH": os.environ.get("PATH") or "/usr/local/bin:/usr/bin:/bin",
        "HOME": os.environ.get("HOME") or str(pathlib.Path.home()),
        "LANG": os.environ.get("LANG") or "C.UTF-8",
        "GIT_TERMINAL_PROMPT": "0",
    }
    name = PROVIDER_KEYS.get(PROVIDER, "")
    value = (os.environ.get(name) or "").strip() if name else ""
    if value:
        env[name] = value
        if name == "OPENCODE_GO_API_KEY":
            env["OPENCODE_API_KEY"] = value
    return env


def main() -> int:
    repo = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    load_key()
    cmd = ["pi", "--mode", "rpc", "--no-session", "--provider", PROVIDER, "--model", MODEL,
           "--thinking", "low"]
    proc = subprocess.Popen(cmd, cwd=repo, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, bufsize=1, env=child_env())
    assert proc.stdin and proc.stdout
    proc.stdin.write(json.dumps({"type": "prompt", "message":
        "Use the ask_user_question tool: ask me to choose between option A and option B. Then stop."}) + "\n")
    proc.stdin.flush()

    deadline = time.time() + TIMEOUT
    asked = answered = resumed = False
    while time.time() < deadline:
        ready, _, _ = select.select([proc.stdout], [], [], 1.0)
        if not ready:
            if proc.poll() is not None:
                break
            continue
        line = proc.stdout.readline()
        if not line:
            break
        try:
            event = json.loads(line)
        except ValueError:
            continue
        kind = event.get("type")
        if kind == "extension_ui_request" and event.get("method") in DIALOG_METHODS:
            asked = True
            print("request:", json.dumps({k: event.get(k) for k in
                                          ("method", "title", "message", "options")})[:500])
            options = event.get("options") or []
            value = options[1] if len(options) > 1 else (options[0] if options else "B")
            proc.stdin.write(json.dumps({"type": "extension_ui_response", "id": event.get("id"),
                                         "value": value}) + "\n")
            proc.stdin.flush()
            answered = True
            print("answered:", value)
        elif kind == "tool_execution_start" and answered:
            resumed = True
        elif kind == "agent_end":
            break

    try:
        proc.stdin.close()
    except OSError:
        pass
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()

    print(f"asked={asked} answered={answered} resumed={resumed}")
    if not asked:
        print("no dialog arrived: check the mode, the extension install, and the provider key")
        return 1
    return 0 if resumed else 1


if __name__ == "__main__":
    raise SystemExit(main())
