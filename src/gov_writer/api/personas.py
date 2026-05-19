"""페르소나 API 라우터.

엔드포인트:
    GET    /api/personas              — 목록 (사용 빈도순)
    POST   /api/personas              — 생성
    GET    /api/personas/{id}         — 단건 조회
    PUT    /api/personas/{id}         — 수정
    DELETE /api/personas/{id}         — 삭제
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..db import (
    create_persona,
    delete_persona,
    get_persona,
    list_personas,
    update_persona,
)

router = APIRouter(prefix="/api/personas", tags=["personas"])


class PersonaCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    role: str = Field("", max_length=100)
    organization: str = Field("", max_length=200)
    tone: str = Field("", max_length=200)
    background: str = Field("", max_length=4000)


class PersonaUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    role: Optional[str] = Field(None, max_length=100)
    organization: Optional[str] = Field(None, max_length=200)
    tone: Optional[str] = Field(None, max_length=200)
    background: Optional[str] = Field(None, max_length=4000)


@router.get("")
async def personas_list(limit: int = Query(100, ge=1, le=200)):
    """페르소나 목록."""
    try:
        personas = await list_personas(limit=limit)
        return {"personas": personas, "count": len(personas)}
    except Exception as e:
        raise HTTPException(500, f"목록 조회 실패: {e}")


@router.post("")
async def personas_create(body: PersonaCreate):
    """페르소나 생성."""
    try:
        created = await create_persona(
            name=body.name,
            role=body.role,
            organization=body.organization,
            tone=body.tone,
            background=body.background,
        )
        return created
    except Exception as e:
        raise HTTPException(500, f"생성 실패: {e}")


@router.get("/{persona_id}")
async def personas_get(persona_id: str):
    """단건 조회."""
    persona = await get_persona(persona_id)
    if not persona:
        raise HTTPException(404, f"페르소나를 찾을 수 없습니다: {persona_id}")
    return persona


@router.put("/{persona_id}")
async def personas_update(persona_id: str, body: PersonaUpdate):
    """페르소나 수정."""
    try:
        updated = await update_persona(
            persona_id,
            name=body.name,
            role=body.role,
            organization=body.organization,
            tone=body.tone,
            background=body.background,
        )
        if not updated:
            raise HTTPException(404, f"페르소나를 찾을 수 없습니다: {persona_id}")
        return updated
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"수정 실패: {e}")


@router.delete("/{persona_id}")
async def personas_delete(persona_id: str):
    """페르소나 삭제."""
    try:
        await delete_persona(persona_id)
        return {"deleted": True, "id": persona_id}
    except Exception as e:
        raise HTTPException(500, f"삭제 실패: {e}")
