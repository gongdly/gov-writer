# gov-writer

행정문서 통합 작성기 — 말씀자료·보도자료 한곳에서.

speech-writer + press-docs-mcp의 통합 재건축 버전 (v1.0+).

---

## 아키텍처

- **백엔드**: Python FastAPI (단일 프로세스)
- **프론트엔드**: React SPA (Vite + TypeScript + Tailwind + shadcn/ui)
- **DB**: Supabase (PostgreSQL + pgvector)
- **호스팅**: Render (단일 인스턴스, 정적 파일도 함께 서빙)
- **LLM**: Anthropic Claude + Google Gemini + OpenAI (사용자 선택)

---

## 로컬 개발 셋업

### 1. 백엔드

```bash
# Python 가상환경
python3.10 -m venv .venv
source .venv/bin/activate

# 패키지 설치
pip install -e ".[dev]"

# 환경변수 (.env.example 복사 후 값 채우기)
cp .env.example .env
# vim .env

# 서버 기동
uvicorn gov_writer.server:app --reload --port 8000
```

### 2. 프론트엔드

```bash
cd frontend
npm install
npm run dev  # http://localhost:5173
```

개발 시: Vite dev server(5173)에서 API 요청을 백엔드(8000)로 프록시.

### 3. Supabase 초기화

Supabase 대시보드 → SQL Editor → New query → `supabase/migrations/001_init.sql` 전체 붙여넣기 → Run.

---

## 운영 배포 (Render)

1. GitHub push → Render 자동 빌드·배포
2. Build Command가 자동 수행: `pip install + npm install + npm run build`
3. Vite가 `static/` 폴더에 빌드 산출물 출력
4. FastAPI가 `static/index.html` + `/api/*` 동시 서빙

`static/`은 `.gitignore`에 있어 커밋되지 않음 — Render가 매번 새로 빌드함.

---

## 폴더 구조

```
gov-writer/
├── pyproject.toml
├── render.yaml             # Render 자동 빌드 설정
├── .env.example            # 환경변수 명세
├── .gitignore              # static/ 포함
│
├── src/gov_writer/         # 백엔드 (Python)
│   ├── server.py           # FastAPI 엔트리포인트
│   ├── config.py           # 환경변수 로딩
│   └── api/                # 라우터 (Phase 2~5에서 추가)
│
├── frontend/               # 프론트엔드 (React)
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       └── App.tsx
│
├── supabase/migrations/    # DB 스키마
│   └── 001_init.sql
│
└── static/                 # Vite 빌드 산출물 (.gitignore)
```

---

## 로드맵

- ✅ **Phase 0**: 설계 완료
- 🚧 **Phase 1**: 초기 구축 (현재)
- ⏳ **Phase 2**: 통합 RAG 시스템
- ⏳ **Phase 3**: 보도자료 작성기
- ⏳ **Phase 4**: 말씀자료 작성기
- ⏳ **Phase 5**: 페르소나·작성 이력
- ⏳ **Phase 6**: 옛 사이트 마이그레이션

---

## 라이선스

MIT
