"""pi-team backend: headless pi lanes for the desktop panes.

A lane is a worktree plus one ``pi -p`` run, recorded by ``~/.hermes/scripts/pi-lane``:

    $HERMES_HOME/lanes/<lane>/lane.json      lane record: task, state, pid, session
    $HERMES_HOME/lanes/<lane>/events.jsonl   the raw pi JSON event stream
    $HERMES_HOME/lanes/<lane>/stderr.txt     stderr of the run

Nothing here starts work: the backend only reads. The panes show the lane state,
the last assistant text, usage, the git changes and the pi-todos plan.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, HTTPException

router = APIRouter()

# The registry's rules live with the CLI helpers; import them by path so the panel and
# `pi-feature` write the same file the same way.
_SCRIPTS = Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes") / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))
import pireg  # noqa: E402

TAIL_BYTES = 1024 * 1024
MAX_LANES = 64
TEXT_LIMIT = 4000
_INSERT_RE = re.compile(r"(\d+) insertions?\(\+\)")
_DELETE_RE = re.compile(r"(\d+) deletions?\(-\)")


# --------------------------------------------------------------------------- #
# paths and small helpers
# --------------------------------------------------------------------------- #

def _hermes_home() -> Path:
    env = os.environ.get("HERMES_HOME")
    return Path(env) if env else Path.home() / ".hermes"


def _lanes_root() -> Path:
    return _hermes_home() / "lanes"


def _read_json(path: Path) -> Optional[Dict[str, Any]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _tail_lines(path: Path, limit: int = TAIL_BYTES) -> List[str]:
    """Last ``limit`` bytes of a file, split into lines. Empty list when absent."""
    try:
        size = path.stat().st_size
        with path.open("rb") as handle:
            if size > limit:
                handle.seek(size - limit)
                handle.readline()  # drop the partial first line
            blob = handle.read()
    except OSError:
        return []
    return [line for line in blob.decode("utf-8", "replace").splitlines() if line.strip()]


def _pid_alive(pid: Any) -> bool:
    try:
        value = int(pid)
    except (TypeError, ValueError):
        return False
    if value <= 0:
        return False
    try:
        os.kill(value, 0)
    except OSError:
        return False
    return True


# --------------------------------------------------------------------------- #
# event stream
# --------------------------------------------------------------------------- #

def _text_of(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, list):
        return ""
    parts = [p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"]
    return "\n".join(p for p in parts if p).strip()


def _parse_events(lines: List[str]) -> Dict[str, Any]:
    """Last assistant text, last tool call, usage and turn count of the run."""
    text = ""
    tool = ""
    tool_detail = ""
    error = ""
    turns = 0
    usage: Dict[str, Any] = {}

    for line in lines:
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        kind = event.get("type")

        if kind == "auto_retry_start":
            error = str(event.get("errorMessage") or "retry")[:200]
            continue
        if kind != "message_end":
            continue

        message = event.get("message") or {}
        if message.get("role") != "assistant":
            continue

        turns += 1
        said = _text_of(message.get("content"))
        if said:
            text = said
        raw_usage = message.get("usage")
        if isinstance(raw_usage, dict):
            usage = {
                "input": raw_usage.get("input", 0),
                "output": raw_usage.get("output", 0),
                "cacheRead": raw_usage.get("cacheRead", 0),
                "total": (raw_usage.get("cost") or {}).get("total", 0),
            }
        for item in message.get("content") or []:
            if isinstance(item, dict) and item.get("type") == "tool_use":
                tool = str(item.get("name") or "")
                payload = item.get("input")
                if isinstance(payload, dict):
                    for key in ("command", "path", "file_path", "pattern", "query"):
                        if payload.get(key):
                            tool_detail = str(payload[key])[:160]
                            break

    return {
        "last_text": text[:TEXT_LIMIT],
        "last_tool": tool,
        "last_tool_detail": tool_detail,
        "last_error": error,
        "turns": turns,
        "usage": usage,
    }


# --------------------------------------------------------------------------- #
# git and plan
# --------------------------------------------------------------------------- #

def _run_git(worktree: str, *args: str) -> tuple[int, str]:
    import subprocess

    try:
        done = subprocess.run(
            ["git", "-C", worktree, *args],
            timeout=4.0,
            capture_output=True,
            text=True,
            check=False,
        )
        return done.returncode, done.stdout
    except (OSError, subprocess.SubprocessError):
        return 127, ""


def _status_lines(worktree: str) -> List[Dict[str, str]]:
    rc, out = _run_git(worktree, "status", "--porcelain")
    if rc != 0:
        return []
    rows: List[Dict[str, str]] = []
    for line in out.splitlines():
        if not line.strip():
            continue
        code = line[:2].strip() or "?"
        path = line[3:].strip()
        if path.startswith(".thinkrail/"):
            continue  # ephemeral lane scratch: the plan store, not work
        rows.append({"code": code, "path": path})
    return rows


def _diff_files(worktree: str) -> List[Dict[str, Any]]:
    """Per file counts against HEAD, biggest change first, untracked files included."""
    rows: List[Dict[str, Any]] = []
    rc, out = _run_git(worktree, "diff", "HEAD", "--numstat")
    if rc != 0:
        return rows
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        added, removed, path = parts
        if path.startswith(".thinkrail/"):
            continue
        rows.append({
            "path": path,
            "insertions": int(added) if added.isdigit() else 0,
            "deletions": int(removed) if removed.isdigit() else 0,
            "binary": added == "-",
        })
    rc_u, untracked = _run_git(worktree, "ls-files", "--others", "--exclude-standard")
    if rc_u == 0:
        for path in untracked.splitlines():
            path = path.strip()
            if not path or path.startswith(".thinkrail/"):
                continue
            try:
                with open(Path(worktree) / path, "r", encoding="utf-8", errors="replace") as handle:
                    lines = sum(1 for _ in handle)
            except OSError:
                lines = 0
            rows.append({"path": path, "insertions": lines, "deletions": 0, "untracked": True})
    rows.sort(key=lambda row: (row["insertions"] + row["deletions"]), reverse=True)
    return rows


def _diffstat(worktree: str) -> Dict[str, int]:
    """Insertions and deletions against HEAD, staged work included."""
    rc, out = _run_git(worktree, "diff", "HEAD", "--stat")
    if rc != 0:
        rc, out = _run_git(worktree, "diff", "--stat")
    if rc != 0:
        return {"insertions": 0, "deletions": 0}
    ins = _INSERT_RE.search(out)
    dels = _DELETE_RE.search(out)
    return {
        "insertions": int(ins.group(1)) if ins else 0,
        "deletions": int(dels.group(1)) if dels else 0,
    }


def _specs_touched(worktree: str) -> List[str]:
    rc, out = _run_git(worktree, "diff", "HEAD", "--name-only")
    names = [n.strip() for n in out.splitlines() if n.strip()] if rc == 0 else []
    return [n for n in names if n.endswith("SPEC.md")]


def _plan(worktree: str) -> Optional[Dict[str, Any]]:
    """Newest plan of the lane, read from the pi-todos store. None when absent."""
    root = Path(worktree) / ".thinkrail" / "context" / "todos"
    if not root.is_dir():
        return None
    try:
        files = sorted(root.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    except OSError:
        return None
    if not files:
        return None
    data = _read_json(files[0])
    if data is None:
        return None

    items: List[Dict[str, Any]] = []
    raw_groups = data.get("groups")
    groups: List[Any] = raw_groups if isinstance(raw_groups, list) else []
    for group in groups:
        if not isinstance(group, dict):
            continue
        for item in group.get("todos") or []:
            if isinstance(item, dict):
                items.append({
                    "group": group.get("title", ""),
                    "title": item.get("title", ""),
                    "status": item.get("status", "pending"),
                })
    raw_loose = data.get("todos")
    loose: List[Any] = raw_loose if isinstance(raw_loose, list) else []
    for item in loose:
        if isinstance(item, dict):
            items.append({
                "group": "",
                "title": item.get("title", ""),
                "status": item.get("status", "pending"),
            })

    done = sum(1 for item in items if item["status"] == "done")
    return {
        "groups": len(groups),
        "total": len(items),
        "done": done,
        "current": next((i["title"] for i in items if i["status"] == "in_progress"), None),
        "items": items,
    }


# --------------------------------------------------------------------------- #
# spec graph (frontmatter id/type, parent hierarchy)
# --------------------------------------------------------------------------- #

SPEC_SKIP = {".git", "node_modules", "dist", "build", ".worktrees", ".thinkrail", ".venv", "vendor"}
SPEC_LIMIT = 200
_FM_KEYS = ("id", "type", "title", "parent", "status")


def _frontmatter(path: Path) -> Dict[str, str]:
    """The few scalar frontmatter fields a spec needs. Empty dict when absent."""
    try:
        with path.open(encoding="utf-8", errors="replace") as handle:
            first = handle.readline().strip()
            if first != "---":
                return {}
            fields: Dict[str, str] = {}
            for _ in range(40):
                line = handle.readline()
                if not line or line.strip() == "---":
                    break
                key, sep, value = line.partition(":")
                if sep and key.strip() in _FM_KEYS:
                    fields[key.strip()] = value.strip().strip('"').strip("'")
            return fields
    except OSError:
        return {}


def _spec_tree(worktree: str) -> List[Dict[str, Any]]:
    """Every spec of the worktree, ordered by its parent chain, with a depth."""
    root = Path(worktree)
    found: List[Dict[str, Any]] = []
    try:
        for path in root.rglob("SPEC.md"):
            if any(part in SPEC_SKIP for part in path.relative_to(root).parts):
                continue
            fields = _frontmatter(path)
            if not fields.get("id") or not fields.get("type"):
                continue
            found.append({
                "id": fields["id"],
                "type": fields["type"],
                "title": fields.get("title") or fields["id"],
                "parent": fields.get("parent") or "",
                "path": str(path.relative_to(root)),
            })
            if len(found) >= SPEC_LIMIT:
                break
    except OSError:
        return []

    by_id = {node["id"]: node for node in found}

    def depth_of(node: Dict[str, Any]) -> int:
        depth = 0
        parent = node.get("parent") or ""
        seen = {node["id"]}
        while parent and parent in by_id and parent not in seen and depth < 12:
            seen.add(parent)
            depth += 1
            parent = by_id[parent].get("parent") or ""
        return depth

    for node in found:
        node["depth"] = depth_of(node)

    return sorted(found, key=lambda n: (n["depth"], n["title"].lower()))


# --------------------------------------------------------------------------- #
# shelf: a lane with nothing left to do leaves the active list
# --------------------------------------------------------------------------- #

SHELF_AFTER_DAYS = 7.0
_SHELF_SECONDS = SHELF_AFTER_DAYS * 86400


def _default_branch(repo: str) -> str:
    rc, out = _run_git(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")
    if rc == 0 and out.strip():
        return out.strip().split("/", 1)[-1]
    for candidate in ("main", "master"):
        rc, _ = _run_git(repo, "rev-parse", "--verify", "--quiet", candidate)
        if rc == 0:
            return candidate
    return ""


def _shelf_reason(entry: Dict[str, Any], repo: str, worktree: str) -> str:
    """Why a finished lane belongs on the shelf, or '' while it stays active."""
    if entry["state"] == "running":
        return ""
    finished = entry.get("finished") or entry.get("started") or 0
    try:
        age = time.time() - float(finished)
    except (TypeError, ValueError):
        age = 0.0
    if worktree and not Path(worktree).is_dir():
        return "worktree gone"
    default = _default_branch(repo) if repo and Path(repo).is_dir() else ""
    if default and worktree and Path(worktree).is_dir():
        branch = entry.get("branch") or ""
        if branch and branch != default:
            rc_anc, _ = _run_git(worktree, "merge-base", "--is-ancestor", "HEAD", default)
            if rc_anc == 0:
                rc_head, head = _run_git(worktree, "rev-parse", "HEAD")
                rc_def, tip = _run_git(worktree, "rev-parse", default)
                # A lane that never committed sits exactly on the default tip.
                # One that did, and whose commits now live in the default
                # branch, is merged and belongs on the shelf.
                if rc_head == 0 and rc_def == 0 and head.strip() and head.strip() != tip.strip():
                    return f"merged into {default}"
    if age >= _SHELF_SECONDS:
        return f"quiet for {int(age // 86400)}d"
    return ""


# --------------------------------------------------------------------------- #
# lane assembly
# --------------------------------------------------------------------------- #

def _merge_receipt(repo: str, branch: str, default: str) -> Optional[Dict[str, Any]]:
    """The merge commit that brought this lane's branch into the default branch, or None."""
    if not repo or not branch or not Path(repo).is_dir():
        return None
    rc, out = _run_git(repo, "log", default, "--merges", "--date=short", "--format=%H %ad %s", "-40")
    if rc != 0:
        return None
    for line in out.splitlines():
        parts = line.split(" ", 2)
        if len(parts) < 3:
            continue
        sha, date, subject = parts
        short = branch.rsplit("/", 1)[-1]
        if branch in subject or (short and short in subject):
            files = insertions = deletions = 0
            rc_stat, stat = _run_git(repo, "show", "--shortstat", "--format=", sha)
            if rc_stat == 0:
                changed = re.search(r"(\d+) files? changed", stat)
                files = int(changed.group(1)) if changed else 0
                added = _INSERT_RE.search(stat)
                insertions = int(added.group(1)) if added else 0
                removed = _DELETE_RE.search(stat)
                deletions = int(removed.group(1)) if removed else 0
            return {
                "sha": sha, "short": sha[:7], "date": date,
                "subject": subject, "files": files,
                "insertions": insertions, "deletions": deletions,
            }
    return None


