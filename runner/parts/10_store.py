def hermes_home() -> Path:
    return Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")


def fail(message: str) -> NoReturn:
    print(f"pi-lane: {message}", file=sys.stderr)
    raise SystemExit(2)


def apply_aliases() -> None:
    """Hermes names a credential differently from pi; hand pi the name it reads.

    Both env branches end here: a spawn that already carries the Hermes name returns early,
    and without this pass ``opencode-go`` stays unconfigured while the key sits in the env.
    """
    for source, target in ALIASES.items():
        value = (os.environ.get(source) or "").strip()
        if value and not (os.environ.get(target) or "").strip():
            os.environ[target] = value


def load_env_keys() -> None:
    """Put the provider keys into this process, for the pi run it starts.

    Hermes's own secret scope comes first: run the runner with Hermes's interpreter and the keys
    arrive profile-scoped, exactly as Hermes reads them. A plain `python3` has no such scope, so the
    fallback parses the profile's `.env` — the one file the keys live in when no scope is installed.
    """
    try:
        from agent.secret_scope import get_secret

        for name in ENV_KEYS:
            value = (get_secret(name) or "").strip()
            if value and not os.environ.get(name):
                os.environ[name] = value
    except Exception:
        pass
    # No early return here. A scope that answers for one provider says nothing about another, and a
    # single unrelated key in the environment — the gateway's own, say — used to stop this fallback
    # before it read the file. The file is the last place a key can come from: read it always.
    env_file = hermes_home() / ".env"
    if not env_file.is_file():
        return
    try:
        lines = env_file.read_text(errors="replace").splitlines()
    except OSError:
        return
    for line in lines:
        name, sep, value = line.partition("=")
        name = name.strip()
        if not sep or name not in ENV_KEYS:
            continue
        value = value.strip()
        target = ALIASES.get(name, name)
        if not os.environ.get(target):
            os.environ[target] = value
    apply_aliases()


def write_record(lane_dir: Path, record: dict) -> None:
    tmp = lane_dir / "lane.json.tmp"
    tmp.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    tmp.replace(lane_dir / "lane.json")


def ensure_excludes(repo: str) -> None:
    """Hide lane scratch from the main checkout without touching tracked files."""
    base = Path(repo) / ".git"
    try:
        done = subprocess.run(
            ["git", "-C", repo, "rev-parse", "--path-format=absolute", "--git-common-dir"],
            capture_output=True, text=True, timeout=10, check=False,
        )
        if done.returncode == 0 and done.stdout.strip():
            base = Path(done.stdout.strip())
    except (OSError, subprocess.SubprocessError):
        pass
    info = base / "info"
    info.mkdir(parents=True, exist_ok=True)
    exclude = info / "exclude"
    existing = exclude.read_text(errors="replace").splitlines() if exclude.is_file() else []
    for pattern in ("/.worktrees/", ".thinkrail/"):
        if pattern not in existing:
            with exclude.open("a", encoding="utf-8") as handle:
                handle.write(pattern + "\n")


def pid_alive(pid) -> bool:
    try:
        value = int(pid)
    except (TypeError, ValueError):
        return False
    if value <= 0:
        return False
    try:
        os.kill(value, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # exists, owned by another user
    except OSError:
        return False
    return True


def lane_records() -> list:
    """Every readable lane record, so guards can see what is already running."""
    records = []
    root = hermes_home() / "lanes"
    if not root.is_dir():
        return records
    for path in sorted(root.glob("*/lane.json")):
        try:
            record = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except (OSError, ValueError):
            continue
        if isinstance(record, dict):
            records.append(record)
    return records
