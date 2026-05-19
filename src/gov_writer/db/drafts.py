"""작성 이력(drafts) Supabase 헬퍼.

drafts 테이블 구조 (001_init.sql):
    id: UUID
    doc_type: 'speech' | 'press'
    title: TEXT
    form_data: JSONB (입력 폼 전체)
    generated_text: TEXT
    edit_history: JSONB
    persona_id: UUID
    rag_references: JSONB
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


async def create_draft(
    *,
    doc_type: str,
    title: str,
    form_data: dict[str, Any],
    generated_text: str,
    rag_references: list[str] | None = None,
    persona_id: str | None = None,
) -> dict[str, Any]:
    """드래프트 저장. 생성된 row 반환."""
    body: dict[str, Any] = {
        "doc_type": doc_type,
        "title": title,
        "form_data": form_data,
        "generated_text": generated_text,
        "rag_references": rag_references or [],
    }
    if persona_id:
        body["persona_id"] = persona_id

    url = f"{_base_url()}/rest/v1/drafts"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=body, headers=_headers())
        resp.raise_for_status()
        data = resp.json()
        return data[0] if isinstance(data, list) else data


async def get_draft(draft_id: str) -> dict[str, Any] | None:
    """드래프트 단건 조회."""
    url = f"{_base_url()}/rest/v1/drafts"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            url,
            params={"select": "*", "id": f"eq.{draft_id}", "limit": 1},
            headers=_headers(),
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0] if rows else None


async def list_drafts(
    *,
    doc_type: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """드래프트 목록 (최신순)."""
    url = f"{_base_url()}/rest/v1/drafts"
    params: dict[str, Any] = {
        "select": "id,doc_type,title,created_at,updated_at",
        "order": "created_at.desc",
        "limit": limit,
    }
    if doc_type:
        params["doc_type"] = f"eq.{doc_type}"

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, params=params, headers=_headers())
        resp.raise_for_status()
        return resp.json()


async def update_draft(
    draft_id: str,
    *,
    generated_text: str | None = None,
    edit_history: list[dict] | None = None,
) -> dict[str, Any] | None:
    """드래프트 수정."""
    body: dict[str, Any] = {}
    if generated_text is not None:
        body["generated_text"] = generated_text
    if edit_history is not None:
        body["edit_history"] = edit_history

    if not body:
        return await get_draft(draft_id)

    url = f"{_base_url()}/rest/v1/drafts"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.patch(
            url, params={"id": f"eq.{draft_id}"}, json=body, headers=_headers()
        )
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list) and data:
            return data[0]
        return None
