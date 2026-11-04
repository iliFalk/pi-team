"""pi-team — Hermes plugin entry point (stub).

This plugin exists so the dashboard backend (dashboard/plugin_api.py) is
discoverable and enableable via ``hermes plugins enable pi-team``. It registers
no agent tools; its payload is the lane API mounted under
/api/plugins/pi-team/ and read by the pi-team desktop panes.

Lanes are tmux sessions named ``pi-<lane>``; the worktree is the pane's current
directory. Nothing is stored here: tmux, git and ``.thinkrail/context/todos``
hold the state.
"""

from __future__ import annotations

import sys
import types
from typing import Any


def register(ctx: Any) -> None:
    """No agent tools or commands. The context is kept so the dashboard API can put a
    message into the live chat when a lane is handed over."""
    runtime = sys.modules.get("pi_team_runtime")
    if runtime is None:
        runtime = types.ModuleType("pi_team_runtime")
        sys.modules["pi_team_runtime"] = runtime
    runtime.ctx = ctx


__all__ = ["register"]
