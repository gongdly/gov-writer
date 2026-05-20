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


# ─── Phase 10: AI 자동 작성 (보조 옵션) ───

SPEECH_AUTO_SYSTEM_PROMPT = """당신은 한국 정부 행사 말씀자료(축사·기념사·연설문) 작성 전문가입니다.
사용자가 행사 계획서를 업로드하면, 그 내용을 분석하여
완성된 말씀자료를 자동으로 작성합니다.

# 절대 원칙
1. **원본에 없는 정보는 만들지 않음**
   - 행사명·일시·장소·참석자는 원본에 있는 것만 사용
   - 원본에 없으면 일반 표현 ("이 자리에", "여러분")
2. **인용·일화·통계는 원본에 명시된 것만**
3. **한국 정부 말씀자료 표준 양식**
   - 종결어미: ~습니다 / ~겠습니다 / ~바랍니다
   - 첫 문장: 인사말 ("존경하는 ~ 여러분, 반갑습니다")
   - 마지막: 감사 인사 ("감사합니다")
4. **격식 있고 따뜻한 어조** (행사 유형에 맞춰)

# 자동 작성 항목
원본 행사 계획서에서 다음을 추출·반영하여 말씀자료 본문 작성:
- 행사명·일시·장소·청중 → 첫 단락 인사·맥락
- 사업·정책 핵심 → 중간 단락 메시지
- 향후 계획·당부 → 후반 단락
- 마무리 → 감사 인사

# 응답 형식
오직 JSON만. ```json 블록 없이.
{
  "title": "○○ 축사",
  "generated_text": "존경하는 ~ 여러분, 반갑습니다.\n\n오늘 ~\n\n...\n\n감사합니다.",
  "event_name": "...",
  "event_date": "...",
  "event_location": "...",
  "speaker_role": "minister/vice_minister/director_general/director/head_of_org",
  "confidence": 0.85
}

generated_text는 단락 간 빈 줄로 구분된 완성 본문."""


@router.post("/auto-draft")
async def speech_auto_draft(
    main_file: UploadFile = File(..., description="행사 계획서 (필수)"),
    additional_files: list[UploadFile] = File(default=[], description="참고 자료 (선택)"),
    instructions: str = Form("", description="추가 지시 (선택)"),
    x_llm_provider: str = Header("gemini"),
    x_anthropic_key: Optional[str] = Header(None),
    x_gemini_key: Optional[str] = Header(None),
    x_openai_key: Optional[str] = Header(None),
):
    """🎯 AI 자동 작성: 행사 계획서 → 완성된 말씀자료.

    수동 작성과 달리 사용자가 폼을 채울 필요 없음.
    파일 한 개 + 한 번 클릭으로 행사 정보 추출 + 본문 생성 통합.

    응답: {
        title, generated_text, event_name, event_date, event_location,
        speaker_role, confidence
    }
    """
    import re

    if not main_file.filename:
        raise HTTPException(400, "행사 계획서 파일이 필요합니다")

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

        # 2. 추가 파일
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

        # 3. 프롬프트 조립
        prompt_parts = [
            "# 행사 계획서 (주 원본)",
            main_text[:8000],
        ]
        if additional_texts:
            prompt_parts.append("\n# 추가 참고 자료")
            prompt_parts.extend(t[:2000] for t in additional_texts[:3])
        if instructions.strip():
            prompt_parts.append(f"\n# 추가 지시\n{instructions.strip()}")
        prompt_parts.append(
            "\n위 자료를 바탕으로 한국 정부 행사 말씀자료를 JSON으로 작성하세요. "
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
                system_prompt=SPEECH_AUTO_SYSTEM_PROMPT,
                user_prompt=user_prompt,
                max_tokens=4000,
                temperature=0.5,
            )
        except LLMError as e:
            raise HTTPException(
                status_code=e.status_code or 500,
                detail=f"LLM 호출 실패: {e}",
            )

        # 4. JSON 파싱
        clean = re.sub(r"^```(?:json)?\s*\n?", "", text.strip())
        clean = re.sub(r"\n?```$", "", clean)
        match = re.search(r"\{[\s\S]*\}", clean)
        if not match:
            return {
                "error": "AI 응답에서 JSON을 찾을 수 없습니다",
                "raw_text": text[:500],
                "title": "",
                "generated_text": "",
                "confidence": 0,
            }
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return {
                "error": "AI 응답 JSON 파싱 실패",
                "raw_text": text[:500],
                "title": "",
                "generated_text": "",
                "confidence": 0,
            }

        # 5. drafts 자동 저장 (실패 무시)
        try:
            await create_draft(
                doc_type="speech",
                title=parsed.get("title", main_file.filename),
                form_data={
                    "auto_draft": True,
                    "main_file": main_file.filename,
                    "instructions": instructions,
                },
                generated_text=parsed.get("generated_text", ""),
                rag_references=[],
            )
        except Exception:
            pass

        # 글자수 추가
        gt = parsed.get("generated_text", "")
        parsed["char_count"] = len(gt)

        return parsed

    finally:
        del api_key
