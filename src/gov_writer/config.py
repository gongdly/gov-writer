"""환경변수 로딩.

pydantic-settings로 .env 또는 OS 환경변수 자동 로딩.
필수 변수 누락 시 명확한 에러 메시지.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """애플리케이션 설정.

    Phase 1에서는 최소 변수만 로딩. Phase 2~5에서 점진 추가.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",  # 미정의 환경변수 무시
    )

    # ─── 환경 ───
    ENVIRONMENT: Literal["development", "production"] = "development"

    # ─── Supabase (Phase 1에서는 옵션, Phase 2부터 필수) ───
    SUPABASE_URL: str = Field(default="", description="Supabase 프로젝트 URL")
    SUPABASE_ANON_KEY: str = Field(default="", description="Supabase anon 키")
    SUPABASE_SERVICE_ROLE_KEY: str = Field(default="", description="Supabase service_role 키")

    # ─── LLM (Phase 3~4에서 필수) ───
    ANTHROPIC_API_KEY: str = Field(default="", description="Anthropic API 키")
    GEMINI_API_KEY: str = Field(default="", description="Google Gemini API 키")
    OPENAI_API_KEY: str = Field(default="", description="OpenAI API 키")

    # ─── 정책브리핑 (Phase 2부터 필수) ───
    POLICY_BRIEFING_API_KEY: str = Field(default="", description="공공데이터포털 정책브리핑 API 키")

    # ─── RAG 동기화 (Phase 2부터 필수) ───
    RAG_SYNC_SECRET: str = Field(default="", description="RAG sync 트리거 인증 시크릿")

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def has_supabase(self) -> bool:
        return bool(self.SUPABASE_URL and self.SUPABASE_SERVICE_ROLE_KEY)


@lru_cache
def get_settings() -> Settings:
    """싱글톤 settings 인스턴스."""
    return Settings()
