"""Phase 5.2 — AI 후속 처리 라우터.

4개 엔드포인트:
    POST /api/refine/regenerate-paragraph  — 단락 단위 재생성
    POST /api/refine/adjust-tone           — 본문 톤 조정
    POST /api/refine/extract-event-info    — 행사 계획서 → 폼 자동 채움
    POST /api/refine/extract-persona       — 이전 자료 → 페르소나 자동 추출

⚠️ 보안: LLM API 키는 X-Anthropic-Key / X-Gemini-Key / X-OpenAI-Key 헤더만.
응답 후 즉시 폐기.
"""
from __future__ import annotations

import json
import re
from typing import Optional

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel

from ..extractors import extract_text
from ..llm.client import LLMError, call_llm

router = APIRouter(prefix="/api/refine", tags=["refine"])


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


def _parse_json_from_response(text: str) -> dict | None:
    """LLM 응답에서 JSON 추출 (코드 블록 제거)."""
    if not text:
        return None
    # ```json ... ``` 블록 제거
    clean = re.sub(r"^```(?:json)?\s*\n?", "", text.strip())
    clean = re.sub(r"\n?```$", "", clean)
    # 첫 { 부터 마지막 } 까지
    match = re.search(r"\{[\s\S]*\}", clean)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


# ─── 1. 단락 재생성 ───


class RegenerateParagraphRequest(BaseModel):
    """단락 재생성 요청.

    full_text: 본문 전체
    target_paragraph: 재생성할 단락 (전체 텍스트 중 일부)
    instruction: 재생성 방향 (선택, 예: "더 간결하게", "수치 추가")
    """
    full_text: str
    target_paragraph: str
    instruction: str = ""
    doc_type: str = "speech"  # speech | press
    max_tokens: int = 1500
    temperature: float = 0.7


@router.post("/regenerate-paragraph")
async def regenerate_paragraph(
    body: RegenerateParagraphRequest,
    x_llm_provider: str = Header("gemini"),
    x_anthropic_key: Optional[str] = Header(None),
    x_gemini_key: Optional[str] = Header(None),
    x_openai_key: Optional[str] = Header(None),
):
    """단락 단위 재생성. 본문 전체 맥락을 유지하면서 특정 단락만 다시 생성."""
    if not body.target_paragraph.strip():
        raise HTTPException(400, "target_paragraph가 비어있습니다")

    api_key = _resolve_user_key(
        x_llm_provider, x_anthropic_key, x_gemini_key, x_openai_key
    )

    doc_label = "보도자료" if body.doc_type == "press" else "말씀자료"
    system_prompt = f"""당신은 대한민국 정부·공공기관의 {doc_label} 작성 전문가입니다.
사용자가 작성된 본문에서 특정 단락을 다시 쓰고 싶어합니다.
다음 원칙을 따라주세요:

1. 본문 전체의 맥락(앞뒤 단락)과 자연스럽게 이어지도록 작성
2. 사용자 추가 지시사항을 우선 반영
3. 한국 정부 행정문서 표준 문체 유지 ({'~다/~했다/~밝혔다' if body.doc_type == 'press' else '~습니다/~겠습니다'})
4. 다른 단락의 내용을 중복하지 않음
5. 응답은 재생성된 단락 텍스트만, 설명·따옴표 없이"""

    instruction_text = f"\n\n# 추가 지시사항\n{body.instruction.strip()}" if body.instruction.strip() else ""

    user_prompt = f"""# 본문 전체 (맥락 참고용)
{body.full_text[:4000]}

# 재생성할 단락
{body.target_paragraph}{instruction_text}

위 단락을 같은 의미·역할은 유지하되 다른 표현으로 다시 작성해주세요. 응답은 단락 텍스트만."""

    norm_provider = "anthropic" if x_llm_provider.lower() in ("claude", "anthropic") else x_llm_provider.lower()

    try:
        text = await call_llm(
            provider=norm_provider,  # type: ignore
            api_key=api_key,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=body.max_tokens,
            temperature=body.temperature,
        )
    except LLMError as e:
        raise HTTPException(e.status_code or 500, f"LLM 호출 실패: {e}")
    finally:
        del api_key

    return {"new_paragraph": text.strip(), "char_count": len(text.strip())}


# ─── 2. 톤 조정 ───


class AdjustToneRequest(BaseModel):
    """본문 톤 조정 요청.

    target_tone:
        - more_formal: 더 격식 있게
        - less_formal: 더 친근하게
        - more_concise: 더 간결하게
        - more_detailed: 더 자세하게
        - custom: instruction 사용
    """
    full_text: str
    target_tone: str = "more_formal"
    instruction: str = ""
    doc_type: str = "speech"
    max_tokens: int = 4000
    temperature: float = 0.5


