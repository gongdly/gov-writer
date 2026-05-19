"""
파일: src/press_docs_mcp/file_extractors.py (신규 추가)

업로드 파일에서 텍스트 추출 - PDF, DOCX, HWPX, TXT 지원
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path
from lxml import etree


MAX_TEXT_LEN = 5000  # 파일당 최대 5000자만 (LLM 토큰 절약)


def extract_text(filename: str, content: bytes) -> str:
    """파일명 확장자 기반으로 텍스트 추출"""
    if not filename:
        return "(파일명 없음)"

    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""

    try:
        if ext == "txt":
            return _extract_txt(content)
        elif ext == "pdf":
            return _extract_pdf(content)
        elif ext in ("docx",):
            return _extract_docx(content)
        elif ext in ("hwpx",):
            return _extract_hwpx(content)
        elif ext == "hwp":
            return f"(HWP 형식은 텍스트 추출 미지원, HWPX로 변환 후 업로드 부탁드립니다)"
        elif ext in ("doc", "ppt", "pptx"):
            return f"({ext.upper()} 형식은 현재 텍스트 추출 미지원)"
        else:
            return f"(지원하지 않는 형식: .{ext})"
    except Exception as e:
        return f"(텍스트 추출 실패: {type(e).__name__}: {str(e)[:80]})"


def _extract_txt(content: bytes) -> str:
    for encoding in ("utf-8", "cp949", "euc-kr"):
        try:
            return content.decode(encoding)[:MAX_TEXT_LEN]
        except UnicodeDecodeError:
            continue
    return "(텍스트 인코딩 오류)"


def _extract_pdf(content: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        return "(pypdf 미설치)"

    reader = PdfReader(io.BytesIO(content))
    parts = []
    for page in reader.pages[:20]:  # 최대 20페이지
        try:
            parts.append(page.extract_text() or "")
        except Exception:
            continue
    text = "\n".join(parts)
    return text[:MAX_TEXT_LEN]


def _extract_docx(content: bytes) -> str:
    try:
        from docx import Document
    except ImportError:
        return "(python-docx 미설치)"

    doc = Document(io.BytesIO(content))
    parts = [p.text for p in doc.paragraphs if p.text.strip()]
    text = "\n".join(parts)
    return text[:MAX_TEXT_LEN]


def _extract_hwpx(content: bytes) -> str:
    """HWPX는 ZIP 안에 Contents/section*.xml. <hp:t> 노드의 텍스트만 모은다."""
    parts = []
    with zipfile.ZipFile(io.BytesIO(content), "r") as z:
        section_files = sorted(
            [n for n in z.namelist() if n.startswith("Contents/section") and n.endswith(".xml")]
        )
        for name in section_files[:10]:  # 안전하게 최대 10개 섹션
            xml = z.read(name)
            root = etree.fromstring(xml)
            for t in root.xpath('//*[local-name()="t"]'):
                if t.text:
                    parts.append(t.text)

    text = " ".join(parts)
    # 공백 정리
    text = " ".join(text.split())
    return text[:MAX_TEXT_LEN]
