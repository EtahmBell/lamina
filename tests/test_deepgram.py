from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

import api.main as api_main
from api.deepgram import DeepgramError, DeepgramSettings, issue_deepgram_temporary_token


def test_token_endpoint_is_safe_when_deepgram_is_not_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
    response = TestClient(api_main.app).post("/integrations/deepgram/token")
    assert response.status_code == 503
    assert response.json() == {"detail": "Deepgram transcription is not configured"}


def test_token_endpoint_returns_only_temporary_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    permanent_key = "permanent-deepgram-key-marker"

    async def fake_token() -> dict[str, str | int]:
        return {"access_token": "temporary-jwt", "expires_in": 30}

    monkeypatch.setenv("DEEPGRAM_API_KEY", permanent_key)
    monkeypatch.setattr(api_main, "issue_deepgram_temporary_token", fake_token)
    response = TestClient(api_main.app).post("/integrations/deepgram/token")
    assert response.status_code == 200
    assert response.json() == {"access_token": "temporary-jwt", "expires_in": 30}
    assert permanent_key not in response.text


def test_token_endpoint_sanitizes_provider_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fail_token() -> dict[str, str | int]:
        raise DeepgramError("deepgram_authentication_failed")

    monkeypatch.setattr(api_main, "issue_deepgram_temporary_token", fail_token)
    response = TestClient(api_main.app).post("/integrations/deepgram/token")
    assert response.status_code == 503
    assert response.json() == {
        "detail": "Deepgram transcription is temporarily unavailable"
    }


@pytest.mark.anyio
async def test_grant_uses_permanent_key_only_in_backend_authorization() -> None:
    permanent_key = "permanent-deepgram-key-marker"

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == f"Token {permanent_key}"
        return httpx.Response(
            200,
            json={"access_token": "temporary-jwt", "expires_in": 30},
        )

    token = await issue_deepgram_temporary_token(
        DeepgramSettings(permanent_key, 5),
        transport=httpx.MockTransport(handler),
    )
    assert token == {"access_token": "temporary-jwt", "expires_in": 30}
    assert permanent_key not in json.dumps(token)
