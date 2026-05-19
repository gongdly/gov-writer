"""정책브리핑 RAG 동기화.

호출 시점:
    1. 검색 API에서 마지막 동기화가 24h 지났을 때 백그라운드로 자동 트리거
    2. /settings 페이지의 "지금 동기화" 버튼으로 수동 트리거

흐름:
    1. 공공데이터포털 API 호출 (최근 3일)
    2. NewsItemId 중복 체크 → 신규만 추림
    3. 본문 정리 → 청크 분할 → Gemini 임베딩 → Supabase 저장
    4. policy_sync_logs 기록
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from lxml import etree

from . import supabase_client as sb
from .chunker import chunk_text
from .embedding import embed_text_batch

logger = logging.getLogger(__name__)

POLICY_API_URL = (
    "https://apis.data.go.kr/1371000/pressReleaseService/pressReleaseList"
)


def _html_to_text(html: str) -> str:
    """HTML → 평문."""
    if not html:
        return ""
    text = re.sub(r"<[^>]+>", " ", html)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _parse_approve_date(s: str) -> datetime | None:
    if not s:
        return None
    for fmt in ("%m/%d/%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s.strip(), fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


async def _fetch_recent_press_releases(
    api_key: str, days: int = 3
) -> list[dict[str, Any]]:
    """공공데이터포털 API 호출. 최근 N일치 보도자료 반환."""
    if days > 3:
        days = 3

    today = datetime.now(timezone.utc)
    start = (today - timedelta(days=days)).strftime("%Y%m%d")
    end = today.strftime("%Y%m%d")

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(
            POLICY_API_URL,
            params={
                "serviceKey": api_key,
                "startDate": start,
                "endDate": end,
            },
        )
        resp.raise_for_status()
        xml_bytes = resp.content

    root = etree.fromstring(xml_bytes)
    result_code = root.findtext(".//header/resultCode", "").strip()
    result_msg = root.findtext(".//header/resultMsg", "").strip()

    if result_code not in ("0", "00"):
        if result_code == "3":  # NODATA
            return []
        raise RuntimeError(
            f"공공데이터포털 API 에러: code={result_code}, msg={result_msg}"
        )

    items = []
    for item in root.findall(".//NewsItem"):
        nid = (item.findtext("NewsItemId") or "").strip()
        if not nid:
            continue
        items.append(
            {
                "news_item_id": nid,
                "title": (item.findtext("Title") or "").strip(),
                "subtitle": (item.findtext("SubTitle1") or "").strip() or None,
                "ministry": (item.findtext("MinisterCode") or "").strip() or None,
                "approve_date_raw": (item.findtext("ApproveDate") or "").strip(),
                "content_html": (item.findtext("DataContents") or "").strip(),
                "original_url": (item.findtext("OriginalUrl") or "").strip() or None,
                "file_url": (item.findtext("FileUrl") or "").strip() or None,
            }
        )
    return items


async def get_sync_age_hours() -> float | None:
    """마지막 성공 동기화로부터 몇 시간 지났는지.

    Returns:
        None: 동기화 기록 없음 (최초)
        float: 경과 시간 (시간 단위)
    """
    latest = await sb.get_latest_successful_sync()
    if not latest:
        return None
    started = datetime.fromisoformat(latest["started_at"].replace("Z", "+00:00"))
    return (datetime.now(timezone.utc) - started).total_seconds() / 3600


async def sync_policy_briefing(
    *,
    policy_api_key: str | None = None,
    gemini_api_key: str | None = None,
    days: int = 3,
) -> dict[str, Any]:
    """메인 동기화 진입점.

    중복 실행 방지:
        다른 sync가 in_progress면 skip하고 즉시 반환.

    Returns:
        status, fetched_count, new_count, embedded_count, error_message, elapsed_seconds
    """
    started = datetime.now(timezone.utc)
    policy_api_key = policy_api_key or os.environ.get("POLICY_BRIEFING_API_KEY", "")

    if not policy_api_key:
        return {
            "status": "error",
            "fetched_count": 0,
            "new_count": 0,
            "embedded_count": 0,
            "error_message": "POLICY_BRIEFING_API_KEY 미설정",
            "elapsed_seconds": 0,
        }

    # 중복 방지
    try:
        if await sb.is_sync_in_progress():
            return {
                "status": "skipped",
                "fetched_count": 0,
                "new_count": 0,
                "embedded_count": 0,
                "error_message": "다른 동기화가 진행 중",
                "elapsed_seconds": 0,
            }
    except Exception:
        pass  # 체크 실패해도 진행

    log_id: int | None = None
    fetched_count = 0
    new_count = 0
    embedded_count = 0
    error_message: str | None = None

    try:
        log_id = await sb.start_sync_log()
    except Exception as e:
        logger.warning("동기화 로그 시작 실패: %s", e)

    try:
        items = await _fetch_recent_press_releases(policy_api_key, days=days)
        fetched_count = len(items)
        logger.info("공공데이터포털에서 %d건 fetch", fetched_count)

        if items:
            existing = await sb.get_existing_article_ids(
                [it["news_item_id"] for it in items]
            )
            new_items = [it for it in items if it["news_item_id"] not in existing]
            logger.info("신규 %d건 (중복 %d건 skip)", len(new_items), len(existing))
        else:
            new_items = []

        for item in new_items:
            try:
                content_text = _html_to_text(item["content_html"])
                approve_date = _parse_approve_date(item["approve_date_raw"])

                await sb.insert_article(
                    {
                        "news_item_id": item["news_item_id"],
                        "title": item["title"],
                        "subtitle": item["subtitle"],
                        "ministry": item["ministry"],
                        "approve_date": approve_date.isoformat()
                        if approve_date
                        else None,
                        "content_html": item["content_html"],
                        "content_text": content_text,
                        "original_url": item["original_url"],
                        "file_url": item["file_url"],
                    }
                )
                new_count += 1

                full_text = "\n\n".join(filter(None, [item["title"], content_text]))
                chunks = chunk_text(full_text, chunk_size=500, overlap=50)
                if not chunks:
                    continue

                embeddings = await embed_text_batch(
                    chunks,
                    api_key=gemini_api_key,
                    task_type="RETRIEVAL_DOCUMENT",
                    title=item["title"],
                )

                chunk_rows = [
                    {
                        "id": f"c_{item['news_item_id']}_{idx}",
                        "article_id": item["news_item_id"],
                        "chunk_idx": idx,
                        "content": content,
                        "embedding": emb,
                        "token_count": max(1, len(content) // 2),
                    }
                    for idx, (content, emb) in enumerate(zip(chunks, embeddings))
                ]
                await sb.insert_chunks(chunk_rows)
                embedded_count += len(chunks)

            except Exception as e:
                logger.error(
                    "보도자료 %s 처리 실패: %s", item.get("news_item_id"), e
                )
                continue

        elapsed = (datetime.now(timezone.utc) - started).total_seconds()

        if log_id is not None:
            try:
                await sb.finish_sync_log(
                    log_id,
                    status="ok",
                    fetched_count=fetched_count,
                    new_count=new_count,
                    embedded_count=embedded_count,
                )
            except Exception as e:
                logger.warning("동기화 로그 완료 기록 실패: %s", e)

        return {
            "status": "ok",
            "fetched_count": fetched_count,
            "new_count": new_count,
            "embedded_count": embedded_count,
            "error_message": None,
            "elapsed_seconds": elapsed,
        }

    except Exception as e:
        error_message = str(e)
        logger.exception("동기화 실패")
        elapsed = (datetime.now(timezone.utc) - started).total_seconds()

        if log_id is not None:
            try:
                await sb.finish_sync_log(
                    log_id,
                    status="error",
                    fetched_count=fetched_count,
                    new_count=new_count,
                    embedded_count=embedded_count,
                    error_message=error_message,
                )
            except Exception as inner:
                logger.warning("에러 로그 기록 실패: %s", inner)

        return {
            "status": "error",
            "fetched_count": fetched_count,
            "new_count": new_count,
            "embedded_count": embedded_count,
            "error_message": error_message,
            "elapsed_seconds": elapsed,
        }
