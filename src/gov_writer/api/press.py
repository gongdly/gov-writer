"""보도자료 API 라우터.

옛 press-docs-mcp의 /api/ai/draft·/api/ai/draft-with-docs 동작을 그대로 이식.
사용자가 익숙한 흐름: 검색 → 작성(AI 초안+파일업로드) → 미리보기.

엔드포인트:
    GET  /api/press/search                — 정책브리핑 검색
    GET  /api/press/detail/{news_id}      — 단건 상세
    GET  /api/press/ministries            — 부처 목록
    POST /api/press/draft                 — AI 초안 (JSON 본문, 참조 보도자료만)
    POST /api/press/draft-with-docs       — AI 초안 + 파일 업로드 (multipart)
"""
from __future__ import annotations

import json
import os
import re
from typing import Optional

from fastapi import APIRouter, File, Form, Header, HTTPException, Query, UploadFile
from pydantic import BaseModel

from ..db import create_draft
from ..extractors import extract_text
from ..llm.client import LLMError, call_llm
from ..policy_api import (
    get_press_release,
    list_ministries,
    list_official_ministries,
    search_press_releases,
)

router = APIRouter(prefix="/api/press", tags=["press"])


# ─── 정책브리핑 검색·상세 ───


@router.get("/search")
async def press_search(
    q: str = Query("", description="키워드"),
    ministry: Optional[str] = Query(None, description="부처 필터"),
    days: int = Query(3, ge=1, le=3),
    limit: int = Query(50, ge=1, le=100),
):
    api_key = os.environ.get("POLICY_BRIEFING_API_KEY", "")
    if not api_key:
        raise HTTPException(500, "POLICY_BRIEFING_API_KEY 미설정")
    try:
        results = await search_press_releases(
            api_key=api_key, query=q, ministry=ministry, days=days, limit=limit,
        )
        return {"results": results, "count": len(results)}
    except Exception as e:
        raise HTTPException(500, f"검색 실패: {e}")


@router.get("/detail/{news_id}")
async def press_detail(news_id: str):
    api_key = os.environ.get("POLICY_BRIEFING_API_KEY", "")
    if not api_key:
        raise HTTPException(500, "POLICY_BRIEFING_API_KEY 미설정")
    item = await get_press_release(api_key=api_key, news_item_id=news_id)
    if not item:
        raise HTTPException(404, f"보도자료를 찾을 수 없습니다: {news_id}")
    return item


@router.get("/ministries")
async def press_ministries(only_recent: bool = Query(False)):
    if only_recent:
        api_key = os.environ.get("POLICY_BRIEFING_API_KEY", "")
        if not api_key:
            raise HTTPException(500, "POLICY_BRIEFING_API_KEY 미설정")
        ministries = await list_ministries(api_key=api_key)
    else:
        ministries = list_official_ministries()
    return {"ministries": ministries}


# ─── AI 초안 작성 (옛 press-docs-mcp 시스템 프롬프트 그대로) ───

SYSTEM_PROMPT = """당신은 한국 정부 보도자료 작성 전문가입니다.
정부 보도자료의 표준 양식과 톤을 정확히 따릅니다.

핵심 규칙:
- [참조 보도자료]가 제공되면, 해당 보도자료의 톤·구조·문체·용어를 최대한 따르세요.
- 참조 보도자료에 나오는 장관명, 부처명, 직함을 그대로 사용하세요. 당신의 학습 데이터가 아닌 참조 자료의 정보를 우선하세요.
- 리드문은 "□"로 시작
- 본문 단락은 " ○"로 시작
- 역피라미드 구조 (핵심 → 세부사항 → 배경)

응답은 반드시 아래 JSON 형식으로만 출력하세요. 다른 텍스트 없이 JSON만:
{
  "title": "메인 제목",
  "subtitle": "- 부제목",
  "lead_paragraph": "□ 리드문...",
  "body_paragraphs": [" ○ 본문1...", " ○ 본문2...", " ○ 본문3..."]
}"""


