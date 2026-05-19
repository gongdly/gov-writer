import { useState, useRef } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Megaphone, Search, Loader2, AlertCircle, X,
  Upload, Sparkles, Plus, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { getActiveProvider, getStoredKey } from '../hooks/useLLMSettings'
import SpeechWriter from './SpeechWriter'

type DocType = 'speech' | 'press'

const MINISTRIES = [
  '행정안전부', '기획재정부', '교육부', '과학기술정보통신부', '외교부',
  '법무부', '국방부', '문화체육관광부', '농림축산식품부', '산업통상자원부',
  '보건복지부', '환경부', '고용노동부', '국토교통부', '해양수산부',
  '중소벤처기업부', '여성가족부', '국가보훈부', '통일부',
]

const STEPS = ['검색·참조', '작성', '미리보기']

interface SearchResult {
  news_item_id: string
  title: string
  subtitle: string
  ministry: string
  approve_date: string
  body_preview: string
  url: string
}

interface PressForm {
  title: string
  subtitle: string
  lead_paragraph: string
  body_paragraphs: string[]
  department: string
  contact_person: string
  contact_phone: string
  distribute_date: string
}

interface UploadFileItem {
  id: string
  name: string
  size: number
  file: File
}

const INIT_FORM: PressForm = {
  title: '',
  subtitle: '',
  lead_paragraph: '',
  body_paragraphs: [''],
  department: '',
  contact_person: '',
  contact_phone: '',
  distribute_date: '',
}

function fSize(b: number): string {
  if (b < 1024) return `${b}B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`
  return `${(b / 1048576).toFixed(1)}MB`
}

const FILE_ICON: Record<string, string> = {
  pdf: '📄', hwp: '📝', hwpx: '📝', doc: '📃', docx: '📃',
  ppt: '📊', pptx: '📊', txt: '📋',
}

function fIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return FILE_ICON[ext] || '📎'
}

export default function WritePage() {
  const [params] = useSearchParams()
  const docType: DocType = params.get('type') === 'press' ? 'press' : 'speech'

  if (docType === 'speech') {
    return <SpeechWriter />
  }

  return <PressEditor />
}

