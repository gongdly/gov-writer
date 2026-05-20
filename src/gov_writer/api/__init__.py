"""gov_writer API 라우터.

Phase 2: rag, settings
Phase 3: press
Phase 4: speech
Phase 5: drafts(이력), personas
Phase 6: download (MD/HWPX)
Phase 7 (=5.2): refine (단락 재생성·톤 조정·자동 추출)
"""
from .rag import router as rag_router
from .settings import router as settings_router
from .press import router as press_router
from .speech import router as speech_router
from .drafts import router as drafts_router
from .personas import router as personas_router
from .download import router as download_router
from .refine import router as refine_router

__all__ = [
    "rag_router", "settings_router", "press_router", "speech_router",
    "drafts_router", "personas_router", "download_router", "refine_router",
]
