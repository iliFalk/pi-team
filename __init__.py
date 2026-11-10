"""pi-team — Hermes plugin entry point.

The panel's data comes from the dashboard backend (``dashboard/plugin_api.py``,
mounted under ``/api/plugins/pi-team/``). This module does two things:

* it hands the plugin context to that backend, so a panel button can put a
  message into the live chat;
* it registers the ``pi-coach`` procedure as a read-only skill, so one install
  gives the agent both the panel and the rules for running a lane.

Lanes are worktrees plus one headless ``pi`` run, recorded by
``~/.hermes/scripts/pi-lane``. Nothing is stored in the plugin: the lane
records, git and the pi session hold the state.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import pi_team_state  # noqa: E402  (the plugin's own module, beside this file)

SKILL = _ROOT / "skills" / "pi-coach" / "SKILL.md"
SKILL_DESCRIPTION = (
    "Run pi coding lanes: start one, answer its question, review what it wrote. "
    "The procedure the pi-team panel drives."
)


def register(ctx: Any) -> None:
    """Keep the context for the dashboard API and publish the pi-coach skill."""
    pi_team_state.ctx = ctx
    if SKILL.is_file():
        try:
            ctx.register_skill("pi-coach", SKILL, description=SKILL_DESCRIPTION)
        except Exception:  # a skill that will not register must not take the panel down
            pass


__all__ = ["register"]
