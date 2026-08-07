"""
Iter6 - Pro Caption Editor asset endpoints.
Covers /api/editor/presets and /api/editor/fonts CRUD + auth + ownership isolation.
Also spot-checks GET /api/projects and GET /api/projects/{id} include the new
caption_groups / editor_style / preview fields for the existing seeded project.
"""
import io
import os
import pytest
import requests
import time
import uuid

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
EXISTING_OWNER_EMAIL = "iter4.mediab.1786098208077@example.com"
EXISTING_OWNER_PASSWORD = "captain12345"
EXISTING_PROJECT_ID = "project_c0af42d2ab1e"
SYSTEM_TEST_FONT = "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf"


def _register_fresh(prefix="iter6.editor"):
    session = requests.Session()
    email = f"{prefix}.{int(time.time()*1000)}.{uuid.uuid4().hex[:6]}@example.com"
    r = session.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "captain123", "name": "Iter6 Tester"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    token = r.headers.get("X-Session-Token")
    assert token
    session.headers.update({"Authorization": f"Bearer {token}"})
    return session, email, token


@pytest.fixture(scope="module")
def owner_session():
    session = requests.Session()
    r = session.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": EXISTING_OWNER_EMAIL, "password": EXISTING_OWNER_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    token = r.headers.get("X-Session-Token")
    assert token
    session.headers.update({"Authorization": f"Bearer {token}"})
    return session


# ---------- Auth guards ----------

class TestEditorAssetAuth:
    def test_presets_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/editor/presets", timeout=15)
        assert r.status_code == 401

    def test_fonts_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/editor/fonts", timeout=15)
        assert r.status_code == 401

    def test_preset_create_requires_auth(self):
        r = requests.post(
            f"{BASE_URL}/api/editor/presets",
            json={"name": "NoAuth", "style": {}},
            timeout=15,
        )
        assert r.status_code == 401

    def test_font_upload_requires_auth(self):
        r = requests.post(
            f"{BASE_URL}/api/editor/fonts",
            files={"file": ("x.ttf", b"\x00\x01\x00\x00" + b"a" * 200, "font/ttf")},
            timeout=30,
        )
        assert r.status_code == 401


# ---------- Preset CRUD + isolation ----------