TONE_LABELS = {
    "more_formal": "더 격식 있고 권위 있는 톤으로",
    "less_formal": "더 친근하고 부드러운 톤으로",
    "more_concise": "더 간결하고 핵심적인 표현으로",
    "more_detailed": "더 자세하고 풍부한 표현으로",
}


@router.post("/adjust-tone")
async def adjust_tone(
    body: AdjustToneRequest,
    x_llm_provider: str = Header("gemini"),
    x_anthropic_key: Optional[str] = Header(None),
    x_gemini_key: Optional[str] = Header(None),
    x_openai_key: Optional[str] = Header(None),
):
    """본문 전체 톤 조정."""
    if not body.full_text.strip():
        raise HTTPException(400, "full_text가 비어있습니다")

    api_key = _resolve_user_key(
        x_llm_provider, x_anthropic_key, x_gemini_key, x_openai_key
    )

    tone_label = TONE_LABELS.get(body.target_tone, "")
    if body.target_tone == "custom":
        tone_instruction = body.instruction.strip() or "자연스러운 톤으로"
    else:
        tone_instruction = tone_label
        if body.instruction.strip():
            tone_instruction += f"\n추가 지시: {body.instruction.strip()}"

    doc_label = "보도자료" if body.doc_type == "press" else "말씀자료"
    system_prompt = f"""당신은 대한민국 정부·공공기관의 {doc_label} 작성 전문가입니다.
주어진 본문의 의미와 정보는 보존하면서 톤만 조정합니다.

원칙:
1. 사실·수치·인용·구조는 절대 바꾸지 않음
2. 단락 구성(빈 줄로 구분)을 유지
3. 한국 정부 행정문서 표준 종결어미 유지
4. 응답은 조정된 전체 본문만, 설명 없이"""

    user_prompt = f"""# 조정 방향
{tone_instruction}

# 원본 본문
{body.full_text}

위 본문을 지시한 방향으로 조정해주세요. 응답은 전체 본문만."""

    norm_provider = "anthropic" if x_llm_provider.lower() in ("claude", "anthropic") else x_llm_provider.lower()

    try:
        text = await call_llm(
            provider=norm_provider,  # type: ignore
            api_key=api_key,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=body.max_tokens,
            temperature=body.temperature,
        )
    except LLMError as e:
        raise HTTPException(e.status_code or 500, f"LLM 호출 실패: {e}")
    finally:
        del api_key

    return {"adjusted_text": text.strip(), "char_count": len(text.strip())}


# ─── 3. 행사 계획서 자동 추출 ───


EVENT_EXTRACT_PROMPT = """다음은 정부·공공기관의 행사 계획서 본문입니다.
이 문서에서 행사 정보를 추출해 JSON 형식으로만 응답하세요.

# 추출 항목 (모두 선택, 없으면 null)
- event_name: 행사명 (정확한 명칭, 예: "「2026 전자정부의 날 기념식」")
- event_date: 일시 (YYYY-MM-DD HH:MM 또는 YYYY-MM-DD)
- event_location: 장소
- event_type: 행사 유형 (다음 중 하나) — chuksa(축사)/gyenyeomsa(기념사)/sinnyeonsa(신년사)/gyeoryeosa(격려사)/hwanyeongsa(환영사)/gaehoesa(개회사)/iimsa(이임사)/seomyeonchuksa(서면축사)
- speaker_role: 발화자 직급 — minister/vice_minister/director_general/director/head_of_org 또는 null
- speaker_organization: 발화자 소속 (예: "행정안전부")
- audience: 청중 (배열) — public_servant/citizen/expert/student/honoree/foreign_guest/industry/media/internal_staff/local_resident
- attendees: 주요 참석자 (배열, "이름 직책" 문자열, 예: ["김OO 장관", "이OO 의원"])
- key_messages: 핵심 메시지 (배열, 최대 3개)
- confidence: 추출 신뢰도 (0~1)

# 응답 형식
오직 JSON만. 설명 텍스트 없이, ```json 블록도 없이.

# 본문"""