def _build_user_prompt(topic: str, instructions: str, ref_texts: list[str]) -> str:
    user_prompt = f"주제: {topic}"
    if instructions:
        user_prompt += f"\n추가 지시: {instructions}"
    if ref_texts:
        user_prompt += "\n\n[참조 보도자료]\n" + "\n---\n".join(ref_texts[:6])
    user_prompt += "\n\nJSON으로 보도자료 초안을 작성해주세요."
    return user_prompt


def _parse_ai_response(text: str) -> dict:
    clean = text.strip()
    if clean.startswith("```"):
        clean = clean.split("\n", 1)[1] if "\n" in clean else clean
    if clean.endswith("```"):
        clean = clean.rsplit("```", 1)[0]
    return json.loads(clean.strip())


class DraftRequest(BaseModel):
    """AI 초안 작성 요청."""
    topic: str
    instructions: str = ""
    ref_texts: list[str] = []


def _resolve_user_key(
    provider: str,
    anthropic: str | None,
    gemini: str | None,
    openai: str | None,
) -> str:
    mapping = {"anthropic": anthropic, "claude": anthropic, "gemini": gemini, "openai": openai}
    key = mapping.get(provider.lower())
    if not key:
        raise HTTPException(401, f"{provider} API 키가 헤더에 없습니다")
    return key


async def _do_draft(
    topic: str,
    instructions: str,
    ref_texts: list[str],
    provider: str,
    api_key: str,
) -> dict:
    """공통 AI 초안 생성."""
    if not topic.strip():
        raise HTTPException(400, "주제(topic)를 입력해주세요")

    user_prompt = _build_user_prompt(topic, instructions, ref_texts)
    norm_provider = "anthropic" if provider.lower() in ("claude", "anthropic") else provider.lower()

    try:
        text = await call_llm(
            provider=norm_provider,  # type: ignore
            api_key=api_key,
            system_prompt=SYSTEM_PROMPT,
            user_prompt=user_prompt,
            max_tokens=2000,
            temperature=0.7,
        )
    except LLMError as e:
        raise HTTPException(
            status_code=e.status_code or 500,
            detail=f"LLM 호출 실패: {e}",
        )

    try:
        parsed = _parse_ai_response(text)
    except (json.JSONDecodeError, ValueError):
        return {"raw_text": text, "error": "JSON 파싱 실패", "title": "", "subtitle": "", "lead_paragraph": "", "body_paragraphs": []}

    # drafts 저장 (실패 무시)
    try:
        await create_draft(
            doc_type="press",
            title=parsed.get("title", topic),
            form_data={"topic": topic, "instructions": instructions, "ref_count": len(ref_texts)},
            generated_text=json.dumps(parsed, ensure_ascii=False),
            rag_references=[],
        )
    except Exception:
        pass

    return parsed


@router.post("/draft")
async def press_draft(
    req: DraftRequest,
    x_llm_provider: str = Header("gemini"),
    x_anthropic_key: Optional[str] = Header(None),
    x_gemini_key: Optional[str] = Header(None),
    x_openai_key: Optional[str] = Header(None),
):
    """AI 초안 작성 (참조 보도자료 텍스트만, 파일 업로드 없음)."""
    api_key = _resolve_user_key(x_llm_provider, x_anthropic_key, x_gemini_key, x_openai_key)
    try:
        return await _do_draft(
            topic=req.topic,
            instructions=req.instructions,
            ref_texts=req.ref_texts,
            provider=x_llm_provider,
            api_key=api_key,
        )
    finally:
        del api_key


