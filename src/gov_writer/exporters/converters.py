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

    한국 정부 보도자료 표준 양식:
        [보도자료]
        배포일자
        ──
        제목
        부제
        리드문
        본문
        ──
        담당부서·담당자·연락처
    """
    parts: list[str] = ["[보도자료]"]

    distribute_date = (parsed.get("distribute_date") or "").strip()
    if distribute_date:
        parts.append(f"배포일시: {distribute_date}")

    parts.append("─" * 40)
    parts.append("")

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

    # 담당자 영역
    department = (parsed.get("department") or "").strip()
    contact_person = (parsed.get("contact_person") or "").strip()
    contact_phone = (parsed.get("contact_phone") or "").strip()

    if department or contact_person or contact_phone:
        parts.append("")
        parts.append("─" * 40)
        if department:
            parts.append(f"담당부서: {department}")
        if contact_person:
            parts.append(f"담 당 자: {contact_person}")
        if contact_phone:
            parts.append(f"연 락 처: {contact_phone}")

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

    한국 정부 보도자료 표준 양식:
        [보도자료] 헤더
        배포일자
        ── 구분선
        제목
        부제
        리드문
        본문 단락들
        ── 구분선
        담당부서·담당자·연락처
    """
    from hwpx import HwpxDocument

    doc = HwpxDocument.new()

    # ── 헤더 ──
    doc.add_paragraph("[보도자료]")

    distribute_date = (parsed.get("distribute_date") or "").strip()
    if distribute_date:
        doc.add_paragraph(f"배포일시: {distribute_date}")

    doc.add_paragraph("─" * 40)

    # ── 본문 ──
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
        doc.add_paragraph("(본문 없음)")

    # ── 담당자 영역 ──
    department = (parsed.get("department") or "").strip()
    contact_person = (parsed.get("contact_person") or "").strip()
    contact_phone = (parsed.get("contact_phone") or "").strip()

    if department or contact_person or contact_phone:
        doc.add_paragraph("")  # 빈 줄
        doc.add_paragraph("─" * 40)
        if department:
            doc.add_paragraph(f"담당부서: {department}")
        if contact_person:
            doc.add_paragraph(f"담 당 자: {contact_person}")
        if contact_phone:
            doc.add_paragraph(f"연 락 처: {contact_phone}")

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


# ─── 설명자료 변환 (Phase 12) ───


def explain_to_markdown(parsed: dict) -> str:
    """설명자료 → Markdown.

    행안부 보도설명자료 표준 양식:
        [보도 설명자료]
        보도시점: YYYY.M.D.(요일) 즉시보도
        ────
        [제목]
        ────
        1. 주요 보도내용
         ○ [날짜] [매체] <기사 제목> 제하의 보도임
           - [핵심 쟁점]

        2. 동 보도내용에 대한 [부처명]의 입장
         ○ [반박 단락]
         ○ [반박 단락]
        ────
        담당 부서·이름·연락처

    parsed 구조:
        title, report_date, ministry_name,
        article: {media_name, article_date, article_title, key_points},
        position_paragraphs: [...],
        contacts: [{division, department_role, manager_role, manager_name,
                    manager_phone, staff_role, staff_name, staff_phone}, ...]
    """
    parts: list[str] = ["[보도 설명자료]"]

    report_date = (parsed.get("report_date") or "").strip()
    if report_date:
        parts.append(f"보도시점: {report_date}")

    parts.append("─" * 40)
    parts.append("")

    title = (parsed.get("title") or "보도설명자료").strip()
    parts.append(f"# {title}")
    parts.append("")
    parts.append("─" * 40)
    parts.append("")

    # 1. 주요 보도내용
    parts.append("## 1. 주요 보도내용")
    parts.append("")

    article = parsed.get("article") or {}
    media = (article.get("media_name") or "").strip()
    date = (article.get("article_date") or "").strip()
    title_art = (article.get("article_title") or "").strip()

    # 첫 줄: ○ [날짜] [매체] <기사 제목> 제하의 보도임
    header_bits = []
    if date:
        header_bits.append(date)
    if media:
        header_bits.append(media)
    article_header = " ".join(header_bits)
    if title_art:
        article_header = f"{article_header} <{title_art}> 제하의 보도임".strip()
    if article_header:
        parts.append(f" ○ {article_header}")
        parts.append("")

    # 핵심 쟁점
    key_points = article.get("key_points") or []
    for kp in key_points:
        if kp and kp.strip():
            parts.append(f"   - {kp.strip()}")
    if key_points:
        parts.append("")

    # 2. 부처 입장
    ministry = (parsed.get("ministry_name") or "○○부").strip()
    parts.append(f"## 2. 동 보도내용에 대한 {ministry}의 입장")
    parts.append("")

    for p in parsed.get("position_paragraphs") or []:
        if p and p.strip():
            parts.append(f" ○ {p.strip()}")
            parts.append("")

    # 담당자
    contacts = parsed.get("contacts") or []
    if contacts:
        parts.append("─" * 40)
        parts.append("")
        for c in contacts:
            line_parts = []
            div = (c.get("division") or "").strip()
            dept = (c.get("department_role") or "").strip()
            if div:
                line_parts.append(div)
            if dept:
                line_parts.append(dept)
            if line_parts:
                parts.append(" / ".join(line_parts))

            mgr_role = (c.get("manager_role") or "").strip()
            mgr_name = (c.get("manager_name") or "").strip()
            mgr_phone = (c.get("manager_phone") or "").strip()
            if mgr_name or mgr_role:
                role_label = mgr_role if mgr_role else "책임자"
                phone_suffix = f" ({mgr_phone})" if mgr_phone else ""
                parts.append(f"  · 책임자: {role_label} {mgr_name}{phone_suffix}".rstrip())

            staff_role = (c.get("staff_role") or "").strip()
            staff_name = (c.get("staff_name") or "").strip()
            staff_phone = (c.get("staff_phone") or "").strip()
            if staff_name or staff_role:
                role_label = staff_role if staff_role else "담당자"
                phone_suffix = f" ({staff_phone})" if staff_phone else ""
                parts.append(f"  · 담당자: {role_label} {staff_name}{phone_suffix}".rstrip())
            parts.append("")

    return "\n".join(parts) + "\n"


