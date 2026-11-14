#!/usr/bin/env python3
"""build.py: cut `runner/pi-lane` into parts and glue them back.

One file installs into `~/.hermes/scripts`, where a package would not survive the plugin's copy. One file
is also 2 400 lines of edit surface. This script keeps both: edit `parts/*.py`, run `python3 build.py`,
and the single-file runner is regenerated in the order the parts are numbered.

    python3 runner/build.py            # write runner/pi-lane from parts
    python3 runner/build.py --check    # fail if the built file is stale
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PARTS = HERE / "parts"
TARGET = HERE / "pi-lane"


def build() -> str:
    chunks = []
    shebang = "#!/usr/bin/env python3"
    for part in sorted(PARTS.glob("*.py")):
        lines = part.read_text(encoding="utf-8").rstrip().splitlines()
        if lines and lines[0].startswith("#!"):
            shebang = lines[0]
            lines = lines[1:]
        body = "\n".join(lines)
        chunks.append(f"# --- {part.name} " + "-" * max(0, 66 - len(part.name)) + "\n" + body)
    return shebang + "\n\n\n" + "\n\n\n".join(chunks) + "\n"


def main() -> int:
    built = build()
    if "--check" in sys.argv:
        current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
        if current.strip() != built.strip():
            print("build.py: runner/pi-lane is stale — run `python3 runner/build.py`", file=sys.stderr)
            return 1
        print("build.py: runner/pi-lane matches parts")
        return 0
    TARGET.write_text(built, encoding="utf-8")
    TARGET.chmod(0o755)
    check = subprocess.run([sys.executable, "-m", "py_compile", str(TARGET)],
                           capture_output=True, text=True, check=False)
    if check.returncode != 0:
        print(check.stderr.strip(), file=sys.stderr)
        return 1
    print(f"build.py: wrote {TARGET} ({len(built.splitlines())} lines, {len(built)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