@router.post("/extract-event-info")
async def extract_event_info(
    file: UploadFile = File(...),
    x_llm_provider: str = Header("gemini"),
    x_anthropic_key: Optional[str] = Header(None),
    x_gemini_key: Optional[str] = Header(None),
    x_openai_key: Optional[str] = Header(None),
):
    """행사 계획서 파일 → 폼 자동 채움용 데이터."""
    if not file.filename:
        raise HTTPException(400, "파일이 없습니다")

    api_key = _resolve_user_key(
        x_llm_provider, x_anthropic_key, x_gemini_key, x_openai_key
    )

    content = await file.read()
    if not content:
        raise HTTPException(400, "파일이 비어있습니다")

    try:
        text = extract_text(file.filename, content)
    except Exception as e:
        raise HTTPException(400, f"파일 텍스트 추출 실패: {e}")

    if not text.strip():
        raise HTTPException(400, "파일에서 텍스트를 추출할 수 없습니다")

    # 5000자로 제한
    truncated = text[:5000]
    user_prompt = f"{EVENT_EXTRACT_PROMPT}\n{truncated}"

    norm_provider = "anthropic" if x_llm_provider.lower() in ("claude", "anthropic") else x_llm_provider.lower()

    try:
        response = await call_llm(
            provider=norm_provider,  # type: ignore
            api_key=api_key,
            system_prompt="당신은 한국 정부 행사 계획서 분석 전문가입니다. JSON으로만 응답하세요.",
            user_prompt=user_prompt,
            max_tokens=1024,
            temperature=0.2,
        )
    except LLMError as e:
        raise HTTPException(e.status_code or 500, f"LLM 호출 실패: {e}")
    finally:
        del api_key

    parsed = _parse_json_from_response(response)
    if not parsed:
        return {
            "error": "AI 응답을 JSON으로 파싱할 수 없습니다",
            "raw_text": response[:500],
        }

    return parsed


# ─── 4. 페르소나 자동 추출 ───


PERSONA_EXTRACT_PROMPT = """다음은 특정 발화자의 과거 말씀자료(연설문·축사·기념사 등)입니다.
이 발화자의 페르소나(말투·강조 가치·표현 특성)를 분석해 JSON 형식으로만 응답하세요.

# 추출 항목
- name: 발화자 이름 (본문에 명시되어 있으면, 없으면 null)
- role: 직책 (장관/차관/실장/국장/과장/팀장/기관장 등)
- organization: 소속 기관
- tone: 말투 스타일 (다음 중 하나 또는 직접 묘사)
  · "격식 있고 권위적"
  · "친근하고 부드러움"
  · "통계·데이터 중심"
  · "비전·미래 지향적"
  · "균형 잡힌 혼합"
- background: 발화자 특성 (다음 항목을 자연어로 정리)
  · 자주 쓰는 표현·시그니처 문구 (예: "함께 만들어가는", "국민의 시각으로")
  · 강조하는 가치·정책
  · 피하는 표현 (확인 가능한 경우)
  · 자주 인용하는 통계·일화 유형
- confidence: 추출 신뢰도 (0~1, 본문이 짧거나 한 사람의 자료가 아니면 낮게)

# 응답 형식
오직 JSON만. 설명 텍스트 없이, ```json 블록도 없이.
background는 줄바꿈 포함 자연어 문자열 (200~500자).

# 본문"""


@router.post("/extract-persona")
async def extract_persona(
    file: UploadFile = File(...),
    x_llm_provider: str = Header("gemini"),
    x_anthropic_key: Optional[str] = Header(None),
    x_gemini_key: Optional[str] = Header(None),
    x_openai_key: Optional[str] = Header(None),
):
    """이전 자료 파일 → 발화자 페르소나 자동 추출."""
    if not file.filename:
        raise HTTPException(400, "파일이 없습니다")

    api_key = _resolve_user_key(
        x_llm_provider, x_anthropic_key, x_gemini_key, x_openai_key
    )

    content = await file.read()
    if not content:
        raise HTTPException(400, "파일이 비어있습니다")

    try:
        text = extract_text(file.filename, content)
    except Exception as e:
        raise HTTPException(400, f"파일 텍스트 추출 실패: {e}")

    if not text.strip():
        raise HTTPException(400, "파일에서 텍스트를 추출할 수 없습니다")

    truncated = text[:6000]
    user_prompt = f"{PERSONA_EXTRACT_PROMPT}\n{truncated}"

    norm_provider = "anthropic" if x_llm_provider.lower() in ("claude", "anthropic") else x_llm_provider.lower()

    try:
        response = await call_llm(
            provider=norm_provider,  # type: ignore
            api_key=api_key,
            system_prompt="당신은 발화자 페르소나 분석 전문가입니다. JSON으로만 응답하세요.",
            user_prompt=user_prompt,
            max_tokens=1500,
            temperature=0.3,
        )
    except LLMError as e:
        raise HTTPException(e.status_code or 500, f"LLM 호출 실패: {e}")
    finally:
        del api_key

    parsed = _parse_json_from_response(response)
    if not parsed:
        return {
            "error": "AI 응답을 JSON으로 파싱할 수 없습니다",
            "raw_text": response[:500],
        }

    return parsed
