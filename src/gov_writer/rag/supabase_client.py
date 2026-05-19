"""Supabase REST API 클라이언트.

service_role 키로 RLS 우회하여 policy_articles, policy_chunks,
policy_sync_logs 3개 테이블에 직접 접근.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import httpx


def _base_url() -> str:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not url:
        raise RuntimeError("SUPABASE_URL 환경변수가 설정되지 않았습니다")
    return url


def _service_key() -> str:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다")
    return key


def _headers() -> dict[str, str]:
    key = _service_key()
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


async def get_existing_article_ids(news_item_ids: list[str]) -> set[str]:
    """이미 저장된 NewsItemId 조회 (중복 방지)."""
    if not news_item_ids:
        return set()

    ids_param = ",".join(f'"{nid}"' for nid in news_item_ids)
    url = f"{_base_url()}/rest/v1/policy_articles"

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            url,
            params={"select": "news_item_id", "news_item_id": f"in.({ids_param})"},
            headers=_headers(),
        )
        resp.raise_for_status()
        rows = resp.json()
        return {row["news_item_id"] for row in rows}


async def insert_article(article: dict[str, Any]) -> None:
    url = f"{_base_url()}/rest/v1/policy_articles"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=article, headers=_headers())
        resp.raise_for_status()


async def insert_chunks(chunks: list[dict[str, Any]]) -> int:
    if not chunks:
        return 0
    url = f"{_base_url()}/rest/v1/policy_chunks"
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json=chunks, headers=_headers())
        resp.raise_for_status()
        return len(chunks)


async def start_sync_log() -> int:
    url = f"{_base_url()}/rest/v1/policy_sync_logs"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            url, json={"status": "in_progress"}, headers=_headers()
        )
        resp.raise_for_status()
        data = resp.json()
        return data[0]["id"] if isinstance(data, list) else data["id"]


async def finish_sync_log(
    log_id: int,
    *,
    status: str,
    fetched_count: int,
    new_count: int,
    embedded_count: int,
    error_message: str | None = None,
) -> None:
    url = f"{_base_url()}/rest/v1/policy_sync_logs"
    body: dict[str, Any] = {
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "fetched_count": fetched_count,
        "new_count": new_count,
        "embedded_count": embedded_count,
    }
    if error_message:
        body["error_message"] = error_message[:2000]

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.patch(
            url, params={"id": f"eq.{log_id}"}, json=body, headers=_headers()
        )
        resp.raise_for_status()


async def match_policy_chunks(
    query_embedding: list[float],
    match_count: int = 5,
    similarity_threshold: float = 0.5,
    filter_ministry: str | None = None,
) -> list[dict[str, Any]]:
    """match_policy_chunks RPC 호출."""
    url = f"{_base_url()}/rest/v1/rpc/match_policy_chunks"
    body: dict[str, Any] = {
        "query_embedding": query_embedding,
        "match_count": match_count,
        "similarity_threshold": similarity_threshold,
    }
    if filter_ministry:
        body["filter_ministry"] = filter_ministry

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=body, headers=_headers())
        resp.raise_for_status()
        return resp.json()


async def get_latest_successful_sync() -> dict[str, Any] | None:
    """마지막 ok 상태 동기화 1건."""
    url = f"{_base_url()}/rest/v1/policy_sync_logs"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            url,
            params={
                "select": "*",
                "status": "eq.ok",
                "order": "started_at.desc",
                "limit": 1,
            },
            headers=_headers(),
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0] if rows else None


async def is_sync_in_progress() -> bool:
    """현재 동기화 진행 중인지 (중복 방지)."""
    url = f"{_base_url()}/rest/v1/policy_sync_logs"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            url,
            params={
                "select": "id,started_at",
                "status": "eq.in_progress",
                "limit": 1,
            },
            headers=_headers(),
        )
        resp.raise_for_status()
        rows = resp.json()
        if not rows:
            return False
        # 1시간 이상 in_progress면 죽은 로그로 간주
        started = datetime.fromisoformat(rows[0]["started_at"].replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - started).total_seconds()
        return age < 3600


async def count_articles() -> int:
    url = f"{_base_url()}/rest/v1/policy_articles"
    headers = {**_headers(), "Prefer": "count=exact"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.head(url, params={"select": "news_item_id"}, headers=headers)
        resp.raise_for_status()
        cr = resp.headers.get("content-range", "")
        if "/" in cr:
            return int(cr.split("/")[1])
        return 0


async def count_chunks() -> int:
    url = f"{_base_url()}/rest/v1/policy_chunks"
    headers = {**_headers(), "Prefer": "count=exact"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.head(url, params={"select": "id"}, headers=headers)
        resp.raise_for_status()
        cr = resp.headers.get("content-range", "")
        if "/" in cr:
            return int(cr.split("/")[1])
        return 0
