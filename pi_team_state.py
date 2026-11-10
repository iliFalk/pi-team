"""Shared state between the plugin entry point and its dashboard API.

Both halves live in one plugin process: ``register()`` runs in the plugin host,
and the dashboard router is imported into that same host. This module is the one
place they meet, so neither half has to reach into the other's module table.
"""

from __future__ import annotations

from typing import Any

# Set by ``register()``. ``None`` until the plugin is loaded, and ``None`` again
# if the host dropped the context — every caller treats that as "no chat here".
ctx: Any = None

__all__ = ["ctx"]
