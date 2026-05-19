import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, FileText, Upload, Sparkles, Loader2, AlertCircle, X, Settings,
} from 'lucide-react'
import { getActiveProvider, getStoredKey } from '../hooks/useLLMSettings'
import ApiKeyBanner from '../components/ApiKeyBanner'
import {
  EVENT_TYPES, AUDIENCES, LENGTH_OPTIONS, SPEAKER_ROLES,
  SPEAKER_ROLE_LABEL,
  type EventTypeKey, type AudienceKey, type LengthOptionKey, type SpeakerRoleKey,
} from '../lib/speech-data'

const FILE_ICON: Record<string, string> = {
  pdf: '📄', hwp: '📝', hwpx: '📝', doc: '📃', docx: '📃',
  ppt: '📊', pptx: '📊', txt: '📋',
}
function fIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return FILE_ICON[ext] || '📎'
}
function fSize(b: number): string {
  if (b < 1024) return `${b}B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`
  return `${(b / 1048576).toFixed(1)}MB`
}

interface UploadFileItem {
  id: string
  name: string
  size: number
  file: File
}

interface SpeechFormData {
  // 행사 정보
  eventName: string
  eventDate: string
  eventLocation: string
  // 발화자
  speakerName: string
  speakerRole: SpeakerRoleKey
  speakerRoleCustom: string
  speakerOrganization: string
  // 행사 유형 · 청중
  eventType: EventTypeKey
  audience: AudienceKey[]
  // 분량
  lengthOption: LengthOptionKey
  customChars: number
  // 고급
  keyMessages: string  // 줄바꿈 구분
  citedStats: string
  avoidExpressions: string  // 줄바꿈 구분
  attendees: string  // 한 줄에 "이름 - 직책"
  // 페르소나 텍스트
  personaBlock: string
}

const INIT: SpeechFormData = {
  eventName: '',
  eventDate: '',
  eventLocation: '',
  speakerName: '',
  speakerRole: 'director_general',
  speakerRoleCustom: '',
  speakerOrganization: '',
  eventType: 'chuksa',
  audience: ['public_servant'],
  lengthOption: 'standard',
  customChars: 1500,
  keyMessages: '',
  citedStats: '',
  avoidExpressions: '',
  attendees: '',
  personaBlock: '',
}

interface ResultData {
  generated_text: string
  char_count: number
  draft_id: string | null
}

