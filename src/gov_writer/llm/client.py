"""LLM 클라이언트 통합.

3개 provider (Anthropic, Gemini, OpenAI)를 같은 인터페이스로 호출.

⚠️ 보안 원칙:
    - 사용자 API 키는 함수 인자로만 받고 응답 후 즉시 폐기
    - DB·로그·디스크 어디에도 저장 금지
    - 함수 끝나면 변수 GC 대상이 되도록 명시적 처리
"""
from __future__ import annotations

from typing import Literal

import httpx

Provider = Literal["anthropic", "gemini", "openai"]


class LLMError(Exception):
    """LLM 호출 에러."""

    def __init__(self, message: str, *, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


async def call_llm(
    *,
    provider: Provider,
    api_key: str,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 4000,
    temperature: float = 0.7,
    timeout: float = 120.0,
) -> str:
    """LLM 호출. 응답 텍스트 반환.

    Args:
        provider: 'anthropic' | 'gemini' | 'openai'
        api_key: 사용자 API 키 (응답 후 즉시 폐기)
        system_prompt: 5-Layer L1+L2+L3
        user_prompt: L4+L5
        max_tokens: 최대 출력 토큰
        temperature: 0.0~1.0
    """
    if not api_key or not api_key.strip():
        raise LLMError(f"{provider} API 키가 비어있습니다")

    if provider == "anthropic":
        return await _call_anthropic(
            api_key=api_key,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            timeout=timeout,
        )
    elif provider == "gemini":
        return await _call_gemini(
            api_key=api_key,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            timeout=timeout,
        )
    elif provider == "openai":
        return await _call_openai(
            api_key=api_key,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            timeout=timeout,
        )
    else:
        raise LLMError(f"지원하지 않는 provider: {provider}")


async def _call_anthropic(
    *,
    api_key: str,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
    temperature: float,
    timeout: float,
) -> str:
    """Anthropic Claude API 호출."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json={
                "model": "claude-sonnet-4-5-20250929",  # 빠르고 합리적인 비용
                "max_tokens": max_tokens,
                "temperature": temperature,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}],
            },
        )
        if resp.status_code == 401:
            raise LLMError("Anthropic API 인증 실패", status_code=401)
        if resp.status_code == 429:
            raise LLMError("Anthropic API 한도 초과", status_code=429)
        if not resp.is_success:
            raise LLMError(
                f"Anthropic API 오류 (HTTP {resp.status_code}): {resp.text[:200]}",
                status_code=resp.status_code,
            )
        data = resp.json()
        content_blocks = data.get("content", [])
        if not content_blocks:
            raise LLMError("Anthropic 응답에 content 없음")
        return "".join(b.get("text", "") for b in content_blocks if b.get("type") == "text")


async def _call_gemini(
    *,
    api_key: str,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
    temperature: float,
    timeout: float,
) -> str:
    """Gemini API 호출.

    thinking 모드 비활성화 (thinkingConfig.thinkingBudget=0).
    빅보스님이 4월에 발견한 함정 — thinking 토큰이 maxOutputTokens 잠식.
    """
    model = "gemini-2.5-flash"  # 빠르고 한도 큼
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            params={"key": api_key},
            json={
                "system_instruction": {"parts": [{"text": system_prompt}]},
                "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
                "generationConfig": {
                    "maxOutputTokens": max_tokens,
                    "temperature": temperature,
                    "thinkingConfig": {"thinkingBudget": 0},  # ⚠️ 필수
                },
            },
        )
        if resp.status_code in (401, 403):
            raise LLMError("Gemini API 인증 실패", status_code=resp.status_code)
        if resp.status_code == 429:
            raise LLMError("Gemini API 한도 초과", status_code=429)
        if not resp.is_success:
            raise LLMError(
                f"Gemini API 오류 (HTTP {resp.status_code}): {resp.text[:200]}",
                status_code=resp.status_code,
            )
        data = resp.json()
        candidates = data.get("candidates", [])
        if not candidates:
            raise LLMError(f"Gemini 응답에 candidates 없음: {str(data)[:300]}")
        parts = candidates[0].get("content", {}).get("parts", [])
        if not parts:
            finish_reason = candidates[0].get("finishReason", "UNKNOWN")
            raise LLMError(
                f"Gemini 응답이 비어있음 (finishReason={finish_reason}). "
                "max_tokens를 늘려보세요."
            )
        return "".join(p.get("text", "") for p in parts)


async def _call_openai(
    *,
    api_key: str,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
    temperature: float,
    timeout: float,
) -> str:
    """OpenAI API 호출."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "gpt-4o-mini",  # 빠르고 합리적
                "max_tokens": max_tokens,
                "temperature": temperature,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            },
        )
        if resp.status_code == 401:
            raise LLMError("OpenAI API 인증 실패", status_code=401)
        if resp.status_code == 429:
            raise LLMError("OpenAI API 한도 초과", status_code=429)
        if not resp.is_success:
            raise LLMError(
                f"OpenAI API 오류 (HTTP {resp.status_code}): {resp.text[:200]}",
                status_code=resp.status_code,
            )
        data = resp.json()
        choices = data.get("choices", [])
        if not choices:
            raise LLMError("OpenAI 응답에 choices 없음")
        return choices[0].get("message", {}).get("content", "")
