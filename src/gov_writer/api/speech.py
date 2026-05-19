"""말씀자료 API 라우터.

5-Layer 프롬프트(prompts/builder.py)로 부처 6단 정형 구조의 말씀자료 생성.

엔드포인트:
    POST /api/speech/draft               — JSON 본문 (참고자료 텍스트)
    POST /api/speech/draft-with-docs     — multipart (파일 업로드 포함)

⚠️ 보안: LLM API 키는 X-Anthropic-Key / X-Gemini-Key / X-OpenAI-Key 헤더만.
응답 후 즉시 폐기.
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel

from ..db import create_draft
from ..extractors import extract_text
from ..llm.client import LLMError, call_llm
from ..prompts import SpeechInput, build_speech_prompt

router = APIRouter(prefix="/api/speech", tags=["speech"])


def _resolve_user_key(
    provider: str,
    anthropic: str | None,
    gemini: str | None,
    openai: str | None,
) -> str:
    mapping = {
        "anthropic": anthropic,
        "claude": anthropic,
        "gemini": gemini,
        "openai": openai,
    }
    key = mapping.get(provider.lower())
    if not key:
        raise HTTPException(401, f"{provider} API 키가 헤더에 없습니다")
    return key


class SpeechDraftRequest(BaseModel):
    """말씀자료 작성 요청."""
    input: SpeechInput
    plan_text: str = ""  # 행사계획서 텍스트 (자동 추출 결과)
    reference_texts: list[str] = []  # 참고자료 텍스트 목록
    max_tokens: int = 4000
    temperature: float = 0.7


async def _do_speech_draft(
    *,
    input: SpeechInput,
    contexts: list[dict] | None,
    provider: str,
    api_key: str,
    max_tokens: int,
    temperature: float,
) -> dict:
    """공통 말씀자료 생성."""
    if not input.event_name.strip():
        raise HTTPException(400, "행사명(event_name)을 입력해주세요")

    system_prompt, user_prompt = build_speech_prompt(
        input,
        contexts=contexts,
        rag_chunks=None,  # 말씀자료는 업로드 자료 기반 (RAG는 Phase 4.5에서 옵션)
    )

    norm_provider = (
        "anthropic" if provider.lower() in ("claude", "anthropic") else provider.lower()
    )

    try:
        text = await call_llm(
            provider=norm_provider,  # type: ignore
            api_key=api_key,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=max_tokens,
            temperature=temperature,
        )
    except LLMError as e:
        raise HTTPException(
            status_code=e.status_code or 500,
            detail=f"LLM 호출 실패: {e}",
        )

    # drafts 저장 (실패 무시)
    draft_id: str | None = None
    try:
        draft_row = await create_draft(
            doc_type="speech",
            title=input.event_name,
            form_data=input.model_dump(),
            generated_text=text,
            rag_references=[],
        )
        if draft_row:
            draft_id = draft_row.get("id")
    except Exception:
        pass

    return {
        "generated_text": text,
        "char_count": len(text),
        "draft_id": draft_id,
    }


@router.post("/draft")
async def speech_draft(
    req: SpeechDraftRequest,
    x_llm_provider: str = Header("gemini"),
    x_anthropic_key: Optional[str] = Header(None),
    x_gemini_key: Optional[str] = Header(None),
    x_openai_key: Optional[str] = Header(None),
):
    """말씀자료 생성 (JSON 본문, 텍스트 형태 참고자료만)."""
    api_key = _resolve_user_key(
        x_llm_provider, x_anthropic_key, x_gemini_key, x_openai_key
    )

    # 참고자료를 contexts 형태로 변환
    contexts: list[dict] = []
    if req.plan_text.strip():
        contexts.append({
            "category": "event_plan",
            "file_name": "행사계획서",
            "text": req.plan_text,
        })
    for i, ref_text in enumerate(req.reference_texts):
        if ref_text.strip():
            contexts.append({
                "category": "reference",
                "file_name": f"참고자료 {i+1}",
                "text": ref_text,
            })

    try:
        return await _do_speech_draft(
            input=req.input,
            contexts=contexts if contexts else None,
            provider=x_llm_provider,
            api_key=api_key,
            max_tokens=req.max_tokens,
            temperature=req.temperature,
        )
    finally:
        del api_key


@router.post("/draft-with-docs")
async def speech_draft_with_docs(
    input_json: str = Form(..., description="SpeechInput JSON"),
    plan_file: Optional[UploadFile] = File(None, description="행사계획서 (단일)"),
    reference_files: list[UploadFile] = File(default=[], description="참고자료 (다중)"),
    max_tokens: int = Form(4000),
    temperature: float = Form(0.7),
    x_llm_provider: str = Header("gemini"),
    x_anthropic_key: Optional[str] = Header(None),
    x_gemini_key: Optional[str] = Header(None),
    x_openai_key: Optional[str] = Header(None),
):
    """말씀자료 생성 + 파일 업로드 (행사계획서 + 참고자료)."""
    api_key = _resolve_user_key(
        x_llm_provider, x_anthropic_key, x_gemini_key, x_openai_key
    )

    # input_json 파싱
    try:
        input_dict = json.loads(input_json)
        input = SpeechInput(**input_dict)
    except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(400, f"input_json 파싱 실패: {e}")

    contexts: list[dict] = []

    # 행사계획서
    if plan_file and plan_file.filename:
        content = await plan_file.read()
        if content:
            text = extract_text(plan_file.filename, content)
            contexts.append({
                "category": "event_plan",
                "file_name": plan_file.filename,
                "text": text,
            })

    # 참고자료
    for ref in reference_files:
        if not ref.filename:
            continue
        content = await ref.read()
        if not content:
            continue
        text = extract_text(ref.filename, content)
        contexts.append({
            "category": "reference",
            "file_name": ref.filename,
            "text": text,
        })

    try:
        return await _do_speech_draft(
            input=input,
            contexts=contexts if contexts else None,
            provider=x_llm_provider,
            api_key=api_key,
            max_tokens=max_tokens,
            temperature=temperature,
        )
    finally:
        del api_key
