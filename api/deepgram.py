from __future__ import annotations

import os
from dataclasses import dataclass

import httpx

DEEPGRAM_GRANT_URL = "https://api.deepgram.com/v1/auth/grant"


class DeepgramError(RuntimeError):
    def __init__(self, category: str) -> None:
        super().__init__(category)
        self.category = category


@dataclass(frozen=True)
class DeepgramSettings:
    api_key: str
    timeout_seconds: float

    @classmethod
    def from_environment(cls) -> DeepgramSettings:
        api_key = os.getenv("DEEPGRAM_API_KEY", "").strip()
        if not api_key:
            raise DeepgramError("deepgram_not_configured")
        try:
            timeout = float(os.getenv("DEEPGRAM_REQUEST_TIMEOUT_SECONDS", "10"))
        except ValueError as error:
            raise DeepgramError("deepgram_invalid_configuration") from error
        if timeout <= 0:
            raise DeepgramError("deepgram_invalid_configuration")
        return cls(api_key=api_key, timeout_seconds=timeout)


async def issue_deepgram_temporary_token(
    settings: DeepgramSettings | None = None,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, str | int]:
    resolved = settings or DeepgramSettings.from_environment()
    try:
        async with httpx.AsyncClient(
            timeout=resolved.timeout_seconds,
            transport=transport,
        ) as client:
            response = await client.post(
                DEEPGRAM_GRANT_URL,
                headers={
                    "Authorization": f"Token {resolved.api_key}",
                    "Content-Type": "application/json",
                },
                json={},
            )
    except httpx.TimeoutException as error:
        raise DeepgramError("deepgram_token_timeout") from error
    except httpx.HTTPError as error:
        raise DeepgramError("deepgram_token_unreachable") from error

    if response.status_code in {401, 403}:
        raise DeepgramError("deepgram_authentication_failed")
    if not response.is_success:
        raise DeepgramError("deepgram_token_upstream_error")
    try:
        payload = response.json()
        access_token = str(payload["access_token"]).strip()
        expires_in = int(payload["expires_in"])
    except (KeyError, TypeError, ValueError) as error:
        raise DeepgramError("deepgram_invalid_token_response") from error
    if not access_token or expires_in <= 0:
        raise DeepgramError("deepgram_invalid_token_response")
    return {"access_token": access_token, "expires_in": expires_in}
