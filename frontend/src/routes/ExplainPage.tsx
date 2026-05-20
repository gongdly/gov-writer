/**
 * Phase 12 — 설명자료 작성 페이지.
 *
 * 행안부 보도설명자료 표준 양식:
 *   1. 주요 보도내용  (AI 요약 가능)
 *   2. 동 보도내용에 대한 ○○부의 입장  (AI 양식 정리만)
 *   담당자 표  (🔒 사용자 입력값만, AI 거치지 않음)
 */
import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, MessageCircleQuestion, Sparkles, Loader2, AlertCircle, Upload,
  Settings, Plus, Trash2, Wand2,
} from 'lucide-react'
import { getActiveProvider, getStoredKey } from '../hooks/useLLMSettings'
import ApiKeyBanner from '../components/ApiKeyBanner'

interface Contact {
  division: string          // (중앙정부) / (지방정부) 구분
  departmentRole: string    // 실/국 / 과
  managerRole: string       // 책임자 직급
  managerName: string       // 책임자 이름
  managerPhone: string      // 책임자 연락처
  staffRole: string         // 담당자 직급
  staffName: string         // 담당자 이름
  staffPhone: string        // 담당자 연락처
}

interface ArticleInfo {
  mediaName: string
  articleDate: string
  articleTitle: string
  keyPoints: string  // 줄바꿈으로 구분
}

interface ExplainForm {
  title: string
  reportDate: string
  ministryName: string
  article: ArticleInfo
  positionParagraphs: string  // 줄바꿈으로 구분
  contacts: Contact[]
}

const EMPTY_CONTACT: Contact = {
  division: '',
  departmentRole: '',
  managerRole: '과장',
  managerName: '',
  managerPhone: '',
  staffRole: '사무관',
  staffName: '',
  staffPhone: '',
}

const INIT_FORM: ExplainForm = {
  title: '',
  reportDate: '',
  ministryName: '행정안전부',
  article: { mediaName: '', articleDate: '', articleTitle: '', keyPoints: '' },
  positionParagraphs: '',
  contacts: [{ ...EMPTY_CONTACT }],
}

type Mode = 'manual' | 'auto'
type Step = 'edit' | 'preview'

export default function ExplainPage() {
  const [mode, setMode] = useState<Mode>('manual')
  const [step, setStep] = useState<Step>('edit')
  const [form, setForm] = useState<ExplainForm>(INIT_FORM)

  const provider = getActiveProvider()
  const apiKey = getStoredKey(provider)
  const hasKey = !!apiKey

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-4 h-4" /> 홈
          </Link>
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-amber-50 rounded-lg">
              <MessageCircleQuestion className="w-4 h-4 text-amber-700" />
            </div>
            <h1 className="text-sm sm:text-base font-semibold text-slate-900 truncate">설명자료 작성</h1>
          </div>
          <Link
            to="/settings"
            title="API 키 설정"
            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
          >
            <Settings className="w-4 h-4" />
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4">
        <ApiKeyBanner />

        {step === 'edit' && (
          <>
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
                  ? '보도내용·부처 입장을 직접 입력합니다.'
                  : '기사 + 부처 입장 메모로 표준 양식 자동 작성 (담당자는 별도 입력).'}
              </p>
            </section>

            {mode === 'auto' && (
              <AutoModeSection
                provider={provider}
                apiKey={apiKey || ''}
                hasKey={hasKey}
                onResult={(parsed) => {
                  // 폼에 채움 (담당자 제외)
                  setForm((prev) => ({
                    ...prev,
                    title: parsed.title || prev.title,
                    reportDate: parsed.report_date || prev.reportDate,
                    article: {
                      mediaName: parsed.article?.media_name || prev.article.mediaName,
                      articleDate: parsed.article?.article_date || prev.article.articleDate,
                      articleTitle: parsed.article?.article_title || prev.article.articleTitle,
                      keyPoints: Array.isArray(parsed.article?.key_points)
                        ? parsed.article.key_points.join('\n')
                        : prev.article.keyPoints,
                    },
                    positionParagraphs: Array.isArray(parsed.position_paragraphs)
                      ? parsed.position_paragraphs.join('\n')
                      : prev.positionParagraphs,
                  }))
                  setMode('manual')
                }}
              />
            )}

            {mode === 'manual' && (
              <ManualForm form={form} setForm={setForm} provider={provider} apiKey={apiKey || ''} hasKey={hasKey} />
            )}

            <div className="flex justify-end">
              <button
                onClick={() => setStep('preview')}
                disabled={!form.title.trim() || !form.positionParagraphs.trim()}
                className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg disabled:bg-slate-300 disabled:cursor-not-allowed text-sm font-medium"
              >
                미리보기 →
              </button>
            </div>
          </>
        )}

        {step === 'preview' && (
          <PreviewSection form={form} onBack={() => setStep('edit')} />
        )}
      </main>
    </div>
  )
}