def explain_to_hwpx_bytes(parsed: dict) -> bytes:
    """설명자료 → HWPX 바이트.

    행안부 표준 양식 그대로 단순 add_paragraph로 작성.
    """
    from hwpx import HwpxDocument

    doc = HwpxDocument.new()

    # ── 헤더 ──
    doc.add_paragraph("[보도 설명자료]")

    report_date = (parsed.get("report_date") or "").strip()
    if report_date:
        doc.add_paragraph(f"보도시점: {report_date}")

    doc.add_paragraph("─" * 40)
    doc.add_paragraph("")

    # ── 제목 ──
    title = (parsed.get("title") or "보도설명자료").strip()
    doc.add_paragraph(title)
    doc.add_paragraph("")
    doc.add_paragraph("─" * 40)
    doc.add_paragraph("")

    # ── 1. 주요 보도내용 ──
    doc.add_paragraph("1. 주요 보도내용")
    doc.add_paragraph("")

    article = parsed.get("article") or {}
    media = (article.get("media_name") or "").strip()
    date = (article.get("article_date") or "").strip()
    title_art = (article.get("article_title") or "").strip()

    header_bits = []
    if date:
        header_bits.append(date)
    if media:
        header_bits.append(media)
    article_header = " ".join(header_bits)
    if title_art:
        article_header = f"{article_header} <{title_art}> 제하의 보도임".strip()
    if article_header:
        doc.add_paragraph(f" ○ {article_header}")
        doc.add_paragraph("")

    key_points = article.get("key_points") or []
    for kp in key_points:
        if kp and kp.strip():
            doc.add_paragraph(f"   - {kp.strip()}")
    if key_points:
        doc.add_paragraph("")

    # ── 2. 부처 입장 ──
    ministry = (parsed.get("ministry_name") or "○○부").strip()
    doc.add_paragraph(f"2. 동 보도내용에 대한 {ministry}의 입장")
    doc.add_paragraph("")

    for p in parsed.get("position_paragraphs") or []:
        if p and p.strip():
            doc.add_paragraph(f" ○ {p.strip()}")
            doc.add_paragraph("")

    # ── 담당자 영역 ──
    contacts = parsed.get("contacts") or []
    if contacts:
        doc.add_paragraph("─" * 40)
        doc.add_paragraph("")
        for c in contacts:
            div = (c.get("division") or "").strip()
            dept = (c.get("department_role") or "").strip()
            header_line = " / ".join([s for s in [div, dept] if s])
            if header_line:
                doc.add_paragraph(header_line)

            mgr_role = (c.get("manager_role") or "").strip()
            mgr_name = (c.get("manager_name") or "").strip()
            mgr_phone = (c.get("manager_phone") or "").strip()
            if mgr_name or mgr_role:
                role_label = mgr_role if mgr_role else "책임자"
                phone_suffix = f" ({mgr_phone})" if mgr_phone else ""
                doc.add_paragraph(f"  · 책임자: {role_label} {mgr_name}{phone_suffix}".rstrip())

            staff_role = (c.get("staff_role") or "").strip()
            staff_name = (c.get("staff_name") or "").strip()
            staff_phone = (c.get("staff_phone") or "").strip()
            if staff_name or staff_role:
                role_label = staff_role if staff_role else "담당자"
                phone_suffix = f" ({staff_phone})" if staff_phone else ""
                doc.add_paragraph(f"  · 담당자: {role_label} {staff_name}{phone_suffix}".rstrip())
            doc.add_paragraph("")

    with tempfile.NamedTemporaryFile(suffix=".hwpx", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        doc.save_to_path(tmp_path)
        return Path(tmp_path).read_bytes()
    finally:
        Path(tmp_path).unlink(missing_ok=True)
