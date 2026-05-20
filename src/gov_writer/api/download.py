"""문서 다운로드 API.

엔드포인트:
    POST /api/download/speech/md    — 말씀자료 MD 다운로드
    POST /api/download/speech/hwpx  — 말씀자료 HWPX 다운로드
    POST /api/download/press/md     — 보도자료 MD 다운로드
    POST /api/download/press/hwpx   — 보도자료 HWPX 다운로드

원칙:
- 본문 내용은 클라이언트에서 받음 (서버는 변환만)
- LLM 호출·DB 저장 없음 (작성 단계에서 이미 완료)
- 실패 시 명확한 에러 (silent fallback X)
"""
from __future__ import annotations

from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from ..exporters import (
    press_to_hwpx_bytes,
    press_to_markdown,
    explain_to_hwpx_bytes,
    explain_to_markdown,
    safe_filename,
    speech_to_hwpx_bytes,
    speech_to_markdown,
)

router = APIRouter(prefix="/api/download", tags=["download"])


# ─── 말씀자료 ───


class SpeechDownloadRequest(BaseModel):
    generated_text: str
    title: str = ""


def _content_disposition(filename: str) -> str:
    """RFC 5987 한글 파일명 지원."""
    encoded = quote(filename, safe="")
    return f"attachment; filename*=UTF-8''{encoded}"


@router.post("/speech/md")
async def download_speech_md(body: SpeechDownloadRequest):
    """말씀자료 Markdown 다운로드."""
    if not body.generated_text or not body.generated_text.strip():
        raise HTTPException(400, "generated_text가 비어있습니다")

    try:
        md_text = speech_to_markdown(body.generated_text, title=body.title)
    except Exception as e:
        raise HTTPException(500, f"MD 변환 실패: {e}")

    fname = safe_filename(body.title, "말씀자료") + ".md"
    return Response(
        content=md_text.encode("utf-8"),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": _content_disposition(fname)},
    )


@router.post("/speech/hwpx")
async def download_speech_hwpx(body: SpeechDownloadRequest):
    """말씀자료 HWPX 다운로드."""
    if not body.generated_text or not body.generated_text.strip():
        raise HTTPException(400, "generated_text가 비어있습니다")

    try:
        hwpx_bytes = speech_to_hwpx_bytes(body.generated_text, title=body.title)
    except Exception as e:
        raise HTTPException(500, f"HWPX 변환 실패: {e}")

    fname = safe_filename(body.title, "말씀자료") + ".hwpx"
    return Response(
        content=hwpx_bytes,
        media_type="application/vnd.hancom.hwpx",
        headers={"Content-Disposition": _content_disposition(fname)},
    )


# ─── 보도자료 ───


class PressDownloadRequest(BaseModel):
    """보도자료 다운로드 요청.

    옛 press-docs-mcp JSON 형식 그대로:
        title, subtitle, lead_paragraph, body_paragraphs.
    담당자 정보(department, contact_*)도 본문 끝에 추가.
    """
    title: str = ""
    subtitle: str = ""
    lead_paragraph: str = ""
    body_paragraphs: list[str] = []
    department: str = ""
    contact_person: str = ""
    contact_phone: str = ""
    distribute_date: str = ""


def _press_parsed(body: PressDownloadRequest) -> dict:
    """PressDownloadRequest → 변환기 입력 dict."""
    return {
        "title": body.title,
        "subtitle": body.subtitle,
        "lead_paragraph": body.lead_paragraph,
        "body_paragraphs": body.body_paragraphs,
        # 담당자 영역 (변환기가 표준 보도자료 양식으로 배치)
        "department": body.department,
        "contact_person": body.contact_person,
        "contact_phone": body.contact_phone,
        "distribute_date": body.distribute_date,
    }


@router.post("/press/md")
async def download_press_md(body: PressDownloadRequest):
    """보도자료 Markdown 다운로드."""
    parsed = _press_parsed(body)

    if not parsed["title"] and not parsed["lead_paragraph"] and not parsed["body_paragraphs"]:
        raise HTTPException(400, "본문이 비어있습니다")

    try:
        md_text = press_to_markdown(parsed)
    except Exception as e:
        raise HTTPException(500, f"MD 변환 실패: {e}")

    fname = safe_filename(body.title, "보도자료") + ".md"
    return Response(
        content=md_text.encode("utf-8"),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": _content_disposition(fname)},
    )


