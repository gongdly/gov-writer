"""정책브리핑 보도자료 API 래퍼.

공공데이터포털 '문화체육관광부_정책브리핑_보도자료_API' (15095295) 사용.
엔드포인트 1종: GET /pressReleaseList (3일 이내 보도자료 목록).

키워드 검색은 정책브리핑 API 자체가 제공하지 않으므로,
서버에서 전체 fetch → 클라이언트 사이드 필터 방식.
(RAG가 이미 임베딩으로 의미 검색을 제공하므로, 이 API는 단순 키워드 매칭용)
"""
from __future__ import annotations

import hashlib
import html
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from lxml import etree

from .ministries import normalize_ministry_name

API_URL = "https://apis.data.go.kr/1371000/pressReleaseService/pressReleaseList"

# 캐시 (5분 TTL)
_cache: dict[str, tuple[float, Any]] = {}
DEFAULT_TTL = 300


def _cache_key(params: dict) -> str:
    raw = str(sorted(params.items()))
    return hashlib.md5(raw.encode()).hexdigest()


def _cache_get(key: str) -> Any | None:
    if key not in _cache:
        return None
    ts, data = _cache[key]
    if time.time() - ts > DEFAULT_TTL:
        del _cache[key]
        return None
    return data


def _cache_set(key: str, data: Any) -> None:
    _cache[key] = (time.time(), data)


def _strip_html(text: str) -> str:
    """HTML 태그 제거 + 엔티티 디코딩."""
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _get_text(elem, tag: str) -> str:
    """XML 자식 노드 텍스트. 없으면 빈 문자열."""
    if elem is None:
        return ""
    child = elem.find(tag)
    if child is None or child.text is None:
        return ""
    return child.text.strip()


def _format_date(raw: str) -> str:
    """MM/DD/YYYY HH:MM:SS → YYYY-MM-DD HH:MM."""
    if not raw:
        return ""
    try:
        dt = datetime.strptime(raw.strip(), "%m/%d/%Y %H:%M:%S")
        return dt.strftime("%Y-%m-%d %H:%M")
    except (ValueError, TypeError):
        return raw


async def _call_api(
    api_key: str,
    start_date: str,
    end_date: str,
    *,
    timeout: float = 30.0,
) -> list[dict]:
    """공공데이터포털 API 호출. items 리스트 반환."""
    params = {
        "serviceKey": api_key,
        "startDate": start_date,
        "endDate": end_date,
    }
    cache_key = _cache_key(params)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(API_URL, params=params)
        resp.raise_for_status()
        xml_bytes = resp.content

    root = etree.fromstring(xml_bytes)
    result_code = _get_text(root.find(".//header"), "resultCode")
    result_msg = _get_text(root.find(".//header"), "resultMsg")

    if result_code not in ("0", "00"):
        if result_code == "3":  # NODATA
            _cache_set(cache_key, [])
            return []
        raise RuntimeError(
            f"공공데이터포털 API 에러: code={result_code}, msg={result_msg}"
        )

    items = []
    for item in root.findall(".//NewsItem"):
        nid = _get_text(item, "NewsItemId")
        if not nid:
            continue
        items.append(
            {
                "news_item_id": nid,
                "title": _get_text(item, "Title"),
                "subtitle": _get_text(item, "SubTitle1"),
                "ministry": _get_text(item, "MinisterCode"),
                "approve_date": _format_date(_get_text(item, "ApproveDate")),
                "content_html": _get_text(item, "DataContents"),
                "content_text": _strip_html(_get_text(item, "DataContents")),
                "original_url": _get_text(item, "OriginalUrl"),
                "file_name": _get_text(item, "FileName"),
                "file_url": _get_text(item, "FileUrl"),
            }
        )

    _cache_set(cache_key, items)
    return items


