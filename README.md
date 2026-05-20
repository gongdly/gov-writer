# gov-writer

행정문서 통합 작성기 — 말씀자료·보도자료·설명자료 한곳에서.

옛 speech-writer + press-docs-mcp의 통합 재건축 버전.

**현재 버전**: v0.8.0 (Phase 12 — 설명자료 작성기 추가)

---

## 주요 기능

### 📝 말씀자료 작성기
- 행사 축사·기념사·연설문 등 격식 있는 말씀자료 작성
- **5-Layer AI 생성**: 행사 정보 → 발언자 페르소나 → 청중 → 메시지 → 톤
- 단락·문장 재생성, 톤 조정
- 발언자 페르소나 저장·재사용 (`/personas`)

### 📢 보도자료 작성기
- 부처 정책·사업 발표용 보도자료
- **수동 작성** + **AI 자동 작성** 두 가지 모드
- 사업계획서 PDF 업로드 → 표준 양식 보도자료 자동 생성
- `[보도자료]` 헤더, 기관장 인용문 단락, 담당자 영역 자동 적용
- 평어체 (~다 / ~했다 / ~밝혔다) 종결어미 강제
- 정책브리핑 RAG 옵션 (필요 시만)

### 💬 설명자료 작성기 (Phase 12, NEW)
- 언론 보도 해명·반박용 보도설명자료
- 행안부 표준 양식: `1. 주요 보도내용` + `2. 동 보도내용에 대한 ○○부의 입장`
- **기사 첨부 시 AI가 "주요 보도내용" 자동 요약**
- 부처 입장 메모 → 표준 양식 단락으로 정리 (사실관계는 사용자 책임)
- 다중 담당자 (여러 부서 합동 발표 지원)
- 경어체 (~입니다 / ~겠습니다) 종결어미 강제
- 🔒 담당자 영역은 AI 거치지 않고 사용자 입력값만 사용 (보안 설계)

### 🗂 공통 기능
- **작성 이력** (`/history`): doc_type별 필터, 재사용, 다운로드
- **다운로드**: Markdown (.md) + 한컴오피스 (.hwpx)
- **멀티 LLM**: Anthropic Claude / Google Gemini / OpenAI (사용자 선택)
- **API 키 사용자 보관**: localStorage만 (서버 환경변수 X)

---

## 아키텍처

- **백엔드**: Python FastAPI (단일 프로세스)
- **프론트엔드**: React SPA (Vite + TypeScript + Tailwind + lucide-react)
- **DB**: Supabase (PostgreSQL + pgvector RAG)
- **호스팅**: Render Singapore (단일 인스턴스, 정적 파일 통합 서빙)
- **LLM**: Anthropic / Gemini / OpenAI (사용자 헤더로 키 전달)
- **문서 변환**: python-hwpx (HWPX 생성), pypdf / python-docx (입력 추출)

---

## API 엔드포인트

### 작성
| 메서드 | 엔드포인트 | 설명 |
|---|---|---|
| POST | `/api/speech/draft` | 말씀자료 수동 생성 |
| POST | `/api/speech/auto-draft` | 말씀자료 자동 생성 (행사계획서 업로드) |
| POST | `/api/press/draft` | 보도자료 수동 생성 |
| POST | `/api/press/draft-with-docs` | 보도자료 + 참고자료 |
| POST | `/api/press/auto-draft` | 보도자료 자동 생성 (사업계획서 업로드) |
| POST | `/api/explain/summarize-article` | 기사 → 주요 보도내용 요약 |
| POST | `/api/explain/format-position` | 부처 입장 메모 → 표준 양식 |
| POST | `/api/explain/auto-draft` | 설명자료 전체 자동 생성 |

### 정리·재생성
| 메서드 | 엔드포인트 | 설명 |
|---|---|---|
| POST | `/api/refine/regenerate-paragraph` | 단락 재생성 |
| POST | `/api/refine/adjust-tone` | 톤 조정 |
| POST | `/api/refine/auto-extract` | 행사 정보 자동 추출 |

### 다운로드
| 메서드 | 엔드포인트 | 설명 |
|---|---|---|
| POST | `/api/download/speech/{md,hwpx}` | 말씀자료 |
| POST | `/api/download/press/{md,hwpx}` | 보도자료 |
| POST | `/api/download/explain/{md,hwpx}` | 설명자료 |

### 관리
| 메서드 | 엔드포인트 | 설명 |
|---|---|---|
| GET | `/api/drafts` | 작성 이력 조회 (doc_type 필터) |
| GET/POST/DELETE | `/api/personas` | 발언자 페르소나 관리 |
| POST | `/api/rag/sync` | 정책브리핑 RAG 수동 동기화 |
| GET | `/api/info` | 현재 Phase·버전 |
| GET | `/health` | 헬스체크 |

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

개발 시: Vite dev server(5173)가 `/api/*` 요청을 백엔드(8000)로 프록시.

### 3. Supabase 초기화

Supabase 대시보드 → SQL Editor → New query → `supabase/migrations/001_init.sql` 붙여넣기 → Run.

### 4. LLM API 키 등록

브라우저에서 `/settings` 진입 → 사용할 모델(Anthropic / Gemini / OpenAI) 선택 → 키 입력.
키는 localStorage에만 저장되며 서버로 전송되지 않습니다 (각 요청 시 헤더로만 전달).