function PressEditor() {
  const [step, setStep] = useState(0)
  const [selectedRefs, setSelectedRefs] = useState<SearchResult[]>([])
  const [form, setForm] = useState<PressForm>(INIT_FORM)
  const [files, setFiles] = useState<UploadFileItem[]>([])

  const toggleRef = (r: SearchResult) => {
    setSelectedRefs((prev) =>
      prev.some((s) => s.news_item_id === r.news_item_id)
        ? prev.filter((s) => s.news_item_id !== r.news_item_id)
        : [...prev, r]
    )
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

      <main className="max-w-4xl mx-auto px-6 py-6">
        {/* 단계 진행 */}
        <div className="mb-6 bg-white rounded-xl border border-slate-200 p-3">
          <div className="flex items-center justify-between">
            {STEPS.map((label, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all ${
                  step === i
                    ? 'bg-green-600 text-white font-medium'
                    : i < step
                    ? 'text-green-700 hover:bg-green-50'
                    : 'text-slate-400 hover:bg-slate-50'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                    step === i ? 'bg-white text-green-700' : i < step ? 'bg-green-100' : 'bg-slate-100'
                  }`}
                >
                  {i + 1}
                </span>
                {label}
              </button>
            ))}
          </div>
        </div>

        {step === 0 && (
          <SearchStep
            selectedRefs={selectedRefs}
            onToggle={toggleRef}
            onNext={() => setStep(1)}
          />
        )}
        {step === 1 && (
          <WriteStep
            form={form}
            setForm={setForm}
            refs={selectedRefs}
            files={files}
            setFiles={setFiles}
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && <PreviewStep form={form} onBack={() => setStep(1)} />}
      </main>
    </div>
  )
}

/* ─── Step 1: 검색 ─── */

function SearchStep({
  selectedRefs,
  onToggle,
  onNext,
}: {
  selectedRefs: SearchResult[]
  onToggle: (r: SearchResult) => void
  onNext: () => void
}) {
  const [ministry, setMinistry] = useState('')
  const [query, setQuery] = useState('')
  const [days, setDays] = useState(3)
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [showMinDrop, setShowMinDrop] = useState(false)
  const PER = 5

  const search = async () => {
    setLoading(true)
    setError('')
    setPage(1)
    try {
      const params = new URLSearchParams({
        q: query,
        days: String(days),
        limit: '50',
      })
      if (ministry) params.set('ministry', ministry)
      const res = await fetch(`/api/press/search?${params}`)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setResults(data.results || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const total = results.length
  const start = (page - 1) * PER
  const pageItems = results.slice(start, start + PER)
  const totalPages = Math.ceil(total / PER)

  return (
    <div>
      <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-900">
        중앙부처 보도자료에서 작성하려는 주제와 유사한 자료를 찾아 참조로 추가하면, AI가 해당 부처의 톤과 형식을 학습합니다.
      </div>

      <section className="bg-white rounded-2xl border border-slate-200 p-5 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <div className="relative">
            <label className="block text-xs font-medium text-slate-600 mb-1">부처</label>
            <input
              type="text"
              value={ministry}
              onChange={(e) => setMinistry(e.target.value)}
              onFocus={() => setShowMinDrop(true)}
              onBlur={() => setTimeout(() => setShowMinDrop(false), 200)}
              placeholder="전체"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
            {showMinDrop && (
              <div className="absolute left-0 right-0 top-full mt-1 max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg z-20">
                <div
                  className="px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer"
                  onClick={() => { setMinistry(''); setShowMinDrop(false) }}
                >
                  전체
                </div>
                {MINISTRIES.filter((m) => !ministry || m.includes(ministry)).map((m) => (
                  <div
                    key={m}
                    className="px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer"
                    onClick={() => { setMinistry(m); setShowMinDrop(false) }}
                  >
                    {m}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">키워드</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              placeholder="예: 디지털, AI, 환경"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">기간</label>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              <option value={1}>최근 1일</option>
              <option value={2}>최근 2일</option>
              <option value={3}>최근 3일</option>
            </select>
          </div>
        </div>
        <button
          onClick={search}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 text-sm font-medium"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {loading ? '검색 중...' : '검색'}
        </button>
        {error && (
          <div className="mt-3 flex items-start gap-2 p-2 bg-red-50 border border-red-100 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}
      </section>

      {results.length > 0 && (
        <section>
          <div className="flex justify-between items-center mb-2 px-1">
            <p className="text-xs text-slate-500">
              총 {total}건 / 선택 {selectedRefs.length}건
            </p>
          </div>
          <div className="space-y-2 mb-4">
            {pageItems.map((r) => {
              const sel = selectedRefs.some((s) => s.news_item_id === r.news_item_id)
              return (
                <div
                  key={r.news_item_id}
                  onClick={() => onToggle(r)}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    sel
                      ? 'border-green-500 bg-green-50'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-700 rounded">
                      {r.ministry}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        sel ? 'bg-green-600 text-white' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {sel ? '✓ 선택됨' : '선택'}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900 mb-1">{r.title}</p>
                  <p className="text-xs text-slate-500">
                    {r.approve_date} · {r.body_preview?.slice(0, 80)}...
                  </p>
                </div>
              )
            })}
          </div>
          {totalPages > 1 && (
            <div className="flex justify-center gap-1 mb-4">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="p-1.5 text-slate-500 hover:text-slate-900 disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setPage(i + 1)}
                  className={`w-8 h-8 text-xs rounded ${
                    page === i + 1
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="p-1.5 text-slate-500 hover:text-slate-900 disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </section>
      )}

      <div className="flex justify-end pt-4">
        <button
          onClick={onNext}
          className="px-5 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
        >
          다음: 작성 →
        </button>
      </div>
    </div>
  )
}

/* ─── Step 2: 작성 (AI 초안 + 폼) ─── */

function WriteStep({
  form, setForm, refs, files, setFiles, onBack, onNext,
}: {
  form: PressForm
  setForm: React.Dispatch<React.SetStateAction<PressForm>>
  refs: SearchResult[]
  files: UploadFileItem[]
  setFiles: React.Dispatch<React.SetStateAction<UploadFileItem[]>>
  onBack: () => void
  onNext: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiTopic, setAiTopic] = useState('')
  const [aiInst, setAiInst] = useState('')
  const [aiError, setAiError] = useState('')

  const provider = getActiveProvider()
  const apiKey = getStoredKey(provider)
  const hasKey = !!apiKey
  const hasRefs = refs.length > 0
  const hasDocs = files.length > 0

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || [])
    if (!selected.length) return
    setFiles((p) => [
      ...p,
      ...selected.map((f) => ({
        id: Math.random().toString(36).slice(2),
        name: f.name,
        size: f.size,
        file: f,
      })),
    ])
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleAI = async () => {
    if (!apiKey) {
      setAiError(`${provider} API 키가 설정되지 않았습니다.`)
      return
    }
    if (!aiTopic.trim()) {
      setAiError('주제를 입력해주세요.')
      return
    }
    setAiLoading(true)
    setAiError('')
    try {
      const refTexts = refs.map(
        (r) => `[${r.ministry}] ${r.title}\n${r.body_preview || ''}`
      )
      const headerKey =
        provider === 'anthropic' ? 'X-Anthropic-Key'
        : provider === 'gemini' ? 'X-Gemini-Key'
        : 'X-OpenAI-Key'

      let result: any
      if (hasDocs) {
        const fd = new FormData()
        fd.append('topic', aiTopic)
        fd.append('instructions', aiInst)
        fd.append('ref_texts', JSON.stringify(refTexts))
        files.forEach((f) => fd.append('files', f.file, f.name))
        const res = await fetch('/api/press/draft-with-docs', {
          method: 'POST',
          headers: { 'X-LLM-Provider': provider, [headerKey]: apiKey },
          body: fd,
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }))
          throw new Error(err.detail || 'AI 초안 생성 실패')
        }
        result = await res.json()
      } else {
        const res = await fetch('/api/press/draft', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-LLM-Provider': provider,
            [headerKey]: apiKey,
          },
          body: JSON.stringify({
            topic: aiTopic,
            instructions: aiInst,
            ref_texts: refTexts,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }))
          throw new Error(err.detail || 'AI 초안 생성 실패')
        }
        result = await res.json()
      }

      if (result.error) {
        setAiError(result.error)
      } else {
        setForm((d) => ({
          ...d,
          title: result.title || d.title,
          subtitle: result.subtitle || d.subtitle,
          lead_paragraph: result.lead_paragraph || d.lead_paragraph,
          body_paragraphs:
            result.body_paragraphs?.length ? result.body_paragraphs : d.body_paragraphs,
        }))
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e))
    } finally {
      setAiLoading(false)
    }
  }

  const addP = () =>
    setForm((d) => ({ ...d, body_paragraphs: [...d.body_paragraphs, ''] }))
  const updP = (i: number, v: string) =>
    setForm((d) => {
      const p = [...d.body_paragraphs]
      p[i] = v
      return { ...d, body_paragraphs: p }
    })
  const delP = (i: number) =>
    setForm((d) => ({
      ...d,
      body_paragraphs: d.body_paragraphs.filter((_, j) => j !== i),
    }))

  return (
    <div className="space-y-5">
      {/* AI 패널 */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4 text-green-600" />
          <h2 className="text-sm font-semibold text-slate-900">AI 초안 작성</h2>
          {!hasKey && (
            <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-800 rounded">
              🔒 API 키 필요
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mb-3">
          {hasKey
            ? '참조 보도자료와 업로드 문서를 분석하여 초안을 생성합니다'
            : '상단 설정에서 AI API 키를 입력하면 사용할 수 있습니다'}
        </p>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {hasRefs && (
            <span className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded">
              참조 보도자료 {refs.length}건
            </span>
          )}
          {hasDocs && (
            <span className="text-xs px-2 py-1 bg-purple-50 text-purple-700 rounded">
              업로드 문서 {files.length}건
            </span>
          )}
          {!hasRefs && !hasDocs && (
            <span className="text-xs px-2 py-1 bg-slate-100 text-slate-500 rounded">
              참조 자료 없음
            </span>
          )}
        </div>

        {/* 파일 업로드 */}
        <div
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all mb-3 ${
            hasKey
              ? 'border-slate-300 hover:border-green-500 hover:bg-green-50/30'
              : 'border-slate-200 opacity-60 hover:opacity-100'
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.hwp,.hwpx,.doc,.docx,.ppt,.pptx,.txt"
            hidden
            onChange={handleFiles}
          />
          <Upload className="w-5 h-5 mx-auto mb-1 text-slate-400" />
          <p className="text-xs font-medium text-slate-700">
            사업계획서, 회의자료 등 참고 문서 업로드
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            PDF, HWPX, DOCX, TXT (HWP는 미지원, HWPX로 저장 후 업로드)
          </p>
        </div>

        {files.length > 0 && (
          <div className="space-y-1 mb-3">
            {files.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 rounded text-xs"
              >
                <span className="text-base">{fIcon(f.name)}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{f.name}</p>
                  <p className="text-[10px] text-slate-400">{fSize(f.size)}</p>
                </div>
                <button
                  onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))}
                  className="p-1 text-slate-400 hover:text-red-600"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <input
          type="text"
          value={aiTopic}
          onChange={(e) => setAiTopic(e.target.value)}
          disabled={!hasKey}
          placeholder="보도자료 주제 (예: 지방자치단체 AI 도입 지원)"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-green-500 disabled:bg-slate-50 disabled:text-slate-400 mb-2"
        />
        <textarea
          value={aiInst}
          onChange={(e) => setAiInst(e.target.value)}
          disabled={!hasKey}
          placeholder="추가 지시사항 (선택) — 리드문 3안, 역피라미드 구조, 수치 강조 등"
          rows={2}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-green-500 disabled:bg-slate-50 disabled:text-slate-400 mb-3"
        />

        {aiError && (
          <div className="flex items-start gap-2 p-2 mb-3 bg-red-50 border border-red-100 rounded text-xs text-red-700">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            {aiError}
          </div>
        )}

        <button
          onClick={handleAI}
          disabled={!hasKey || !aiTopic.trim() || aiLoading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-slate-300 text-sm font-medium"
        >
          {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {aiLoading ? '생성 중...' : 'AI로 초안 작성'}
        </button>
      </section>

      {/* 제목 */}
      <Section title="제목">
        <input
          type="text"
          value={form.title}
          onChange={(e) => setForm((d) => ({ ...d, title: e.target.value }))}
          placeholder="제목"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 mb-2"
        />
        <input
          type="text"
          value={form.subtitle}
          onChange={(e) => setForm((d) => ({ ...d, subtitle: e.target.value }))}
          placeholder="부제목 (선택)"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
        />
      </Section>

      {/* 리드문 */}
      <Section title="리드문">
        <textarea
          value={form.lead_paragraph}
          onChange={(e) => setForm((d) => ({ ...d, lead_paragraph: e.target.value }))}
          placeholder="□ 리드문..."
          rows={3}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
        />
      </Section>

      {/* 본문 단락 */}
      <Section title="본문 단락">
        {form.body_paragraphs.map((p, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <textarea
              value={p}
              onChange={(e) => updP(i, e.target.value)}
              placeholder=" ○ 본문 단락..."
              rows={2}
              className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => delP(i)}
              disabled={form.body_paragraphs.length <= 1}
              className="px-2 text-slate-400 hover:text-red-600 disabled:opacity-30 self-start mt-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
        <button
          onClick={addP}
          className="w-full flex items-center justify-center gap-1 px-3 py-2 text-sm text-slate-600 border border-dashed border-slate-300 rounded-lg hover:border-blue-500 hover:text-blue-600"
        >
          <Plus className="w-3.5 h-3.5" /> 단락 추가
        </button>
      </Section>

      {/* 담당자 */}
      <Section title="담당자 정보">
        <div className="grid grid-cols-2 gap-3">
          <FieldInput
            label="부서"
            value={form.department}
            onChange={(v) => setForm((d) => ({ ...d, department: v }))}
            placeholder="예: 디지털정부국 디지털정부과"
          />
          <FieldInput
            label="담당자"
            value={form.contact_person}
            onChange={(v) => setForm((d) => ({ ...d, contact_person: v }))}
            placeholder="예: 홍길동 사무관"
          />
          <FieldInput
            label="연락처"
            value={form.contact_phone}
            onChange={(v) => setForm((d) => ({ ...d, contact_phone: v }))}
            placeholder="예: 044-205-1234"
          />
          <FieldInput
            label="배포일자"
            value={form.distribute_date}
            onChange={(v) => setForm((d) => ({ ...d, distribute_date: v }))}
            placeholder="예: 2026.5.19.(월)"
          />
        </div>
      </Section>

      <div className="flex justify-between pt-2">
        <button
          onClick={onBack}
          className="px-4 py-2.5 text-sm text-slate-600 hover:text-slate-900"
        >
          ← 이전
        </button>
        <button
          onClick={onNext}
          className="px-5 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
        >
          다음: 미리보기 →
        </button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{title}</h3>
      {children}
    </section>
  )
}

function FieldInput({
  label, value, onChange, placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs text-slate-600 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
      />
    </div>
  )
}

/* ─── Step 3: 미리보기 ─── */

function PreviewStep({
  form, onBack,
}: {
  form: PressForm
  onBack: () => void
}) {
  const [copied, setCopied] = useState(false)

  const fullText = [
    form.title,
    form.subtitle ? form.subtitle : '',
    '',
    form.lead_paragraph,
    '',
    ...form.body_paragraphs,
    '',
    form.department && `담당 부서: ${form.department}`,
    form.contact_person && `담당자: ${form.contact_person}`,
    form.contact_phone && `연락처: ${form.contact_phone}`,
    form.distribute_date && `배포일자: ${form.distribute_date}`,
  ].filter(Boolean).join('\n')

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert('복사 실패. 텍스트 직접 선택하여 복사해주세요.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">{form.title || '(제목 없음)'}</h1>
        {form.subtitle && (
          <p className="text-base text-slate-600 mb-6">{form.subtitle}</p>
        )}

        <div className="space-y-3 text-sm leading-relaxed text-slate-800 whitespace-pre-wrap">
          <p className="font-medium">{form.lead_paragraph || '□ 리드문이 비어있습니다'}</p>
          {form.body_paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>

        {(form.department || form.contact_person || form.contact_phone || form.distribute_date) && (
          <div className="mt-8 pt-4 border-t border-slate-200 text-xs text-slate-600 space-y-0.5">
            {form.department && <p>담당 부서: {form.department}</p>}
            {form.contact_person && <p>담당자: {form.contact_person}</p>}
            {form.contact_phone && <p>연락처: {form.contact_phone}</p>}
            {form.distribute_date && <p>배포일자: {form.distribute_date}</p>}
          </div>
        )}
      </div>

      <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-900">
        <strong>다음 단계 (Phase 3.5):</strong> HWPX 파일 다운로드. 현재는 "전체 복사"로 결재 시스템·한글에 붙여넣으시면 됩니다.
      </div>

      <div className="flex justify-between pt-2">
        <button
          onClick={onBack}
          className="px-4 py-2.5 text-sm text-slate-600 hover:text-slate-900"
        >
          ← 이전 (편집)
        </button>
        <button
          onClick={handleCopy}
          className="px-5 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 text-sm font-medium"
        >
          {copied ? '✓ 복사됨' : '전체 복사'}
        </button>
      </div>
    </div>
  )
}
