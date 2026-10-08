"""Select existing trusted shadow directories; CLI values never form directories."""
import os
from pathlib import Path

ROOT = Path.home() / "Documents" / "Database"


def directories(root):
    shadow = (root / "data" / "shadow").resolve()
    if not shadow.is_dir():
        raise ValueError("Local Database data/shadow directory is missing")
    result = {str(shadow): shadow}
    for entry in shadow.iterdir():
        if entry.is_dir() and not entry.is_symlink():
            result[str(entry)] = entry
    return result


def source_directory(value, root=ROOT):
    # Lookup returns a filesystem-discovered Path, never Path(user_value).
    result = directories(root).get(str(value))
    if result is None or result == (root / "data" / "shadow").resolve():
        raise ValueError("Select an existing direct child of data/shadow")
    return result


def shadow_file(value, root=ROOT):
    raw = str(value)
    parent_key, separator, filename = raw.rpartition(os.sep)
    parent = directories(root).get(parent_key)
    safe_name = os.path.basename(filename)
    if not separator or parent is None or safe_name in {"", ".", ".."}:
        raise ValueError("File must be in data/shadow or an existing direct child")
    if safe_name != filename or not safe_name.endswith(".json"):
        raise ValueError("Select a JSON filename without directory components")
    result = parent / safe_name
    if result.is_symlink():
        raise ValueError("Shadow input/output files cannot be symlinks")
    return result