def _thread(lane_dir: Path) -> List[Dict[str, Any]]:
    """The conversation kept next to a lane: what was said, by whom, when."""
    rows: List[Dict[str, Any]] = []
    for line in _tail_lines(lane_dir / "thread.jsonl"):
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if isinstance(entry, dict) and entry.get("text"):
            rows.append({
                "who": str(entry.get("who") or "user"),
                "at": entry.get("at"),
                "text": str(entry.get("text") or ""),
            })
    return rows[-100:]


def _append_thread(lane_dir: Path, who: str, text: str) -> Dict[str, Any]:
    entry = {"who": who, "at": int(time.time()), "text": text}
    lane_dir.mkdir(parents=True, exist_ok=True)
    with (lane_dir / "thread.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def _lane_entry(lane_dir: Path) -> Optional[Dict[str, Any]]:
    record = _read_json(lane_dir / "lane.json")
    if record is None:
        return None

    worktree = str(record.get("worktree") or "")
    events = _parse_events(_tail_lines(lane_dir / "events.jsonl"))
    state = str(record.get("state") or "unknown")
    if state == "running" and not _pid_alive(record.get("pid")):
        state = "stopped"

    entry: Dict[str, Any] = {
        "lane": record.get("lane") or lane_dir.name,
        "task": record.get("task") or "",
        "project": record.get("project") or (Path(str(record.get("repo") or "")).name or "—"),
        "group": record.get("group") or "",
        "repo": record.get("repo") or "",
        "worktree": worktree,
        "branch": record.get("branch") or "",
        "state": state,
        "question": None,
        "started": record.get("started"),
        "finished": record.get("finished"),
        "exit": record.get("exit"),
        "model": record.get("model") or "",
        "provider": record.get("provider") or "",
        "files": 0,
        "insertions": 0,
        "deletions": 0,
        "diff_files": [],
        "specs": [],
        "spec_tree": [],
        "plan": None,
        "status": [],
        "shelved": False,
        "shelved_reason": "",
        "last_text": events["last_text"],
        "last_tool": events["last_tool"],
        "last_tool_detail": events["last_tool_detail"],
        "last_error": events["last_error"],
        "turns": events["turns"],
        "usage": events["usage"],
        "stderr": "",
    }

    # Why a lane stopped: the runner's own stderr is the only place that says it.
    if state in ("failed", "error", "stopped"):
        entry["stderr"] = "\n".join(_tail_lines(lane_dir / "stderr.txt", 64 * 1024))[-TEXT_LIMIT:]

    if worktree and Path(worktree).is_dir():
        rc, branch = _run_git(worktree, "rev-parse", "--abbrev-ref", "HEAD")
        if rc == 0 and branch.strip():
            entry["branch"] = branch.strip()
        status = _status_lines(worktree)
        stat = _diffstat(worktree)
        entry["status"] = status
        entry["files"] = len(status)
        entry["insertions"] = stat["insertions"]
        entry["deletions"] = stat["deletions"]
        entry["diff_files"] = _diff_files(worktree)
        entry["specs"] = _specs_touched(worktree)
        entry["spec_tree"] = _spec_tree(worktree)
        entry["plan"] = _plan(worktree)

    if state == "waiting":
        question = _read_json(lane_dir / "question.json")
        if isinstance(question, dict) and question.get("id"):
            entry["question"] = {
                "id": question.get("id"),
                "method": str(question.get("method") or ""),
                "title": str(question.get("title") or ""),
                "message": str(question.get("message") or ""),
                "options": [str(option) for option in (question.get("options") or [])],
                "asked_at": question.get("asked_at"),
            }

    # Closing is a decision, not a side effect of finishing: only an explicit close (the
    # orchestrator, after a merge) puts a lane on the shelf.
    closed_at = record.get("closed_at")
    guess = _shelf_reason(entry, str(record.get("repo") or ""), worktree)
    entry["shelved"] = bool(closed_at)
    entry["shelved_reason"] = str(record.get("closed_reason") or "") or (guess if closed_at else "")
    entry["handed_at"] = record.get("handed_at")
    entry["handed"] = bool(record.get("handed_at")) and not closed_at
    entry["thread"] = _thread(lane_dir)
    # What git says about the lane right now: a hint for the card, never a decision.
    entry["git_hint"] = guess
    entry["merge"] = None
    marker = "merged into "
    hint = guess if guess.startswith(marker) else ""
    if hint:
        entry["merge"] = _merge_receipt(
            str(record.get("repo") or ""), str(entry.get("branch") or ""), hint[len(marker):].strip()
        )
    if closed_at and not entry["merge"]:
        branch_subject = str(record.get("merge_subject") or "")
        if branch_subject:
            entry["merge"] = {
                "sha": str(record.get("merge_sha") or ""),
                "short": str(record.get("merge_sha") or "")[:7],
                "date": str(record.get("closed_date") or ""),
                "subject": branch_subject,
                "files": int(record.get("merge_files") or 0),
                "insertions": int(record.get("merge_insertions") or 0),
                "deletions": int(record.get("merge_deletions") or 0),
            }
    return entry


def _all_lanes() -> List[Dict[str, Any]]:
    root = _lanes_root()
    if not root.is_dir():
        return []
    lanes: List[Dict[str, Any]] = []
    for lane_dir in sorted(root.iterdir()):
        if not lane_dir.is_dir():
            continue
        entry = _lane_entry(lane_dir)
        if entry is not None:
            lanes.append(entry)
    lanes.sort(key=lambda item: (item["state"] != "running", bool(item.get("shelved")), -(item.get("started") or 0)))
    return lanes[:MAX_LANES]


def _registry() -> List[Dict[str, Any]]:
    """Registered projects and features, so the tree shows empty nodes too."""
    data = _read_json(_hermes_home() / "plugin-data" / "pi-team" / "projects.json") or {}
    projects = data.get("projects")
    if not isinstance(projects, dict):
        return []
    out: List[Dict[str, Any]] = []
    for name in sorted(projects):
        entry = projects[name]
        if not isinstance(entry, dict):
            continue
        raw_features = entry.get("features")
        features: List[Dict[str, Any]] = []
        if isinstance(raw_features, dict):
            for feature in sorted(raw_features):
                item = raw_features[feature]
                title = item.get("title") if isinstance(item, dict) else ""
                sessions = []
                if isinstance(item, dict) and isinstance(item.get("sessions"), list):
                    sessions = [
                        {
                            "id": str(s.get("id")),
                            "linked_at": s.get("linked_at"),
                            "label": str(s.get("label") or ""),
                        }
                        for s in item["sessions"]
                        if isinstance(s, dict) and s.get("id")
                    ]
                features.append(
                    {
                        "name": feature,
                        "title": str(title or feature),
                        "sessions": sessions,
                        # A placeholder is a feature asked for in one line: it has a request and no
                        # name yet. The panel shows it as preparation, not as a feature.
                        "state": str(item.get("state") or "") if isinstance(item, dict) else "",
                        "request": str(item.get("request") or "") if isinstance(item, dict) else "",
                    }
                )
        out.append({"name": name, "repo": str(entry.get("repo") or ""), "features": features})
    return out


# --------------------------------------------------------------------------- #
# routes
# --------------------------------------------------------------------------- #

def _closed_entries() -> List[Dict[str, Any]]:
    """Closed lanes live only as one line each: their folder is gone after the close."""
    path = _lanes_root() / "closed.jsonl"
    entries: List[Dict[str, Any]] = []
    for line in _tail_lines(path):
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if not isinstance(row, dict) or not row.get("lane"):
            continue
        sha = str(row.get("merge_sha") or "")
        entries.append({
            "lane": str(row.get("lane")),
            "project": row.get("project"),
            "group": row.get("group"),
            "state": str(row.get("state") or "done"),
            "branch": row.get("branch"),
            "files": 0,
            "insertions": 0,
            "deletions": 0,
            "diff_files": [],
            "usage": {},
            "turns": 0,
            "status": [],
            "plan": None,
            "spec_tree": [],
            "feature_sessions": [],
            "thread": [],
            "task": "",
            "last_text": "",
            "handed": False,
            "handed_at": None,
            "shelved": True,
            "shelved_reason": str(row.get("closed_reason") or "closed"),
            "git_hint": "",
            "archived": True,
            "closed_at": row.get("closed_at"),
            "merge": {
                "sha": sha,
                "short": sha[:7],
                "date": str(row.get("closed_date") or ""),
                "subject": str(row.get("merge_subject") or ""),
                "files": int(row.get("merge_files") or 0),
                "insertions": int(row.get("merge_insertions") or 0),
                "deletions": int(row.get("merge_deletions") or 0),
            } if sha else None,
        })
    return entries


@router.get("/lanes")
def list_lanes() -> Dict[str, Any]:
    """Every lane: state, task, last assistant text, changes and plan progress."""
    lanes = _all_lanes()
    known = {lane["lane"] for lane in lanes}
    lanes += [entry for entry in _closed_entries() if entry["lane"] not in known]
    return {
        "lanes": [
            {k: v for k, v in lane.items() if k not in ("status", "plan", "spec_tree")}
            for lane in lanes
        ],
        "count": len(lanes),
        "registry": _registry(),
    }


def _registry_write(project: str, feature: str, session: str, add: bool) -> Dict[str, Any]:
    """Attach or drop one Hermes session on a feature, in the registry file."""
    path = _hermes_home() / "plugin-data" / "pi-team" / "projects.json"
    data = _read_json(path) or {}
    projects = data.get("projects")
    if not isinstance(projects, dict) or not isinstance(projects.get(project), dict):
        raise HTTPException(status_code=404, detail="unknown project")
    entry = projects[project]
    features = entry.get("features")
    if not isinstance(features, dict) or not isinstance(features.get(feature), dict):
        raise HTTPException(status_code=404, detail="unknown feature")
    item = features[feature]
    sessions = [s for s in (item.get("sessions") or []) if isinstance(s, dict) and s.get("id")]
    if add:
        if not any(s.get("id") == session for s in sessions):
            sessions.append({"id": session, "linked_at": int(time.time())})
    else:
        sessions = [s for s in sessions if s.get("id") != session]
    item["sessions"] = sessions
    features[feature] = item
    entry["features"] = features
    projects[project] = entry
    data["projects"] = projects
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)
    return {"project": project, "feature": feature, "sessions": sessions}


