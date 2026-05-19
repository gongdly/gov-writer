"""사용자 입력 API 키 유효성 검증.

흐름:
    1. 사용자가 /settings에서 키 입력
    2. "테스트" 버튼 클릭 → POST /api/validate-key
    3. 서버가 실제 LLM API 1회 호출 (최소 토큰)로 검증
    4. 응답 후 키 즉시 폐기 (저장·로깅 금지)
"""
from __future__ import annotations

from typing import Literal

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["settings"])


class ValidateKeyRequest(BaseModel):
    provider: Literal["anthropic", "gemini", "openai"]
    api_key: str


class ValidateKeyResponse(BaseModel):
    valid: bool
    error: str | None = None


async def _test_anthropic(api_key: str) -> None:
    """Anthropic Claude 키 검증 — 최소 토큰 호출."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "1"}],
            },
        )
        if resp.status_code == 401:
            raise ValueError("API 키 인증 실패 (401)")
        if resp.status_code == 429:
            raise ValueError("API 호출 한도 초과 (429) - 키는 유효함")
        resp.raise_for_status()


async def _test_gemini(api_key: str) -> None:
    """Gemini 키 검증 — 모델 목록 호출 (가장 가벼움)."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            "https://generativelanguage.googleapis.com/v1beta/models",
            params={"key": api_key},
        )
        if resp.status_code in (401, 403):
            raise ValueError("API 키 인증 실패")
        resp.raise_for_status()


async def _test_openai(api_key: str) -> None:
    """OpenAI 키 검증 — 모델 목록 호출."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            "https://api.openai.com/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        if resp.status_code == 401:
            raise ValueError("API 키 인증 실패 (401)")
        resp.raise_for_status()


@router.post("/api/validate-key", response_model=ValidateKeyResponse)
async def validate_key(body: ValidateKeyRequest) -> ValidateKeyResponse:
    """사용자 API 키 유효성 검증.

    ⚠️ 받은 키는 응답 후 즉시 폐기. DB·로그·디스크 저장 일체 금지.
    """
    if not body.api_key or not body.api_key.strip():
        return ValidateKeyResponse(valid=False, error="API 키가 비어있습니다")

    try:
        if body.provider == "anthropic":
            await _test_anthropic(body.api_key)
        elif body.provider == "gemini":
            await _test_gemini(body.api_key)
        elif body.provider == "openai":
            await _test_openai(body.api_key)
        return ValidateKeyResponse(valid=True)
    except ValueError as e:
        return ValidateKeyResponse(valid=False, error=str(e))
    except httpx.HTTPStatusError as e:
        return ValidateKeyResponse(
            valid=False, error=f"검증 실패: HTTP {e.response.status_code}"
        )
    except Exception as e:
        return ValidateKeyResponse(valid=False, error=f"검증 중 오류: {type(e).__name__}")