async def search_press_releases(
    *,
    api_key: str,
    query: str = "",
    ministry: str | None = None,
    days: int = 3,
    limit: int = 20,
) -> list[dict]:
    """보도자료 검색.

    정책브리핑 API는 한 번에 최대 3일 조회만 허용하므로,
    days > 3이면 3일 단위로 chunk 분할하여 여러 번 호출 후 결과 병합.

    Args:
        api_key: POLICY_BRIEFING_API_KEY
        query: 키워드 (제목·본문 매칭)
        ministry: 부처 필터
        days: 조회 기간 (1~90, 3 초과 시 자동 chunking)
        limit: 최대 반환 건수
    """
    if days < 1:
        days = 1
    if days > 90:
        days = 90

    today = datetime.now(timezone.utc) + timedelta(hours=9)  # KST

    # 3일씩 chunk 분할: 가장 최근 chunk부터 거꾸로 호출
    items: list[dict] = []
    seen_ids: set[str] = set()
    remaining = days
    chunk_end = today
    while remaining > 0:
        chunk_days = min(3, remaining)
        chunk_start = chunk_end - timedelta(days=chunk_days)
        start_str = chunk_start.strftime("%Y%m%d")
        end_str = chunk_end.strftime("%Y%m%d")

        chunk_items = await _call_api(api_key, start_str, end_str)
        # 중복 제거 (chunk 경계 겹침 방지)
        for it in chunk_items:
            nid = it.get("news_item_id")
            if nid and nid not in seen_ids:
                items.append(it)
                seen_ids.add(nid)

        remaining -= chunk_days
        chunk_end = chunk_start

    # 부처 필터
    if ministry:
        normalized = normalize_ministry_name(ministry) or ministry
        items = [
            it for it in items
            if (normalize_ministry_name(it.get("ministry", "")) or it.get("ministry", ""))
            == normalized
        ]

    # 키워드 필터
    if query and query.strip():
        q = query.strip().lower()
        items = [
            it
            for it in items
            if q in it.get("title", "").lower()
            or q in it.get("subtitle", "").lower()
            or q in it.get("content_text", "").lower()
        ]

    # 본문 미리보기로 잘라서 (전체 본문은 detail에서)
    results = []
    for it in items[:limit]:
        results.append(
            {
                "news_item_id": it["news_item_id"],
                "title": it["title"],
                "subtitle": it["subtitle"],
                "ministry": it["ministry"],
                "approve_date": it["approve_date"],
                "body_preview": it["content_text"][:500],
                "url": it["original_url"],
            }
        )
    return results


async def get_press_release(
    *,
    api_key: str,
    news_item_id: str,
    days: int = 3,
) -> dict | None:
    """보도자료 단건 상세 조회.

    days > 3이면 3일 chunk로 분할 호출 (찾으면 즉시 반환).
    """
    if days < 1:
        days = 1
    if days > 90:
        days = 90

    today = datetime.now(timezone.utc) + timedelta(hours=9)
    remaining = days
    chunk_end = today
    while remaining > 0:
        chunk_days = min(3, remaining)
        chunk_start = chunk_end - timedelta(days=chunk_days)
        items = await _call_api(
            api_key,
            chunk_start.strftime("%Y%m%d"),
            chunk_end.strftime("%Y%m%d"),
        )
        for it in items:
            if it["news_item_id"] == news_item_id:
                return it
        remaining -= chunk_days
        chunk_end = chunk_start
    return None


async def list_ministries(*, api_key: str, days: int = 3) -> list[str]:
    """최근 보도자료에 등장한 부처 목록 (중복 제거).

    days > 3이면 3일 chunk로 분할 호출 후 부처 병합.
    """
    if days < 1:
        days = 1
    if days > 90:
        days = 90

    today = datetime.now(timezone.utc) + timedelta(hours=9)
    ministries = set()
    remaining = days
    chunk_end = today
    while remaining > 0:
        chunk_days = min(3, remaining)
        chunk_start = chunk_end - timedelta(days=chunk_days)
        items = await _call_api(
            api_key,
            chunk_start.strftime("%Y%m%d"),
            chunk_end.strftime("%Y%m%d"),
        )
        for it in items:
            m = it.get("ministry", "").strip()
            if m:
                ministries.add(m)
        remaining -= chunk_days
        chunk_end = chunk_start
    return sorted(ministries)
