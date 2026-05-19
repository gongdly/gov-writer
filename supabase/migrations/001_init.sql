-- =============================================================================
-- gov-writer 통합 초기 스키마 v1.0
-- =============================================================================
--
-- 빅보스님 실행 방법:
--   1. Supabase Dashboard → 새 프로젝트 (gov-writer) 진입
--   2. SQL Editor → New query
--   3. 이 파일 전체 복사 → 붙여넣기 → Run
--   4. "Success" 확인
--
-- 이 파일이 만드는 것:
--   - personas:           발화자 페르소나 (말씀자료/보도자료 공용)
--   - policy_articles:    공공데이터포털에서 받은 정책브리핑 보도자료
--   - policy_chunks:      임베딩된 RAG 청크 (768차원)
--   - policy_sync_logs:   동기화 실행 이력
--   - drafts:             작성 이력 (말씀자료·보도자료 통합)
--   - match_policy_chunks(): 의미 검색 RPC 함수
--
-- 안전성: idempotent — 여러 번 실행해도 안전 (CREATE IF NOT EXISTS)
-- =============================================================================

-- 1. 확장
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- 2. personas — 발화자 페르소나
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.personas (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,                  -- 발화자명 (예: "이상민 행정안전부 장관")
  role            TEXT,                            -- 직책 (예: "행정안전부 장관")
  organization    TEXT,                            -- 기관 (예: "행정안전부")
  tone            TEXT,                            -- 말투 스타일 (예: "격식 있고 단정한")
  background      TEXT,                            -- L4/L5 컨텍스트 (예: "디지털플랫폼정부 추진...")
  usage_count     INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personas_organization
  ON public.personas(organization);
CREATE INDEX IF NOT EXISTS idx_personas_usage_count
  ON public.personas(usage_count DESC);


-- 3. policy_articles — 정책브리핑 보도자료 원본
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.policy_articles (
  news_item_id    TEXT PRIMARY KEY,                -- 공공데이터포털 NewsItemId
  title           TEXT NOT NULL,
  subtitle        TEXT,
  ministry        TEXT,                            -- MinisterCode (예: "행정안전부")
  approve_date    TIMESTAMPTZ,                     -- 보도자료 발표 시각
  content_html    TEXT,                            -- 원본 HTML (DataContents)
  content_text    TEXT,                            -- HTML 파싱 후 평문
  original_url    TEXT,
  file_url        TEXT,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policy_articles_ministry
  ON public.policy_articles(ministry);
CREATE INDEX IF NOT EXISTS idx_policy_articles_approve_date
  ON public.policy_articles(approve_date DESC);


-- 4. policy_chunks — RAG 임베딩 청크
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.policy_chunks (
  id              TEXT PRIMARY KEY,                -- "c_{news_item_id}_{idx}"
  article_id      TEXT NOT NULL REFERENCES public.policy_articles(news_item_id) ON DELETE CASCADE,
  chunk_idx       INT NOT NULL,
  content         TEXT NOT NULL,
  embedding       vector(768),                     -- Gemini text-embedding-004
  token_count     INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- HNSW 인덱스 (코사인 거리 기준)
CREATE INDEX IF NOT EXISTS idx_policy_chunks_embedding_hnsw
  ON public.policy_chunks
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_policy_chunks_article_id
  ON public.policy_chunks(article_id);


-- 5. policy_sync_logs — 동기화 이력
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.policy_sync_logs (
  id              BIGSERIAL PRIMARY KEY,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  status          TEXT NOT NULL,                   -- 'ok' | 'error' | 'in_progress'
  fetched_count   INT DEFAULT 0,
  new_count       INT DEFAULT 0,
  embedded_count  INT DEFAULT 0,
  error_message   TEXT
);

CREATE INDEX IF NOT EXISTS idx_policy_sync_logs_started_at
  ON public.policy_sync_logs(started_at DESC);


-- 6. drafts — 작성 이력 (말씀자료·보도자료 통합)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.drafts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  doc_type        TEXT NOT NULL,                   -- 'speech' | 'press'
  title           TEXT NOT NULL,
  form_data       JSONB NOT NULL,                  -- 입력 폼 전체
  generated_text  TEXT,                            -- AI 생성 본문
  edit_history    JSONB DEFAULT '[]'::jsonb,       -- 편집 이력 배열
  persona_id      UUID REFERENCES public.personas(id) ON DELETE SET NULL,
  rag_references  JSONB DEFAULT '[]'::jsonb,       -- 참고한 RAG 결과 (article_id 배열)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drafts_doc_type
  ON public.drafts(doc_type);
CREATE INDEX IF NOT EXISTS idx_drafts_created_at
  ON public.drafts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drafts_persona_id
  ON public.drafts(persona_id);


-- 7. updated_at 자동 갱신 트리거
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS personas_touch_updated_at ON public.personas;
CREATE TRIGGER personas_touch_updated_at
  BEFORE UPDATE ON public.personas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS drafts_touch_updated_at ON public.drafts;
CREATE TRIGGER drafts_touch_updated_at
  BEFORE UPDATE ON public.drafts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- 8. match_policy_chunks RPC — 의미 검색
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_policy_chunks(
  query_embedding         vector(768),
  match_count             INT DEFAULT 5,
  similarity_threshold    FLOAT DEFAULT 0.5,
  filter_ministry         TEXT DEFAULT NULL
)
RETURNS TABLE (
  chunk_id            TEXT,
  article_id          TEXT,
  chunk_idx           INT,
  content             TEXT,
  similarity          FLOAT,
  article_title       TEXT,
  article_subtitle    TEXT,
  ministry            TEXT,
  approve_date        TIMESTAMPTZ,
  original_url        TEXT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    c.id                                AS chunk_id,
    c.article_id,
    c.chunk_idx,
    c.content,
    1 - (c.embedding <=> query_embedding) AS similarity,
    a.title                             AS article_title,
    a.subtitle                          AS article_subtitle,
    a.ministry,
    a.approve_date,
    a.original_url
  FROM public.policy_chunks c
  JOIN public.policy_articles a ON a.news_item_id = c.article_id
  WHERE c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) >= similarity_threshold
    AND (filter_ministry IS NULL OR a.ministry = filter_ministry)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;


-- 9. service_role 권한 부여
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role;

GRANT ALL ON public.personas TO service_role;
GRANT ALL ON public.policy_articles TO service_role;
GRANT ALL ON public.policy_chunks TO service_role;
GRANT ALL ON public.policy_sync_logs TO service_role;
GRANT ALL ON public.drafts TO service_role;

GRANT USAGE, SELECT ON SEQUENCE public.policy_sync_logs_id_seq TO service_role;

GRANT EXECUTE ON FUNCTION public.match_policy_chunks TO service_role;
GRANT EXECUTE ON FUNCTION public.touch_updated_at TO service_role;


-- =============================================================================
-- 검증 쿼리 (실행 후 한 번 돌려보세요)
-- =============================================================================
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;
--
-- 예상 결과 (5개 행):
--   drafts
--   personas
--   policy_articles
--   policy_chunks
--   policy_sync_logs
-- =============================================================================
