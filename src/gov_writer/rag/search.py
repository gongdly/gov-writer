"""RAG 의미 검색 + on-demand 캐시 동기화.

핵심 동작:
    1. 검색 요청 시 마지막 동기화 시각 확인
    2. 24h 이상 지났으면 백그라운드로 새 동기화 트리거 (응답 대기 안 함)
    3. 검색은 기존 데이터로 즉시 수행

⚠️ 외부 cron 없음. 사용자 접속이 곧 신선도 트리거.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from . import supabase_client as sb
from .embedding import embed_text
from .sync import get_sync_age_hours, sync_policy_briefing

logger = logging.getLogger(__name__)

STALE_THRESHOLD_HOURS = 24


async def _maybe_trigger_background_sync() -> None:
    """24h 지났으면 백그라운드로 동기화 시작 (실패해도 무시)."""
    try:
        age = await get_sync_age_hours()
        if age is None:
            # 최초 동기화 — 백그라운드 트리거
            logger.info("최초 동기화 — 백그라운드 트리거")
            asyncio.create_task(sync_policy_briefing())
        elif age > STALE_THRESHOLD_HOURS:
            logger.info("동기화 %dh 지남 — 백그라운드 트리거", int(age))
            asyncio.create_task(sync_policy_briefing())
    except Exception as e:
        # 트리거 실패는 검색을 막지 않음
        logger.warning("백그라운드 동기화 트리거 실패 (무시): %s", e)


async def search_policy_chunks(
    query: str,
    *,
    match_count: int = 5,
    similarity_threshold: float = 0.5,
    filter_ministry: str | None = None,
    user_gemini_key: str | None = None,
    auto_sync: bool = True,
) -> list[dict[str, Any]]:
    """의미 검색 진입점.

    Args:
        query: 검색 자연어 쿼리
        match_count: 반환 청크 수
        similarity_threshold: 코사인 유사도 임계값
        filter_ministry: 부처 필터 (옵션)
        user_gemini_key: 사용자 Gemini 키 (헤더에서 받음)
        auto_sync: True면 데이터 오래된 경우 백그라운드 동기화 트리거

    Returns:
        match_policy_chunks RPC 응답
    """
    if not query or not query.strip():
        return []

    # 백그라운드 신선도 체크 (응답 대기 안 함)
    if auto_sync:
        await _maybe_trigger_background_sync()

    # 쿼리 임베딩 (사용자 키 우선)
    query_embedding = await embed_text(
        query,
        api_key=user_gemini_key,
        task_type="RETRIEVAL_QUERY",
    )

    # Supabase RPC
    results = await sb.match_policy_chunks(
        query_embedding=query_embedding,
        match_count=match_count,
        similarity_threshold=similarity_threshold,
        filter_ministry=filter_ministry,
    )

    return results
