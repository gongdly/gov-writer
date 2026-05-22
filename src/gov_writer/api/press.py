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
    days: int = Query(3, ge=1, le=90),
    limit: int = Query(50, ge=1, le=100),
    early_stop: bool = Query(False, description="True면 필요한 만큼만 조회 후 즉시 종료 (빠른 검색)"),
):
    api_key = os.environ.get("POLICY_BRIEFING_API_KEY", "")
    if not api_key:
        raise HTTPException(500, "POLICY_BRIEFING_API_KEY 미설정")
    try:
        results = await search_press_releases(
            api_key=api_key, query=q, ministry=ministry, days=days, limit=limit,
            early_stop=early_stop,
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

SYSTEM_PROMPT = """당신은 한국 정부·지자체 보도자료 작성 전문가입니다.
대한민국 정부 보도자료의 표준 양식과 톤을 정확히 따릅니다.

# 1. 종결어미 (가장 중요)
보도자료는 서술형 평어체입니다. 절대 ~합니다, ~겠습니다 같은 경어체를 쓰지 마세요.

✓ 옳음: "~다 / ~했다 / ~밝혔다 / ~말했다 / ~강조했다 / ~계획이다 / ~예정이다"
✗ 틀림: "~합니다 / ~했습니다 / ~밝혔습니다 / ~계획입니다"

# 2. 문서 구조
[제목]
- 25~40자 이내, 핵심 메시지 한 줄
- "기관명, ~ 발표" / "기관명, ~ 추진" 식 명사형 종결 가능

[부제]
- "- "로 시작, 60자 이내
- 제목을 보완하는 핵심 수치·일정·범위

[리드문]
- "□ "로 시작
- 첫 문장 필수 요소: 발표 주체(기관명), 발표일, 핵심 내용
- 예: "□ 경상남도(도지사 ○○○)는 5월 20일, 2025년 중소기업 지원사업 5대 분야 90여 개 사업을 발표했다."

[본문 단락 (3~6개 이상, 원본 분량에 맞춰)]
- 각 단락 " ○ "로 시작
- 첫 단락: 추진 배경·필요성
- 중간 단락: 주요 내용 (정책 세부, 분야별, 시행일·대상·예산 등)
- 향후 계획·기대 효과 단락
- **마지막 단락: 기관장 인용문 — 필수**
  - 형식: " ○ ○○○ ○○○○지사는 \\"...\\"라며, \\"...\\"라고 밝혔다."
  - 한국 정부 보도자료 표준상 마지막에 배치
  - 원본에 인용문이 없어도 사업 취지·기대효과를 바탕으로 자연스럽게 구성

# 3. 작성 원칙
- 사실·수치·날짜·기관명·인명은 원본 자료 그대로
- 원본에 없는 통계·시기는 추가하지 않음
- 다만 한국 보도자료 표준 양식(인용문, 종결어미, 단락 구조)은 원본에 없어도 적용
- 5W1H 명확하게: 누가(기관), 언제(발표일), 무엇을(정책), 어떻게(방식), 왜(목적), 어디서(지역)

# 4. 참조 자료 사용 (있을 때만)
- [참조 보도자료]가 제공되면 톤·구조·문체만 학습
- 참조 자료의 수치·인용문·정책 내용은 우리 보도자료에 절대 넣지 않음

# 응답 형식
오직 JSON만 출력. ```json 블록도 없이.
{
  "title": "메인 제목 (40자 이내)",
  "subtitle": "- 부제목 (60자 이내)",
  "lead_paragraph": "□ 리드문 (발표주체·날짜·핵심)...",
  "body_paragraphs": [
    " ○ 본문 단락 1 (배경·필요성)...",
    " ○ 본문 단락 2 (주요 내용)...",
    " ○ 본문 단락 3 (세부 정책)...",
    " ○ 향후 계획·기대 효과...",
    " ○ ○○○ 도지사는 \\"...\\"라며, \\"...\\"라고 밝혔다."
  ]
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
            max_tokens=3500,
            temperature=0.4,
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

AUTO_SYSTEM_PROMPT = """당신은 한국 정부·지자체 보도자료 작성 전문가입니다.
사용자가 사업계획서·정책자료를 업로드하면 그 내용을 분석하여
한국 정부 보도자료 표준 양식의 완성된 초안을 작성합니다.

# 1. 종결어미 — 가장 중요 (절대 위반 금지)
보도자료는 서술형 평어체입니다.
✓ 옳음: "~다 / ~했다 / ~밝혔다 / ~말했다 / ~강조했다 / ~계획이다 / ~예정이다"
✗ 절대 금지: "~합니다 / ~했습니다 / ~밝혔습니다 / ~계획입니다 / ~예정입니다"

이 규칙을 어기면 보도자료가 아니라 말씀자료가 됩니다.

# 2. 표준 구조 (반드시 모두 포함)

## 제목 (title)
- 25~40자, 핵심 메시지 한 줄
- 형식: "기관명, ~ 발표" / "기관명, ~ 추진" / "기관명, ~ 본격 추진"

## 부제 (subtitle)
- "- "로 시작, 60자 이내
- 핵심 수치·일정·범위 보완

## 리드문 (lead_paragraph)
- "□ "로 시작 (□ 다음 공백 1개)
- 필수 요소: 기관명(직책 ○○○ 포함), 발표일, 핵심 내용
- 예: "□ 경상남도(도지사 ○○○)는 5월 20일, 2025년 중소기업 지원사업 5대 분야 90여 개 사업을 발표했다."
- 기관장 이름이 원본에 없으면 "(도지사 ○○○)" 처럼 ○○○로 표기

## 본문 단락 (body_paragraphs)
각 단락 " ○ "로 시작 (앞 공백 1개 + ○ + 공백 1개).
원본 자료에 담긴 정보를 충실하게 풀어 작성하세요.
단락 수는 원본 내용 분량에 맞춰 자유롭게 (보통 5~8개, 풍부한 자료는 더 많아도 됨).

권장 순서:
1. 첫 단락: 추진 배경·필요성 (왜 이 사업·정책이 필요한가)
2. 중간 단락들: 주요 내용을 분야·항목별로 충분히 풀어쓰기
   - 사업이 여러 분야로 나뉘면 분야별로 한 단락씩
   - 시행일·대상·예산·신규 사업 등 세부 내용 포함
   - 원본의 풍부한 정보를 압축하지 말고 그대로 살릴 것
3. 향후 계획·기대 효과 단락 (있으면)
4. **마지막 단락: 기관장 인용문 — 필수**
   - 반드시 마지막에 배치 (한국 보도자료 표준)
   - 형식: " ○ ○○○ ○○○○지사는 \\"...\\"라며, \\"...\\"라고 밝혔다."
   - 인용문 2개 (앞은 정책 의미, 뒤는 향후 다짐/기대)
   - 원본에 도지사·시장·장관 이름이 없으면 "○○○"로 표기

# 3. 기관장 인용문 — 절대 빠뜨리지 말 것 (그리고 마지막에 배치)
한국 정부 보도자료는 거의 100% 기관장 인용문을 **마지막 단락**에 포함합니다.
원본에 인용문이 명시되지 않아도, 사업 취지·목표를 바탕으로 자연스러운 인용문을 구성합니다.

예시 (경상남도 사업의 경우):
" ○ ○○○ 경상남도지사는 \\"이번 지원사업은 지역 중소기업의 전 주기적 성장을 돕는 종합 패키지\\"라며, \\"신산업·수출·창업 등 미래 성장 동력 확보와 지역 경제 활성화에 최선을 다하겠다\\"라고 밝혔다."

# 4. 정확성 원칙
- 사업명·금액·날짜·기관명·고유명사: 원본 자료 그대로
- 통계·수치: 원본에 있는 것만 사용
- 다만 인용문은 한국 보도자료 표준 양식의 일부이므로, 원본 정보로 자연스럽게 구성

# 5. 참조 자료 (있을 때만)
- [참조 보도자료]가 제공되면 톤·종결어미·문체만 학습
- 참조 자료의 수치·인용문·정책 내용은 우리 보도자료에 인용 금지

# 응답 형식
오직 JSON만. ```json 블록도 없이, 설명 텍스트도 없이.
{
  "title": "...",
  "subtitle": "- ...",
  "lead_paragraph": "□ 기관(직책 ○○○)은 [발표일], [핵심 내용]을 발표했다.",
  "body_paragraphs": [
    " ○ 배경·필요성 단락...",
    " ○ 주요 내용 단락 1 (분야별 상세)...",
    " ○ 주요 내용 단락 2 (분야별 상세)...",
    " ○ 주요 내용 단락 3 (분야별 상세)...",
    " ○ 향후 계획·기대 효과 단락...",
    " ○ ○○○ 기관장은 \\"...\\"라며, \\"...\\"라고 밝혔다."
  ],
  "confidence": 0.85
}"""


@router.post("/auto-draft")
async def press_auto_draft(
    main_file: UploadFile = File(..., description="사업계획서·정책자료 (필수)"),
    additional_files: list[UploadFile] = File(default=[], description="추가 참고 자료 (선택)"),
    ref_texts: str = Form("[]", description="정책브리핑 참조 JSON 배열 (선택)"),
    use_refs: str = Form("false", description="정책브리핑 참조 사용 여부 (기본 false)"),
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

    use_refs="true"일 때만 정책브리핑 참조 자료를 프롬프트에 포함.
    기본값 false (지자체·신규 사업은 정책브리핑 참조가 무용한 경우가 많음).

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

        # 3. 정책브리핑 참조 텍스트 — use_refs="true"일 때만 사용
        use_refs_bool = use_refs.lower() in ("true", "1", "yes")
        refs: list = []
        if use_refs_bool:
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
            prompt_parts.append(
                "\n# 유사 보도자료 (톤·종결어미·문체만 학습. 수치·인용문·정책 내용 인용 절대 금지)"
            )
            prompt_parts.extend(str(r)[:1000] for r in refs[:3])
        if instructions.strip():
            prompt_parts.append(f"\n# 추가 지시\n{instructions.strip()}")
        prompt_parts.append(
            "\n위 자료를 바탕으로 한국 정부 보도자료 JSON을 작성하세요.\n"
            "- 종결어미는 반드시 평어체(~다/~했다/~밝혔다)\n"
            "- 기관장 인용문 단락은 반드시 **본문 맨 마지막**에 배치\n"
            "- 원본 자료의 분야별·항목별 세부 정보를 압축하지 말고 풍부하게 풀어쓸 것\n"
            "- 사실·수치·날짜는 원본 그대로"
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
                max_tokens=4000,
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
