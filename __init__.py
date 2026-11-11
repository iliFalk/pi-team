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

import os
import shutil
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


RUNNER = ("pi-lane", "pi-feature", "pi-team-demo", "pireg.py")
EXECUTABLE = ("pi-lane", "pi-feature", "pi-team-demo")


def install_runner() -> list[str]:
    """Place the lane runner in ``$HERMES_HOME/scripts`` on the first start.

    The runner is not a plugin entry point, so the plugin manager does not install it: without this
    copy a fresh install has a panel and no way to start a lane. Files that are already there are left
    alone — a local edit is not overwritten — and nothing outside ``scripts/`` is touched.
    """
    home = Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")
    target = home / "scripts"
    placed: list[str] = []
    source = _ROOT / "runner"
    try:
        target.mkdir(parents=True, exist_ok=True)
    except OSError:
        return placed
    for name in RUNNER:
        src = source / name
        dst = target / name
        if not src.is_file():
            continue
        try:
            if dst.is_file() and dst.read_bytes() == src.read_bytes():
                continue
            if dst.is_file():
                continue  # a copy that differs is the user's: never replace it
            shutil.copy2(src, dst)
            if name in EXECUTABLE:
                dst.chmod(dst.stat().st_mode | 0o111)
            placed.append(name)
        except OSError:
            continue
    return placed


def register(ctx: Any) -> None:
    """Keep the context for the dashboard API, publish the skill, place the runner."""
    pi_team_state.ctx = ctx
    if SKILL.is_file():
        try:
            ctx.register_skill("pi-coach", SKILL, description=SKILL_DESCRIPTION)
        except Exception:  # a skill that will not register must not take the panel down
            pass
    try:
        install_runner()
    except Exception:  # a read-only home must not take the panel down either
        pass


__all__ = ["register"]
