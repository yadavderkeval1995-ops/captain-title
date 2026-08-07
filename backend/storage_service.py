import os
import requests

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "captain-title"
storage_key = None


def init_storage(force: bool = False):
    global storage_key
    if storage_key and not force:
        return storage_key
    response = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    response.raise_for_status()
    storage_key = response.json()["storage_key"]
    return storage_key


def _request(method: str, path: str, **kwargs):
    key = init_storage()
    headers = kwargs.pop("headers", {})
    headers["X-Storage-Key"] = key
    response = requests.request(method, f"{STORAGE_URL}/objects/{path}", headers=headers, **kwargs)
    if response.status_code == 404:
        headers["X-Storage-Key"] = init_storage(force=True)
        response = requests.request(method, f"{STORAGE_URL}/objects/{path}", headers=headers, **kwargs)
    response.raise_for_status()
    return response


def put_object(path: str, data: bytes, content_type: str):
    return _request("PUT", path, headers={"Content-Type": content_type}, data=data, timeout=180).json()


def get_object(path: str):
    response = _request("GET", path, timeout=120)
    return response.content, response.headers.get("Content-Type", "application/octet-stream")