@router.post("/link")
def link_session(body: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Attach the calling session to a feature."""
    return _registry_write(
        str(body.get("project") or ""), str(body.get("feature") or ""), str(body.get("session") or ""), True
    )


@router.post("/unlink")
def unlink_session(body: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Drop a session from a feature."""
    return _registry_write(
        str(body.get("project") or ""), str(body.get("feature") or ""), str(body.get("session") or ""), False
    )


@router.post("/label")
def label_session(body: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Name a linked session inside the panel only: the real session keeps its own title."""
    project = str(body.get("project") or "")
    feature = str(body.get("feature") or "")
    session = str(body.get("session") or "")
    label = str(body.get("label") or "").strip()

    path = _hermes_home() / "plugin-data" / "pi-team" / "projects.json"
    data = _read_json(path) or {}
    projects = data.get("projects")
    if not isinstance(projects, dict) or not isinstance(projects.get(project), dict):
        raise HTTPException(status_code=404, detail="unknown project")
    features = projects[project].get("features")
    if not isinstance(features, dict) or not isinstance(features.get(feature), dict):
        raise HTTPException(status_code=404, detail="unknown feature")
    sessions = features[feature].get("sessions")
    if not isinstance(sessions, list):
        raise HTTPException(status_code=404, detail="feature has no sessions")

    found = False
    for item in sessions:
        if isinstance(item, dict) and item.get("id") == session:
            if label:
                item["label"] = label
            else:
                item.pop("label", None)
            found = True
    if not found:
        raise HTTPException(status_code=404, detail="session is not linked to this feature")

    features[feature]["sessions"] = sessions
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)
    return {"project": project, "feature": feature, "session": session, "label": label}


def _plugin_ctx() -> Any:
    """The PluginContext kept by this plugin's entry point, when it is loaded."""
    module = sys.modules.get("pi_team_runtime")
    return getattr(module, "ctx", None) if module else None


@router.post("/lanes/{lane}/say")
def say_to_lane(lane: str, payload: Dict[str, Any] = Body(default={})) -> Dict[str, Any]:
    """Put a message about this lane into the chat; the orchestrator decides what reaches pi."""
    text = str(payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="empty message")
    lane_dir = _lanes_root() / lane
    record = _read_json(lane_dir / "lane.json")
    if record is None:
        raise HTTPException(status_code=404, detail="unknown lane")

    _append_thread(lane_dir, "user", text)
    where = f'{record.get("project") or "?"}/{record.get("group") or "?"}'
    state = str(record.get("state") or "")
    message = (
        f'[lane {lane} · {where} · {state}]\n{text}\n\n'
        f'Put your answer back into the lane thread with: pi-lane say {lane} "…"'
    )
    sent = False
    ctx = _plugin_ctx()
    if ctx is not None:
        try:
            sent = bool(ctx.inject_message(message, session_key=payload.get("session_key") or None))
        except Exception:
            sent = False
    return {"ok": True, "message_sent": sent}


UPDATE_PROMPT = (
    "Обнови плагин pi-team: подтяни репозиторий и разложи файлы по местам — "
    "desktop/plugin.js в ~/.hermes/desktop-plugins/pi-team/, "
    "plugin/dashboard/plugin_api.py в ~/.hermes/plugins/pi-team/, "
    "runner/pi-lane в ~/.hermes/scripts/. Перезапусти бэкенд, раздай панель клиентам "
    "и покажи, что изменилось."
)


PREPARE_PROMPT = (
    "[feature {where} · preparation]\n{text}\n\n"
    "Эту фичу завели из панели одной строкой. Дай ей имя по конвенциям проекта, "
    "сформулируй задачу для pi и открой полосу. Заготовка станет обычной фичей, "
    "как только в ней появится полоса."
)


@router.post("/features/prepare")
def prepare_feature(payload: Dict[str, Any] = Body(default={})) -> Dict[str, Any]:
    """A feature asked for in one line: it appears at once, the agent names it after."""
    project_name = str(payload.get("project") or "").strip()
    text = str(payload.get("text") or "").strip()
    if not project_name or not text:
        raise HTTPException(status_code=400, detail="project and text are required")
    try:
        slug, item = pireg.prepare_feature(project_name, text, str(payload.get("session_key") or ""))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown project: {project_name}")
    sent = False
    ctx = _plugin_ctx()
    if ctx is not None:
        try:
            sent = bool(
                ctx.inject_message(
                    PREPARE_PROMPT.format(where=f"{project_name}/{slug}", text=text),
                    session_key=payload.get("session_key") or None,
                )
            )
        except Exception:
            sent = False
    return {"ok": True, "project": project_name, "feature": slug, "title": item["title"], "message_sent": sent}


@router.post("/features/cancel")
def cancel_feature(payload: Dict[str, Any] = Body(default={})) -> Dict[str, Any]:
    """Drop a placeholder that never became a feature. Refused once it has lanes."""
    project_name = str(payload.get("project") or "").strip()
    feature = str(payload.get("feature") or "").strip()
    if not pireg.cancel_preparation(project_name, feature):
        raise HTTPException(status_code=409, detail="only a feature still in preparation can be dropped")
    return {"ok": True}


@router.post("/update/request")
def request_update(payload: Dict[str, Any] = Body(default={})) -> Dict[str, Any]:
    """Ask the agent to update the plugin, instead of doing it from here.

    The backend cannot know where a person keeps the repository or how their host is wired;
    the agent can look. So the button only puts the request into the chat.
    """
    sent = False
    ctx = _plugin_ctx()
    if ctx is not None:
        try:
            sent = bool(ctx.inject_message(UPDATE_PROMPT, session_key=payload.get("session_key") or None))
        except Exception:
            sent = False
    return {"ok": True, "message_sent": sent}


@router.post("/review/send")
def send_review(payload: Dict[str, Any] = Body(default={})) -> Dict[str, Any]:
    """Put the whole review queue into the chat as one list, for the orchestrator to check."""
    lanes = [entry for entry in _all_lanes() if entry.get("handed") and not entry.get("shelved")]
    project = payload.get("project")
    if project:
        lanes = [entry for entry in lanes if entry.get("project") == project]
    if not lanes:
        raise HTTPException(status_code=409, detail="the review queue is empty")

    lanes.sort(key=lambda entry: entry.get("handed_at") or 0)
    lines = []
    for entry in lanes:
        change = f'{entry["files"]} files +{entry["insertions"]} −{entry["deletions"]}'
        trouble = f' · failed: {entry["last_error"]}' if entry.get("last_error") else ""
        lines.append(
            f'- {entry.get("project")}/{entry.get("group") or "-"}/{entry["lane"]} — '
            f'{entry["state"]} — {change}{trouble}'
        )
    text = (
        f"Review queue: {len(lanes)} lane(s).\n"
        + "\n".join(lines)
        + "\n\nCheck each one, report what you found, and wait for my go before merging or closing."
    )
    sent = False
    ctx = _plugin_ctx()
    if ctx is not None:
        try:
            sent = bool(ctx.inject_message(text, session_key=payload.get("session_key") or None))
        except Exception:
            sent = False
    return {"ok": True, "count": len(lanes), "message_sent": sent, "text": text}


@router.post("/lanes/{lane}/hand")
def hand_lane(lane: str, payload: Dict[str, Any] = Body(default={})) -> Dict[str, Any]:
    """Take a finished lane off the agent's hands: mark it handed and say so in the chat."""
    lane_dir = _lanes_root() / lane
    record = _read_json(lane_dir / "lane.json")
    if record is None:
        raise HTTPException(status_code=404, detail="unknown lane")
    if record.get("closed_at"):
        raise HTTPException(status_code=409, detail="lane is already closed")
    record["handed_at"] = int(time.time())
    (lane_dir / "lane.json").write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    who = f'{record.get("project") or "?"}/{record.get("group") or "?"}'
    text = (
        f'Handed over: lane {lane} ({who}) is finished and waiting for a check. '
        f'Merge it and close it with pi-lane close {lane}.'
    )
    sent = False
    ctx = _plugin_ctx()
    if ctx is not None:
        try:
            sent = bool(ctx.inject_message(text, session_key=payload.get("session_key") or None))
        except Exception:
            sent = False
    return {"ok": True, "handed_at": record["handed_at"], "message_sent": sent}


@router.post("/lanes/{lane}/answer")
def answer_lane(lane: str, body: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Answer the question a lane waits on: write answer.json for the runner."""
    lane_dir = _lanes_root() / lane
    question = _read_json(lane_dir / "question.json")
    if not isinstance(question, dict) or not question.get("id"):
        raise HTTPException(status_code=409, detail="lane is not waiting on a question")

    options = [str(option) for option in (question.get("options") or [])]
    cancelled = bool(body.get("cancelled"))
    value = str(body.get("value") or "")
    if not cancelled and options and value not in options:
        raise HTTPException(status_code=422, detail="value is not one of the options")

    payload: Dict[str, Any] = {"id": question["id"]}
    if cancelled:
        payload["cancelled"] = True
    else:
        payload["value"] = value
    (lane_dir / "answer.json").write_text(
        json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return {"lane": lane, "answered": True, **payload}


# --------------------------------------------------------------------------- #
# update: pull the plugin repo, then push the panel file to every client
# --------------------------------------------------------------------------- #

def _update_clients() -> List[Dict[str, Any]]:
    """Hosts that show a window. `{"host": "ili@casalt", "path": "/home/ili/..."}`.

    An entry with `host` empty, `local` or this machine's name writes the file in
    place; anything else reaches the host over ssh and writes it on stdin.
    """
    data = _read_json(_hermes_home() / "plugin-data" / "pi-team" / "clients.json") or {}
    clients = data.get("clients")
    return [item for item in clients if isinstance(item, dict)] if isinstance(clients, list) else []


def _write_client(entry: Dict[str, Any], payload: bytes) -> Dict[str, Any]:
    host = str(entry.get("host") or "local")
    target = str(entry.get("path") or "")
    if not target:
        return {"host": host, "ok": False, "detail": "no path in clients.json"}
    parent = str(Path(target).parent)
    script = (
        f"mkdir -p {shlex.quote(parent)} && cat > {shlex.quote(target)}.tmp && "
        f"chmod 644 {shlex.quote(target)}.tmp && mv {shlex.quote(target)}.tmp {shlex.quote(target)}"
    )
    if host in ("local", "localhost") or host == os.uname().nodename:
        done = subprocess.run(["bash", "-c", script], input=payload, capture_output=True, timeout=30)
    else:
        done = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", host, script],
            input=payload,
            capture_output=True,
            timeout=40,
        )
    detail = (done.stderr or done.stdout).decode("utf-8", "replace").strip()[:300]
    return {"host": host, "ok": done.returncode == 0, "detail": detail or "written"}


@router.post("/update")
def update_plugin() -> Dict[str, Any]:
    """Pull the repo holding this plugin and hand the new panel file to every client."""
    repo = Path(os.environ.get("PI_TEAM_REPO") or (Path.home() / "work" / "pi-team"))
    if not (repo / ".git").is_dir():
        raise HTTPException(status_code=409, detail=f"no git repository at {repo}")
    source = repo / "desktop" / "plugin.js"
    if not source.is_file():
        raise HTTPException(status_code=409, detail=f"{source} missing")

    steps: List[Dict[str, Any]] = []
    pull = subprocess.run(
        ["git", "-C", str(repo), "pull", "--ff-only"], capture_output=True, timeout=120
    )
    steps.append(
        {
            "host": "git",
            "ok": pull.returncode == 0,
            "detail": (pull.stdout + pull.stderr).decode("utf-8", "replace").strip()[-300:] or "up to date",
        }
    )

    payload = source.read_bytes()
    digest = hashlib.sha256(payload).hexdigest()[:16]
    steps.append(_write_client({"path": str(_hermes_home() / "desktop-plugins" / "pi-team" / "plugin.js")}, payload))
    for entry in _update_clients():
        steps.append(_write_client(entry, payload))

    return {"sha256": digest, "steps": steps, "ok": all(step["ok"] for step in steps)}


@router.get("/lanes/{lane}")
def lane_detail(lane: str) -> Dict[str, Any]:
    """One lane with per-file status, the full plan and the last text."""
    match = next((item for item in _all_lanes() if item["lane"] == lane), None)
    if match is None:
        # A closed lane keeps only its journal line; that is the whole record.
        match = next((row for row in _closed_entries() if row["lane"] == lane), None)
    if match is None:
        raise HTTPException(status_code=404, detail="lane not found")
    if match.get("archived"):
        return match
    match["feature_sessions"] = []
    for project in _registry():
        if project["name"] != match.get("project"):
            continue
        for feature in project.get("features") or []:
            if feature["name"] == (match.get("group") or ""):
                match["feature_sessions"] = feature.get("sessions") or []
    return match
