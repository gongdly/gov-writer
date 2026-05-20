import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, MessageCircleQuestion, Upload, Sparkles, Loader2,
  AlertCircle, X, Settings, Plus,
} from 'lucide-react'
import { getActiveProvider, getStoredKey } from '../hooks/useLLMSettings'
import ApiKeyBanner from '../components/ApiKeyBanner'

/**
 * Phase 12 — 설명자료(보도설명자료) 작성 페이지.
 *
 * 행안부 보도설명자료 표준 양식:
 *   < 보도설명자료 >
 *   보도시점 · 제목 (부처 메시지)
 *   1. 주요 보도내용 — ○ 매체·일시·기사제목 / - 핵심 쟁점
 *   2. 동 보도내용에 대한 ○○부의 입장 — ○ 반박 단락 (경어체)
 *   담당 부서 (여러 부서 가능)
 *
 * 모드:
 *   - 수동(기본): 모든 항목 직접 입력
 *   - 자동: 기사 업로드 → AI가 "주요 보도내용" 요약 + 부처 입장 양식 정리
 *
 * 보안 원칙:
 *   - 담당자는 폼 입력값만, AI를 거치지 않음
 *   - 모든 예시는 "홍길동 · ○○과 · 044-XXX-XXXX"
 */

interface ContactItem {
  id: string
  category: string
  division: string
  team: string
  head: string
  head_phone: string
  staff: string
  staff_phone: string
}

interface ExplainForm {
  title: string
  report_date: string
  media_name: string
  media_date: string
  article_title: string
  article_points: string  // 줄바꿈 구분
  ministry_name: string
  ministry_position_raw: string  // 줄바꿈 구분
  contacts: ContactItem[]
}

const NEW_CONTACT = (): ContactItem => ({
  id: Math.random().toString(36).slice(2),
  category: '',
  division: '',
  team: '',
  head: '',
  head_phone: '',
  staff: '',
  staff_phone: '',
})

const INIT_FORM: ExplainForm = {
  title: '',
  report_date: '',
  media_name: '',
  media_date: '',
  article_title: '',
  article_points: '',
  ministry_name: '행정안전부',
  ministry_position_raw: '',
  contacts: [NEW_CONTACT()],
}

