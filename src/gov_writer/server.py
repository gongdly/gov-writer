"""gov-writer FastAPI 서버.

Phase 1 스코프:
    - /health: 헬스체크
    - /api/info: 환경 정보 (Supabase 연결 상태 등)
    - /{path:path}: React SPA 정적 파일 서빙 (static/)

Phase 2~5에서 /api/rag, /api/speech, /api/press 등 추가.
"""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings

# ─── 로깅 ───
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("gov_writer")

# ─── 설정 ───
settings = get_settings()

# ─── FastAPI 앱 ───
app = FastAPI(
    title="gov-writer",
    description="행정문서 통합 작성기",
    version="0.1.0",
)

# ─── CORS (개발 환경에서만) ───
if not settings.is_production:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],  # Vite dev server
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    logger.info("CORS 활성 (dev): http://localhost:5173 허용")


# ─── API 라우트 ───
@app.get("/health")
async def health() -> dict:
    """헬스체크 — Render·cron-job.org·모니터링용."""
    return {
        "status": "ok",
        "version": "0.1.0",
        "environment": settings.ENVIRONMENT,
    }


@app.get("/api/info")
async def info() -> dict:
    """환경 정보 — 개발자·디버깅용."""
    return {
        "name": "gov-writer",
        "version": "0.1.0",
        "environment": settings.ENVIRONMENT,
        "features": {
            "supabase_configured": settings.has_supabase,
            "anthropic_configured": bool(settings.ANTHROPIC_API_KEY),
            "gemini_configured": bool(settings.GEMINI_API_KEY),
            "openai_configured": bool(settings.OPENAI_API_KEY),
            "policy_briefing_configured": bool(settings.POLICY_BRIEFING_API_KEY),
        },
        "phase": "Phase 1 — 초기 구축 완료",
    }


# ─── React SPA 서빙 ───
# static/ 폴더는 Render가 매번 자동 빌드 (Vite). .gitignore에 있음.
STATIC_DIR = Path(__file__).parent.parent.parent / "static"

if STATIC_DIR.exists():
    # /assets/* 정적 파일
    assets_dir = STATIC_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> FileResponse:
        """React SPA fallback — 모든 비-API 경로는 index.html 반환.

        클라이언트 사이드 라우팅(/speech, /press 등) 지원.
        """
        # 정적 파일 직접 서빙 시도
        target = STATIC_DIR / full_path
        if target.exists() and target.is_file():
            return FileResponse(str(target))

        # 그 외는 SPA 진입점
        index = STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(str(index))

        # static/ 빌드 안 됨 (로컬 개발 등)
        return JSONResponse(
            status_code=404,
            content={
                "error": "Frontend not built",
                "hint": "Run: cd frontend && npm install && npm run build",
            },
        )

    logger.info("React SPA 서빙 활성: %s", STATIC_DIR)
else:
    logger.warning(
        "static/ 폴더 없음 — 프론트엔드 빌드 안 됨. "
        "로컬 개발 중이면 'cd frontend && npm run dev' 별도 실행."
    )

    @app.get("/")
    async def root_no_frontend() -> dict:
        return {
            "message": "gov-writer 백엔드 실행 중 (프론트엔드 빌드 안 됨)",
            "hint": "cd frontend && npm install && npm run build",
            "api": "/api/info",
        }
