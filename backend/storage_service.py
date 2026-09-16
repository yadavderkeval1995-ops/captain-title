import mimetypes
import os
from pathlib import Path

APP_NAME = "captain-title"
STORAGE_ROOT = Path(os.environ.get("LOCAL_STORAGE_DIR") or Path(__file__).parent / "storage_data")


def init_storage(force: bool = False):
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    return str(STORAGE_ROOT)


def _meta_path(target: Path) -> Path:
    return target.parent / f"{target.name}.meta"


def put_object(path: str, data: bytes, content_type: str):
    init_storage()
    target = STORAGE_ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    _meta_path(target).write_text(content_type or "application/octet-stream")
    return {"path": path}


def get_object(path: str):
    init_storage()
    target = STORAGE_ROOT / path
    if not target.is_file():
        raise FileNotFoundError(path)
    meta = _meta_path(target)
    content_type = meta.read_text().strip() if meta.is_file() else (
        mimetypes.guess_type(path)[0] or "application/octet-stream")
    return target.read_bytes(), content_type
