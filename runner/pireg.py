#!/usr/bin/env python3
"""pireg — the pi-team registry: projects and their features.

Projects and features exist before any lane runs, because Ilja names them
top-down: project → feature → lanes. Lanes live in $HERMES_HOME/lanes/<lane>/
and point back here by project and feature name.

    ~/.hermes/plugin-data/pi-team/projects.json

    {"version": 1, "projects": {"<project>": {
        "repo": "/home/ilja/work/<project>", "remote": "...", "created": <epoch>,
        "features": {"<feature>": {"title": "...", "created": <epoch>}}}}}
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any, Dict, Optional

DEFAULT_ROOT = Path.home() / "work"


def hermes_home() -> Path:
    return Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")


def registry_path() -> Path:
    return hermes_home() / "plugin-data" / "pi-team" / "projects.json"


def load() -> Dict[str, Any]:
    path = registry_path()
    if not path.is_file():
        return {"version": 1, "projects": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except (OSError, ValueError):
        return {"version": 1, "projects": {}}
    if not isinstance(data, dict) or not isinstance(data.get("projects"), dict):
        return {"version": 1, "projects": {}}
    return data


def save(data: Dict[str, Any]) -> None:
    path = registry_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def project(data: Dict[str, Any], name: str) -> Optional[Dict[str, Any]]:
    entry = data.get("projects", {}).get(name)
    return entry if isinstance(entry, dict) else None


def add_project(name: str, repo: str, remote: str = "") -> Dict[str, Any]:
    data = load()
    projects = data.setdefault("projects", {})
    entry = projects.get(name) if isinstance(projects.get(name), dict) else {}
    entry.setdefault("features", {})
    entry["repo"] = repo
    if remote:
        entry["remote"] = remote
    entry.setdefault("created", int(time.time()))
    # A registered path means the clone exists: the placeholder is done.
    entry.pop("state", None)
    projects[name] = entry
    save(data)
    return entry


def add_feature(name: str, feature: str, title: str = "") -> Dict[str, Any]:
    data = load()
    entry = project(data, name)
    if entry is None:
        raise KeyError(f"unknown project: {name}")
    features = entry.setdefault("features", {})
    item = features.get(feature) if isinstance(features.get(feature), dict) else {}
    item["title"] = title or item.get("title") or feature
    item.setdefault("created", int(time.time()))
    features[feature] = item
    save(data)
    return item


def _feature(data: Dict[str, Any], name: str, feature: str) -> Optional[Dict[str, Any]]:
    entry = project(data, name)
    if entry is None:
        return None
    features = entry.get("features")
    if not isinstance(features, dict):
        return None
    item = features.get(feature)
    return item if isinstance(item, dict) else None


class ChatTaken(Exception):
    """The chat already belongs to another feature: a chat is one address, not a label."""

    def __init__(self, where: str) -> None:
        self.where = where
        super().__init__(where)


class ChatBusy(Exception):
    """The feature already has its chat; a second one would make the address ambiguous."""

    def __init__(self, session: str) -> None:
        self.session = session
        super().__init__(session)


def _owner_of(data: Dict[str, Any], session: str) -> Optional[tuple]:
    for project_name, project_entry in (data.get("projects") or {}).items():
        if not isinstance(project_entry, dict):
            continue
        for feature_name, feature_entry in (project_entry.get("features") or {}).items():
            if not isinstance(feature_entry, dict):
                continue
            for linked in feature_entry.get("sessions") or []:
                if isinstance(linked, dict) and linked.get("id") == session:
                    return project_name, feature_name
    return None


def link_session(
    project: str, feature: str, session: str, move: bool = False
) -> Dict[str, Any]:
    """Attach a chat to a feature. One chat per feature, and one feature per chat."""
    data = load()
    item = _feature(data, project, feature)
    if item is None:
        raise KeyError(f"unknown feature: {project}/{feature}")
    owner = _owner_of(data, session)
    if owner and owner != (project, feature):
        if not move:
            raise ChatTaken(f"{owner[0]}/{owner[1]}")
        previous = _feature(data, owner[0], owner[1])
        if isinstance(previous, dict):
            previous["sessions"] = [
                s
                for s in (previous.get("sessions") or [])
                if not (isinstance(s, dict) and s.get("id") == session)
            ]
    sessions = [s for s in (item.get("sessions") or []) if isinstance(s, dict)]
    if sessions and not any(s.get("id") == session for s in sessions):
        raise ChatBusy(str(sessions[0].get("id") or ""))
    if not any(s.get("id") == session for s in sessions):
        sessions.append({"id": session, "linked_at": int(time.time())})
    item["sessions"] = sessions
    save(data)
    return item


def unlink_session(project: str, feature: str, session: str) -> Dict[str, Any]:
    data = load()
    item = _feature(data, project, feature)
    if item is None:
        raise KeyError(f"unknown feature: {project}/{feature}")
    sessions = [s for s in (item.get("sessions") or []) if not (isinstance(s, dict) and s.get("id") == session)]
    item["sessions"] = sessions
    save(data)
    return item


def prepare_feature(name: str, text: str, session: str = "") -> tuple:
    """Create a feature the person asked for in one line, before the agent names it.

    It exists at once so the tree answers the click; the agent then gives it a name,
    a task and a lane. A placeholder never has lanes, so cancelling it is safe.
    """
    data = load()
    entry = project(data, name)
    if entry is None:
        raise KeyError(f"unknown project: {name}")
    slug = "prep-" + hashlib.sha1(f"{text}{time.time()}".encode()).hexdigest()[:6]
    clean = " ".join(text.split())
    item: Dict[str, Any] = {
        "title": (clean[:48] + "…") if len(clean) > 48 else clean,
        "created": int(time.time()),
        "state": "preparation",
        "request": text,
    }
    if session:
        item["sessions"] = [{"id": session, "linked_at": int(time.time())}]
    entry.setdefault("features", {})[slug] = item
    save(data)
    return slug, item


def cancel_preparation(name: str, feature: str) -> bool:
    """Drop a placeholder. Refuses once it has lanes: then it is a real feature."""
    data = load()
    item = _feature(data, name, feature)
    if item is None or item.get("state") != "preparation":
        return False
    del project(data, name)["features"][feature]
    save(data)
    return True


def finish_feature(name: str, feature: str, new_name: str, title: str = "") -> Dict[str, Any]:
    """Give a placeholder its real name. Lanes already filed under it move with it."""
    data = load()
    entry = project(data, name)
    if entry is None:
        raise KeyError(f"unknown project: {name}")
    features = entry.setdefault("features", {})
    item = features.get(feature)
    if not isinstance(item, dict):
        raise KeyError(f"unknown feature: {name}/{feature}")
    new_name = new_name or feature
    item["title"] = title or item.get("title") or new_name
    item.pop("state", None)
    if new_name != feature:
        features[new_name] = item
        del features[feature]
    save(data)
    if new_name != feature:
        home = hermes_home()
        for lane_file in sorted((home / "lanes").glob("*/lane.json")):
            try:
                lane = json.loads(lane_file.read_text())
            except (OSError, ValueError):
                continue
            if lane.get("project") == name and lane.get("group") == feature:
                lane["group"] = new_name
                lane_file.write_text(json.dumps(lane, indent=2) + "\n")
    return item


def prepare_project(name: str, remote: str, request: str = "") -> Dict[str, Any]:
    """Register a project the person asked for, before anything is on disk.

    The tree answers the click at once; the agent checks the repository, clones it and
    registers the path, which clears the placeholder.
    """
    data = load()
    projects = data.setdefault("projects", {})
    if name in projects:
        raise KeyError(f"project already exists: {name}")
    item: Dict[str, Any] = {
        "remote": remote,
        "features": {},
        "created": int(time.time()),
        "state": "preparation",
    }
    if request:
        item["request"] = request
    projects[name] = item
    save(data)
    return item


def cancel_project(name: str) -> bool:
    """Drop a placeholder project. Refuses as soon as it has a feature."""
    data = load()
    entry = project(data, name)
    if entry is None or entry.get("state") != "preparation":
        return False
    if entry.get("features"):
        return False
    del data["projects"][name]
    save(data)
    return True
