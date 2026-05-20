import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, FileText, Upload, Sparkles, Loader2, AlertCircle, X, Settings,
  Wand2, RefreshCw,
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

  // Phase 5.2 — 자동 추출 상태
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [extractMsg, setExtractMsg] = useState<string | null>(null)

  // Phase 5.2 — 저장된 페르소나 목록
  const [savedPersonas, setSavedPersonas] = useState<Array<{
    id: string
    name: string
    role: string | null
    organization: string | null
    tone: string | null
    background: string | null
  }>>([])

  const provider = getActiveProvider()
  const apiKey = getStoredKey(provider)
  const hasKey = !!apiKey

  // 페르소나 목록 로드 (한 번만)
  useEffect(() => {
    fetch('/api/personas')
      .then((r) => (r.ok ? r.json() : { personas: [] }))
      .then((data) => setSavedPersonas(data.personas || []))
      .catch(() => { /* ignore */ })
  }, [])

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

  // Phase 5.2 — 행사 계획서 자동 추출
  const handleExtractEventInfo = async () => {
    if (!planFile || !apiKey) return
    setExtracting(true)
    setExtractError(null)
    setExtractMsg(null)
    try {
      const headerKey =
        provider === 'anthropic' ? 'X-Anthropic-Key'
        : provider === 'gemini' ? 'X-Gemini-Key'
        : 'X-OpenAI-Key'

      const fd = new FormData()
      fd.append('file', planFile.file, planFile.name)

      const res = await fetch('/api/refine/extract-event-info', {
        method: 'POST',
        headers: { 'X-LLM-Provider': provider, [headerKey]: apiKey },
        body: fd,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || '추출 실패')
      }
      const data = await res.json()
      if (data.error) {
        throw new Error(data.error)
      }

      // 폼에 적용 (값이 있을 때만 덮어쓰기)
      setForm((prev) => {
        const next = { ...prev }
        if (data.event_name) next.eventName = data.event_name
        if (data.event_date) next.eventDate = data.event_date
        if (data.event_location) next.eventLocation = data.event_location
        if (data.event_type && ['chuksa','gyenyeomsa','sinnyeonsa','gyeoryeosa','hwanyeongsa','gaehoesa','iimsa','seomyeonchuksa'].includes(data.event_type)) {
          next.eventType = data.event_type
        }
        if (data.speaker_role && ['minister','vice_minister','director_general','director','head_of_org'].includes(data.speaker_role)) {
          next.speakerRole = data.speaker_role
        }
        if (data.speaker_organization) next.speakerOrganization = data.speaker_organization
        if (Array.isArray(data.audience) && data.audience.length > 0) {
          const valid = data.audience.filter((a: string) =>
            ['public_servant','citizen','expert','student','honoree','foreign_guest','industry','media','internal_staff','local_resident'].includes(a)
          )
          if (valid.length > 0) next.audience = valid
        }
        if (Array.isArray(data.attendees) && data.attendees.length > 0) {
          next.attendees = data.attendees.join('\n')
        }
        if (Array.isArray(data.key_messages) && data.key_messages.length > 0) {
          next.keyMessages = data.key_messages.join('\n')
        }
        return next
      })

      const conf = typeof data.confidence === 'number' ? Math.round(data.confidence * 100) : null
      setExtractMsg(
        conf !== null
          ? `자동 채움 완료 (신뢰도 ${conf}%). 결과를 검토 후 수정해주세요.`
          : '자동 채움 완료. 결과를 검토 후 수정해주세요.'
      )
      setTimeout(() => setExtractMsg(null), 6000)
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : String(e))
    } finally {
      setExtracting(false)
    }
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
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-4 h-4" /> 홈
          </Link>
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-blue-50 rounded-lg">
              <FileText className="w-4 h-4 text-blue-600" />
            </div>
            <h1 className="text-sm sm:text-base font-semibold text-slate-900 truncate">말씀자료 작성</h1>
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

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
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
            <>
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
              <button
                onClick={handleExtractEventInfo}
                disabled={!hasKey || extracting}
                className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs bg-blue-50 hover:bg-blue-100 text-blue-900 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed font-medium border border-blue-100"
              >
                {extracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                {extracting ? '추출 중... (10-20초)' : 'AI로 폼 자동 채우기'}
              </button>
              {extractMsg && (
                <p className="mt-1.5 text-[11px] text-green-700">{extractMsg}</p>
              )}
              {extractError && (
                <p className="mt-1.5 text-[11px] text-red-700">{extractError}</p>
              )}
            </>
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
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
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
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
            {savedPersonas.length > 0 && (
              <div className="mb-2 flex items-center gap-2">
                <select
                  onChange={(e) => {
                    const id = e.target.value
                    if (!id) return
                    const p = savedPersonas.find((x) => x.id === id)
                    if (!p) return
                    const lines: string[] = []
                    if (p.role) lines.push(`직책: ${p.role}`)
                    if (p.organization) lines.push(`소속: ${p.organization}`)
                    if (p.tone) lines.push(`말투: ${p.tone}`)
                    if (p.background) lines.push(p.background)
                    update('personaBlock', lines.join('\n'))
                    // 발화자 정보도 같이 채움 (비어있을 때만)
                    setForm((prev) => ({
                      ...prev,
                      speakerName: prev.speakerName || p.name,
                      speakerOrganization: prev.speakerOrganization || p.organization || '',
                    }))
                    e.target.value = ''
                  }}
                  className="flex-1 px-3 py-1.5 text-xs border border-purple-200 bg-purple-50 text-purple-900 rounded-lg focus:outline-none focus:border-purple-400"
                >
                  <option value="">저장된 페르소나에서 불러오기...</option>
                  {savedPersonas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.role ? ` · ${p.role}` : ''}{p.organization ? ` (${p.organization})` : ''}
                    </option>
                  ))}
                </select>
                <Link
                  to="/personas"
                  className="text-[10px] text-slate-500 hover:text-slate-900 underline whitespace-nowrap"
                >
                  관리
                </Link>
              </div>
            )}
            <textarea
              value={form.personaBlock}
              onChange={(e) => update('personaBlock', e.target.value)}
              placeholder={'예: 자주 쓰는 표현 "함께 만들어가는", 친근하고 부드러운 톤, 시민과 동등한 시선...'}
              rows={3}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
            {savedPersonas.length === 0 && (
              <p className="text-[10px] text-slate-400 mt-1">
                <Link to="/personas" className="underline hover:text-slate-600">페르소나 관리</Link>에서 자주 쓰는 발화자를 등록하면 여기서 빠르게 불러올 수 있습니다.
              </p>
            )}
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
          <SpeechResultPanel
            initialText={result.generated_text}
            eventName={form.eventName}
            provider={provider}
            apiKey={apiKey || ''}
          />
        )}
      </main>
    </div>
  )
}

