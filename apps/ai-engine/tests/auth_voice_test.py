"""Isolated HTTP checks for open registration and scoped voice access."""

import pytest

pytest_plugins = ["tests.editorial_test"]


@pytest.mark.parametrize("role", ["student", "teacher"])
async def test_login_language_is_atomic_and_does_not_bypass_session_confirmation(
    editorial_http, role
):
    client, *_ = editorial_http
    credentials = {"username": f"language-{role}", "password": "language-test-123"}
    created = await client.post(
        "/auth/register",
        json={
            **credentials,
            "full_name": "Language test",
            "role": role,
            "preferred_language": "en",
        },
    )
    assert created.status_code == 201
    token = created.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    # Neither invalid input, wrong credentials nor an unapproved second
    # login may change the current account's language/session.
    assert (
        await client.post("/auth/login", json={**credentials, "preferred_language": "fr"})
    ).status_code == 422
    assert (
        await client.post(
            "/auth/login", json={**credentials, "password": "incorrect", "preferred_language": "id"}
        )
    ).status_code == 401
    conflict = await client.post("/auth/login", json={**credentials, "preferred_language": "id"})
    assert conflict.status_code == 409
    assert (await client.get("/auth/me", headers=headers)).json()["preferred_language"] == "en"
    approved = await client.post(
        "/auth/login",
        json={
            **credentials,
            "preferred_language": "id",
            "replace_session_id": conflict.json()["detail"]["session_id"],
        },
    )
    assert approved.status_code == 200
    assert approved.json()["user"]["preferred_language"] == "id"
    assert (await client.get("/auth/me", headers=headers)).status_code == 401
    headers = {"Authorization": f"Bearer {approved.json()['access_token']}"}
    assert (await client.post("/auth/logout", headers=headers)).status_code == 204
    # API clients without a browser preference retain the saved account choice.
    again = await client.post("/auth/login", json=credentials)
    assert again.status_code == 200
    assert again.json()["user"]["preferred_language"] == "id"


@pytest.mark.parametrize("role", ["student", "teacher"])
async def test_registration_without_invitation(editorial_http, role):
    client, _, _, _, _, _ = editorial_http
    payload = dict(
        username=f"signup-{role}",
        full_name="Akun pengujian",
        role=role,
        password="registration-test-123",
        preferred_language="en",
    )
    response = await client.post("/auth/register", json=payload)
    assert response.status_code == 201, response.text
    account = response.json()
    assert account["user"]["role"] == role
    assert account["user"]["preferred_language"] == "en"
    assert "password_hash" not in response.text
    assert (await client.post("/auth/register", json=payload)).status_code == 409
    assert (
        await client.post(
            "/auth/login", json={"username": payload["username"], "password": "wrong-password"}
        )
    ).status_code == 401


@pytest.mark.parametrize(
    "changes",
    [
        {"role": "admin"},
        {"password": "short"},
        {"username": "bad name"},
        {"grade_level": "x" * 51},
        {"grade_level": "7\x00A"},
        {"full_name": "Nama\x00Siswa"},
    ],
)
async def test_registration_keeps_validation(editorial_http, changes):
    client, _, _, _, _, _ = editorial_http
    payload = (
        dict(
            username="signup-valid",
            full_name="Test",
            role="student",
            password="registration-test-123",
        )
        | changes
    )
    assert (await client.post("/auth/register", json=payload)).status_code == 422


@pytest.mark.parametrize(
    "changes",
    [{"grade_level": "x" * 51}, {"grade_level": "7\x00A"}, {"full_name": "Nama\x00Siswa"}],
)
async def test_profile_rejects_values_that_cannot_be_stored(editorial_http, changes):
    client, _, _, _, _, headers = editorial_http
    response = await client.patch("/auth/me", json=changes, headers=headers("student"))
    assert response.status_code == 422, response.text


