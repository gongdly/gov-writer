"""gov_writer API 라우터.

Phase 2 완료:
    - rag.py: RAG 동기화·검색·상태
    - settings.py: 사용자 키 검증

Phase 3~5에서 추가될 라우터:
    - speech.py, press.py, personas.py, drafts.py, upload.py, policy.py
"""
from .rag import router as rag_router
from .settings import router as settings_router

__all__ = ["rag_router", "settings_router"]
