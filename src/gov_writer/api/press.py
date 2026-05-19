"""보도자료 API 라우터.

엔드포인트:
    GET  /api/press/search?q=...&ministry=...   — 정책브리핑 검색
    GET  /api/press/detail/{news_id}            — 보도자료 단건 상세
    GET  /api/press/ministries                  — 부처 목록 (최근 보도자료 기준)
    POST /api/press/generate                    — 5-Layer로 본문 생성 (사용자 LLM 키)

⚠️ 보안: LLM API 키는 X-Anthropic-Key / X-Gemini-Key / X-OpenAI-Key 헤더로 받음.
"""
from __future__ import annotations

import os
from typing import Literal, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from ..db import create_draft
from ..llm.client import LLMError, call_llm
from ..policy_api import (
    get_press_release,
    list_ministries,
    list_official_ministries,
    search_press_releases,
)
from ..prompts import PressInput, build_press_prompt
from ..rag import search_policy_chunks

router = APIRouter(prefix="/api/press", tags=["press"])

Provider = Literal["anthropic", "gemini", "openai"]


# ─── 검색·상세 ───


@router.get("/search")
async def press_search(
    q: str = Query("", description="키워드 (제목·본문 매칭)"),
    ministry: Optional[str] = Query(None, description="부처 필터"),
    days: int = Query(3, ge=1, le=3, description="조회 기간 (최대 3일)"),
    limit: int = Query(20, ge=1, le=50),
):
    """정책브리핑 보도자료 키워드 검색."""
    api_key = os.environ.get("POLICY_BRIEFING_API_KEY", "")
    if not api_key:
        raise HTTPException(500, "POLICY_BRIEFING_API_KEY 미설정")

    try:
        results = await search_press_releases(
            api_key=api_key,
            query=q,
            ministry=ministry,
            days=days,
            limit=limit,
        )
        return {"results": results, "count": len(results)}
    except Exception as e:
        raise HTTPException(500, f"검색 실패: {e}")


@router.get("/detail/{news_id}")
async def press_detail(news_id: str):
    """보도자료 단건 상세."""
    api_key = os.environ.get("POLICY_BRIEFING_API_KEY", "")
    if not api_key:
        raise HTTPException(500, "POLICY_BRIEFING_API_KEY 미설정")

    item = await get_press_release(api_key=api_key, news_item_id=news_id)
    if not item:
        raise HTTPException(404, f"보도자료를 찾을 수 없습니다: {news_id}")
    return item


@router.get("/ministries")
async def press_ministries(
    only_recent: bool = Query(False, description="최근 보도자료에 등장한 부처만"),
):
    """부처 목록.

    only_recent=False: 정식 명칭 18개부 등 전체
    only_recent=True: 최근 3일 보도자료에 등장한 부처만
    """
    if only_recent:
        api_key = os.environ.get("POLICY_BRIEFING_API_KEY", "")
        if not api_key:
            raise HTTPException(500, "POLICY_BRIEFING_API_KEY 미설정")
        ministries = await list_ministries(api_key=api_key)
    else:
        ministries = list_official_ministries()
    return {"ministries": ministries}


# ─── 생성 ───


class PressGenerateRequest(BaseModel):
    """보도자료 생성 요청."""
    input: PressInput
    use_rag: bool = True  # RAG 자동 참조
    rag_query: Optional[str] = None  # RAG 검색용 쿼리 (생략 시 제목 사용)
    save_draft: bool = True  # 작성 결과 DB 저장
    max_tokens: int = 4000
    temperature: float = 0.7


class PressGenerateResponse(BaseModel):
    """보도자료 생성 응답."""
    generated_text: str
    rag_used: bool
    rag_count: int
    draft_id: Optional[str] = None
    char_count: int


def _get_user_llm_key(
    provider: Provider,
    anthropic: str | None,
    gemini: str | None,
    openai: str | None,
) -> str:
    """provider에 해당하는 헤더 값 반환."""
    mapping = {"anthropic": anthropic, "gemini": gemini, "openai": openai}
    key = mapping.get(provider)
    if not key:
        raise HTTPException(
            401,
            f"{provider} API 키가 헤더에 없습니다. "
            f"X-{provider.title()}-Key 헤더로 전달해주세요.",
        )
    return key


@router.post("/generate", response_model=PressGenerateResponse)
async def press_generate(
    body: PressGenerateRequest,
    x_llm_provider: str = Header("gemini", description="anthropic|gemini|openai"),
    x_anthropic_key: Optional[str] = Header(None),
    x_gemini_key: Optional[str] = Header(None),
    x_openai_key: Optional[str] = Header(None),
):
    """보도자료 본문 생성.

    흐름:
        1. (선택) RAG에서 유사 보도자료 검색 → L4 컨텍스트
        2. 5-Layer 프롬프트 조립
        3. 사용자 LLM 키로 호출
        4. (선택) drafts 테이블 저장
        5. 응답 후 사용자 키 즉시 폐기
    """
    provider = x_llm_provider.lower().strip()
    if provider not in ("anthropic", "gemini", "openai"):
        raise HTTPException(400, f"지원하지 않는 provider: {provider}")

    user_key = _get_user_llm_key(provider, x_anthropic_key, x_gemini_key, x_openai_key)

    # 1. RAG 검색 (선택)
    rag_chunks: list[dict] = []
    if body.use_rag:
        rag_query = body.rag_query or body.input.title
        if rag_query.strip():
            try:
                rag_chunks = await search_policy_chunks(
                    query=rag_query,
                    match_count=5,
                    similarity_threshold=0.4,
                    user_gemini_key=x_gemini_key,
                    auto_sync=True,
                )
            except Exception:
                # RAG 실패는 무시 (보도자료 생성은 계속)
                rag_chunks = []

    # 2. 5-Layer 프롬프트 조립
    system_prompt, user_prompt = build_press_prompt(
        body.input,
        contexts=None,  # 업로드 자료는 Phase 4+에서 추가
        rag_chunks=rag_chunks if rag_chunks else None,
    )

    # 3. LLM 호출
    try:
        generated_text = await call_llm(
            provider=provider,  # type: ignore
            api_key=user_key,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=body.max_tokens,
            temperature=body.temperature,
        )
    except LLMError as e:
        raise HTTPException(
            status_code=e.status_code or 500,
            detail=f"LLM 호출 실패: {e}",
        )
    finally:
        # 사용자 키 즉시 폐기 (변수 명시적 삭제)
        del user_key

    # 4. drafts 저장 (선택)
    draft_id: Optional[str] = None
    if body.save_draft:
        try:
            rag_refs = list({c.get("article_id") for c in rag_chunks if c.get("article_id")})
            draft_row = await create_draft(
                doc_type="press",
                title=body.input.title,
                form_data=body.input.model_dump(),
                generated_text=generated_text,
                rag_references=rag_refs,
            )
            draft_id = draft_row.get("id") if draft_row else None
        except Exception:
            # 저장 실패는 무시 (본문은 이미 응답)
            draft_id = None

    return PressGenerateResponse(
        generated_text=generated_text,
        rag_used=body.use_rag and bool(rag_chunks),
        rag_count=len(rag_chunks),
        draft_id=draft_id,
        char_count=len(generated_text),
    )
