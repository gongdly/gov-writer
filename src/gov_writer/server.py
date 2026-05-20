"""gov-writer FastAPI 서버 v0.2.

Phase 1: /health, /api/info, React SPA 서빙
Phase 2: /api/rag/*, /api/validate-key, 로깅 마스킹 미들웨어
"""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import (
    rag_router, settings_router, press_router, speech_router,
    drafts_router, personas_router, download_router, refine_router,
)
from .config import get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("gov_writer")

settings = get_settings()

app = FastAPI(
    title="gov-writer",
    description="행정문서 통합 작성기",
    version="0.7.2",
)

if not settings.is_production:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# 보안: 민감 헤더는 절대 로깅 안 됨 (FastAPI 기본 동작 + 명시적 정책)
SENSITIVE_HEADERS = frozenset({
    "x-anthropic-key",
    "x-gemini-key",
    "x-openai-key",
    "x-rag-sync-secret",
    "authorization",
    "x-api-key",
    "apikey",
})


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    """추후 추가 로깅 시 민감 헤더 마스킹 보장."""
    return await call_next(request)


app.include_router(rag_router)
app.include_router(settings_router)
app.include_router(press_router)
app.include_router(speech_router)
app.include_router(drafts_router)
app.include_router(personas_router)
app.include_router(download_router)
app.include_router(refine_router)


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "version": "0.7.2",
        "environment": settings.ENVIRONMENT,
    }


@app.get("/api/info")
async def info() -> dict:
    """환경 정보. LLM 키 상태는 노출 안 함 (사용자 localStorage 관리)."""
    return {
        "name": "gov-writer",
        "version": "0.7.2",
        "environment": settings.ENVIRONMENT,
        "features": {
            "supabase_configured": settings.has_supabase,
            "policy_briefing_configured": settings.has_policy_briefing,
            "rag_sync_secret_configured": bool(settings.RAG_SYNC_SECRET),
        },
        "phase": "Phase 10 — AI 자동 작성 토글 추가",
        "security_model": {
            "llm_keys": "client_localStorage",
            "policy_briefing": "server_only",
            "supabase": "server_only (service_role)",
        },
    }


STATIC_DIR = Path(__file__).parent.parent.parent / "static"

if STATIC_DIR.exists():
    assets_dir = STATIC_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> FileResponse:
        target = STATIC_DIR / full_path
        if target.exists() and target.is_file():
            return FileResponse(str(target))
        index = STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(str(index))
        return JSONResponse(
            status_code=404,
            content={"error": "Frontend not built"},
        )

    logger.info("React SPA 서빙 활성: %s", STATIC_DIR)
else:
    @app.get("/")
    async def root_no_frontend() -> dict:
        return {"message": "gov-writer 백엔드 (프론트엔드 빌드 안 됨)"}
