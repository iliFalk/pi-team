_DROP_EVENT_TYPES = () if os.environ.get("PI_LANE_KEEP_DELTAS") else ("message_update",)


def _keep_event(line: str) -> bool:
    """True when this raw line belongs in events.jsonl."""
    if not _DROP_EVENT_TYPES:
        return True
    stripped = line.lstrip()
    if not stripped.startswith("{"):
        return True
    for name in _DROP_EVENT_TYPES:
        if f'"type":"{name}"' in stripped or f'"type": "{name}"' in stripped:
            return False
    return True


def assistant_text(event: dict) -> str:
    message = event.get("message") or {}
    if message.get("role") != "assistant":
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, list):
        return ""
    parts = [p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"]
    return "\n".join(p for p in parts if p).strip()


RESULT_MARKER = "RESULT:"


def _json_after(text: str, marker: str):
    """The first JSON object that follows the last `marker` in a text, or None."""
    if not text:
        return None
    index = text.upper().rfind(marker)
    if index < 0:
        return None
    tail = text[index + len(marker):].strip().strip("`").strip()
    start = tail.find("{")
    if start < 0:
        return None
    depth = 0
    for position, char in enumerate(tail[start:], start=start):
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(tail[start:position + 1])
                except ValueError:
                    return None
    return None


def parse_result(text: str) -> tuple:
    """Read the lane's machine-readable report: the last `RESULT: {...}` in its final text.

    Returns `(result, status)` with status `ok`, `missing` or `invalid`. The prose stays for a person;
    this object is what an orchestrator reads without paying for the whole report again.
    """
    if RESULT_MARKER not in text.upper():
        return None, "missing"
    result = _json_after(text, RESULT_MARKER)
    if not isinstance(result, dict):
        return None, "invalid"
    files = result.get("files")
    if not isinstance(files, list) or not all(isinstance(item, str) for item in files):
        return None, "invalid"
    for key in ("risks", "followups"):
        if key in result and not isinstance(result[key], list):
            return None, "invalid"
    verify = result.get("verify")
    if verify is not None and not (isinstance(verify, dict) and "exit" in verify):
        return None, "invalid"
    return result, "ok"


def parse_review(text: str) -> tuple:
    """Read the critic's line: `REVIEW: {p0, p1, notes}`, each a list of strings."""
    if REVIEW_MARKER not in text.upper():
        return None, "missing"
    review = _json_after(text, REVIEW_MARKER)
    if not isinstance(review, dict):
        return None, "invalid"
    for key in ("p0", "p1", "notes"):
        if key in review and not (isinstance(review[key], list)
                                  and all(isinstance(item, str) for item in review[key])):
            return None, "invalid"
    if not isinstance(review.get("p0"), list) or not isinstance(review.get("p1"), list):
        return None, "invalid"
    return review, "ok"
