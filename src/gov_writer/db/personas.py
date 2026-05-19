"""페르소나(personas) Supabase 헬퍼.

personas 테이블 구조 (001_init.sql):
    id: UUID
    name: TEXT NOT NULL                   - 발화자명
    role: TEXT                            - 직책
    organization: TEXT                    - 기관
    tone: TEXT                            - 말투 스타일
    background: TEXT                      - L4/L5 컨텍스트 (구조화 텍스트)
    usage_count: INT
    created_at, updated_at
"""
from __future__ import annotations

import os
from typing import Any

import httpx


def _base_url() -> str:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not url:
        raise RuntimeError("SUPABASE_URL 미설정")
    return url


def _service_key() -> str:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY 미설정")
    return key


def _headers() -> dict[str, str]:
    key = _service_key()
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


async def create_persona(
    *,
    name: str,
    role: str = "",
    organization: str = "",
    tone: str = "",
    background: str = "",
) -> dict[str, Any]:
    """페르소나 생성."""
    body: dict[str, Any] = {"name": name}
    if role:
        body["role"] = role
    if organization:
        body["organization"] = organization
    if tone:
        body["tone"] = tone
    if background:
        body["background"] = background

    url = f"{_base_url()}/rest/v1/personas"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(url, json=body, headers=_headers())
        resp.raise_for_status()
        data = resp.json()
        return data[0] if isinstance(data, list) else data


async def get_persona(persona_id: str) -> dict[str, Any] | None:
    """페르소나 단건 조회."""
    url = f"{_base_url()}/rest/v1/personas"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            url,
            params={"select": "*", "id": f"eq.{persona_id}", "limit": 1},
            headers=_headers(),
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0] if rows else None


async def list_personas(
    *,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """페르소나 목록 (사용 빈도 + 최신순)."""
    url = f"{_base_url()}/rest/v1/personas"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            url,
            params={
                "select": "*",
                "order": "usage_count.desc,updated_at.desc",
                "limit": limit,
            },
            headers=_headers(),
        )
        resp.raise_for_status()
        return resp.json()


async def update_persona(
    persona_id: str,
    *,
    name: str | None = None,
    role: str | None = None,
    organization: str | None = None,
    tone: str | None = None,
    background: str | None = None,
) -> dict[str, Any] | None:
    """페르소나 수정."""
    body: dict[str, Any] = {}
    if name is not None:
        body["name"] = name
    if role is not None:
        body["role"] = role
    if organization is not None:
        body["organization"] = organization
    if tone is not None:
        body["tone"] = tone
    if background is not None:
        body["background"] = background

    if not body:
        return await get_persona(persona_id)

    url = f"{_base_url()}/rest/v1/personas"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.patch(
            url, params={"id": f"eq.{persona_id}"}, json=body, headers=_headers()
        )
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list) and data:
            return data[0]
        return None


async def delete_persona(persona_id: str) -> bool:
    """페르소나 삭제."""
    url = f"{_base_url()}/rest/v1/personas"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.delete(
            url, params={"id": f"eq.{persona_id}"}, headers=_headers()
        )
        resp.raise_for_status()
        return True


async def increment_persona_usage(persona_id: str) -> None:
    """페르소나 사용 횟수 증가 (실패 무시)."""
    persona = await get_persona(persona_id)
    if not persona:
        return
    new_count = (persona.get("usage_count", 0) or 0) + 1
    url = f"{_base_url()}/rest/v1/personas"
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            await client.patch(
                url,
                params={"id": f"eq.{persona_id}"},
                json={"usage_count": new_count},
                headers=_headers(),
            )
        except Exception:
            pass
