"""문서 다운로드 변환기 (MD/HWPX).

원칙:
- python-hwpx 고수준 API의 단순한 path만 사용 (4월 실패 경험 반영)
- add_paragraph() 만 사용, 복잡한 표·도형·이미지 X
- save_to_path() 사용 (라이브러리 저자 권장)
- 실패 시 명확한 에러 (silent fallback X)

말씀자료는 단순 텍스트, 보도자료는 JSON(title/subtitle/lead/body_paragraphs) → 각각 처리.
"""
from __future__ import annotations

import io
import re
import tempfile
from pathlib import Path


# ─── MD 변환 ───


def speech_to_markdown(generated_text: str, *, title: str = "") -> str:
    """말씀자료 텍스트 → Markdown.

    AI가 생성한 텍스트가 이미 자연 단락 형태(빈 줄로 구분)이므로
    제목만 # 으로 추가하고 본문은 그대로 보존.
    """
    lines = ["# " + (title or "말씀자료").strip(), ""]
    body = (generated_text or "").strip()
    if body:
        lines.append(body)
    return "\n".join(lines)


def press_to_markdown(parsed: dict) -> str:
    """보도자료 JSON 파싱 결과 → Markdown.

    parsed 구조 (옛 press-docs-mcp 형식 그대로):
        {title, subtitle, lead_paragraph, body_paragraphs: list[str]}
    """
    parts: list[str] = []
    title = (parsed.get("title") or "보도자료").strip()
    parts.append(f"# {title}")

    subtitle = (parsed.get("subtitle") or "").strip()
    if subtitle:
        parts.append("")
        parts.append(f"## {subtitle}")

    lead = (parsed.get("lead_paragraph") or "").strip()
    if lead:
        parts.append("")
        parts.append(lead)

    body_paragraphs = parsed.get("body_paragraphs") or []
    for p in body_paragraphs:
        if p and p.strip():
            parts.append("")
            parts.append(p.strip())

    return "\n".join(parts) + "\n"


# ─── HWPX 변환 ───


def _split_paragraphs(text: str) -> list[str]:
    """텍스트를 빈 줄 기준으로 단락 분할.

    AI 출력은 보통 빈 줄로 단락이 구분되어 있음.
    빈 줄 없으면 줄바꿈 단위로 분할.
    """
    if not text or not text.strip():
        return []
    # 빈 줄로 단락 분할 (2회 이상 줄바꿈)
    paragraphs = re.split(r"\n\s*\n+", text.strip())
    result = []
    for p in paragraphs:
        # 단락 내부의 단일 줄바꿈은 공백으로 (AI 출력이 한 단락을 줄바꿈으로 끊는 경우 있음)
        cleaned = " ".join(line.strip() for line in p.splitlines() if line.strip())
        if cleaned:
            result.append(cleaned)
    return result


def speech_to_hwpx_bytes(generated_text: str, *, title: str = "") -> bytes:
    """말씀자료 → HWPX 바이트.

    구조:
        - 첫 단락: 제목 (있으면)
        - 이후 단락: 본문 텍스트를 단락 단위로 분할 후 add_paragraph
    """
    from hwpx import HwpxDocument

    doc = HwpxDocument.new()

    title_clean = (title or "").strip()
    if title_clean:
        doc.add_paragraph(title_clean)
        doc.add_paragraph("")  # 빈 줄

    paragraphs = _split_paragraphs(generated_text)
    if not paragraphs:
        # 빈 본문이어도 최소 1개 단락은 있어야 안전
        doc.add_paragraph("(본문 없음)")
    else:
        for p in paragraphs:
            doc.add_paragraph(p)

    with tempfile.NamedTemporaryFile(suffix=".hwpx", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        doc.save_to_path(tmp_path)
        return Path(tmp_path).read_bytes()
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def press_to_hwpx_bytes(parsed: dict) -> bytes:
    """보도자료 → HWPX 바이트.

    parsed 구조 (옛 press-docs-mcp 형식):
        {title, subtitle, lead_paragraph, body_paragraphs: list[str]}

    구조:
        - 제목 단락
        - 부제 단락 (있으면)
        - 빈 줄
        - 리드문 단락 (있으면)
        - 본문 단락들
    """
    from hwpx import HwpxDocument

    doc = HwpxDocument.new()

    title = (parsed.get("title") or "보도자료").strip()
    doc.add_paragraph(title)

    subtitle = (parsed.get("subtitle") or "").strip()
    if subtitle:
        doc.add_paragraph(subtitle)

    doc.add_paragraph("")  # 빈 줄

    lead = (parsed.get("lead_paragraph") or "").strip()
    if lead:
        doc.add_paragraph(lead)

    body_paragraphs = parsed.get("body_paragraphs") or []
    has_body = False
    for p in body_paragraphs:
        if p and p.strip():
            doc.add_paragraph(p.strip())
            has_body = True

    if not has_body and not lead:
        # 본문이 완전히 비어있으면 최소 1개 단락
        doc.add_paragraph("(본문 없음)")

    with tempfile.NamedTemporaryFile(suffix=".hwpx", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        doc.save_to_path(tmp_path)
        return Path(tmp_path).read_bytes()
    finally:
        Path(tmp_path).unlink(missing_ok=True)


# ─── 파일명 정리 ───


def safe_filename(name: str, default: str = "document") -> str:
    """파일명에 안전한 문자로 정리. 한글 OK."""
    if not name or not name.strip():
        return default
    # 파일시스템 금지 문자 제거
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name.strip())
    # 길이 제한 (한글 50자)
    cleaned = cleaned[:50].strip()
    return cleaned or default
