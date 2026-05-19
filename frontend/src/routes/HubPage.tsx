import { Link } from 'react-router-dom'
import { FileText, Megaphone, Users, History, Settings } from 'lucide-react'

export default function HubPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-blue-50 p-6">
      <div className="max-w-4xl mx-auto">
        <header className="text-center pt-8 pb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-medium mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            v0.2 · 통합 RAG 적용
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 mb-3">
            gov-writer
          </h1>
          <p className="text-slate-600">행정문서 통합 작성기</p>
        </header>

        <section className="mb-10">
          <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4 text-center">
            어떤 문서를 작성하시겠어요?
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link
              to="/write?type=speech"
              className="group bg-white rounded-2xl border border-slate-200 hover:border-blue-300 hover:shadow-md transition-all p-6"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-blue-50 rounded-lg group-hover:bg-blue-100 transition-colors">
                  <FileText className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-lg font-semibold text-slate-900">말씀자료</h2>
              </div>
              <p className="text-sm text-slate-600">
                행사 축사·기념사·연설문. 페르소나와 행사 정보를 입력하면 5-Layer AI가
                격식 있는 말씀자료를 작성합니다.
              </p>
            </Link>

            <Link
              to="/write?type=press"
              className="group bg-white rounded-2xl border border-slate-200 hover:border-blue-300 hover:shadow-md transition-all p-6"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-green-50 rounded-lg group-hover:bg-green-100 transition-colors">
                  <Megaphone className="w-5 h-5 text-green-600" />
                </div>
                <h2 className="text-lg font-semibold text-slate-900">보도자료</h2>
              </div>
              <p className="text-sm text-slate-600">
                부처 보도자료. 정책 정보와 부처 입장을 입력하면 정책브리핑 RAG가
                유사 사례를 참고하여 본문을 작성합니다.
              </p>
            </Link>
          </div>
        </section>

        <section className="grid grid-cols-3 gap-3">
          <Link
            to="/personas"
            className="flex items-center gap-2 px-4 py-3 bg-white rounded-xl border border-slate-200 hover:border-slate-300 transition-all text-sm text-slate-700"
          >
            <Users className="w-4 h-4" />
            페르소나
          </Link>
          <Link
            to="/history"
            className="flex items-center gap-2 px-4 py-3 bg-white rounded-xl border border-slate-200 hover:border-slate-300 transition-all text-sm text-slate-700"
          >
            <History className="w-4 h-4" />
            작성 이력
          </Link>
          <Link
            to="/settings"
            className="flex items-center gap-2 px-4 py-3 bg-white rounded-xl border border-slate-200 hover:border-slate-300 transition-all text-sm text-slate-700"
          >
            <Settings className="w-4 h-4" />
            설정
          </Link>
        </section>

        <footer className="mt-16 text-center text-xs text-slate-400">
          gov-writer · v0.2.0 · Phase 2 통합 RAG
        </footer>
      </div>
    </div>
  )
}
