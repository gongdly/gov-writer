"""환경변수 로딩.

pydantic-settings로 .env 또는 OS 환경변수 자동 로딩.
필수 변수 누락 시 명확한 에러 메시지.

⚠️ 보안 원칙:
    LLM API 키(Anthropic·Gemini·OpenAI)는 서버 환경변수에 저장하지 않습니다.
    각 사용자가 클라이언트에서 자기 키를 입력하고 localStorage에 보관합니다.
    요청 시마다 사용자 키를 함께 보내며, 서버는 받아서 LLM 호출에만 사용
    (저장·로깅 일체 금지). 빅보스님 키 한도가 외부 사용자에게 빨리지 않도록.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """애플리케이션 설정.

    Phase 1에서는 최소 변수만 로딩. Phase 2~5에서 점진 추가.

    여기에 정의된 변수는 모두 **서버 전용**입니다. 사용자별로 달라지는
    키(LLM API 키 등)는 여기 두지 않고 요청 헤더로 받습니다.
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
    # 모든 사용자가 공유하는 데이터베이스. RLS와 service_role로 통제.
    SUPABASE_URL: str = Field(default="", description="Supabase 프로젝트 URL")
    SUPABASE_ANON_KEY: str = Field(default="", description="Supabase anon 키 (공개 가능)")
    SUPABASE_SERVICE_ROLE_KEY: str = Field(
        default="",
        description="Supabase service_role 키 (서버 전용, 절대 클라이언트 노출 금지)",
    )

    # ─── 정책브리핑 (Phase 2부터 필수) ───
    # 서버 cron이 일일 동기화에 사용. 사용자별 다를 필요 없음.
    POLICY_BRIEFING_API_KEY: str = Field(
        default="",
        description="공공데이터포털 정책브리핑 API 키 (서버 cron용)",
    )

    # ─── RAG 동기화 (Phase 2부터 필수) ───
    # cron-job.org가 /api/rag/sync 호출 시 인증용. 사용자 무관.
    RAG_SYNC_SECRET: str = Field(
        default="",
        description="RAG sync 트리거 인증 시크릿 (서버↔cron 간)",
    )

    # ─── LLM 키는 여기 없음 ───
    # ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY는
    # 사용자별 입력 + 요청 헤더 전달 방식으로 처리합니다 (Phase 3~4 구현 예정).
    # 서버 환경변수에 두지 않는 이유:
    #   - 비용·한도 책임 분리
    #   - 외부 사용자가 빅보스님 키를 빨아쓰는 사고 방지
    #   - 빅보스님 공무원 신분 보호 (개인 키가 시민 서비스에 노출되지 않도록)

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def has_supabase(self) -> bool:
        return bool(self.SUPABASE_URL and self.SUPABASE_SERVICE_ROLE_KEY)

    @property
    def has_policy_briefing(self) -> bool:
        return bool(self.POLICY_BRIEFING_API_KEY)


@lru_cache
def get_settings() -> Settings:
    """싱글톤 settings 인스턴스."""
    return Settings()