async def test_registration_keeps_unicode_names_and_grade_limit(editorial_http):
    client, _, _, _, _, _ = editorial_http
    payload = dict(
        username="signup-unicode",
        full_name="Ana María",
        grade_level="x" * 50,
        role="student",
        password="registration-test-123",
    )
    response = await client.post("/auth/register", json=payload)
    assert response.status_code == 201, response.text
    assert response.json()["user"]["full_name"] == payload["full_name"]
    assert response.json()["user"]["grade_level"] == payload["grade_level"]


@pytest.mark.parametrize("username", ["", "ab", "x" * 65, "bad name", "bad\x00name", "漢字"])
async def test_username_availability_rejects_invalid_names(editorial_http, username):
    client, _, _, _, _, _ = editorial_http
    response = await client.get("/auth/username-available", params={"username": username})
    assert response.status_code == 422, response.text


async def test_username_availability_normalizes_and_detects_taken_names(editorial_http):
    client, _, _, _, _, _ = editorial_http
    payload = dict(
        username="signup-available",
        full_name="Test",
        role="student",
        password="registration-test-123",
    )
    available = await client.get(
        "/auth/username-available", params={"username": "Signup-Available"}
    )
    assert available.status_code == 200
    assert available.json() == {"username": payload["username"], "available": True}
    assert (await client.post("/auth/register", json=payload)).status_code == 201
    taken = await client.get("/auth/username-available", params={"username": "Signup-Available"})
    assert taken.status_code == 200
    assert taken.json() == {"username": payload["username"], "available": False}


@pytest.mark.parametrize("actor", ["student", "owner", "admin"])
async def test_active_accounts_can_read_text(editorial_http, monkeypatch, actor):
    from api.routes import voice

    client, _, _, _, _, headers = editorial_http
    requests = []

    async def audio(text, **kwargs):
        requests.append((text, kwargs))
        return b"ID3-test-audio"

    monkeypatch.setattr(voice, "synthesise_bytes", audio)
    response = await client.post(
        "/voice/tts", json={"text": "Test", "language": "en"}, headers=headers(actor)
    )
    assert response.status_code == 200, response.text
    assert response.content == b"ID3-test-audio"
    assert response.headers["cache-control"] == "no-store"
    assert requests[0][1]["language"] == "en"
    assert requests[0][1]["scope"].startswith("user:")
    assert (await client.post("/voice/tts", json={"text": "Test"})).status_code == 401


async def test_public_voice_only_accepts_menu_catalog(editorial_http, monkeypatch):
    from api.routes import voice

    client, _, _, _, _, _ = editorial_http

    async def audio(text, **kwargs):
        assert kwargs["scope"] == "public-menu"
        return b"ID3-preview"

    monkeypatch.setattr(voice, "synthesise_bytes", audio)
    response = await client.get("/voice/menu/welcome?language=id")
    assert response.status_code == 200, response.text
    assert response.content == b"ID3-preview"
    assert (await client.get("/voice/menu/free-text?language=id")).status_code == 404
    assert (await client.get("/voice/menu/welcome?language=xx")).status_code == 422


@pytest.mark.parametrize(
    "language,expected",
    [
        ("id", "Bahasa telah berubah ke Bahasa Indonesia."),
        ("en", "Language changed to English."),
    ],
)
async def test_language_confirmation_is_shared_across_accounts(
    editorial_http, monkeypatch, language, expected
):
    from api.routes import voice

    client, _, _, _, _, headers = editorial_http
    requests = []

    async def audio(text, **kwargs):
        requests.append((text, kwargs))
        return b"ID3-language"

    monkeypatch.setattr(voice, "synthesise_bytes", audio)
    for actor in [None, "student", "owner"]:
        response = await client.get(
            f"/voice/menu/language-changed?language={language}",
            headers=headers(actor) if actor else {},
        )
        assert response.status_code == 200, response.text
        assert "public" in response.headers["cache-control"]
    assert all(
        text == expected and context["language"] == language and context["scope"] == "public-menu"
        for text, context in requests
    )
