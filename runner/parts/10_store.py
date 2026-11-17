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


def load_provider_key(provider: str) -> None:
    """Put this lane's provider key into the process, through Hermes's secret scope.

    One key, never six. `agent.secret_scope.get_secret` is the sanctioned route: it composes the
    profile's `.env` with the environment and honours the active profile under multiplexing, so this
    module reads no file of its own. A key that already sits in the environment — the dashboard
    resolves the one a lane needs and passes it in — is left alone.
    """
    name = PROVIDER_KEYS.get(provider or "", "")
    if not name or (os.environ.get(name) or "").strip():
        apply_aliases()
        return
    try:
        from agent.secret_scope import get_secret

        value = (get_secret(name) or "").strip()
    except Exception:
        value = ""
    if value:
        os.environ[name] = value
    apply_aliases()


def minimal_env(provider: str = "", extra: dict | None = None) -> dict:
    """The whole environment a child gets: a PATH, a HOME, a locale, one provider key.

    `pi` and the test commands it runs work inside a repository somebody else wrote. They inherit
    nothing that can spend money or reach another service, so an injected command finds no
    credential to read. `extra` carries the few names a command genuinely needs.
    """
    env = {
        "PATH": os.environ.get("PATH") or "/usr/local/bin:/usr/bin:/bin",
        "HOME": os.environ.get("HOME") or str(Path.home()),
        "LANG": os.environ.get("LANG") or "C.UTF-8",
        "GIT_TERMINAL_PROMPT": "0",
    }
    for name in ("TMPDIR", "TZ"):
        value = os.environ.get(name)
        if value:
            env[name] = value
    key = PROVIDER_KEYS.get(provider or "", "")
    value = (os.environ.get(key) or "").strip() if key else ""
    if value:
        env[key] = value
        for source, target in ALIASES.items():
            if source == key:
                env[target] = value
    if extra:
        env.update({name: str(value) for name, value in extra.items()})
    return env


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
