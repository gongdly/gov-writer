import { useEffect, useState } from 'react'

interface InfoResponse {
  name: string
  version: string
  environment: string
  features: {
    supabase_configured: boolean
    anthropic_configured: boolean
    gemini_configured: boolean
    openai_configured: boolean
    policy_briefing_configured: boolean
  }
  phase: string
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; data: InfoResponse }
  | { status: 'error'; message: string }

function StatusBadge({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
        ok ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-green-500' : 'bg-slate-400'}`}
      />
      {ok ? '설정됨' : '미설정'}
    </span>
  )
}

export default function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    fetch('/api/info')
      .then(async (resp) => {
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`)
        }
        const data = (await resp.json()) as InfoResponse
        setState({ status: 'ok', data })
      })
      .catch((err) => {
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
      })
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-white via-slate-50 to-blue-50">
      <div className="max-w-2xl w-full">
        {/* 헤더 */}
        <header className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-medium mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            Phase 1 · 초기 구축
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 mb-3">
            gov-writer
          </h1>
          <p className="text-slate-600">행정문서 통합 작성기</p>
        </header>

        {/* 상태 카드 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">
            시스템 상태
          </h2>

          {state.status === 'loading' && (
            <div className="py-8 text-center text-slate-400 text-sm">
              백엔드 연결 중...
            </div>
          )}

          {state.status === 'error' && (
            <div className="py-6 px-4 bg-red-50 border border-red-100 rounded-lg">
              <p className="text-sm font-medium text-red-900 mb-1">
                백엔드 연결 실패
              </p>
              <p className="text-xs text-red-700">{state.message}</p>
              <p className="text-xs text-red-600 mt-3">
                힌트: <code className="bg-red-100 px-1 rounded">uvicorn gov_writer.server:app --reload</code>
              </p>
            </div>
          )}

          {state.status === 'ok' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">버전</p>
                  <p className="font-mono text-slate-900">{state.data.version}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">환경</p>
                  <p className="font-mono text-slate-900">{state.data.environment}</p>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <p className="text-xs text-slate-500 mb-3">외부 서비스 연동</p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center justify-between">
                    <span className="text-slate-700">Supabase</span>
                    <StatusBadge ok={state.data.features.supabase_configured} />
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-slate-700">Anthropic Claude</span>
                    <StatusBadge ok={state.data.features.anthropic_configured} />
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-slate-700">Google Gemini</span>
                    <StatusBadge ok={state.data.features.gemini_configured} />
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-slate-700">OpenAI</span>
                    <StatusBadge ok={state.data.features.openai_configured} />
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-slate-700">공공데이터포털 정책브리핑</span>
                    <StatusBadge ok={state.data.features.policy_briefing_configured} />
                  </li>
                </ul>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <p className="text-xs text-slate-500 mb-2">현재 단계</p>
                <p className="text-sm text-slate-900">{state.data.phase}</p>
              </div>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <footer className="mt-8 text-center text-xs text-slate-400">
          gov-writer · v0.1.0 · Phase 1 초기 구축
        </footer>
      </div>
    </div>
  )
}
