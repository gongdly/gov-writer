"""gov_writer API 라우터.

Phase 2: rag, settings
Phase 3: press
Phase 4: speech
Phase 5: drafts(이력), personas
Phase 6+: HWPX 다운로드
"""
from .rag import router as rag_router
from .settings import router as settings_router
from .press import router as press_router
from .speech import router as speech_router
from .drafts import router as drafts_router
from .personas import router as personas_router

__all__ = [
    "rag_router", "settings_router", "press_router", "speech_router",
    "drafts_router", "personas_router",
]
