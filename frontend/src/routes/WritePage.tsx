import { useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, FileText, Megaphone } from 'lucide-react'

type DocType = 'speech' | 'press'

const DOC_INFO: Record<DocType, { name: string; icon: typeof FileText; color: string }> = {
  speech: { name: '말씀자료', icon: FileText, color: 'blue' },
  press: { name: '보도자료', icon: Megaphone, color: 'green' },
}

export default function WritePage() {
  const [params] = useSearchParams()
  const rawType = params.get('type')
  const docType: DocType = rawType === 'press' ? 'press' : 'speech'
  const info = DOC_INFO[docType]
  const Icon = info.icon

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="w-4 h-4" />
            허브로
          </Link>
          <div className="flex items-center gap-2">
            <div className={`p-1.5 bg-${info.color}-50 rounded-lg`}>
              <Icon className={`w-4 h-4 text-${info.color}-600`} />
            </div>
            <h1 className="text-base font-semibold text-slate-900">{info.name} 작성</h1>
          </div>
          <div className="w-12" />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* 단계 진행 표시 */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span className="font-medium text-slate-900">1. 페르소나</span>
            <span>2. 참고자료</span>
            <span>3. 정보 입력</span>
            <span>4. AI 생성</span>
          </div>
          <div className="h-1 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full" style={{ width: '25%' }} />
          </div>
        </div>

        {/* 작성 단계 본문 */}
        <div className="bg-white rounded-2xl border border-slate-200 p-8">
          <p className="text-sm text-slate-500 mb-2">Phase 3-4</p>
          <h2 className="text-xl font-semibold text-slate-900 mb-3">
            {info.name} 작성 흐름
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed mb-6">
            Phase 3({docType === 'press' ? '보도자료' : '말씀자료'})와 Phase 4에서 다음 단계가 구현됩니다:
          </p>

          <ol className="space-y-3 text-sm text-slate-700">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs flex items-center justify-center font-medium">
                1
              </span>
              <div>
                <p className="font-medium">페르소나 선택</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {docType === 'press' ? '발표 기관·부처' : '연사·직책·말투'}
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs flex items-center justify-center font-medium">
                2
              </span>
              <div>
                <p className="font-medium">참고자료 업로드 (선택)</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  PDF·DOCX·HWPX 행사계획서·정책자료
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs flex items-center justify-center font-medium">
                3
              </span>
              <div>
                <p className="font-medium">
                  {docType === 'press' ? '정책·사안 정보' : '행사 정보'} 입력
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {docType === 'press'
                    ? '제목·요지·핵심 메시지·인용문'
                    : '행사명·일시·장소·청중·주제'}
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs flex items-center justify-center font-medium">
                4
              </span>
              <div>
                <p className="font-medium">AI 5-Layer 생성 + RAG 자동 참조</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  정책브리핑 RAG에서 유사 사례 자동 참고
                </p>
              </div>
            </li>
          </ol>

          <div className="mt-8 pt-6 border-t border-slate-100">
            <p className="text-xs text-slate-500">
              현재는 Phase 2(RAG 시스템) 완료 상태입니다. 작성 흐름은 다음 단계에서
              구현됩니다.
            </p>
            <Link
              to="/settings"
              className="inline-block mt-3 text-sm text-blue-600 hover:underline"
            >
              설정에서 LLM API 키 입력 →
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
