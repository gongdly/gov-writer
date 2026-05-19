"""텍스트 청크 분할.

speech-writer의 chunk_text 로직과 동일:
    - 기본 청크 크기 500자
    - 오버랩 50자
    - 한국어 문장 경계 우선
"""
from __future__ import annotations

import re


def chunk_text(
    text: str,
    chunk_size: int = 500,
    overlap: int = 50,
) -> list[str]:
    """텍스트를 청크로 분할."""
    if not text or not text.strip():
        return []

    text = text.strip()
    if len(text) <= chunk_size:
        return [text]

    sentences = re.split(r"(?<=[.!?。])\s+|(?<=다\.)\s+|(?<=음\.)\s+|\n\n+", text)
    sentences = [s.strip() for s in sentences if s.strip()]

    chunks: list[str] = []
    current = ""

    for sent in sentences:
        if len(sent) > chunk_size:
            if current:
                chunks.append(current)
                current = ""
            i = 0
            while i < len(sent):
                chunks.append(sent[i : i + chunk_size])
                i += chunk_size - overlap
            continue

        if len(current) + len(sent) + 1 > chunk_size:
            if current:
                chunks.append(current)
            if overlap > 0 and current:
                tail = current[-overlap:]
                current = tail + " " + sent
            else:
                current = sent
        else:
            current = (current + " " + sent) if current else sent

    if current:
        chunks.append(current)

    return chunks
