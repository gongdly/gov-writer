"""Phase 12 — 설명자료 작성 API.

행안부 보도설명자료 표준 양식:
    [헤더] 보도 설명자료 / 보도시점 / 제목
    1. 주요 보도내용
        ○ [날짜] [매체] <기사 제목> 제하의 보도임
          - [핵심 쟁점 한 줄]
    2. 동 보도내용에 대한 ○○부의 입장
        ○ [반박 단락]
    [담당자 표]

🔒 절대 규칙:
- 담당자 영역(부서·이름·직급·연락처)은 사용자 폼 입력값만 출력
- AI는 가상의 담당자 이름·연락처 생성 금지
- 학습 데이터의 공무원 이름 인용 금지
"""
from __future__ import annotations

import json
import re
from typing import Optional

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel

from ..db import create_draft
from ..extractors import extract_text
from ..llm.client import LLMError, call_llm

router = APIRouter(prefix="/api/explain", tags=["explain"])


def _resolve_user_key(
    provider: str,
    anthropic: str | None,
    gemini: str | None,
    openai: str | None,
) -> str:
    mapping = {
        "anthropic": anthropic, "claude": anthropic,
        "gemini": gemini, "openai": openai,
    }
    key = mapping.get(provider.lower())
    if not key:
        raise HTTPException(401, f"{provider} API 키가 헤더에 없습니다")
    return key


def _norm_provider(provider: str) -> str:
    return "anthropic" if provider.lower() in ("claude", "anthropic") else provider.lower()


def _parse_json_response(text: str) -> dict | None:
    if not text:
        return None
    clean = re.sub(r"^```(?:json)?\s*\n?", "", text.strip())
    clean = re.sub(r"\n?```$", "", clean)
    match = re.search(r"\{[\s\S]*\}", clean)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


ARTICLE_SUMMARY_PROMPT = """당신은 한국 정부 보도설명자료 작성 보조 도구입니다.
사용자가 업로드한 언론 기사 텍스트를 분석하여 "주요 보도내용" 섹션에 들어갈 정보를 추출합니다.

# 추출 항목
- media_name: 매체명 (예: "이데일리", "조선일보", "채널A")
- article_date: 보도일자 (YYYY.M.D. 형식)
- article_title: 기사 제목 (원문 그대로, 인용 부호 없이)
- key_points: 기사의 핵심 주장 배열 (각 한 줄, 최대 5개)
  · 기사가 주장하는 것을 그대로 옮겨 적기
  · 기사 표현 보존, 왜곡 금지
- confidence: 추출 신뢰도 (0~1)

# 절대 규칙
1. 원본 기사에 없는 내용 추가 금지
2. 기사의 주장을 평가하거나 반박하지 말 것
3. 매체명·일시·제목이 명확하지 않으면 null

# 응답 형식
오직 JSON만. ```json 블록 없이.
{
  "media_name": "...",
  "article_date": "YYYY.M.D.",
  "article_title": "...",
  "key_points": ["...", "..."],
  "confidence": 0.9
}"""


POSITION_FORMAT_PROMPT = """당신은 한국 정부 보도설명자료의 "부처 입장" 섹션을 정리하는 보조 도구입니다.
사용자가 입력한 부처 입장 메모를 받아, 한국 정부 보도설명자료 표준 양식으로 정리만 합니다.

# 절대 원칙
1. 사용자 메모의 사실관계·수치·근거를 그대로 보존. 추가 정보 만들지 마세요.
2. 종결어미는 경어체로 통일: ~입니다 / ~겠습니다 / ~하겠습니다 / ~사실이 아닙니다
3. 양식만 정리: 단락 구분, 마커, 종결어미만 표준화
4. 단락은 사용자 메모의 논리 구조 보존: 한 단락에 한 가지 메시지

# 출력 형식
- paragraphs: 부처 입장 단락 배열
- suggested_title: 부처 메시지 한 줄 (선택, 사용자가 제목을 비웠을 때만)

# 절대 금지
- 사용자 메모에 없는 통계·수치·날짜 추가
- 가상의 담당자 이름·부서명 인용
- 학습 데이터에서 본 공무원 이름 사용

# 응답 형식
오직 JSON만.
{
  "paragraphs": ["...", "..."],
  "suggested_title": "○○부는 ... 하겠습니다"
}"""


