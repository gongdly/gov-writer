"""RAG API 라우터.

엔드포인트:
    POST /api/rag/sync       — 수동 동기화 트리거 (인증 필요)
    POST /api/rag/search     — 의미 검색 (자동 신선도 트리거 포함)
    GET  /api/rag/status     — 마지막 동기화 시각·청크 수
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from ..rag import sync_policy_briefing, search_policy_chunks, get_sync_age_hours
from ..rag import supabase_client as sb

router = APIRouter(prefix="/api/rag", tags=["rag"])


class RagSearchBody(BaseModel):
    query: str
    match_count: int = 5
    similarity_threshold: float = 0.5
    filter_ministry: Optional[str] = None


@router.post("/sync")
async def rag_sync(
    x_rag_sync_secret: Optional[str] = Header(None),
    x_gemini_key: Optional[str] = Header(None),
):
    """수동 동기화 트리거.

    인증:
        RAG_SYNC_SECRET 환경변수가 설정돼 있으면 헤더 일치 필요.
        환경변수 없으면 인증 생략 (개발용).
    """
    expected = os.environ.get("RAG_SYNC_SECRET", "")
    if expected and x_rag_sync_secret != expected:
        raise HTTPException(status_code=401, detail="인증 실패")

    result = await sync_policy_briefing(gemini_api_key=x_gemini_key)
    return result


@router.post("/search")
async def rag_search(
    body: RagSearchBody,
    x_gemini_key: Optional[str] = Header(None),
):
    """의미 검색. 24h 이상 지난 경우 백그라운드로 동기화 자동 트리거."""
    try:
        results = await search_policy_chunks(
            query=body.query,
            match_count=body.match_count,
            similarity_threshold=body.similarity_threshold,
            filter_ministry=body.filter_ministry,
            user_gemini_key=x_gemini_key,
            auto_sync=True,
        )
        return {"matches": results, "count": len(results)}
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status")
async def rag_status():
    """RAG 시스템 상태 — UI 표시용."""
    try:
        age_hours = await get_sync_age_hours()
        article_count = await sb.count_articles()
        chunk_count = await sb.count_chunks()
        latest = await sb.get_latest_successful_sync()

        return {
            "article_count": article_count,
            "chunk_count": chunk_count,
            "sync_age_hours": age_hours,
            "is_stale": age_hours is not None and age_hours > 24,
            "never_synced": age_hours is None,
            "latest_sync": latest,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"상태 조회 실패: {e}")