export default function ExplainWriter() {
  const [mode, setMode] = useState<'manual' | 'auto'>('manual')
  const [form, setForm] = useState<ExplainForm>(INIT_FORM)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  const provider = getActiveProvider()
  const apiKey = getStoredKey(provider)
  const hasKey = !!apiKey

  const update = <K extends keyof ExplainForm>(key: K, value: ExplainForm[K]) => {
    setForm((p) => ({ ...p, [key]: value }))
  }

  const updateContact = (idx: number, patch: Partial<ContactItem>) => {
    setForm((p) => ({
      ...p,
      contacts: p.contacts.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    }))
  }

  const addContact = () => {
    setForm((p) => ({ ...p, contacts: [...p.contacts, NEW_CONTACT()] }))
  }

  const removeContact = (idx: number) => {
    setForm((p) => ({
      ...p,
      contacts: p.contacts.length === 1 ? p.contacts : p.contacts.filter((_, i) => i !== idx),
    }))
  }

  const handleManualDraft = async () => {
    if (!hasKey) {
      setError('LLM API 키가 필요합니다. /settings에서 등록해주세요.')
      return
    }
    if (!form.media_name.trim() || !form.media_date.trim()) {
      setError('매체명·보도일자가 필요합니다.')
      return
    }
    const points = form.article_points.split('\n').map(s => s.trim()).filter(Boolean)
    if (points.length === 0) {
      setError('기사 핵심 쟁점이 하나 이상 필요합니다.')
      return
    }
    if (!form.ministry_position_raw.trim()) {
      setError('부처 입장 메모가 필요합니다.')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const headerKey =
        provider === 'anthropic' ? 'X-Anthropic-Key'
        : provider === 'gemini' ? 'X-Gemini-Key'
        : 'X-OpenAI-Key'

      const res = await fetch('/api/explain/draft', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-LLM-Provider': provider,
          [headerKey]: apiKey,
        },
        body: JSON.stringify({
          title: form.title,
          report_date: form.report_date,
          media_name: form.media_name,
          media_date: form.media_date,
          article_title: form.article_title,
          article_points: points,
          ministry_name: form.ministry_name,
          ministry_position_raw: form.ministry_position_raw,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || 'AI 정리 실패')
      }
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      // 결과를 폼에 반영
      setForm((p) => ({
        ...p,
        title: data.title || p.title,
        report_date: data.report_date || p.report_date,
        article_title: data.article_title || p.article_title,
        article_points: (data.article_points || []).join('\n') || p.article_points,
        ministry_position_raw: (data.ministry_position || []).join('\n') || p.ministry_position_raw,
      }))
      setShowPreview(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  // 미리보기로 직접 이동 (AI 안 거치고)
  const handlePreviewWithoutAI = () => {
    const points = form.article_points.split('\n').map(s => s.trim()).filter(Boolean)
    const positions = form.ministry_position_raw.split('\n').map(s => s.trim()).filter(Boolean)
    if (!form.media_name.trim() || points.length === 0 || positions.length === 0) {
      setError('매체명·기사 쟁점·부처 입장이 모두 필요합니다.')
      return
    }
    setShowPreview(true)
  }

  if (showPreview) {
    return (
      <ExplainPreview
        form={form}
        onBack={() => setShowPreview(false)}
      />
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-4 h-4" /> 홈
          </Link>
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-amber-50 rounded-lg">
              <MessageCircleQuestion className="w-4 h-4 text-amber-700" />
            </div>
            <h1 className="text-sm sm:text-base font-semibold text-slate-900 truncate">설명자료 작성</h1>
          </div>
          <Link to="/settings" title="API 키 설정" className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg">
            <Settings className="w-4 h-4" />
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <ApiKeyBanner />

        {/* 모드 토글 */}
        <section className="bg-white rounded-2xl border border-slate-200 p-1.5">
          <div className="grid grid-cols-2 gap-1">
            <button
              onClick={() => setMode('manual')}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                mode === 'manual' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              ✍️ 수동 작성
            </button>
            <button
              onClick={() => setMode('auto')}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                mode === 'auto' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              ✨ AI 자동 작성
            </button>
          </div>
          <p className="text-[11px] text-slate-500 px-2 pt-1.5 pb-0.5 text-center">
            {mode === 'manual'
              ? '보도내용·부처 입장을 직접 입력합니다. AI가 양식·종결어미만 정리해줍니다.'
              : '기사 첨부 → AI가 "주요 보도내용" 요약 + 부처 입장 양식 정리.'}
          </p>
        </section>

        {mode === 'auto' && (
          <ExplainAutoSection
            provider={provider}
            apiKey={apiKey || ''}
            hasKey={hasKey}
            ministryName={form.ministry_name}
            onResult={(parsed) => {
              setForm((p) => ({
                ...p,
                title: parsed.title || p.title,
                report_date: parsed.report_date || p.report_date,
                media_name: parsed.media_name || p.media_name,
                media_date: parsed.media_date || p.media_date,
                article_title: parsed.article_title || p.article_title,
                article_points: (parsed.article_points || []).join('\n') || p.article_points,
                ministry_position_raw: (parsed.ministry_position || []).join('\n') || p.ministry_position_raw,
              }))
              setMode('manual')
            }}
          />
        )}

        {mode === 'manual' && (
          <>
            {/* ① 기본 정보 */}
            <Section title="① 기본 정보">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <Label hint='💡 부처 메시지 한 줄. 예: "○○부는 ○○에 최선을 다하겠습니다"'>
                    제목 <Req />
                  </Label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => update('title', e.target.value)}
                    placeholder="예: ○○부는 ○○ 분야 ○○에 최선을 다하겠습니다"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <Label>보도시점</Label>
                  <input
                    type="text"
                    value={form.report_date}
                    onChange={(e) => update('report_date', e.target.value)}
                    placeholder="YYYY.M.D.(요일) 즉시보도"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="mt-3">
                <Label>부처명 <Req /></Label>
                <input
                  type="text"
                  value={form.ministry_name}
                  onChange={(e) => update('ministry_name', e.target.value)}
                  placeholder="예: 행정안전부"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>
            </Section>

            {/* ② 주요 보도내용 */}
            <Section title="② 주요 보도내용">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <div>
                  <Label>매체명 <Req /></Label>
                  <input
                    type="text"
                    value={form.media_name}
                    onChange={(e) => update('media_name', e.target.value)}
                    placeholder="예: ○○일보"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <Label>보도일자 <Req /></Label>
                  <input
                    type="text"
                    value={form.media_date}
                    onChange={(e) => update('media_date', e.target.value)}
                    placeholder="예: 3월 19일"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <Label>기사 제목</Label>
                  <input
                    type="text"
                    value={form.article_title}
                    onChange={(e) => update('article_title', e.target.value)}
                    placeholder="기사 제하"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <Label hint='💡 한 줄에 한 쟁점씩. 미리보기에서 "  - " 마커로 출력'>
                기사 핵심 내용 (쟁점별 한 줄씩) <Req />
              </Label>
              <textarea
                value={form.article_points}
                onChange={(e) => update('article_points', e.target.value)}
                placeholder={'기사가 주장하는 첫 번째 쟁점\n두 번째 쟁점 (한 줄에 하나)'}
                rows={3}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-mono"
              />
            </Section>

            {/* ③ 부처 입장 */}
            <Section title={`③ 동 보도내용에 대한 ${form.ministry_name || '○○부'}의 입장`}>
              <Label hint="💡 한 줄에 한 단락. AI는 양식만 정리(사실관계는 빅보스님 책임)">
                반박 단락 (한 줄에 한 단락) <Req />
              </Label>
              <textarea
                value={form.ministry_position_raw}
                onChange={(e) => update('ministry_position_raw', e.target.value)}
                placeholder={`${form.ministry_name || '○○부'}는 ~ 실시하고 있습니다.\n관계기관과 협력하여 ~ 지속 추진하겠습니다.`}
                rows={5}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                ⚠ 종결어미는 경어체(~입니다 / ~하겠습니다). AI는 양식·종결어미만 정리하고 사실관계는 만들지 않습니다.
              </p>
            </Section>

            {/* ④ 담당자 */}
            <Section title="④ 담당자 (여러 부서 추가 가능)">
              {form.contacts.map((c, idx) => (
                <div key={c.id} className="bg-slate-50 rounded-lg p-3 mb-2">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-slate-600">담당자 {idx + 1}</p>
                    {form.contacts.length > 1 && (
                      <button
                        onClick={() => removeContact(idx)}
                        className="p-1 text-slate-400 hover:text-red-600"
                        title="삭제"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
                    <input
                      type="text"
                      value={c.category}
                      onChange={(e) => updateContact(idx, { category: e.target.value })}
                      placeholder="구분 (선택)"
                      className="px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white"
                    />
                    <input
                      type="text"
                      value={c.division}
                      onChange={(e) => updateContact(idx, { division: e.target.value })}
                      placeholder="실/국"
                      className="px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white"
                    />
                    <input
                      type="text"
                      value={c.team}
                      onChange={(e) => updateContact(idx, { team: e.target.value })}
                      placeholder="과"
                      className="px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white"
                    />
                    <input
                      type="text"
                      value={c.head}
                      onChange={(e) => updateContact(idx, { head: e.target.value })}
                      placeholder="책임자 (예: 과장 홍길동)"
                      className="px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={c.head_phone}
                      onChange={(e) => updateContact(idx, { head_phone: e.target.value })}
                      placeholder="책임자 연락처 (예: 044-XXX-XXXX)"
                      className="px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white"
                    />
                    <input
                      type="text"
                      value={c.staff}
                      onChange={(e) => updateContact(idx, { staff: e.target.value })}
                      placeholder="담당자 (예: 사무관 홍길동)"
                      className="px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white"
                    />
                    <input
                      type="text"
                      value={c.staff_phone}
                      onChange={(e) => updateContact(idx, { staff_phone: e.target.value })}
                      placeholder="담당자 연락처"
                      className="px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white"
                    />
                  </div>
                </div>
              ))}
              <button
                onClick={addContact}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50 border border-blue-200 rounded-lg"
              >
                <Plus className="w-3.5 h-3.5" /> 담당자 추가
              </button>
              <p className="text-[11px] text-slate-500 mt-2 text-center">
                ℹ 담당자 정보는 AI를 거치지 않고 폼 입력값 그대로 문서에 들어갑니다.
              </p>
            </Section>

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={handleManualDraft}
                disabled={!hasKey || loading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-slate-900 text-white rounded-lg disabled:bg-slate-300 disabled:cursor-not-allowed font-medium text-sm"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {loading ? '양식 정리 중...' : 'AI로 양식 정리'}
              </button>
              <button
                onClick={handlePreviewWithoutAI}
                className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-sm"
              >
                미리보기 →
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

/* ─── 자동 모드 ─── */

function ExplainAutoSection({
  provider, apiKey, hasKey, ministryName, onResult,
}: {
  provider: string
  apiKey: string
  hasKey: boolean
  ministryName: string
  onResult: (parsed: {
    title?: string
    report_date?: string
    media_name?: string
    media_date?: string
    article_title?: string
    article_points?: string[]
    ministry_position?: string[]
  }) => void
}) {
  const [articleFile, setArticleFile] = useState<File | null>(null)
  const [articleText, setArticleText] = useState('')
  const [positionMemo, setPositionMemo] = useState('')
  const [titleHint, setTitleHint] = useState('')
  const [reportDate, setReportDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleSubmit = async () => {
    setError('')
    setInfo('')
    if (!hasKey) {
      setError(`${provider} API 키가 설정되지 않았습니다.`)
      return
    }
    if (!articleFile && !articleText.trim()) {
      setError('기사 파일 또는 기사 텍스트가 필요합니다.')
      return
    }
    if (!positionMemo.trim()) {
      setError('부처 입장 요지 메모가 필요합니다.')
      return
    }

    setLoading(true)
    try {
      const headerKey =
        provider === 'anthropic' ? 'X-Anthropic-Key'
        : provider === 'gemini' ? 'X-Gemini-Key'
        : 'X-OpenAI-Key'

      const fd = new FormData()
      if (articleFile) fd.append('article_file', articleFile, articleFile.name)
      if (articleText.trim()) fd.append('article_text', articleText.trim())
      fd.append('ministry_position_raw', positionMemo.trim())
      fd.append('ministry_name', ministryName || '○○부')
      if (titleHint.trim()) fd.append('title_hint', titleHint.trim())
      if (reportDate.trim()) fd.append('report_date', reportDate.trim())

      const res = await fetch('/api/explain/auto-draft', {
        method: 'POST',
        headers: { 'X-LLM-Provider': provider, [headerKey]: apiKey },
        body: fd,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || '자동 작성 실패')
      }
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      const conf = typeof data.confidence === 'number' ? Math.round(data.confidence * 100) : null
      setInfo(
        conf !== null
          ? `✓ 자동 작성 완료 (신뢰도 ${conf}%). 수동 모드로 전환되었습니다. 폼에서 검토·수정하세요.`
          : '✓ 자동 작성 완료. 수동 모드로 전환되었습니다.'
      )
      onResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="bg-blue-50/40 rounded-2xl border-2 border-blue-200 p-5">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-4 h-4 text-blue-600" />
        <h2 className="text-sm font-semibold text-slate-900">AI 자동 작성</h2>
        {!hasKey && (
          <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-800 rounded">🔒 API 키 필요</span>
        )}
      </div>
      <p className="text-xs text-slate-600 mb-4">
        기사 첨부 → AI가 "주요 보도내용" 섹션 요약 + 부처 입장 메모를 양식대로 정리합니다.
        담당자는 별도로 폼에서 직접 입력해주세요.
      </p>

      {/* 1. 기사 */}
      <div className="mb-3">
        <label className="block text-xs font-medium text-slate-700 mb-1.5">
          ① 기사 원문 <span className="text-red-500">*</span>
        </label>
        <p className="text-[11px] text-slate-500 mb-2">AI가 매체·일시·기사 제목·핵심 쟁점을 자동 추출하여 양식대로 요약합니다.</p>
        <div className="flex flex-col gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.hwp,.hwpx,.doc,.docx,.txt"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) setArticleFile(f)
              if (fileRef.current) fileRef.current.value = ''
            }}
          />
          <div
            onClick={() => hasKey && fileRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-all ${
              hasKey ? 'border-blue-300 bg-white hover:border-blue-500' : 'border-slate-200 opacity-60'
            }`}
          >
            <Upload className="w-4 h-4 mx-auto mb-1 text-blue-500" />
            <p className="text-xs font-medium text-slate-700">
              {articleFile ? articleFile.name : '기사 파일 업로드 (PDF/HWPX/DOCX/TXT)'}
            </p>
          </div>
          {articleFile && (
            <button
              onClick={() => setArticleFile(null)}
              className="text-xs text-slate-500 hover:text-red-600 self-start"
            >
              파일 제거
            </button>
          )}
          <p className="text-[11px] text-slate-500 text-center">또는</p>
          <textarea
            value={articleText}
            onChange={(e) => setArticleText(e.target.value)}
            placeholder="기사 텍스트 직접 붙여넣기"
            rows={3}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* 2. 부처 입장 메모 */}
      <div className="mb-3">
        <label className="block text-xs font-medium text-slate-700 mb-1.5">
          ② 부처 입장 요지 <span className="text-red-500">*</span>
        </label>
        <p className="text-[11px] text-slate-500 mb-2">
          ⚠ AI는 이 메모를 양식에 맞게 정리만 합니다. 사실관계·수치를 새로 만들지 않습니다.
        </p>
        <textarea
          value={positionMemo}
          onChange={(e) => setPositionMemo(e.target.value)}
          placeholder="무엇이 사실과 다른지, 부처 공식 입장, 근거 자료·통계를 짧게 메모"
          rows={4}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* 3. 제목 (선택) */}
      <div className="mb-3">
        <label className="block text-xs font-medium text-slate-700 mb-1.5">③ 제목 (선택)</label>
        <p className="text-[11px] text-slate-500 mb-2">비워두면 AI가 부처 입장으로부터 메시지 한 줄 도출.</p>
        <input
          type="text"
          value={titleHint}
          onChange={(e) => setTitleHint(e.target.value)}
          placeholder="예: ○○부는 ○○에 최선을 다하겠습니다"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* 4. 보도시점 (선택) */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-slate-700 mb-1.5">④ 보도시점 (선택)</label>
        <input
          type="text"
          value={reportDate}
          onChange={(e) => setReportDate(e.target.value)}
          placeholder="YYYY.M.D.(요일) 즉시보도"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
        />
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 p-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {info && (
        <div className="mb-3 p-2.5 bg-green-50 border border-green-100 rounded-lg text-xs text-green-800">
          {info}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={!hasKey || loading || (!articleFile && !articleText.trim()) || !positionMemo.trim()}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:bg-slate-300 disabled:cursor-not-allowed font-medium text-sm"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {loading ? 'AI가 작성 중... (15-30초)' : 'AI로 설명자료 자동 작성'}
      </button>
    </section>
  )
}

/* ─── 미리보기 ─── */

function ExplainPreview({ form, onBack }: { form: ExplainForm; onBack: () => void }) {
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState<'md' | 'hwpx' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const points = form.article_points.split('\n').map(s => s.trim()).filter(Boolean)
  const positions = form.ministry_position_raw.split('\n').map(s => s.trim()).filter(Boolean)

  const buildBody = () => ({
    title: form.title,
    report_date: form.report_date,
    media_name: form.media_name,
    media_date: form.media_date,
    article_title: form.article_title,
    article_points: points,
    ministry_name: form.ministry_name,
    ministry_position: positions,
    contacts: form.contacts.filter(c =>
      c.division || c.team || c.head || c.staff
    ).map(c => ({
      category: c.category,
      division: c.division,
      team: c.team,
      head: c.head,
      head_phone: c.head_phone,
      staff: c.staff,
      staff_phone: c.staff_phone,
    })),
  })

  const handleCopy = async () => {
    const text = [
      '< 보도설명자료 >',
      form.report_date ? `보도시점: ${form.report_date}` : '',
      '',
      form.title,
      '',
      '1. 주요 보도내용',
      ` ○ ${form.media_date} ${form.media_name}${form.article_title ? ` <${form.article_title}>` : ''} 제하의 보도임`,
      ...points.map(p => `   - ${p}`),
      '',
      `2. 동 보도내용에 대한 ${form.ministry_name}의 입장`,
      ...positions.map(p => ` ○ ${p}`),
    ].filter(Boolean).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert('복사 실패')
    }
  }

  const handleDownload = async (format: 'md' | 'hwpx') => {
    setError(null)
    setDownloading(format)
    try {
      const res = await fetch(`/api/download/explain/${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      })
      if (!res.ok) throw new Error(await res.text() || `${format} 변환 실패`)
      const cd = res.headers.get('content-disposition') || ''
      let fname = `설명자료.${format}`
      const m = cd.match(/filename\*=UTF-8''([^;]+)/i)
      if (m) {
        try { fname = decodeURIComponent(m[1]) } catch { /* ignore */ }
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fname
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-4 h-4" /> 편집으로
          </button>
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-amber-50 rounded-lg">
              <MessageCircleQuestion className="w-4 h-4 text-amber-700" />
            </div>
            <h1 className="text-sm sm:text-base font-semibold text-slate-900">미리보기</h1>
          </div>
          <div className="w-8" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8">
          {/* 헤더 */}
          <div className="text-center pb-3 border-b-2 border-slate-900 mb-4">
            <p className="text-base font-semibold tracking-widest">&lt; 보도설명자료 &gt;</p>
          </div>
          {form.report_date && (
            <p className="text-sm text-slate-700 mb-2">
              <strong>보도시점</strong>: {form.report_date}
            </p>
          )}
          {/* 제목 */}
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900 my-4 text-center px-2">
            {form.title || '(제목 없음)'}
          </h1>

          {/* 1. 주요 보도내용 */}
          <div className="mt-6">
            <h2 className="text-sm font-semibold mb-2">1. 주요 보도내용</h2>
            <p className="text-sm leading-relaxed text-slate-800 mb-1">
              {' ○ '}
              {form.media_date} {form.media_name}
              {form.article_title && ` <${form.article_title}>`} 제하의 보도임
            </p>
            {points.map((p, i) => (
              <p key={i} className="text-sm leading-relaxed text-slate-700 ml-3">
                {`   - ${p}`}
              </p>
            ))}
          </div>

          {/* 2. 부처 입장 */}
          <div className="mt-6">
            <h2 className="text-sm font-semibold mb-2">
              2. 동 보도내용에 대한 {form.ministry_name}의 입장
            </h2>
            {positions.map((p, i) => (
              <p key={i} className="text-sm leading-relaxed text-slate-800 mb-2">
                {` ○ ${p}`}
              </p>
            ))}
          </div>

          {/* 담당자 */}
          {form.contacts.some(c => c.division || c.team || c.head || c.staff) && (
            <div className="mt-8 pt-4 border-t-2 border-slate-300">
              <h3 className="text-xs font-semibold text-slate-700 mb-2">담당 부서</h3>
              {form.contacts.map((c, i) => {
                if (!c.division && !c.team && !c.head && !c.staff) return null
                const header = [c.category, c.division, c.team].filter(Boolean).join(' / ')
                return (
                  <div key={i} className="text-xs text-slate-700 mb-2">
                    {header && <p className="font-medium">{header}</p>}
                    {c.head && (
                      <p className="ml-3">책임자: {c.head}{c.head_phone && ` (${c.head_phone})`}</p>
                    )}
                    {c.staff && (
                      <p className="ml-3">담당자: {c.staff}{c.staff_phone && ` (${c.staff_phone})`}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button onClick={onBack} className="px-4 py-2.5 text-sm text-slate-600 hover:text-slate-900">
            ← 편집
          </button>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <button
              onClick={handleCopy}
              className="flex-1 sm:flex-none px-4 py-2.5 text-sm border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 font-medium"
            >
              {copied ? '✓ 복사됨' : '전체 복사'}
            </button>
            <button
              onClick={() => handleDownload('md')}
              disabled={downloading !== null}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50 font-medium"
            >
              {downloading === 'md' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              MD
            </button>
            <button
              onClick={() => handleDownload('hwpx')}
              disabled={downloading !== null}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-5 py-2.5 text-sm bg-slate-900 hover:bg-slate-800 text-white rounded-lg disabled:opacity-50 font-medium"
            >
              {downloading === 'hwpx' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              HWPX 다운로드
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}

/* ─── 헬퍼 ─── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{title}</h3>
      {children}
    </section>
  )
}

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5">
      <label className="block text-xs font-medium text-slate-700">{children}</label>
      {hint && <p className="text-[10px] text-slate-500 mt-0.5">{hint}</p>}
    </div>
  )
}

function Req() {
  return <span className="text-red-500">*</span>
}