AUTO_DRAFT_PROMPT = """당신은 한국 정부 보도설명자료 작성 보조 도구입니다.
사용자가 ①언론 기사와 ②부처 입장 메모를 함께 제공하면, 표준 양식에 맞는 설명자료 JSON을 작성합니다.

# 표준 양식 (행정안전부 보도설명자료 일반형)

[헤더]
- 제목: 부처가 전달하고 싶은 메시지 한 줄
  · 예: "○○부는 ... 노력하겠습니다", "○○ 보도는 사실이 아닙니다"
- 보도시점: 사용자 명시 시 그대로, 없으면 "YYYY.M.D.(요일) 즉시보도"

[1. 주요 보도내용]
- "○ [날짜] [매체] <기사 제목> 제하의 보도임" 한 줄
- "  - [핵심 쟁점]" 들여쓰기로 한 줄에 한 쟁점

[2. 동 보도내용에 대한 ○○부의 입장]
- "○ [반박/설명 단락]" 한 줄에 한 단락
- 종결어미는 경어체: ~입니다 / ~하겠습니다

# 절대 원칙 (위반 시 보안 사고)

1. 기사 내용은 원문 그대로 — 매체·일시·제목·쟁점을 기사 원문에서 추출. 만들지 마세요.
2. 부처 입장은 사용자 메모 그대로 — 사실관계·수치·근거를 보존. 양식만 정리.
3. 담당자 영역 절대 생성 금지 — 담당 부서·이름·직급·연락처를 출력하지 마세요. 이 영역은 사용자가 별도 입력합니다.
4. 가상의 이름 금지 — "○○○ 과장", "홍길동" 같은 자리표시자도 만들지 마세요. 학습 데이터의 공무원 이름 인용 절대 금지.
5. 종결어미 — 보도내용은 기사 원문 그대로, 부처 입장은 경어체 (~입니다)

# 응답 형식
오직 JSON만. ```json 블록 없이.
{
  "title": "부처 메시지 한 줄",
  "report_date": "YYYY.M.D.(요일) 즉시보도",
  "article": {
    "media_name": "...",
    "article_date": "YYYY.M.D.",
    "article_title": "...",
    "key_points": ["...", "..."]
  },
  "position_paragraphs": ["...", "..."],
  "confidence": 0.85
}"""


@router.post("/summarize-article")
async def summarize_article(
    file: Optional[UploadFile] = File(None),
    article_text: str = Form(""),
    x_llm_provider: str = Header("gemini"),
    x_anthropic_key: Optional[str] = Header(None),
    x_gemini_key: Optional[str] = Header(None),
    x_openai_key: Optional[str] = Header(None),
):
    """기사 PDF/텍스트 → 주요 보도내용 섹션 데이터."""
    if file and file.filename:
        content = await file.read()
        if not content:
            raise HTTPException(400, "파일이 비어있습니다")
        try:
            text = extract_text(file.filename, content)
        except Exception as e:
            raise HTTPException(400, f"파일 텍스트 추출 실패: {e}")
    elif article_text.strip():
        text = article_text
    else:
        raise HTTPException(400, "기사 파일 또는 텍스트가 필요합니다")

    if not text.strip():
        raise HTTPException(400, "기사 텍스트가 비어있습니다")

    api_key = _resolve_user_key(
        x_llm_provider, x_anthropic_key, x_gemini_key, x_openai_key
    )

    try:
        truncated = text[:6000]
        user_prompt = f"{ARTICLE_SUMMARY_PROMPT}\n\n# 기사 텍스트\n{truncated}"

        try:
            response = await call_llm(
                provider=_norm_provider(x_llm_provider),  # type: ignore
                api_key=api_key,
                system_prompt="당신은 한국 언론 기사 분석 전문가입니다. JSON으로만 응답.",
                user_prompt=user_prompt,
                max_tokens=1500,
                temperature=0.2,
            )
        except LLMError as e:
            raise HTTPException(e.status_code or 500, f"LLM 호출 실패: {e}")

        parsed = _parse_json_response(response)
        if not parsed:
            return {
                "error": "AI 응답을 JSON으로 파싱할 수 없습니다",
                "raw_text": response[:500],
            }
        return parsed
    finally:
        del api_key


class FormatPositionRequest(BaseModel):
    position_memo: str
    suggest_title: bool = False


@router.post("/format-position")
async def format_position(
    body: FormatPositionRequest,
    x_llm_provider: str = Header("gemini"),
    x_anthropic_key: Optional[str] = Header(None),
    x_gemini_key: Optional[str] = Header(None),
    x_openai_key: Optional[str] = Header(None),
):
    """부처 입장 메모 → 표준 양식 단락 배열."""
    if not body.position_memo.strip():
        raise HTTPException(400, "부처 입장 메모가 필요합니다")

    api_key = _resolve_user_key(
        x_llm_provider, x_anthropic_key, x_gemini_key, x_openai_key
    )

    try:
        extra = "\n사용자가 제목을 비워두었으니, suggested_title도 함께 도출하세요." if body.suggest_title else ""
        user_prompt = (
            f"{POSITION_FORMAT_PROMPT}{extra}\n\n# 사용자 입장 메모\n{body.position_memo[:5000]}"
        )

        try:
            response = await call_llm(
                provider=_norm_provider(x_llm_provider),  # type: ignore
                api_key=api_key,
                system_prompt="당신은 한국 정부 보도설명자료 양식 정리 보조 도구입니다.",
                user_prompt=user_prompt,
                max_tokens=2500,
                temperature=0.3,
            )
        except LLMError as e:
            raise HTTPException(e.status_code or 500, f"LLM 호출 실패: {e}")

        parsed = _parse_json_response(response)
        if not parsed:
            return {
                "error": "AI 응답을 JSON으로 파싱할 수 없습니다",
                "raw_text": response[:500],
                "paragraphs": [],
            }
        return parsed
    finally:
        del api_key


