"""pi-team — Hermes plugin entry point (stub).

This plugin exists so the dashboard backend (dashboard/plugin_api.py) is
discoverable and enableable via ``hermes plugins enable pi-team``. It registers
no agent tools; its payload is the lane API mounted under
/api/plugins/pi-team/ and read by the pi-team desktop panes.

A lane is a git worktree plus one headless ``pi`` run, recorded on disk by
``~/.hermes/scripts/pi-lane`` under ``$HERMES_HOME/lanes/<lane>``. Nothing is
kept in this plugin: the lane directories, git and the registry under
``plugin-data/pi-team/`` hold the state.
"""

from __future__ import annotations

from typing import Any


def register(ctx: Any) -> None:
    """No agent tools, hooks or commands: the payload is the dashboard API."""
    return None


__all__ = ["register"]
