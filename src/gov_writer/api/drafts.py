"""작성 이력(drafts) API 라우터.

엔드포인트:
    GET    /api/drafts                  — 목록 (검색·필터·페이징)
    GET    /api/drafts/{draft_id}       — 단건 조회 (재사용용 form_data 포함)
    DELETE /api/drafts/{draft_id}       — 삭제
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..db import delete_draft, get_draft, list_drafts

router = APIRouter(prefix="/api/drafts", tags=["drafts"])


@router.get("")
async def drafts_list(
    doc_type: Optional[str] = Query(None, description="speech | press"),
    search: Optional[str] = Query(None, description="제목 부분 검색"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """작성 이력 목록."""
    if doc_type and doc_type not in ("speech", "press"):
        raise HTTPException(400, "doc_type은 'speech' 또는 'press'여야 합니다")
    try:
        result = await list_drafts(
            doc_type=doc_type,
            search=search,
            limit=limit,
            offset=offset,
        )
        return result
    except Exception as e:
        raise HTTPException(500, f"목록 조회 실패: {e}")


@router.get("/{draft_id}")
async def drafts_get(draft_id: str):
    """단건 조회 (form_data + generated_text 전체)."""
    try:
        draft = await get_draft(draft_id)
        if not draft:
            raise HTTPException(404, f"드래프트를 찾을 수 없습니다: {draft_id}")
        return draft
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"조회 실패: {e}")


@router.delete("/{draft_id}")
async def drafts_delete(draft_id: str):
    """드래프트 삭제."""
    try:
        await delete_draft(draft_id)
        return {"deleted": True, "id": draft_id}
    except Exception as e:
        raise HTTPException(500, f"삭제 실패: {e}")