---

## 환경변수

`.env.example` 참고. 필수:

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

POLICY_BRIEFING_API_KEY=...    # 공공데이터포털 정책브리핑 API (RAG용)
RAG_SYNC_SECRET=...            # RAG 수동 동기화 보호 (랜덤 64자)
```

⚠ **LLM API 키는 서버 환경변수로 설정하지 마세요.** 사용자가 브라우저에서 입력하는 키만 사용합니다.

---

## 운영 배포 (Render)

1. GitHub push → Render 자동 빌드·배포
2. Build Command가 자동 수행: `pip install + npm install + npm run build`
3. Vite가 `static/` 폴더에 빌드 산출물 출력
4. FastAPI가 `static/index.html` + `/api/*` 동시 서빙

`static/`은 `.gitignore`에 있어 커밋되지 않음 — Render가 매번 새로 빌드.

---

## 폴더 구조

```
gov-writer/
├── pyproject.toml
├── render.yaml                  # Render 자동 빌드 설정
├── .env.example                 # 환경변수 명세
├── README.md                    # 이 파일
│
├── src/gov_writer/              # 백엔드 (Python)
│   ├── server.py                # FastAPI 엔트리포인트
│   ├── config.py                # 환경변수 로딩
│   ├── db.py                    # Supabase 클라이언트
│   ├── extractors.py            # PDF/HWPX/DOCX 텍스트 추출
│   ├── llm/                     # 멀티 LLM 클라이언트
│   ├── api/                     # 라우터
│   │   ├── speech.py            # 말씀자료
│   │   ├── press.py             # 보도자료
│   │   ├── explain.py           # 설명자료 (Phase 12)
│   │   ├── refine.py            # 단락 재생성·톤 조정
│   │   ├── download.py          # MD/HWPX 다운로드
│   │   ├── drafts.py            # 작성 이력
│   │   ├── personas.py          # 발언자 페르소나
│   │   ├── rag.py               # 정책브리핑 RAG
│   │   └── settings.py          # API 키 검증
│   └── exporters/
│       └── converters.py        # MD/HWPX 변환기
│
├── frontend/                    # 프론트엔드 (React)
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx              # 라우터
│       ├── routes/
│       │   ├── HubPage.tsx      # 허브 (3개 카드)
│       │   ├── WritePage.tsx    # 말씀·보도 작성
│       │   ├── ExplainPage.tsx  # 설명자료 작성 (Phase 12)
│       │   ├── HistoryPage.tsx  # 작성 이력
│       │   ├── PersonasPage.tsx # 페르소나 관리
│       │   └── SettingsPage.tsx # API 키 설정
│       ├── components/
│       └── hooks/
│
├── supabase/migrations/         # DB 스키마
│   └── 001_init.sql
│
└── static/                      # Vite 빌드 산출물 (.gitignore)
```

---

## Phase 진행 이력

| Phase | 버전 | 내용 |
|---|---|---|
| 1 | 0.1.x | 초기 구축 (헬로월드) |
| 2 | 0.2.x | 통합 RAG (정책브리핑 + 5개 부처 보도자료) |
| 3 | 0.3.x | 보도자료 작성기 (옛 press-docs-mcp 이식) |
| 4 | 0.4.x | 말씀자료 작성기 (옛 speech-writer 이식) |
| 5.2 | 0.5.x | 페르소나, 단락 재생성, 톤 조정, 자동 추출 |
| 6 | 0.6.x | HWPX 다운로드 |
| 9 | 0.7.0 | 모바일 반응형 |
| 10 | 0.7.2 | AI 자동 작성 모드 (보도자료·말씀자료) |
| 11 | 0.7.3 | 보도자료 프롬프트·양식 강화 (헤더·담당자·인용문) |
| 11.1 | 0.7.4 | 인용문 위치 보정 + 본문 풍부함 복원 |
| **12** | **0.8.0** | **설명자료 작성기 추가 (행안부 표준 양식)** |

---

## AI 안전 설계

### 1. 사용자 API 키 보호
- LLM API 키는 클라이언트 localStorage에만 저장
- 서버 환경변수로 설정 금지 (운영자 책임 회피)
- 각 요청 시 헤더로만 전달 (`X-Anthropic-Key`, `X-Gemini-Key`, `X-OpenAI-Key`)

### 2. 담당자·연락처 보호 (설명자료 Phase 12)
- 담당자 영역은 AI 거치지 않고 사용자 폼 → 변환기 직접 전달
- AI 시스템 프롬프트에 "가상의 이름·연락처 생성 금지" 명시
- 백엔드 응답 필터: `contacts`, `department`, `contact_person`, `contact_phone` 키 강제 제거
- 모든 시안·예시는 "홍길동·○○과·044-XXX-XXXX" 익명화

### 3. 사실관계 보호
- 자동 작성 모드에서 AI는 양식만 정리, 사실관계는 사용자 입력 그대로
- 종결어미·단락 구조만 표준화, 단어·수치는 보존
- 정책브리핑 RAG는 기본 OFF (지자체·신규 사업은 무관한 중앙부처 톤 섞임 방지)

---

## 라이선스

MIT
