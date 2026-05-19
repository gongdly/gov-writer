"""Gemini text-embedding-004 클라이언트.

용도:
    1. RAG 동기화 시 보도자료 본문 임베딩 (RETRIEVAL_DOCUMENT)
    2. RAG 검색 시 사용자 쿼리 임베딩 (RETRIEVAL_QUERY)

⚠️ 사용 키:
    1번(동기화)은 서버 GEMINI_API_KEY 사용 (cron 무인 동작).
    2번(검색)은 요청 헤더로 받은 사용자 키 사용 가능 — 또는 서버 키 fallback.

768차원 출력, 한도 보호를 위해 배치 처리.
"""
from __future__ import annotations

import asyncio
import os
from typing import Literal

import httpx

GEMINI_EMBED_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "text-embedding-004:embedContent"
)
GEMINI_EMBED_BATCH_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "text-embedding-004:batchEmbedContents"
)

TaskType = Literal["RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY"]


def _resolve_api_key(user_key: str | None) -> str:
    """사용자 키 우선, 없으면 서버 환경변수 키.

    동기화는 서버 키 사용. 검색은 사용자 키 가능.
    """
    if user_key and user_key.strip():
        return user_key.strip()
    server_key = os.environ.get("GEMINI_API_KEY_SERVER", "").strip()
    if server_key:
        return server_key
    raise RuntimeError(
        "GEMINI 임베딩 키 미설정. "
        "서버 GEMINI_API_KEY_SERVER 또는 사용자 헤더 X-Gemini-Key 필요."
    )


async def embed_text(
    text: str,
    *,
    api_key: str | None = None,
    task_type: TaskType = "RETRIEVAL_QUERY",
    title: str | None = None,
    timeout: float = 30.0,
) -> list[float]:
    """단일 텍스트 임베딩."""
    if not text or not text.strip():
        raise ValueError("빈 텍스트는 임베딩할 수 없습니다")

    key = _resolve_api_key(api_key)

    payload: dict = {
        "model": "models/text-embedding-004",
        "content": {"parts": [{"text": text[:8000]}]},
        "taskType": task_type,
    }
    if title and task_type == "RETRIEVAL_DOCUMENT":
        payload["title"] = title

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            GEMINI_EMBED_URL,
            params={"key": key},
            json=payload,
            headers={"Content-Type": "application/json"},
        )
        if resp.status_code == 429:
            raise RuntimeError("Gemini API 호출 한도 초과 (429)")
        resp.raise_for_status()
        data = resp.json()
        embedding = data.get("embedding", {}).get("values")
        if not embedding or len(embedding) != 768:
            raise RuntimeError(
                f"Gemini 응답 이상: 임베딩 차원={len(embedding) if embedding else 'None'}"
            )
        return embedding


async def embed_text_batch(
    texts: list[str],
    *,
    api_key: str | None = None,
    task_type: TaskType = "RETRIEVAL_DOCUMENT",
    title: str | None = None,
    timeout: float = 60.0,
    batch_size: int = 100,
) -> list[list[float]]:
    """다수 텍스트 배치 임베딩.

    Gemini batchEmbedContents 한 번에 최대 100개.
    초과 시 자동 분할 + 1초 sleep으로 한도 보호.
    """
    if not texts:
        return []

    key = _resolve_api_key(api_key)
    results: list[list[float]] = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        requests = []
        for t in batch:
            req = {
                "model": "models/text-embedding-004",
                "content": {"parts": [{"text": t[:8000]}]},
                "taskType": task_type,
            }
            if title and task_type == "RETRIEVAL_DOCUMENT":
                req["title"] = title
            requests.append(req)

        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                GEMINI_EMBED_BATCH_URL,
                params={"key": key},
                json={"requests": requests},
                headers={"Content-Type": "application/json"},
            )
            if resp.status_code == 429:
                raise RuntimeError("Gemini API 호출 한도 초과 (429)")
            resp.raise_for_status()
            data = resp.json()
            embeddings = data.get("embeddings", [])
            if len(embeddings) != len(batch):
                raise RuntimeError(
                    f"배치 응답 크기 불일치: 요청 {len(batch)}, 응답 {len(embeddings)}"
                )
            for emb in embeddings:
                values = emb.get("values")
                if not values or len(values) != 768:
                    raise RuntimeError(
                        f"배치 임베딩 이상: 차원={len(values) if values else 'None'}"
                    )
                results.append(values)

        if i + batch_size < len(texts):
            await asyncio.sleep(1.0)

    return results