/* ─── 수동 작성 폼 ─── */

function ManualForm({
  form, setForm, provider, apiKey, hasKey,
}: {
  form: ExplainForm
  setForm: React.Dispatch<React.SetStateAction<ExplainForm>>
  provider: string
  apiKey: string
  hasKey: boolean
}) {
  const [formatLoading, setFormatLoading] = useState(false)
  const [formatError, setFormatError] = useState<string | null>(null)
  const [formatMsg, setFormatMsg] = useState<string | null>(null)

  const handleFormatPosition = async () => {
    if (!apiKey) {
      setFormatError(`${provider} API 키가 필요합니다.`)
      return
    }
    if (!form.positionParagraphs.trim()) {
      setFormatError('부처 입장 메모를 먼저 입력해주세요.')
      return
    }
    setFormatLoading(true)
    setFormatError(null)
    setFormatMsg(null)
    try {
      const headerKey =
        provider === 'anthropic' ? 'X-Anthropic-Key'
        : provider === 'gemini' ? 'X-Gemini-Key'
        : 'X-OpenAI-Key'

      const res = await fetch('/api/explain/format-position', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-LLM-Provider': provider,
          [headerKey]: apiKey,
        },
        body: JSON.stringify({
          position_memo: form.positionParagraphs,
          suggest_title: !form.title.trim(),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || '양식 정리 실패')
      }
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      setForm((prev) => ({
        ...prev,
        positionParagraphs: Array.isArray(data.paragraphs)
          ? data.paragraphs.join('\n')
          : prev.positionParagraphs,
        title: !prev.title.trim() && data.suggested_title ? data.suggested_title : prev.title,
      }))
      setFormatMsg('✓ 양식 정리 완료. 결과를 검토해주세요.')
      setTimeout(() => setFormatMsg(null), 4000)
    } catch (e) {
      setFormatError(e instanceof Error ? e.message : String(e))
    } finally {
      setFormatLoading(false)
    }
  }

  const updateArticle = (field: keyof ArticleInfo, value: string) => {
    setForm((p) => ({ ...p, article: { ...p.article, [field]: value } }))
  }

  const addContact = () => {
    setForm((p) => ({ ...p, contacts: [...p.contacts, { ...EMPTY_CONTACT }] }))
  }

  const removeContact = (i: number) => {
    setForm((p) => ({ ...p, contacts: p.contacts.filter((_, idx) => idx !== i) }))
  }

  const updateContact = (i: number, field: keyof Contact, value: string) => {
    setForm((p) => ({
      ...p,
      contacts: p.contacts.map((c, idx) => (idx === i ? { ...c, [field]: value } : c)),
    }))
  }

  return (
    <>
      {/* ① 기본 정보 */}
      <Section title="① 기본 정보">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="제목 *" hint='부처가 전달하고 싶은 메시지 한 줄 (예: "○○부는 ... 노력하겠습니다")' span={2}>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="예: 정부는 ... 최선을 다하겠습니다"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500"
            />
          </Field>
          <Field label="보도시점">
            <input
              type="text"
              value={form.reportDate}
              onChange={(e) => setForm({ ...form, reportDate: e.target.value })}
              placeholder="YYYY.M.D.(요일) 즉시보도"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500"
            />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="부처명" hint='담당 부처 (예: "행정안전부", "기획재정부")'>
            <input
              type="text"
              value={form.ministryName}
              onChange={(e) => setForm({ ...form, ministryName: e.target.value })}
              placeholder="행정안전부"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500"
            />
          </Field>
        </div>
      </Section>

      {/* ② 주요 보도내용 */}
      <Section title="② 주요 보도내용">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <Field label="매체명 *">
            <input
              type="text"
              value={form.article.mediaName}
              onChange={(e) => updateArticle('mediaName', e.target.value)}
              placeholder="예: ○○일보"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500"
            />
          </Field>
          <Field label="보도일자 *">
            <input
              type="text"
              value={form.article.articleDate}
              onChange={(e) => updateArticle('articleDate', e.target.value)}
              placeholder="2026.5.20."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500"
            />
          </Field>
          <Field label="기사 제목 *">
            <input
              type="text"
              value={form.article.articleTitle}
              onChange={(e) => updateArticle('articleTitle', e.target.value)}
              placeholder="기사 제하"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500"
            />
          </Field>
        </div>
        <Field label="기사 핵심 내용 *" hint='한 줄에 한 쟁점. 미리보기에서 "  - " 마커로 출력'>
          <textarea
            value={form.article.keyPoints}
            onChange={(e) => updateArticle('keyPoints', e.target.value)}
            placeholder="기사가 주장하는 핵심 내용 한 줄&#10;두 번째 쟁점 한 줄"
            rows={3}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500"
          />
        </Field>
      </Section>

      {/* ③ 부처 입장 */}
      <Section title={`③ 동 보도내용에 대한 ${form.ministryName || '○○부'}의 입장`}>
        <Field label="반박 단락 *" hint='한 줄에 한 단락. 종결어미 경어체(~입니다 / ~하겠습니다). 미리보기에서 " ○ " 마커'>
          <textarea
            value={form.positionParagraphs}
            onChange={(e) => setForm({ ...form, positionParagraphs: e.target.value })}
            placeholder="○○부는 ... 실시하고 있습니다.&#10;관계기관과 협력하여 ... 추진하겠습니다."
            rows={6}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500"
          />
        </Field>
        <div className="mt-2">
          <button
            onClick={handleFormatPosition}
            disabled={!hasKey || formatLoading || !form.positionParagraphs.trim()}
            className="flex items-center gap-1.5 px-3 py-2 text-xs bg-blue-50 hover:bg-blue-100 text-blue-900 rounded-lg disabled:opacity-50 font-medium border border-blue-100"
          >
            {formatLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            {formatLoading ? 'AI 정리 중...' : '✨ AI로 양식 정리 (메모 → ○ 단락)'}
          </button>
          {formatMsg && <p className="mt-1.5 text-[11px] text-green-700">{formatMsg}</p>}
          {formatError && <p className="mt-1.5 text-[11px] text-red-700">{formatError}</p>}
        </div>
      </Section>

      {/* ④ 담당자 (다중) */}
      <Section title="④ 담당자">
        <p className="text-[11px] text-slate-500 mb-3">
          🔒 담당자 정보는 사용자가 입력한 값만 출력됩니다. AI가 만들지 않습니다.
        </p>
        {form.contacts.map((c, i) => (
          <div key={i} className="bg-slate-50 rounded-lg p-3 mb-2 border border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-slate-600">담당자 {i + 1}</p>
              {form.contacts.length > 1 && (
                <button onClick={() => removeContact(i)} className="text-slate-400 hover:text-red-600">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <SmallField label="구분 (선택)">
                <input
                  type="text"
                  value={c.division}
                  onChange={(e) => updateContact(i, 'division', e.target.value)}
                  placeholder="(중앙정부)"
                  className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-amber-500"
                />
              </SmallField>
              <SmallField label="실/국 / 과">
                <input
                  type="text"
                  value={c.departmentRole}
                  onChange={(e) => updateContact(i, 'departmentRole', e.target.value)}
                  placeholder="○○실 / ○○과"
                  className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-amber-500"
                />
              </SmallField>
              <SmallField label="책임자 직급">
                <input
                  type="text"
                  value={c.managerRole}
                  onChange={(e) => updateContact(i, 'managerRole', e.target.value)}
                  placeholder="과장"
                  className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-amber-500"
                />
              </SmallField>
              <SmallField label="책임자 이름">
                <input
                  type="text"
                  value={c.managerName}
                  onChange={(e) => updateContact(i, 'managerName', e.target.value)}
                  placeholder="홍길동"
                  className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-amber-500"
                />
              </SmallField>
              <SmallField label="책임자 연락처">
                <input
                  type="text"
                  value={c.managerPhone}
                  onChange={(e) => updateContact(i, 'managerPhone', e.target.value)}
                  placeholder="044-XXX-XXXX"
                  className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-amber-500"
                />
              </SmallField>
              <SmallField label="담당자 직급">
                <input
                  type="text"
                  value={c.staffRole}
                  onChange={(e) => updateContact(i, 'staffRole', e.target.value)}
                  placeholder="사무관"
                  className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-amber-500"
                />
              </SmallField>
              <SmallField label="담당자 이름">
                <input
                  type="text"
                  value={c.staffName}
                  onChange={(e) => updateContact(i, 'staffName', e.target.value)}
                  placeholder="홍길동"
                  className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-amber-500"
                />
              </SmallField>
              <SmallField label="담당자 연락처">
                <input
                  type="text"
                  value={c.staffPhone}
                  onChange={(e) => updateContact(i, 'staffPhone', e.target.value)}
                  placeholder="044-XXX-XXXX"
                  className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-amber-500"
                />
              </SmallField>
            </div>
          </div>
        ))}
        <button
          onClick={addContact}
          className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-200 font-medium"
        >
          <Plus className="w-3.5 h-3.5" /> 담당자 추가
        </button>
      </Section>
    </>
  )
}

/* ─── AI 자동 작성 섹션 ─── */

function AutoModeSection({
  provider, apiKey, hasKey, onResult,
}: {
  provider: string
  apiKey: string
  hasKey: boolean
  onResult: (parsed: any) => void
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
      setError(`${provider} API 키가 필요합니다. 우측 상단 ⚙️에서 등록해주세요.`)
      return
    }
    if (!positionMemo.trim()) {
      setError('부처 입장 요지를 입력해주세요.')
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
      fd.append('position_memo', positionMemo.trim())
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
          ? `✓ 자동 작성 완료 (신뢰도 ${conf}%). 수동 모드로 전환됨. 폼 검토·수정 + 담당자 입력 후 미리보기.`
          : '✓ 자동 작성 완료. 폼 검토·수정 + 담당자 입력 후 미리보기.'
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
      <p className="text-xs text-slate-600 mb-4 leading-relaxed">
        기사 첨부 → AI가 "주요 보도내용" 요약. 부처 입장 메모 → AI가 표준 양식으로 정리.
        <strong className="text-blue-900"> 담당자 영역은 별도 입력</strong>합니다 (AI 거치지 않음).
      </p>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            ① 기사 원문 (선택)
          </label>
          <p className="text-[10px] text-slate-500 mb-1.5">PDF/HWPX/DOCX/TXT 또는 텍스트 직접 입력. AI가 매체·일시·제목·핵심 쟁점 자동 추출.</p>
          <div
            onClick={() => hasKey && fileRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-all ${
              hasKey ? 'border-blue-300 bg-white hover:border-blue-500' : 'border-slate-200 opacity-60'
            }`}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.hwp,.hwpx,.doc,.docx,.txt"
              hidden
              onChange={(e) => setArticleFile(e.target.files?.[0] || null)}
            />
            <Upload className="w-4 h-4 mx-auto mb-1 text-blue-500" />
            <p className="text-xs font-medium text-slate-700">
              {articleFile ? articleFile.name : '파일 업로드'}
            </p>
          </div>
          <textarea
            value={articleText}
            onChange={(e) => setArticleText(e.target.value)}
            placeholder="또는 기사 텍스트 직접 입력 (매체·일시·제목·내용 포함)"
            rows={2}
            className="w-full mt-2 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            ② 부처 입장 요지 <span className="text-red-500">*</span>
          </label>
          <p className="text-[10px] text-blue-700 mb-1.5">
            ⚠ AI는 사실관계를 만들지 않습니다. 직접 입력한 메모를 양식대로 정리만 합니다.
          </p>
          <textarea
            value={positionMemo}
            onChange={(e) => setPositionMemo(e.target.value)}
            placeholder="무엇이 사실과 다른지·부처 공식 입장·근거 자료·통계를 짧게 메모"
            rows={5}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">제목 (선택)</label>
            <p className="text-[10px] text-slate-500 mb-1.5">비우면 AI가 부처 입장에서 도출</p>
            <input
              type="text"
              value={titleHint}
              onChange={(e) => setTitleHint(e.target.value)}
              placeholder="자동 생성"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">보도시점 (선택)</label>
            <p className="text-[10px] text-slate-500 mb-1.5">예: 2026.5.20.(수) 즉시보도</p>
            <input
              type="text"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
              placeholder="YYYY.M.D.(요일) 즉시보도"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {info && (
          <div className="p-2.5 bg-green-50 border border-green-100 rounded-lg text-xs text-green-800">{info}</div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!hasKey || !positionMemo.trim() || loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:bg-slate-300 disabled:cursor-not-allowed font-medium text-sm"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {loading ? 'AI가 작성 중... (15-30초)' : '✨ AI로 설명자료 자동 작성'}
        </button>
      </div>
    </section>
  )
}

/* ─── 미리보기 + 다운로드 ─── */

function PreviewSection({ form, onBack }: { form: ExplainForm; onBack: () => void }) {
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState<'md' | 'hwpx' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 폼 → API 페이로드
  const buildPayload = () => ({
    title: form.title,
    report_date: form.reportDate,
    ministry_name: form.ministryName,
    article: {
      media_name: form.article.mediaName,
      article_date: form.article.articleDate,
      article_title: form.article.articleTitle,
      key_points: form.article.keyPoints.split('\n').map((s) => s.trim()).filter(Boolean),
    },
    position_paragraphs: form.positionParagraphs.split('\n').map((s) => s.trim()).filter(Boolean),
    contacts: form.contacts
      .filter((c) => c.departmentRole.trim() || c.managerName.trim() || c.staffName.trim())
      .map((c) => ({
        division: c.division,
        department_role: c.departmentRole,
        manager_role: c.managerRole,
        manager_name: c.managerName,
        manager_phone: c.managerPhone,
        staff_role: c.staffRole,
        staff_name: c.staffName,
        staff_phone: c.staffPhone,
      })),
  })

  const handleCopy = async () => {
    // 미리보기 텍스트 그대로 복사 (MD 형식)
    const payload = buildPayload()
    try {
      const res = await fetch('/api/download/explain/md', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('복사 실패')
      const text = await res.text()
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleDownload = async (format: 'md' | 'hwpx') => {
    setError(null)
    setDownloading(format)
    try {
      const res = await fetch(`/api/download/explain/${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
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

  const keyPoints = form.article.keyPoints.split('\n').map((s) => s.trim()).filter(Boolean)
  const positionParas = form.positionParagraphs.split('\n').map((s) => s.trim()).filter(Boolean)
  const contacts = form.contacts.filter(
    (c) => c.departmentRole.trim() || c.managerName.trim() || c.staffName.trim()
  )

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8">
        {/* 헤더 */}
        <div className="pb-4 mb-4 border-b-2 border-slate-300 text-center">
          <p className="text-sm font-bold text-slate-900 mb-1 tracking-widest">[ 보 도 설 명 자 료 ]</p>
          {form.reportDate && <p className="text-xs text-slate-600">{form.reportDate}</p>}
        </div>

        {/* 제목 */}
        <h1 className="text-lg sm:text-xl font-bold text-slate-900 mb-6 text-center px-2">
          {form.title || '(제목 없음)'}
        </h1>

        {/* 1. 주요 보도내용 */}
        <div className="mb-5">
          <p className="text-sm font-semibold text-slate-900 mb-2">1. 주요 보도내용</p>
          <p className="text-sm text-slate-800 leading-relaxed mb-2">
            {' ○ '}
            {form.article.articleDate} {form.article.mediaName}
            {form.article.articleTitle && (
              <> {'<'}{form.article.articleTitle}{'>'} 제하의 보도임</>
            )}
          </p>
          {keyPoints.map((kp, i) => (
            <p key={i} className="text-sm text-slate-800 leading-relaxed pl-6">
              {'   - '}{kp}
            </p>
          ))}
        </div>

        {/* 2. 부처 입장 */}
        <div className="mb-5">
          <p className="text-sm font-semibold text-slate-900 mb-2">
            2. 동 보도내용에 대한 {form.ministryName || '○○부'}의 입장
          </p>
          {positionParas.map((p, i) => (
            <p key={i} className="text-sm text-slate-800 leading-relaxed mb-2">
              {' ○ '}{p}
            </p>
          ))}
        </div>

        {/* 담당자 */}
        {contacts.length > 0 && (
          <div className="mt-6 pt-4 border-t-2 border-slate-300">
            {contacts.map((c, i) => (
              <div key={i} className="text-xs text-slate-700 mb-3">
                <p className="font-medium">
                  {[c.division, c.departmentRole].filter(Boolean).join(' / ')}
                </p>
                {(c.managerName || c.managerRole) && (
                  <p className="pl-4">
                    · 책임자: {c.managerRole} {c.managerName}
                    {c.managerPhone && ` (${c.managerPhone})`}
                  </p>
                )}
                {(c.staffName || c.staffRole) && (
                  <p className="pl-4">
                    · 담당자: {c.staffRole} {c.staffName}
                    {c.staffPhone && ` (${c.staffPhone})`}
                  </p>
                )}
              </div>
            ))}
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
        <button
          onClick={onBack}
          className="px-4 py-2.5 text-sm text-slate-600 hover:text-slate-900"
        >
          ← 편집으로
        </button>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <button
            onClick={handleCopy}
            className="flex-1 sm:flex-none px-3 sm:px-4 py-2.5 text-sm border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 font-medium"
          >
            {copied ? '✓ 복사됨' : '전체 복사'}
          </button>
          <button
            onClick={() => handleDownload('md')}
            disabled={downloading !== null}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2.5 text-sm border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50 font-medium"
          >
            {downloading === 'md' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            MD
          </button>
          <button
            onClick={() => handleDownload('hwpx')}
            disabled={downloading !== null}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 sm:px-5 py-2.5 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded-lg disabled:opacity-50 font-medium"
          >
            {downloading === 'hwpx' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            HWPX
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── 보조 컴포넌트 ─── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{title}</h3>
      {children}
    </section>
  )
}

function Field({
  label, hint, children, span,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  span?: number
}) {
  return (
    <div className={span === 2 ? 'md:col-span-2' : ''}>
      <p className="text-xs font-medium text-slate-700 mb-1">{label}</p>
      {hint && <p className="text-[10px] text-slate-500 mb-1.5">{hint}</p>}
      {children}
    </div>
  )
}

function SmallField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] text-slate-600 mb-1">{label}</p>
      {children}
    </div>
  )
}
