import { useState } from 'react'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, FileText, Megaphone, Loader2, AlertCircle, Sparkles } from 'lucide-react'
import { callApi } from '../lib/api'
import { getActiveProvider, getStoredKey } from '../hooks/useLLMSettings'

type DocType = 'speech' | 'press'

interface PressFormData {
  title: string
  subtitle: string
  press_type: string
  ministry: string
  department: string
  contact: string
  who: string
  when_date: string
  where_location: string
  what_summary: string
  why_background: string
  how_method: string
  key_points: string  // 줄바꿈으로 구분
  quotes: string  // 줄바꿈으로 구분
  schedule: string
  expected_effect: string
  target_chars: number
}

const PRESS_TYPES = [
  '정책 발표', '행사 개최', '통계·실태', '법령·제도',
  '사업 추진', '협약·MOU', '인사·조직', '사고·재난 대응',
]

const INIT_PRESS: PressFormData = {
  title: '',
  subtitle: '',
  press_type: '정책 발표',
  ministry: '',
  department: '',
  contact: '',
  who: '',
  when_date: '',
  where_location: '',
  what_summary: '',
  why_background: '',
  how_method: '',
  key_points: '',
  quotes: '',
  schedule: '',
  expected_effect: '',
  target_chars: 1500,
}

interface GenerateResponse {
  generated_text: string
  rag_used: boolean
  rag_count: number
  draft_id: string | null
  char_count: number
}

export default function WritePage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const rawType = params.get('type')
  const docType: DocType = rawType === 'press' ? 'press' : 'speech'

  // 말씀자료는 Phase 4
  if (docType === 'speech') {
    return <SpeechPlaceholder />
  }

  return <PressForm initial={INIT_PRESS} navigate={navigate} />
}

function SpeechPlaceholder() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-4 h-4" /> 허브로
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-16 text-center">
        <div className="inline-flex p-3 bg-blue-50 rounded-2xl mb-4">
          <FileText className="w-6 h-6 text-blue-600" />
        </div>
        <h1 className="text-2xl font-semibold text-slate-900 mb-3">말씀자료 작성</h1>
        <p className="text-sm text-slate-500 mb-1">Phase 4에서 구현 예정</p>
        <p className="text-xs text-slate-400">
          5-Layer 프롬프트와 6단 정형 구조는 이미 백엔드에 준비됨
        </p>
      </main>
    </div>
  )
}