/**
 * Phase 5.2 — 결과 패널 (편집·단락 재생성·톤 조정·다운로드).
 */
function SpeechResultPanel({
  initialText, eventName, provider, apiKey,
}: {
  initialText: string
  eventName: string
  provider: string
  apiKey: string
}) {
  const [text, setText] = useState(initialText)
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState<'md' | 'hwpx' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 단락 재생성 상태
  const [regenIndex, setRegenIndex] = useState<number | null>(null)
  const [regenInstruction, setRegenInstruction] = useState('')
  const [regenLoading, setRegenLoading] = useState(false)

  // 톤 조정 상태
  const [showToneMenu, setShowToneMenu] = useState(false)
  const [toneLoading, setToneLoading] = useState<string | null>(null)

  const headerKey =
    provider === 'anthropic' ? 'X-Anthropic-Key'
    : provider === 'gemini' ? 'X-Gemini-Key'
    : 'X-OpenAI-Key'

  // 단락 분할 (빈 줄 기준)
  const paragraphs = text.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean)

  const handleCopy = async () => {
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
      const res = await fetch(`/api/download/speech/${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generated_text: text, title: eventName }),
      })
      if (!res.ok) throw new Error(await res.text() || `${format} 변환 실패`)
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

  // 단락 재생성
  const handleRegenerateParagraph = async (index: number) => {
    if (!apiKey) {
      setError('API 키가 필요합니다')
      return
    }
    setRegenLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/refine/regenerate-paragraph', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-LLM-Provider': provider,
          [headerKey]: apiKey,
        },
        body: JSON.stringify({
          full_text: text,
          target_paragraph: paragraphs[index],
          instruction: regenInstruction,
          doc_type: 'speech',
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || '재생성 실패')
      }
      const data = await res.json()
      const newParagraph = data.new_paragraph || ''
      if (!newParagraph) throw new Error('빈 응답')

      // 해당 단락만 교체
      const newParagraphs = [...paragraphs]
      newParagraphs[index] = newParagraph
      setText(newParagraphs.join('\n\n'))
      setRegenIndex(null)
      setRegenInstruction('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRegenLoading(false)
    }
  }

  // 톤 조정
  const handleAdjustTone = async (targetTone: string) => {
    if (!apiKey) {
      setError('API 키가 필요합니다')
      return
    }
    setToneLoading(targetTone)
    setError(null)
    setShowToneMenu(false)
    try {
      const res = await fetch('/api/refine/adjust-tone', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-LLM-Provider': provider,
          [headerKey]: apiKey,
        },
        body: JSON.stringify({
          full_text: text,
          target_tone: targetTone,
          doc_type: 'speech',
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || '톤 조정 실패')
      }
      const data = await res.json()
      if (data.adjusted_text) {
        setText(data.adjusted_text)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setToneLoading(null)
    }
  }

  return (
    <div id="result-section" className="pt-8 space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-8">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">생성 결과</h2>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>{text.length.toLocaleString()}자</span>
            <button
              onClick={() => setEditing(!editing)}
              className={`px-2 py-1 rounded ${editing ? 'bg-blue-600 text-white' : 'border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
            >
              {editing ? '편집 종료' : '직접 편집'}
            </button>
          </div>
        </div>

        {editing ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full text-sm leading-relaxed font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 rounded p-2"
            style={{ minHeight: '500px', fontFamily: 'Pretendard, system-ui, sans-serif' }}
          />
        ) : (
          <div className="space-y-2">
            {paragraphs.map((p, i) => (
              <div key={i} className="group relative">
                <p
                  className="text-sm leading-relaxed text-slate-800 py-1"
                  style={{ fontFamily: 'Pretendard, system-ui, sans-serif' }}
                >
                  {p}
                </p>
                <button
                  onClick={() => { setRegenIndex(i); setRegenInstruction('') }}
                  disabled={!apiKey}
                  title="이 단락만 다시 생성"
                  className="absolute -right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-white border border-slate-200 rounded text-slate-500 hover:text-blue-600 hover:border-blue-300 disabled:hidden"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 단락 재생성 모달 */}
      {regenIndex !== null && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => !regenLoading && setRegenIndex(null)}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl max-w-2xl w-full p-5 sm:p-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-900 mb-3">
              단락 재생성 ({regenIndex + 1}/{paragraphs.length})
            </h3>
            <div className="p-3 bg-slate-50 rounded-lg text-xs text-slate-700 mb-3 max-h-32 overflow-y-auto">
              {paragraphs[regenIndex]}
            </div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              추가 지시 (선택)
            </label>
            <textarea
              value={regenInstruction}
              onChange={(e) => setRegenInstruction(e.target.value)}
              placeholder="예: 더 간결하게, 수치 강조, 첫 문장을 질문형으로"
              rows={2}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRegenIndex(null)}
                disabled={regenLoading}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
              >
                취소
              </button>
              <button
                onClick={() => handleRegenerateParagraph(regenIndex)}
                disabled={regenLoading}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {regenLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {regenLoading ? '재생성 중...' : '재생성'}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* 액션 버튼 */}
      <div className="flex flex-wrap justify-between gap-2">
        {/* 톤 조정 */}
        <div className="relative">
          <button
            onClick={() => setShowToneMenu(!showToneMenu)}
            disabled={!apiKey || toneLoading !== null}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-200 text-slate-700 rounded-lg hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 font-medium"
          >
            {toneLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            {toneLoading ? '톤 조정 중...' : '톤 조정'}
          </button>
          {showToneMenu && (
            <div className="absolute left-0 bottom-full mb-1 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden z-10 min-w-[180px]">
              {[
                { key: 'more_formal', label: '더 격식 있게' },
                { key: 'less_formal', label: '더 친근하게' },
                { key: 'more_concise', label: '더 간결하게' },
                { key: 'more_detailed', label: '더 자세하게' },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => handleAdjustTone(t.key)}
                  className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
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

      <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-900">
        💡 각 단락에 마우스 올리면 <RefreshCw className="w-3 h-3 inline" /> 버튼이 나타납니다. 단락 단위로 재생성하거나, "톤 조정"으로 전체 분위기를 바꿀 수 있습니다.
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