@router.post("/press/hwpx")
async def download_press_hwpx(body: PressDownloadRequest):
    """보도자료 HWPX 다운로드."""
    parsed = _press_parsed(body)

    if not parsed["title"] and not parsed["lead_paragraph"] and not parsed["body_paragraphs"]:
        raise HTTPException(400, "본문이 비어있습니다")

    try:
        hwpx_bytes = press_to_hwpx_bytes(parsed)
    except Exception as e:
        raise HTTPException(500, f"HWPX 변환 실패: {e}")

    fname = safe_filename(body.title, "보도자료") + ".hwpx"
    return Response(
        content=hwpx_bytes,
        media_type="application/vnd.hancom.hwpx",
        headers={"Content-Disposition": _content_disposition(fname)},
    )


# ─── 설명자료 다운로드 (Phase 12) ───


class ExplainContact(BaseModel):
    """담당자 단위. 모든 필드 선택, 사용자 입력값만 출력됨."""
    division: str = ""             # (중앙정부) / (지방정부) 등 구분
    department_role: str = ""       # 실/국 + 과 (예: "인공지능정부실 / 디지털보안정책과")
    manager_role: str = ""          # 책임자 직급 (예: "과장")
    manager_name: str = ""          # 책임자 이름
    manager_phone: str = ""         # 책임자 연락처
    staff_role: str = ""            # 담당자 직급 (예: "사무관")
    staff_name: str = ""            # 담당자 이름
    staff_phone: str = ""           # 담당자 연락처


class ExplainArticle(BaseModel):
    media_name: str = ""
    article_date: str = ""
    article_title: str = ""
    key_points: list[str] = []


class ExplainDownloadRequest(BaseModel):
    """설명자료 다운로드 요청.

    🔒 contacts 영역은 사용자가 폼에서 입력한 값. AI가 만든 값 X.
    """
    title: str = ""
    report_date: str = ""
    ministry_name: str = ""
    article: ExplainArticle = ExplainArticle()
    position_paragraphs: list[str] = []
    contacts: list[ExplainContact] = []


def _explain_parsed(body: ExplainDownloadRequest) -> dict:
    """ExplainDownloadRequest → 변환기 입력 dict."""
    return {
        "title": body.title,
        "report_date": body.report_date,
        "ministry_name": body.ministry_name,
        "article": body.article.model_dump(),
        "position_paragraphs": body.position_paragraphs,
        "contacts": [c.model_dump() for c in body.contacts],
    }


@router.post("/explain/md")
async def download_explain_md(body: ExplainDownloadRequest):
    """설명자료 Markdown 다운로드."""
    parsed = _explain_parsed(body)

    if not parsed["title"] and not parsed["position_paragraphs"]:
        raise HTTPException(400, "본문이 비어있습니다")

    try:
        md_text = explain_to_markdown(parsed)
    except Exception as e:
        raise HTTPException(500, f"MD 변환 실패: {e}")

    fname = safe_filename(body.title, "설명자료") + ".md"
    return Response(
        content=md_text.encode("utf-8"),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": _content_disposition(fname)},
    )


@router.post("/explain/hwpx")
async def download_explain_hwpx(body: ExplainDownloadRequest):
    """설명자료 HWPX 다운로드."""
    parsed = _explain_parsed(body)

    if not parsed["title"] and not parsed["position_paragraphs"]:
        raise HTTPException(400, "본문이 비어있습니다")

    try:
        hwpx_bytes = explain_to_hwpx_bytes(parsed)
    except Exception as e:
        raise HTTPException(500, f"HWPX 변환 실패: {e}")

    fname = safe_filename(body.title, "설명자료") + ".hwpx"
    return Response(
        content=hwpx_bytes,
        media_type="application/vnd.hancom.hwpx",
        headers={"Content-Disposition": _content_disposition(fname)},
    )
