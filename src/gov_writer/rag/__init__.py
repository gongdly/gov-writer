"""gov-writer 통합 RAG 모듈.

정책브리핑 보도자료를 임베딩하여 말씀자료·보도자료 작성 시 의미 검색 제공.

데이터 흐름:
    [공공데이터포털 API] → fetch → 청크 분할 → Gemini 임베딩 → Supabase 저장
    [사용자 쿼리] → Gemini 임베딩 → match_policy_chunks RPC → 유사 청크 반환

동기화 방식:
    on-demand 캐시 — 검색 호출 시 마지막 동기화 시각 확인,
    24시간 지났으면 백그라운드로 새 동기화 트리거.
    외부 cron 없음.
"""
from .sync import sync_policy_briefing, get_sync_age_hours
from .search import search_policy_chunks

__all__ = ["sync_policy_briefing", "search_policy_chunks", "get_sync_age_hours"]