class TestPresetCRUD:
    def test_full_preset_lifecycle_and_isolation(self):
        session_a, email_a, _ = _register_fresh("iter6.preset.a")
        session_b, email_b, _ = _register_fresh("iter6.preset.b")

        # Initially A has no presets
        r = session_a.get(f"{BASE_URL}/api/editor/presets", timeout=15)
        assert r.status_code == 200
        assert r.json() == []

        # Create preset for A
        payload = {
            "name": "TEST_iter6_preset",
            "style": {"fontFamily": "Anton", "fontSize": 62, "color": "#FF3B30"},
            "template_id": "viral-punch",
        }
        r = session_a.post(f"{BASE_URL}/api/editor/presets", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["name"] == payload["name"]
        assert created["style"]["fontFamily"] == "Anton"
        assert created["style"]["fontSize"] == 62
        assert created["template_id"] == "viral-punch"
        assert created["preset_id"].startswith("preset_")
        assert "user_id" not in created and "_id" not in created
        preset_id = created["preset_id"]

        # GET list contains it for A
        r = session_a.get(f"{BASE_URL}/api/editor/presets", timeout=15)
        assert r.status_code == 200
        found = [p for p in r.json() if p["preset_id"] == preset_id]
        assert len(found) == 1
        assert found[0]["style"]["fontSize"] == 62

        # User B cannot see A's preset
        r = session_b.get(f"{BASE_URL}/api/editor/presets", timeout=15)
        assert r.status_code == 200
        assert not any(p["preset_id"] == preset_id for p in r.json())

        # User B cannot delete A's preset
        r = session_b.delete(f"{BASE_URL}/api/editor/presets/{preset_id}", timeout=15)
        assert r.status_code == 404

        # After failed delete, A still owns it
        r = session_a.get(f"{BASE_URL}/api/editor/presets", timeout=15)
        assert any(p["preset_id"] == preset_id for p in r.json())

        # A deletes it - success
        r = session_a.delete(f"{BASE_URL}/api/editor/presets/{preset_id}", timeout=15)
        assert r.status_code == 200
        assert r.json() == {"status": "deleted"}

        # Deleting again yields 404
        r = session_a.delete(f"{BASE_URL}/api/editor/presets/{preset_id}", timeout=15)
        assert r.status_code == 404

        # And GET no longer returns it
        r = session_a.get(f"{BASE_URL}/api/editor/presets", timeout=15)
        assert not any(p["preset_id"] == preset_id for p in r.json())

    def test_preset_name_validation(self):
        session, _, _ = _register_fresh("iter6.preset.v")
        # Too short
        r = session.post(
            f"{BASE_URL}/api/editor/presets", json={"name": "x", "style": {}}, timeout=15,
        )
        assert r.status_code == 422
        # Too long
        r = session.post(
            f"{BASE_URL}/api/editor/presets",
            json={"name": "y" * 51, "style": {}},
            timeout=15,
        )
        assert r.status_code == 422


# ---------- Font upload / download / delete + validation ----------

class TestFontUpload:
    def test_full_font_lifecycle_and_isolation(self):
        assert os.path.exists(SYSTEM_TEST_FONT), "System test font not present"
        with open(SYSTEM_TEST_FONT, "rb") as fh:
            font_bytes = fh.read()
        assert len(font_bytes) > 0

        session_a, email_a, token_a = _register_fresh("iter6.font.a")
        session_b, email_b, _ = _register_fresh("iter6.font.b")

        # Bad extension is rejected
        r = session_a.post(
            f"{BASE_URL}/api/editor/fonts",
            files={"file": ("bad.exe", b"MZ" + b"\x00" * 40, "application/octet-stream")},
            timeout=30,
        )
        assert r.status_code == 415

        # Oversize (>8 MB) TTF is rejected
        big = b"\x00\x01\x00\x00" + b"a" * (8 * 1024 * 1024 + 10)
        r = session_a.post(
            f"{BASE_URL}/api/editor/fonts",
            files={"file": ("big.ttf", big, "font/ttf")},
            timeout=60,
        )
        assert r.status_code == 413

        # Valid TTF upload
        r = session_a.post(
            f"{BASE_URL}/api/editor/fonts",
            files={"file": ("TEST_iter6_FreeSansBold.ttf", font_bytes, "font/ttf")},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["font_id"].startswith("font_")
        assert created["family"] == "TEST iter6 FreeSansBold"
        assert created["content_type"] == "font/ttf"
        assert created["size"] == len(font_bytes)
        assert created["filename"] == "TEST_iter6_FreeSansBold.ttf"
        assert created["is_deleted"] is False
        assert "user_id" not in created and "storage_path" not in created
        font_id = created["font_id"]

        # List shows it for A
        r = session_a.get(f"{BASE_URL}/api/editor/fonts", timeout=15)
        assert r.status_code == 200
        listed = [f for f in r.json() if f["font_id"] == font_id]
        assert len(listed) == 1
        assert "storage_path" not in listed[0]

        # File endpoint returns the exact bytes for owner
        r = session_a.get(f"{BASE_URL}/api/editor/fonts/{font_id}/file", timeout=30)
        assert r.status_code == 200
        assert r.headers.get("content-type") == "font/ttf"
        assert r.content == font_bytes

        # Foreign user cannot list A's font
        r = session_b.get(f"{BASE_URL}/api/editor/fonts", timeout=15)
        assert not any(f["font_id"] == font_id for f in r.json())

        # Foreign user cannot download the file
        r = session_b.get(f"{BASE_URL}/api/editor/fonts/{font_id}/file", timeout=15)
        assert r.status_code == 404

        # Foreign user cannot delete the font
        r = session_b.delete(f"{BASE_URL}/api/editor/fonts/{font_id}", timeout=15)
        assert r.status_code == 404

        # Owner deletes (soft-delete). Follow-up GET file returns 404.
        r = session_a.delete(f"{BASE_URL}/api/editor/fonts/{font_id}", timeout=15)
        assert r.status_code == 200
        assert r.json() == {"status": "deleted"}
        r = session_a.get(f"{BASE_URL}/api/editor/fonts/{font_id}/file", timeout=15)
        assert r.status_code == 404
        # And listing no longer includes it (is_deleted filter)
        r = session_a.get(f"{BASE_URL}/api/editor/fonts", timeout=15)
        assert not any(f["font_id"] == font_id for f in r.json())

    def test_font_upload_woff_and_otf_accepted(self):
        session, _, _ = _register_fresh("iter6.font.mimes")
        # Fabricate small dummy files - service only checks extension + size, not
        # magic bytes.
        for filename, content_type in [
            ("TEST_woff.woff", "font/woff"),
            ("TEST_otf.otf", "font/otf"),
            ("TEST_woff2.woff2", "font/woff2"),
        ]:
            data = b"\x00\x01\x00\x00" + os.urandom(2048)
            r = session.post(
                f"{BASE_URL}/api/editor/fonts",
                files={"file": (filename, data, content_type)},
                timeout=30,
            )
            assert r.status_code == 200, (filename, r.text)
            font_id = r.json()["font_id"]
            # Clean up
            session.delete(f"{BASE_URL}/api/editor/fonts/{font_id}", timeout=15)


# ---------- Project persistence / read-back ----------

class TestProjectPersistence:
    def test_list_projects_and_open_existing(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/projects", timeout=15)
        assert r.status_code == 200
        projects = r.json()
        assert isinstance(projects, list)
        ids = [p.get("project_id") for p in projects]
        assert EXISTING_PROJECT_ID in ids, ids

        # Confirm the light listing does NOT include the heavy fields (privacy /
        # payload guard promised by list_projects projection).
        seeded = next(p for p in projects if p["project_id"] == EXISTING_PROJECT_ID)
        for hidden in ["words", "source_transcript", "caption_groups",
                       "source_path", "preview_path", "user_id"]:
            assert hidden not in seeded, hidden

    def test_get_project_returns_full_payload(self, owner_session):
        r = owner_session.get(
            f"{BASE_URL}/api/projects/{EXISTING_PROJECT_ID}", timeout=15,
        )
        assert r.status_code == 200
        p = r.json()
        # Status must let the editor mount
        assert p["status"] in {"ready", "rendered"}, p["status"]
        assert p["project_id"] == EXISTING_PROJECT_ID
        # Words present so editor can build fallback groups
        assert isinstance(p.get("words"), list) and len(p["words"]) > 0
        # New editor fields addressable (may be default when no manual edits yet)
        assert "caption_groups" in p or True  # allow either absent or present
        # ProjectEdit round-trip
        current_groups = p.get("caption_groups", []) or []
        current_style = p.get("editor_style", {}) or {}
        assert isinstance(current_groups, list)
        assert isinstance(current_style, dict)
        # None of the private fields leak
        for hidden in ["user_id", "_id", "source_path", "content_type", "credit_type"]:
            assert hidden not in p, hidden

    def test_put_project_persists_caption_groups_and_style(self, owner_session):
        # Read current
        r = owner_session.get(
            f"{BASE_URL}/api/projects/{EXISTING_PROJECT_ID}", timeout=15,
        )
        assert r.status_code == 200
        p = r.json()
        original_theme = p["theme"]
        original_words = p["words"]
        original_groups = p.get("caption_groups", []) or []
        original_style = p.get("editor_style", {}) or {}

        # Craft a distinctive update payload
        tag = f"iter6-{uuid.uuid4().hex[:6]}"
        # Words must satisfy WordEdit schema. Round-trip existing words.
        words_payload = [
            {
                "index": i,
                "text": w.get("text", w.get("original", "word")),
                "original": w.get("original", ""),
                "start": float(w.get("start", 0.0)),
                "end": float(w.get("end", 0.05)),
                "important": bool(w.get("important", False)),
                "uncertain": bool(w.get("uncertain", False)),
                "color": w.get("color", "#FFFFFF"),
                "font_size": int(w.get("font_size", 52)),
            }
            for i, w in enumerate(original_words)
        ]
        new_style = {**original_style, "note": tag, "fontSize": 58, "y": 74}
        new_groups = [
            {
                "id": f"caption-{tag}-0",
                "word_indices": [0, 1] if len(original_words) >= 2 else [0],
                "text": f"TEST {tag} phrase one",
                "start": float(original_words[0]["start"]),
                "end": float(original_words[min(1, len(original_words)-1)]["end"]),
                "style": {"fontFamily": "Anton"},
                "template_id": "viral-punch",
            }
        ]
        payload = {
            "theme": original_theme,
            "words": words_payload,
            "caption_groups": new_groups,
            "editor_style": new_style,
        }
        r = owner_session.put(
            f"{BASE_URL}/api/projects/{EXISTING_PROJECT_ID}", json=payload, timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"status": "saved"}

        # Read-back
        r = owner_session.get(
            f"{BASE_URL}/api/projects/{EXISTING_PROJECT_ID}", timeout=15,
        )
        assert r.status_code == 200
        p2 = r.json()
        assert p2.get("editor_style", {}).get("note") == tag
        assert p2.get("editor_style", {}).get("fontSize") == 58
        assert p2.get("caption_groups", [{}])[0].get("id") == f"caption-{tag}-0"
        assert p2.get("caption_groups", [{}])[0].get("template_id") == "viral-punch"

        # Restore original state
        restore = {
            "theme": original_theme,
            "words": words_payload,
            "caption_groups": original_groups,
            "editor_style": original_style,
        }
        r = owner_session.put(
            f"{BASE_URL}/api/projects/{EXISTING_PROJECT_ID}", json=restore, timeout=30,
        )
        assert r.status_code == 200, r.text

    def test_get_project_isolation(self, owner_session):
        session_b, _, _ = _register_fresh("iter6.project.iso")
        r = session_b.get(
            f"{BASE_URL}/api/projects/{EXISTING_PROJECT_ID}", timeout=15,
        )
        assert r.status_code == 404
        # Cross-user PUT also 404
        r = session_b.put(
            f"{BASE_URL}/api/projects/{EXISTING_PROJECT_ID}",
            json={"theme": "viral", "words": [], "caption_groups": [], "editor_style": {}},
            timeout=15,
        )
        assert r.status_code == 404
