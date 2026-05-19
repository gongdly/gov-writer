"""5-Layer 프롬프트 빌더.

L1~L3은 정적 (말씀자료/보도자료 분기).
L4(컨텍스트)와 L5(사용자 입력)는 동적 생성.

빅보스님이 4월 speech-writer v0.4에서 검증한 구조를 Python으로 이식.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Literal

from pydantic import BaseModel

from .l1_identity import L1_SPEECH, L1_PRESS
from .l2_domain import L2_SPEECH, L2_PRESS
from .l3_rules import L3_SPEECH, L3_PRESS

DocType = Literal["speech", "press"]

KST = timezone(timedelta(hours=9))


# ─── 입력 데이터 모델 ───


class SpeechInput(BaseModel):
    """말씀자료 생성 입력."""

    event_name: str  # 행사명
    event_type: str = "축사"  # 8종 중 1
    event_date: str = ""  # YYYY-MM-DD
    event_location: str = ""

    speaker_name: str = ""
    speaker_role: str = ""
    speaker_organization: str = ""

    audience: str = ""
    vip_list: list[str] = []  # 주요 참석자
    target_chars: int = 1400  # 분량 (기본 5분 분량)

    key_messages: list[str] = []  # 핵심 메시지 (필수 반영)
    quotes_or_anecdotes: list[str] = []  # 인용·일화
    avoid_phrases: list[str] = []  # 피해야 할 표현

    persona_block: str = ""  # 페르소나 (사전 빌드된 텍스트)


class PressInput(BaseModel):
    """보도자료 생성 입력."""

    title: str  # 보도자료 제목
    subtitle: str = ""  # 부제

    press_type: str = "정책 발표"  # 보도자료 유형
    ministry: str = ""  # 발표 부처
    department: str = ""  # 담당 부서·과
    contact: str = ""  # 담당자 연락처

    # 5W1H
    who: str = ""  # 누가 (주체)
    when_date: str = ""  # 시행일·발표일
    where_location: str = ""
    what_summary: str = ""  # 무엇을
    why_background: str = ""  # 왜 (배경)
    how_method: str = ""  # 어떻게

    target_chars: int = 1500  # A4 1장 기준

    key_points: list[str] = []  # 주요 내용 (필수)
    quotes: list[str] = []  # 인용문 (사용자 입력만 사용)
    schedule: str = ""  # 일정·대상

    expected_effect: str = ""  # 기대 효과


# ─── L4: 컨텍스트 (참고자료·RAG) ───


def build_l4_speech(
    contexts: list[dict] | None = None,
    rag_chunks: list[dict] | None = None,
) -> str:
    """말씀자료 L4 — 업로드 자료 + RAG."""
    parts: list[str] = []

    if contexts:
        # 행사계획서 등
        plan_ctx = [c for c in contexts if c.get("category") == "event_plan"]
        if plan_ctx:
            parts.append("## 행사 계획서")
            for ctx in plan_ctx[:3]:
                parts.append(f"### {ctx.get('file_name', '자료')}")
                parts.append(ctx.get("text", "")[:3000])

        # 추가 참고자료
        other_ctx = [c for c in contexts if c.get("category") != "event_plan"]
        if other_ctx:
            parts.append("## 추가 참고 자료")
            for ctx in other_ctx[:5]:
                cat = ctx.get("category", "기타")
                parts.append(f"### {cat} - {ctx.get('file_name', '자료')}")
                parts.append(ctx.get("text", "")[:2000])

    if rag_chunks:
        parts.append("## 정책브리핑 자동 참조")
        for idx, m in enumerate(rag_chunks[:5], 1):
            date = (m.get("approve_date") or "")[:10] or "날짜 미상"
            ministry = m.get("ministry") or "정책브리핑"
            parts.append(
                f"[참고 {idx}] {ministry} ({date}) - {m.get('article_title', '')}"
            )
            parts.append(m.get("content", "")[:500])

    if not parts:
        return ""
    return "\n\n".join(parts)


def build_l4_press(
    contexts: list[dict] | None = None,
    rag_chunks: list[dict] | None = None,
) -> str:
    """보도자료 L4 — 업로드 자료 + RAG (유사 발표 사례)."""
    parts: list[str] = []

    if contexts:
        parts.append("## 첨부 자료")
        for ctx in contexts[:5]:
            parts.append(f"### {ctx.get('file_name', '자료')}")
            parts.append(ctx.get("text", "")[:3000])

    if rag_chunks:
        parts.append("## 유사 보도자료 (정책브리핑 참고)")
        parts.append("아래는 참고용이며, 직접 인용하지 말고 톤·구조만 참고하십시오.\n")
        for idx, m in enumerate(rag_chunks[:5], 1):
            date = (m.get("approve_date") or "")[:10] or "날짜 미상"
            ministry = m.get("ministry") or "정책브리핑"
            parts.append(
                f"[유사 사례 {idx}] {ministry} ({date}) - {m.get('article_title', '')}"
            )
            parts.append(m.get("content", "")[:500])

    if not parts:
        return ""
    return "\n\n".join(parts)


# ─── L5: 사용자 입력 ───


def build_l5_speech(input: SpeechInput) -> str:
    """말씀자료 L5."""
    today = datetime.now(KST).strftime("%Y년 %m월 %d일")
    parts = ["## 행사 정보"]
    parts.append(f"- 행사명: {input.event_name}")
    parts.append(f"- 유형: {input.event_type}")
    if input.event_date:
        parts.append(f"- 일시: {input.event_date}")
    if input.event_location:
        parts.append(f"- 장소: {input.event_location}")

    parts.append("\n## 발화자")
    if input.speaker_name:
        parts.append(f"- 이름: {input.speaker_name}")
    if input.speaker_role:
        parts.append(f"- 직책: {input.speaker_role}")
    if input.speaker_organization:
        parts.append(f"- 기관: {input.speaker_organization}")

    if input.audience:
        parts.append(f"\n## 청중\n{input.audience}")

    if input.vip_list:
        parts.append("\n## 주요 참석자 (직급 순)")
        for v in input.vip_list:
            parts.append(f"- {v}")

    parts.append(f"\n## 분량 요청\n목표 {input.target_chars}자 (±5%)")

    if input.key_messages:
        parts.append("\n## 핵심 메시지 (반드시 본문에 반영)")
        for m in input.key_messages:
            parts.append(f"- {m}")

    if input.quotes_or_anecdotes:
        parts.append("\n## 인용할 통계·일화")
        for q in input.quotes_or_anecdotes:
            parts.append(f"- {q}")

    if input.avoid_phrases:
        parts.append("\n## 피해야 할 표현")
        for a in input.avoid_phrases:
            parts.append(f"- {a}")

    parts.append(f"\n## 작성일\n{today}")
    return "\n".join(parts)


def build_l5_press(input: PressInput) -> str:
    """보도자료 L5."""
    today = datetime.now(KST).strftime("%Y년 %m월 %d일")
    parts = ["## 보도자료 정보"]
    parts.append(f"- 제목: {input.title}")
    if input.subtitle:
        parts.append(f"- 부제: {input.subtitle}")
    parts.append(f"- 유형: {input.press_type}")

    parts.append("\n## 발표 부처")
    if input.ministry:
        parts.append(f"- 부처: {input.ministry}")
    if input.department:
        parts.append(f"- 담당 부서: {input.department}")
    if input.contact:
        parts.append(f"- 연락처: {input.contact}")

    parts.append("\n## 5W1H")
    if input.who:
        parts.append(f"- 누가 (주체): {input.who}")
    if input.when_date:
        parts.append(f"- 언제: {input.when_date}")
    if input.where_location:
        parts.append(f"- 어디서: {input.where_location}")
    if input.what_summary:
        parts.append(f"- 무엇을: {input.what_summary}")
    if input.why_background:
        parts.append(f"- 왜 (배경): {input.why_background}")
    if input.how_method:
        parts.append(f"- 어떻게: {input.how_method}")

    if input.key_points:
        parts.append("\n## 주요 내용 (반드시 본문에 반영)")
        for p in input.key_points:
            parts.append(f"- {p}")

    if input.schedule:
        parts.append(f"\n## 일정·대상\n{input.schedule}")

    if input.quotes:
        parts.append("\n## 인용문 (반드시 본문에 그대로 인용, 변형 금지)")
        for q in input.quotes:
            parts.append(f'- "{q}"')

    if input.expected_effect:
        parts.append(f"\n## 기대 효과\n{input.expected_effect}")

    parts.append(f"\n## 분량 요청\n목표 {input.target_chars}자 (±5%)")
    parts.append(f"\n## 작성일\n{today}")
    return "\n".join(parts)


# ─── 최종 조립 ───


def build_speech_prompt(
    input: SpeechInput,
    *,
    contexts: list[dict] | None = None,
    rag_chunks: list[dict] | None = None,
) -> tuple[str, str]:
    """말씀자료 프롬프트 (system_prompt, user_prompt) 반환."""
    system_prompt = "\n\n".join([L1_SPEECH, L2_SPEECH, L3_SPEECH])

    user_parts: list[str] = []
    l4 = build_l4_speech(contexts, rag_chunks)
    if l4:
        user_parts.append(l4)

    # 페르소나는 L4와 L5 사이
    if input.persona_block.strip():
        user_parts.append(input.persona_block.strip())

    user_parts.append(build_l5_speech(input))
    user_prompt = "\n\n---\n\n".join(user_parts)

    return system_prompt, user_prompt


def build_press_prompt(
    input: PressInput,
    *,
    contexts: list[dict] | None = None,
    rag_chunks: list[dict] | None = None,
) -> tuple[str, str]:
    """보도자료 프롬프트 (system_prompt, user_prompt) 반환."""
    system_prompt = "\n\n".join([L1_PRESS, L2_PRESS, L3_PRESS])

    user_parts: list[str] = []
    l4 = build_l4_press(contexts, rag_chunks)
    if l4:
        user_parts.append(l4)
    user_parts.append(build_l5_press(input))
    user_prompt = "\n\n---\n\n".join(user_parts)

    return system_prompt, user_prompt