@router.post("/draft-with-docs")
async def press_draft_with_docs(
    topic: str = Form(...),
    instructions: str = Form(""),
    ref_texts: str = Form("[]"),
    files: list[UploadFile] = File(default=[]),
    x_llm_provider: str = Header("gemini"),
    x_anthropic_key: Optional[str] = Header(None),
    x_gemini_key: Optional[str] = Header(None),
    x_openai_key: Optional[str] = Header(None),
):
    """AI 초안 작성 + 파일 업로드 (PDF/DOCX/HWPX/TXT)."""
    api_key = _resolve_user_key(x_llm_provider, x_anthropic_key, x_gemini_key, x_openai_key)

    try:
        refs = json.loads(ref_texts)
        if not isinstance(refs, list):
            refs = []
    except json.JSONDecodeError:
        refs = []

    # 파일 텍스트 추출 → ref_texts에 추가
    file_extracts = []
    for f in files:
        if not f.filename:
            continue
        content = await f.read()
        if not content:
            continue
        text = extract_text(f.filename, content)
        file_extracts.append(f"[첨부:{f.filename}]\n{text}")

    combined_refs = (refs + file_extracts)[:6]

    try:
        return await _do_draft(
            topic=topic,
            instructions=instructions,
            ref_texts=combined_refs,
            provider=x_llm_provider,
            api_key=api_key,
        )
    finally:
        del api_key


# ─── Phase 10: AI 자동 작성 (보조 옵션) ───

AUTO_SYSTEM_PROMPT = """당신은 한국 정부 보도자료 작성 전문가입니다.
사용자가 사업계획서·정책자료를 업로드하면, 그 내용을 분석하여
완성된 보도자료 초안 JSON을 자동으로 작성합니다.

# 절대 원칙
1. **원본에 없는 정보는 만들지 않음**
   - 날짜·금액·인용문·통계는 원본에 있는 것만 사용
   - 원본에 없으면 해당 필드를 비우거나 일반 표현으로
2. **부처명·직책·인명은 정확히**
   - 원본에 명시된 그대로
   - 원본에 없으면 "○○부", "장관" 같은 일반 표현
3. **인용문은 원본에 명시된 것만**
   - 원본에 인용문이 없으면 본문에 인용 없이 작성
4. **한국 정부 보도자료 표준 양식**
   - 리드문: "□"로 시작
   - 본문 단락: " ○"로 시작
   - 역피라미드 구조

# 자동 작성 항목
- title: 정책·사업 핵심 한 줄 (40자 이내)
- subtitle: "- "로 시작 부제 (60자 이내, 선택)
- lead_paragraph: "□ "로 시작, 누가·언제·무엇·어떻게 압축 (1~2문장)
- body_paragraphs: 본문 단락 배열 (각 " ○ "로 시작, 3~6개)
  · 첫 단락: 추진 배경·필요성
  · 중간 단락: 주요 내용 (정책 세부, 시행일·대상·예산)
  · 후반 단락: 기대 효과·향후 계획
- confidence: 추출 신뢰도 (0~1)

# 응답 형식
오직 JSON만. ```json 블록 없이, 설명 텍스트 없이.
{
  "title": "...",
  "subtitle": "- ...",
  "lead_paragraph": "□ ...",
  "body_paragraphs": [" ○ ...", " ○ ..."],
  "confidence": 0.85
}"""