function PressForm({
  initial,
  navigate,
}: {
  initial: PressFormData
  navigate: ReturnType<typeof useNavigate>
}) {
  const [form, setForm] = useState<PressFormData>(initial)
  const [useRag, setUseRag] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const provider = getActiveProvider()
  const hasKey = !!getStoredKey(provider)

  const update = <K extends keyof PressFormData>(key: K, value: PressFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleGenerate = async () => {
    setError(null)

    if (!hasKey) {
      setError(`${provider} API 키가 설정되지 않았습니다. /settings에서 입력해주세요.`)
      return
    }
    if (!form.title.trim()) {
      setError('제목을 입력해주세요.')
      return
    }
    if (!form.what_summary.trim() && !form.key_points.trim()) {
      setError('"무엇을" 또는 "주요 내용" 중 하나는 입력해야 합니다.')
      return
    }

    setLoading(true)
    try {
      const requestBody = {
        input: {
          title: form.title,
          subtitle: form.subtitle,
          press_type: form.press_type,
          ministry: form.ministry,
          department: form.department,
          contact: form.contact,
          who: form.who,
          when_date: form.when_date,
          where_location: form.where_location,
          what_summary: form.what_summary,
          why_background: form.why_background,
          how_method: form.how_method,
          key_points: form.key_points
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
          quotes: form.quotes
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
          schedule: form.schedule,
          expected_effect: form.expected_effect,
          target_chars: Number(form.target_chars) || 1500,
        },
        use_rag: useRag,
        save_draft: true,
        max_tokens: 4000,
        temperature: 0.7,
      }

      const result = await callApi<GenerateResponse>('/api/press/generate', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'X-LLM-Provider': provider },
      })

      // 결과를 sessionStorage에 저장하고 /result로 이동
      sessionStorage.setItem(
        'gw_last_result',
        JSON.stringify({
          ...result,
          doc_type: 'press',
          form_data: requestBody.input,
          provider,
          created_at: new Date().toISOString(),
        }),
      )
      navigate('/result')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-4 h-4" /> 허브로
          </Link>
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-green-50 rounded-lg">
              <Megaphone className="w-4 h-4 text-green-600" />
            </div>
            <h1 className="text-base font-semibold text-slate-900">보도자료 작성</h1>
          </div>
          <div className="w-12" />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {!hasKey && (
          <div className="mb-6 flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-900">
              <p className="font-medium mb-1">LLM API 키가 필요합니다</p>
              <p className="text-amber-800">
                작성을 시작하려면{' '}
                <Link to="/settings" className="underline font-medium">
                  설정
                </Link>
                에서 Gemini 또는 Claude 키를 입력해주세요.
              </p>
            </div>
          </div>
        )}

        <Section title="① 보도자료 기본 정보">
          <Field label="제목 *" required>
            <input
              type="text"
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
              placeholder="예: 행정안전부, 디지털플랫폼정부 추진 본격화"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </Field>
          <Field label="부제 (선택)">
            <input
              type="text"
              value={form.subtitle}
              onChange={(e) => update('subtitle', e.target.value)}
              placeholder="예: 30대 핵심 과제 발표, 2027년까지 시행"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="보도자료 유형">
              <select
                value={form.press_type}
                onChange={(e) => update('press_type', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                {PRESS_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="목표 글자수">
              <input
                type="number"
                value={form.target_chars}
                onChange={(e) => update('target_chars', Number(e.target.value) || 1500)}
                step="100"
                min="500"
                max="5000"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </Field>
          </div>
        </Section>

        <Section title="② 발표 부처">
          <div className="grid grid-cols-2 gap-4">
            <Field label="부처">
              <input
                type="text"
                value={form.ministry}
                onChange={(e) => update('ministry', e.target.value)}
                placeholder="예: 행정안전부"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </Field>
            <Field label="담당 부서">
              <input
                type="text"
                value={form.department}
                onChange={(e) => update('department', e.target.value)}
                placeholder="예: 디지털정부국 기획총괄과"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </Field>
          </div>
        </Section>

        <Section title="③ 5W1H">
          <div className="grid grid-cols-2 gap-4">
            <Field label="누가 (주체)">
              <input
                type="text"
                value={form.who}
                onChange={(e) => update('who', e.target.value)}
                placeholder="예: 행정안전부 장관"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </Field>
            <Field label="언제 (시행일·발표일)">
              <input
                type="text"
                value={form.when_date}
                onChange={(e) => update('when_date', e.target.value)}
                placeholder="예: 2026년 6월 1일부터"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </Field>
          </div>
          <Field label="어디서 (장소)">
            <input
              type="text"
              value={form.where_location}
              onChange={(e) => update('where_location', e.target.value)}
              placeholder="예: 정부서울청사"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </Field>
          <Field label="무엇을 *" required>
            <textarea
              value={form.what_summary}
              onChange={(e) => update('what_summary', e.target.value)}
              placeholder="정책·사안의 핵심 한 줄 설명"
              rows={2}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </Field>
          <Field label="왜 (배경)">
            <textarea
              value={form.why_background}
              onChange={(e) => update('why_background', e.target.value)}
              placeholder="추진 배경·필요성"
              rows={2}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </Field>
          <Field label="어떻게 (방법)">
            <textarea
              value={form.how_method}
              onChange={(e) => update('how_method', e.target.value)}
              placeholder="구체적인 추진 방법·절차"
              rows={2}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </Field>
        </Section>

        <Section title="④ 주요 내용·인용·기대효과">
          <Field
            label="주요 내용 (한 줄에 하나씩, 본문에 ①②③로 반영)"
          >
            <textarea
              value={form.key_points}
              onChange={(e) => update('key_points', e.target.value)}
              placeholder={'각 줄에 하나씩 입력. 예:\n공공 데이터 개방 30% 확대\n민원 신청 디지털화 100%\nAI 기반 행정서비스 도입'}
              rows={4}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </Field>
          <Field label="인용문 (한 줄에 하나씩, 사용자 입력만 사용)">
            <textarea
              value={form.quotes}
              onChange={(e) => update('quotes', e.target.value)}
              placeholder={'예:\n장관 발언: "디지털정부가 국민의 일상을 바꿀 것"'}
              rows={3}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </Field>
          <Field label="일정·대상">
            <textarea
              value={form.schedule}
              onChange={(e) => update('schedule', e.target.value)}
              placeholder="시행일, 적용 대상, 신청 방법 등"
              rows={2}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </Field>
          <Field label="기대 효과">
            <textarea
              value={form.expected_effect}
              onChange={(e) => update('expected_effect', e.target.value)}
              placeholder="정책이 가져올 효과"
              rows={2}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </Field>
        </Section>

        <Section title="⑤ RAG 자동 참조">
          <label className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg cursor-pointer">
            <input
              type="checkbox"
              checked={useRag}
              onChange={(e) => setUseRag(e.target.checked)}
              className="mt-1"
            />
            <div className="text-sm">
              <p className="font-medium text-slate-900">정책브리핑 유사 사례 자동 참조</p>
              <p className="text-xs text-slate-500 mt-0.5">
                제목과 유사한 최근 보도자료를 RAG에서 검색하여 작성 시 참고합니다.
                직접 인용하지 않고 톤·구조만 참고합니다.
              </p>
            </div>
          </label>
        </Section>

        {error && (
          <div className="mb-6 flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-xl">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Link
            to="/"
            className="px-4 py-2.5 text-sm text-slate-600 hover:text-slate-900"
          >
            취소
          </Link>
          <button
            onClick={handleGenerate}
            disabled={loading || !hasKey}
            className="flex items-center gap-2 px-6 py-2.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:bg-slate-300 disabled:cursor-not-allowed font-medium"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                AI 생성 중... (20-40초)
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                AI로 본문 생성
              </>
            )}
          </button>
        </div>
      </main>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 bg-white rounded-2xl border border-slate-200 p-6">
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  )
}