@router.post("/auto-draft")
async def explain_auto_draft(
    article_file: Optional[UploadFile] = File(None),
    article_text: str = Form(""),
    position_memo: str = Form(...),
    title_hint: str = Form(""),
    report_date: str = Form(""),
    x_llm_provider: str = Header("gemini"),
    x_anthropic_key: Optional[str] = Header(None),
    x_gemini_key: Optional[str] = Header(None),
    x_openai_key: Optional[str] = Header(None),
):
    """🎯 통합 자동 작성: 기사 + 부처 입장 → 설명자료 전체.

    ⚠️ 담당자 영역은 응답에 포함하지 않음 (사용자 폼 입력값만 사용).
    """
    if not position_memo.strip():
        raise HTTPException(400, "부처 입장 요지가 필요합니다")

    api_key = _resolve_user_key(
        x_llm_provider, x_anthropic_key, x_gemini_key, x_openai_key
    )

    # 기사 텍스트 확보
    article_content = ""
    if article_file and article_file.filename:
        content = await article_file.read()
        if content:
            try:
                article_content = extract_text(article_file.filename, content)
            except Exception as e:
                raise HTTPException(400, f"기사 파일 추출 실패: {e}")
    if not article_content and article_text.strip():
        article_content = article_text

    try:
        prompt_parts = []
        if article_content.strip():
            prompt_parts.append("# 기사 원문")
            prompt_parts.append(article_content[:6000])
        else:
            prompt_parts.append("# 기사")
            prompt_parts.append("(기사 원문 미제공 — 부처 입장 메모에서 기사 정보 추정 가능 시)")

        prompt_parts.append("\n# 부처 입장 메모 (사용자 입력)")
        prompt_parts.append(position_memo[:5000])

        if title_hint.strip():
            prompt_parts.append(f"\n# 제목 (사용자 지정)\n{title_hint.strip()}")
        else:
            prompt_parts.append("\n# 제목\n(사용자가 비웠음 - 부처 메시지로 도출)")

        if report_date.strip():
            prompt_parts.append(f"\n# 보도시점\n{report_date.strip()}")

        prompt_parts.append(
            "\n위 자료로 한국 정부 보도설명자료 JSON을 작성하세요.\n"
            "- 기사 내용은 원문 그대로 추출\n"
            "- 부처 입장은 사용자 메모를 양식대로 정리 (사실 추가 금지)\n"
            "- 종결어미: 보도내용 평어체, 부처 입장 경어체\n"
            "- 담당자 영역은 응답에 포함하지 마세요"
        )
        user_prompt = "\n\n".join(prompt_parts)

        try:
            text = await call_llm(
                provider=_norm_provider(x_llm_provider),  # type: ignore
                api_key=api_key,
                system_prompt=AUTO_DRAFT_PROMPT,
                user_prompt=user_prompt,
                max_tokens=3000,
                temperature=0.3,
            )
        except LLMError as e:
            raise HTTPException(e.status_code or 500, f"LLM 호출 실패: {e}")

        parsed = _parse_json_response(text)
        if not parsed:
            return {
                "error": "AI 응답 파싱 실패",
                "raw_text": text[:500],
                "title": "",
                "report_date": "",
                "article": {},
                "position_paragraphs": [],
                "confidence": 0,
            }

        # 안전장치: 담당자 영역이 응답에 섞여 들어왔으면 제거
        for forbidden_key in ("contacts", "department", "contact_person", "contact_phone"):
            parsed.pop(forbidden_key, None)

        # 작성 이력 저장 (실패 무시)
        try:
            await create_draft(
                doc_type="explain",
                title=parsed.get("title", article_file.filename if article_file else "설명자료"),
                form_data={
                    "auto_draft": True,
                    "report_date": report_date,
                    "position_memo_preview": position_memo[:200],
                },
                generated_text=json.dumps(parsed, ensure_ascii=False),
                rag_references=[],
            )
        except Exception:
            pass

        return parsed

    finally:
        del api_key
