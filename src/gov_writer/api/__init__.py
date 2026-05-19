"""gov_writer API 라우터.

Phase 2 완료:
    - rag.py: RAG 동기화·검색·상태
    - settings.py: 사용자 키 검증

Phase 3 추가:
    - press.py: 보도자료 검색·생성·상세·저장

Phase 4~5에서 추가될 라우터:
    - speech.py, personas.py, drafts.py(이력 조회), upload.py
"""
from .rag import router as rag_router
from .settings import router as settings_router
from .press import router as press_router

__all__ = ["rag_router", "settings_router", "press_router"]