@router.post("/auto-draft")
async def press_auto_draft(
    main_file: UploadFile = File(..., description="사업계획서·정책자료 (필수)"),
    additional_files: list[UploadFile] = File(default=[], description="추가 참고 자료 (선택)"),
    ref_texts: str = Form("[]", description="정책브리핑 참조 JSON 배열 (선택)"),
    instructions: str = Form("", description="추가 지시 (선택)"),
    x_llm_provider: str = Header("gemini"),
    x_anthropic_key: Optional[str] = Header(None),
    x_gemini_key: Optional[str] = Header(None),
    x_openai_key: Optional[str] = Header(None),
):
    """🎯 AI 자동 작성: 사업계획서 → 완성된 보도자료 JSON.

    수동 작성과 달리 사용자가 주제·제목·리드·본문을 입력할 필요 없음.
    파일 한 개 + 한 번 클릭으로 완성된 초안 생성.
    응답은 폼에 자동 채워지며, 사용자가 검토·수정 후 미리보기로.

    응답: {title, subtitle, lead_paragraph, body_paragraphs, confidence}
    """
    if not main_file.filename:
        raise HTTPException(400, "사업계획서 파일이 필요합니다")

    api_key = _resolve_user_key(
        x_llm_provider, x_anthropic_key, x_gemini_key, x_openai_key
    )

    try:
        # 1. 메인 파일 추출
        main_content = await main_file.read()
        if not main_content:
            raise HTTPException(400, "메인 파일이 비어있습니다")
        try:
            main_text = extract_text(main_file.filename, main_content)
        except Exception as e:
            raise HTTPException(400, f"메인 파일 텍스트 추출 실패: {e}")
        if not main_text.strip():
            raise HTTPException(400, "메인 파일에서 텍스트를 추출할 수 없습니다")

        # 2. 추가 파일 추출
        additional_texts: list[str] = []
        for f in additional_files:
            if not f.filename:
                continue
            content = await f.read()
            if not content:
                continue
            try:
                text = extract_text(f.filename, content)
                if text.strip():
                    additional_texts.append(f"[참고:{f.filename}]\n{text[:3000]}")
            except Exception:
                pass

        # 3. 정책브리핑 참조 텍스트
        try:
            refs = json.loads(ref_texts) if ref_texts else []
            if not isinstance(refs, list):
                refs = []
        except json.JSONDecodeError:
            refs = []

        # 4. 사용자 프롬프트 조립
        prompt_parts = [
            "# 작성할 보도자료의 주 원본 자료",
            main_text[:8000],
        ]
        if additional_texts:
            prompt_parts.append("\n# 추가 참고 자료")
            prompt_parts.extend(t[:2000] for t in additional_texts[:3])
        if refs:
            prompt_parts.append("\n# 유사 보도자료 (톤·구조 참고용, 인용 금지)")
            prompt_parts.extend(str(r)[:1000] for r in refs[:3])
        if instructions.strip():
            prompt_parts.append(f"\n# 추가 지시\n{instructions.strip()}")
        prompt_parts.append(
            "\n위 자료를 바탕으로 한국 정부 보도자료 JSON을 작성하세요. "
            "원본에 없는 정보는 만들지 마세요."
        )
        user_prompt = "\n\n".join(prompt_parts)

        norm_provider = (
            "anthropic" if x_llm_provider.lower() in ("claude", "anthropic")
            else x_llm_provider.lower()
        )

        try:
            text = await call_llm(
                provider=norm_provider,  # type: ignore
                api_key=api_key,
                system_prompt=AUTO_SYSTEM_PROMPT,
                user_prompt=user_prompt,
                max_tokens=3000,
                temperature=0.4,
            )
        except LLMError as e:
            raise HTTPException(
                status_code=e.status_code or 500,
                detail=f"LLM 호출 실패: {e}",
            )

        # 5. JSON 파싱 (코드 블록 제거)
        clean = re.sub(r"^```(?:json)?\s*\n?", "", text.strip())
        clean = re.sub(r"\n?```$", "", clean)
        match = re.search(r"\{[\s\S]*\}", clean)
        if not match:
            return {
                "error": "AI 응답에서 JSON을 찾을 수 없습니다",
                "raw_text": text[:500],
                "title": "",
                "subtitle": "",
                "lead_paragraph": "",
                "body_paragraphs": [],
                "confidence": 0,
            }
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return {
                "error": "AI 응답 JSON 파싱 실패",
                "raw_text": text[:500],
                "title": "",
                "subtitle": "",
                "lead_paragraph": "",
                "body_paragraphs": [],
                "confidence": 0,
            }

        # 6. drafts 자동 저장 (실패 무시)
        try:
            await create_draft(
                doc_type="press",
                title=parsed.get("title", main_file.filename),
                form_data={
                    "auto_draft": True,
                    "main_file": main_file.filename,
                    "instructions": instructions,
                },
                generated_text=json.dumps(parsed, ensure_ascii=False),
                rag_references=[],
            )
        except Exception:
            pass

        return parsed

    finally:
        del api_key
