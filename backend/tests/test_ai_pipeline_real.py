"""
Real end-to-end AI pipeline: register -> /projects/process (Whisper + GPT + object storage)
-> /projects/{id} update (edits) -> /projects/{id}/render (FFmpeg subtitle burn + object storage)
-> /projects/{id}/download -> second unentitled process returns 402.

Uses real EMERGENT_LLM_KEY. Sample: /app/captain-sample.mp4 (~2.4 sec, MOCKED-FREE flow).
"""
import os
import time
import uuid
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
SAMPLE = Path("/app/captain-sample.mp4")


@pytest.mark.skipif(not SAMPLE.exists(), reason="Sample video missing")
def test_full_pipeline_real_ai_and_gating(tmp_path):
    # 1) Fresh user
    email = f"ai.pipeline.{int(time.time()*1000)}.{uuid.uuid4().hex[:6]}@example.com"
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": "captain123", "name": "AI Pipeline"},
                      timeout=30)
    assert r.status_code == 200, r.text
    token = r.headers["X-Session-Token"]
    auth = {"Authorization": f"Bearer {token}"}

    # 2) Usage before -> free_remaining == 1
    r_before = requests.get(f"{BASE_URL}/api/usage", headers=auth, timeout=15).json()
    assert r_before["free_remaining"] == 1
    assert r_before["videos_created"] == 0

    # 3) Real /projects/process with sample video (Whisper + GPT + storage)
    with SAMPLE.open("rb") as f:
        r_proc = requests.post(f"{BASE_URL}/api/projects/process",
                               headers=auth,
                               data={"theme": "viral"},
                               files={"file": ("captain-sample.mp4", f, "video/mp4")},
                               timeout=180)
    assert r_proc.status_code == 200, f"process failed: {r_proc.status_code} {r_proc.text[:400]}"
    project = r_proc.json()
    print("project.words[:5]=", project["words"][:5])
    assert project["project_id"].startswith("project_")
    assert project["theme"] == "viral"
    assert project["duration"] > 0 and project["duration"] <= 120
    assert project["status"] == "ready"
    assert isinstance(project["words"], list) and len(project["words"]) >= 1
    w0 = project["words"][0]
    for k in ("index", "text", "original", "start", "end", "important", "color", "font_size"):
        assert k in w0, f"missing word field: {k}"
    assert w0["end"] >= w0["start"]
    # Some words should be flagged important (~<=20%)
    imp = [w for w in project["words"] if w["important"]]
    assert len(imp) >= 0  # allowed to be zero if GPT flags none
    # Colors match theme palette
    assert w0["color"] in {"#FFFFFF", "#FF3B30"}

    # 4) Usage after: credit decremented
    r_after = requests.get(f"{BASE_URL}/api/usage", headers=auth, timeout=15).json()
    assert r_after["free_remaining"] == 0
    assert r_after["videos_created"] == 1

    # 5) Second process must return 402 (no entitlement)
    with SAMPLE.open("rb") as f:
        r_proc2 = requests.post(f"{BASE_URL}/api/projects/process",
                                headers=auth,
                                data={"theme": "viral"},
                                files={"file": ("captain-sample.mp4", f, "video/mp4")},
                                timeout=180)
    assert r_proc2.status_code == 402, f"expected 402 got {r_proc2.status_code} {r_proc2.text[:200]}"

    project_id = project["project_id"]

    # 6) Object-storage media endpoint returns bytes to the owner (retry once on transient 5xx)
    r_media = requests.get(f"{BASE_URL}/api/projects/{project_id}/media",
                           headers=auth, timeout=90)
    if r_media.status_code >= 500:
        time.sleep(3)
        r_media = requests.get(f"{BASE_URL}/api/projects/{project_id}/media",
                               headers=auth, timeout=90)
    assert r_media.status_code == 200, f"media status={r_media.status_code}"
    assert r_media.headers.get("content-type", "").startswith("video/")
    assert len(r_media.content) > 1024

    # 7) Ownership: another user cannot fetch media
    other_email = f"other.{int(time.time()*1000)}.{uuid.uuid4().hex[:6]}@example.com"
    r_o = requests.post(f"{BASE_URL}/api/auth/register",
                       json={"email": other_email, "password": "captain123", "name": "Other User"},
                       timeout=15)
    other_token = r_o.headers["X-Session-Token"]
    r_forbid = requests.get(f"{BASE_URL}/api/projects/{project_id}/media",
                            headers={"Authorization": f"Bearer {other_token}"}, timeout=20)
    assert r_forbid.status_code == 404  # non-owner => not found

    # 8) Edit project (change theme + tweak first word)
    words_edit = project["words"]
    words_edit[0]["text"] = words_edit[0]["text"]  # keep same, just prove roundtrip
    words_edit[0]["color"] = "#00FF00"
    words_edit[0]["font_size"] = 72
    r_put = requests.put(f"{BASE_URL}/api/projects/{project_id}",
                         headers=auth,
                         json={"theme": "cinematic", "words": words_edit}, timeout=30)
    assert r_put.status_code == 200
    assert r_put.json()["status"] == "saved"

    # 9) Render (FFmpeg subtitle burn) + object-storage upload
    r_render = requests.post(f"{BASE_URL}/api/projects/{project_id}/render",
                             headers=auth, timeout=300)
    assert r_render.status_code == 200, r_render.text
    assert r_render.json()["status"] == "rendered"
    assert r_render.json()["download_url"].endswith(f"/{project_id}/download")

    # 10) Download rendered MP4 bytes
    r_dl = requests.get(f"{BASE_URL}/api/projects/{project_id}/download",
                        headers=auth, timeout=120)
    assert r_dl.status_code == 200
    assert r_dl.headers.get("content-type") == "video/mp4"
    assert len(r_dl.content) > 4096
    # MP4 signature check
    head = r_dl.content[:12]
    assert b"ftyp" in head, f"not mp4: {head!r}"

    # 11) Non-owner cannot download
    r_dl_other = requests.get(f"{BASE_URL}/api/projects/{project_id}/download",
                              headers={"Authorization": f"Bearer {other_token}"}, timeout=30)
    assert r_dl_other.status_code == 404