export default function SpeechWriter() {
  const [form, setForm] = useState<SpeechFormData>(INIT)
  const [planFile, setPlanFile] = useState<UploadFileItem | null>(null)
  const [refFiles, setRefFiles] = useState<UploadFileItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ResultData | null>(null)

  const planFileRef = useRef<HTMLInputElement>(null)
  const refFileRef = useRef<HTMLInputElement>(null)

  const provider = getActiveProvider()
  const apiKey = getStoredKey(provider)
  const hasKey = !!apiKey

  const update = <K extends keyof SpeechFormData>(key: K, value: SpeechFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handlePlanFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setPlanFile({
      id: Math.random().toString(36).slice(2),
      name: f.name,
      size: f.size,
      file: f,
    })
    if (planFileRef.current) planFileRef.current.value = ''
  }

  const handleRefFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || [])
    if (!selected.length) return
    setRefFiles((p) => [
      ...p,
      ...selected.map((f) => ({
        id: Math.random().toString(36).slice(2),
        name: f.name,
        size: f.size,
        file: f,
      })),
    ])
    if (refFileRef.current) refFileRef.current.value = ''
  }

  const toggleAudience = (key: AudienceKey) => {
    setForm((prev) => ({
      ...prev,
      audience: prev.audience.includes(key)
        ? prev.audience.filter((a) => a !== key)
        : [...prev.audience, key],
    }))
  }

  const handleGenerate = async () => {
    setError(null)
    setResult(null)

    if (!hasKey || !apiKey) {
      setError(`${provider} API 키가 설정되지 않았습니다. /settings에서 입력해주세요.`)
      return
    }
    if (!form.eventName.trim()) {
      setError('행사명을 입력해주세요.')
      return
    }
    if (form.audience.length === 0) {
      setError('청중을 1개 이상 선택해주세요.')
      return
    }
    if (form.speakerRole === 'custom' && !form.speakerRoleCustom.trim()) {
      setError('직급명을 입력해주세요.')
      return
    }

    setLoading(true)
    try {
      const headerKey =
        provider === 'anthropic' ? 'X-Anthropic-Key'
        : provider === 'gemini' ? 'X-Gemini-Key'
        : 'X-OpenAI-Key'

      // 분량 결정
      const targetChars = form.lengthOption === 'custom'
        ? Math.max(300, Math.min(5000, form.customChars))
        : (LENGTH_OPTIONS.find((o) => o.key === form.lengthOption)?.targetChars ?? 1500)

      // 발화자 직책
      const speakerRoleLabel = form.speakerRole === 'custom'
        ? form.speakerRoleCustom
        : SPEAKER_ROLE_LABEL[form.speakerRole]

      // SpeechInput 모델에 맞게 변환
      const speechInput = {
        event_name: form.eventName,
        event_type: EVENT_TYPES.find((t) => t.key === form.eventType)?.label || '축사',
        event_date: form.eventDate,
        event_location: form.eventLocation,
        speaker_name: form.speakerName,
        speaker_role: speakerRoleLabel,
        speaker_organization: form.speakerOrganization,
        audience: form.audience
          .map((a) => AUDIENCES.find((x) => x.key === a)?.label)
          .filter(Boolean)
          .join(', '),
        vip_list: form.attendees
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        target_chars: targetChars,
        key_messages: form.keyMessages
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        quotes_or_anecdotes: form.citedStats.trim()
          ? form.citedStats.split('\n').map((s) => s.trim()).filter(Boolean)
          : [],
        avoid_phrases: form.avoidExpressions
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        persona_block: form.personaBlock.trim(),
      }

      let result: ResultData

      if (planFile || refFiles.length > 0) {
        // 파일 업로드 multipart
        const fd = new FormData()
        fd.append('input_json', JSON.stringify(speechInput))
        fd.append('max_tokens', '4000')
        fd.append('temperature', '0.7')
        if (planFile) fd.append('plan_file', planFile.file, planFile.name)
        refFiles.forEach((f) => fd.append('reference_files', f.file, f.name))

        const res = await fetch('/api/speech/draft-with-docs', {
          method: 'POST',
          headers: { 'X-LLM-Provider': provider, [headerKey]: apiKey },
          body: fd,
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }))
          throw new Error(err.detail || '생성 실패')
        }
        result = await res.json()
      } else {
        // JSON 본문
        const res = await fetch('/api/speech/draft', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-LLM-Provider': provider,
            [headerKey]: apiKey,
          },
          body: JSON.stringify({
            input: speechInput,
            plan_text: '',
            reference_texts: [],
            max_tokens: 4000,
            temperature: 0.7,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }))
          throw new Error(err.detail || '생성 실패')
        }
        result = await res.json()
      }

      setResult(result)
      // 결과로 스크롤
      setTimeout(() => {
        document.getElementById('result-section')?.scrollIntoView({ behavior: 'smooth' })
      }, 100)
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
            <ArrowLeft className="w-4 h-4" /> 홈
          </Link>
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-blue-50 rounded-lg">
              <FileText className="w-4 h-4 text-blue-600" />
            </div>
            <h1 className="text-base font-semibold text-slate-900">말씀자료 작성</h1>
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

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-5">
        <ApiKeyBanner />

        {/* 행사 계획서 (단일) */}
        <Section title="📎 행사 계획서 (선택)" description="업로드 시 AI가 본문에 참고합니다">
          <div
            onClick={() => hasKey && planFileRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all ${
              hasKey ? 'border-slate-300 hover:border-blue-500 hover:bg-blue-50/30' : 'border-slate-200 opacity-60'
            }`}
          >
            <input
              ref={planFileRef}
              type="file"
              accept=".pdf,.hwp,.hwpx,.doc,.docx,.txt"
              hidden
              onChange={handlePlanFile}
            />
            <Upload className="w-5 h-5 mx-auto mb-1 text-slate-400" />
            <p className="text-xs font-medium text-slate-700">
              행사 계획서 (단일 파일)
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">PDF, HWPX, DOCX, TXT</p>
          </div>
          {planFile && (
            <div className="mt-2 flex items-center gap-2 px-2 py-1.5 bg-slate-50 rounded text-xs">
              <span className="text-base">{fIcon(planFile.name)}</span>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{planFile.name}</p>
                <p className="text-[10px] text-slate-400">{fSize(planFile.size)}</p>
              </div>
              <button
                onClick={() => setPlanFile(null)}
                className="p-1 text-slate-400 hover:text-red-600"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </Section>

        {/* 참고자료 (다중) */}
        <Section title="📚 참고자료 (다중, 선택)" description="정책자료·통계·이전 말씀자료 등">
          <div
            onClick={() => hasKey && refFileRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all ${
              hasKey ? 'border-slate-300 hover:border-blue-500 hover:bg-blue-50/30' : 'border-slate-200 opacity-60'
            }`}
          >
            <input
              ref={refFileRef}
              type="file"
              multiple
              accept=".pdf,.hwp,.hwpx,.doc,.docx,.txt"
              hidden
              onChange={handleRefFiles}
            />
            <Upload className="w-5 h-5 mx-auto mb-1 text-slate-400" />
            <p className="text-xs font-medium text-slate-700">참고자료 (여러 파일)</p>
            <p className="text-[10px] text-slate-400 mt-0.5">PDF, HWPX, DOCX, TXT</p>
          </div>
          {refFiles.length > 0 && (
            <div className="mt-2 space-y-1">
              {refFiles.map((f) => (
                <div key={f.id} className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 rounded text-xs">
                  <span className="text-base">{fIcon(f.name)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{f.name}</p>
                    <p className="text-[10px] text-slate-400">{fSize(f.size)}</p>
                  </div>
                  <button
                    onClick={() => setRefFiles((p) => p.filter((x) => x.id !== f.id))}
                    className="p-1 text-slate-400 hover:text-red-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        <div className="relative my-2">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-slate-50 px-3 text-xs uppercase tracking-wide text-slate-400">
              또는 직접 입력
            </span>
          </div>
        </div>

        {/* ① 행사 정보 */}
        <Section title="① 행사 정보">
          <Field label="행사명 *" required>
            <input
              type="text"
              value={form.eventName}
              onChange={(e) => update('eventName', e.target.value)}
              placeholder="예: 디지털플랫폼정부위원회 출범식"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="일시">
              <input
                type="text"
                value={form.eventDate}
                onChange={(e) => update('eventDate', e.target.value)}
                placeholder="예: 2026-06-15 14:00"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </Field>
            <Field label="장소">
              <input
                type="text"
                value={form.eventLocation}
                onChange={(e) => update('eventLocation', e.target.value)}
                placeholder="예: 정부서울청사"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </Field>
          </div>
        </Section>

        {/* ② 발화자 */}
        <Section title="② 발화자">
          <div className="grid grid-cols-2 gap-3">
            <Field label="이름">
              <input
                type="text"
                value={form.speakerName}
                onChange={(e) => update('speakerName', e.target.value)}
                placeholder="예: 홍길동"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </Field>
            <Field label="소속 기관">
              <input
                type="text"
                value={form.speakerOrganization}
                onChange={(e) => update('speakerOrganization', e.target.value)}
                placeholder="예: 행정안전부"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </Field>
          </div>
          <Field label="직급">
            <div className="grid grid-cols-3 gap-2">
              {SPEAKER_ROLES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => update('speakerRole', r.key)}
                  className={`px-3 py-2 text-sm rounded-lg border transition-all ${
                    form.speakerRole === r.key
                      ? 'border-blue-500 bg-blue-50 text-blue-900 font-medium'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {form.speakerRole === 'custom' && (
              <input
                type="text"
                value={form.speakerRoleCustom}
                onChange={(e) => update('speakerRoleCustom', e.target.value)}
                placeholder="직접 입력 (예: 위원장)"
                className="w-full mt-2 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
              />
            )}
          </Field>
        </Section>

        {/* ③ 행사 유형 · 청중 */}
        <Section title="③ 행사 유형 · 청중">
          <Field label="행사 유형">
            <div className="grid grid-cols-4 gap-2">
              {EVENT_TYPES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => update('eventType', t.key)}
                  title={t.description}
                  className={`px-2 py-2 text-sm rounded-lg border transition-all ${
                    form.eventType === t.key
                      ? 'border-blue-500 bg-blue-50 text-blue-900 font-medium'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="청중 (다중 선택)">
            <div className="flex flex-wrap gap-2">
              {AUDIENCES.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => toggleAudience(a.key)}
                  className={`px-3 py-1.5 text-xs rounded-full border transition-all ${
                    form.audience.includes(a.key)
                      ? 'border-blue-500 bg-blue-50 text-blue-900 font-medium'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </Field>
        </Section>

        {/* ④ 분량 */}
        <Section title="④ 분량">
          <div className="grid grid-cols-3 gap-2">
            {LENGTH_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => update('lengthOption', opt.key)}
                className={`px-3 py-2 text-left rounded-lg border transition-all ${
                  form.lengthOption === opt.key
                    ? 'border-blue-500 bg-blue-50 text-blue-900'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <p className="text-sm font-medium">{opt.label}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {opt.targetChars > 0 ? `${opt.targetChars.toLocaleString()}자 · ${opt.spokenMinutes}` : '300~5,000자'}
                </p>
              </button>
            ))}
          </div>
          {form.lengthOption === 'custom' && (
            <input
              type="number"
              value={form.customChars}
              onChange={(e) => update('customChars', Number(e.target.value) || 1500)}
              min="300"
              max="5000"
              step="100"
              className="w-full mt-2 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          )}
        </Section>

        {/* ⑤ 고급 (선택) */}
        <Section title="⑤ 고급 옵션 (선택)">
          <Field label="핵심 메시지 (한 줄에 하나씩, 최대 3개)">
            <textarea
              value={form.keyMessages}
              onChange={(e) => update('keyMessages', e.target.value)}
              placeholder={'반드시 본문에 반영될 메시지. 예:\n디지털플랫폼정부 추진 의지\n부처 간 협력 강화'}
              rows={3}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </Field>
          <Field label="인용할 통계·일화 (한 줄에 하나씩)">
            <textarea
              value={form.citedStats}
              onChange={(e) => update('citedStats', e.target.value)}
              placeholder={'예:\n2025년 디지털정부 평가 OECD 1위\n민원처리 시간 평균 40% 단축'}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </Field>
          <Field label="피할 표현 (한 줄에 하나씩, 최대 5개)">
            <textarea
              value={form.avoidExpressions}
              onChange={(e) => update('avoidExpressions', e.target.value)}
              placeholder={'예:\n바야흐로\n발 빠르게\n21세기를 맞이하여'}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </Field>
          <Field label="주요 참석자 (한 줄에 한 명, 직급 순)">
            <textarea
              value={form.attendees}
              onChange={(e) => update('attendees', e.target.value)}
              placeholder={'예:\n김OO 위원장\n이OO 의원\n박OO 시장'}
              rows={3}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </Field>
          <Field label="페르소나 (선택) - 발화자 특유의 말투·표현">
            <textarea
              value={form.personaBlock}
              onChange={(e) => update('personaBlock', e.target.value)}
              placeholder={'예: 자주 쓰는 표현 "함께 만들어가는", 친근하고 부드러운 톤, 시민과 동등한 시선...'}
              rows={3}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </Field>
        </Section>

        {error && (
          <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-xl">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={loading || !hasKey}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:bg-slate-300 disabled:cursor-not-allowed font-medium text-sm"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              AI 생성 중... (30-60초)
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              AI로 말씀자료 생성
            </>
          )}
        </button>

        {result && (
          <div id="result-section" className="pt-8 space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-8">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                <h2 className="text-base font-semibold text-slate-900">생성 결과</h2>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>{result.char_count.toLocaleString()}자</span>
                </div>
              </div>
              <pre
                className="text-sm leading-relaxed whitespace-pre-wrap break-words text-slate-800"
                style={{ fontFamily: 'Pretendard, system-ui, sans-serif' }}
              >
                {result.generated_text}
              </pre>
            </div>
            <SpeechResultActions
              generatedText={result.generated_text}
              eventName={form.eventName}
            />
            <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-900">
              HWPX는 한글에서 바로 열립니다. 입력 폼을 수정 후 재생성도 가능합니다.
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function SpeechResultActions({
  generatedText, eventName,
}: {
  generatedText: string
  eventName: string
}) {
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState<'md' | 'hwpx' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedText)
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
      const res = await fetch(`/api/download/speech/${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generated_text: generatedText,
          title: eventName,
        }),
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(err || `${format.toUpperCase()} 변환 실패`)
      }
      const cd = res.headers.get('content-disposition') || ''
      let fname = `말씀자료.${format}`
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
    <div className="space-y-2">
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          onClick={handleCopy}
          className="px-4 py-2 text-sm border border-slate-200 text-slate-700 rounded-lg hover:border-slate-300 hover:bg-slate-50 font-medium"
        >
          {copied ? '✓ 복사됨' : '전체 복사'}
        </button>
        <button
          onClick={() => handleDownload('md')}
          disabled={downloading !== null}
          className="flex items-center gap-1.5 px-4 py-2 text-sm border border-slate-200 text-slate-700 rounded-lg hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 font-medium"
        >
          {downloading === 'md' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          MD 다운로드
        </button>
        <button
          onClick={() => handleDownload('hwpx')}
          disabled={downloading !== null}
          className="flex items-center gap-1.5 px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 font-medium"
        >
          {downloading === 'hwpx' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          HWPX 다운로드
        </button>
      </div>
    </div>
  )
}

function Section({
  title, description, children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Field({
  label, required, children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  )
}
