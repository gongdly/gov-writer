import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, Users, Plus, Edit2, Trash2, Loader2, AlertCircle, CheckCircle2, X, Settings,
} from 'lucide-react'

interface Persona {
  id: string
  name: string
  role: string | null
  organization: string | null
  tone: string | null
  background: string | null
  usage_count: number
  created_at: string
  updated_at: string
}

interface PersonaFormValues {
  name: string
  role: string
  organization: string
  tone: string
  background: string
}

const INIT_FORM: PersonaFormValues = {
  name: '',
  role: '',
  organization: '',
  tone: '',
  background: '',
}

const TONE_PRESETS = [
  '격식 있고 권위적',
  '친근하고 부드러움',
  '통계·데이터 중심',
  '비전·미래 지향적',
  '균형 잡힌 혼합',
]

const ROLE_PRESETS = ['장관', '차관', '실장', '국장', '과장', '팀장', '기관장']

type Mode = 'list' | 'create' | 'edit'

export default function PersonasPage() {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>('list')
  const [editing, setEditing] = useState<Persona | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const loadPersonas = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/personas')
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setPersonas(data.personas || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPersonas()
  }, [])

  const flashSuccess = (msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(null), 3000)
  }

  const handleCreate = async (values: PersonaFormValues) => {
    try {
      const res = await fetch('/api/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (!res.ok) throw new Error(await res.text())
      flashSuccess(`"${values.name}" 페르소나가 생성되었습니다`)
      setMode('list')
      loadPersonas()
    } catch (e) {
      alert(`생성 실패: ${e instanceof Error ? e.message : e}`)
    }
  }

  const handleUpdate = async (values: PersonaFormValues) => {
    if (!editing) return
    try {
      const res = await fetch(`/api/personas/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (!res.ok) throw new Error(await res.text())
      flashSuccess(`"${values.name}" 페르소나가 수정되었습니다`)
      setMode('list')
      setEditing(null)
      loadPersonas()
    } catch (e) {
      alert(`수정 실패: ${e instanceof Error ? e.message : e}`)
    }
  }

  const handleDelete = async (p: Persona) => {
    if (!confirm(`"${p.name}" 페르소나를 삭제하시겠습니까?`)) return
    try {
      const res = await fetch(`/api/personas/${p.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      flashSuccess('삭제되었습니다')
      loadPersonas()
    } catch (e) {
      alert(`삭제 실패: ${e instanceof Error ? e.message : e}`)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-4 h-4" /> 홈
          </Link>
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-600" />
            <h1 className="text-base font-semibold text-slate-900">페르소나 관리</h1>
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

      <main className="max-w-3xl mx-auto px-6 py-6">
        {successMsg && (
          <div className="mb-4 flex items-center gap-2 p-3 bg-green-50 border border-green-100 rounded-xl">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <p className="text-sm text-green-800">{successMsg}</p>
          </div>
        )}

        {mode === 'list' && (
          <>
            <div className="mb-5 flex items-center justify-between">
              <p className="text-sm text-slate-500">
                자주 쓰는 발화자(장관·국장·과장 등)를 저장하여 작성 시 빠르게 적용합니다.
              </p>
              <button
                onClick={() => setMode('create')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
              >
                <Plus className="w-3.5 h-3.5" /> 새 페르소나
              </button>
            </div>

            {loading && (
              <div className="flex items-center justify-center py-16 text-slate-400">
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                불러오는 중...
              </div>
            )}

            {error && (
              <div className="mb-4 flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-xl">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {!loading && !error && personas.length === 0 && (
              <div className="text-center py-16">
                <Users className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p className="text-sm text-slate-500 mb-4">
                  아직 저장된 페르소나가 없습니다.
                </p>
                <button
                  onClick={() => setMode('create')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  <Plus className="w-3.5 h-3.5" /> 첫 페르소나 만들기
                </button>
              </div>
            )}

            {!loading && !error && personas.length > 0 && (
              <div className="space-y-2">
                {personas.map((p) => (
                  <div
                    key={p.id}
                    className="bg-white rounded-xl border border-slate-200 p-4 hover:border-slate-300 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-sm text-slate-900">
                            {p.name}
                          </h3>
                          {p.usage_count > 0 && (
                            <span className="text-xs text-slate-400">
                              사용 {p.usage_count}회
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 mb-2">
                          {p.role && <span>{p.role}</span>}
                          {p.organization && <span>· {p.organization}</span>}
                          {p.tone && <span>· {p.tone}</span>}
                        </div>
                        {p.background && (
                          <p className="text-xs text-slate-600 line-clamp-2 mt-1">
                            {p.background}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-shrink-0 gap-1">
                        <button
                          onClick={() => { setEditing(p); setMode('edit') }}
                          title="수정"
                          className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(p)}
                          title="삭제"
                          className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {(mode === 'create' || mode === 'edit') && (
          <PersonaForm
            initial={
              mode === 'edit' && editing
                ? {
                    name: editing.name,
                    role: editing.role || '',
                    organization: editing.organization || '',
                    tone: editing.tone || '',
                    background: editing.background || '',
                  }
                : INIT_FORM
            }
            isEdit={mode === 'edit'}
            onSubmit={mode === 'edit' ? handleUpdate : handleCreate}
            onCancel={() => { setMode('list'); setEditing(null) }}
          />
        )}
      </main>
    </div>
  )
}

function PersonaForm({
  initial, isEdit, onSubmit, onCancel,
}: {
  initial: PersonaFormValues
  isEdit: boolean
  onSubmit: (values: PersonaFormValues) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState<PersonaFormValues>(initial)
  const [submitting, setSubmitting] = useState(false)

  const update = <K extends keyof PersonaFormValues>(key: K, value: PersonaFormValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      alert('이름은 필수입니다.')
      return
    }
    setSubmitting(true)
    try {
      await onSubmit(form)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-semibold text-slate-900">
          {isEdit ? '페르소나 수정' : '새 페르소나'}
        </h2>
        <button
          onClick={onCancel}
          className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-4">
        <Field label="이름 *" required>
          <input
            type="text"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="예: 김OO 행정안전부 장관"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="직책">
            <input
              type="text"
              value={form.role}
              onChange={(e) => update('role', e.target.value)}
              placeholder="예: 장관"
              list="role-presets"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
            <datalist id="role-presets">
              {ROLE_PRESETS.map((r) => <option key={r} value={r} />)}
            </datalist>
          </Field>
          <Field label="기관">
            <input
              type="text"
              value={form.organization}
              onChange={(e) => update('organization', e.target.value)}
              placeholder="예: 행정안전부"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </Field>
        </div>

        <Field label="말투 스타일">
          <input
            type="text"
            value={form.tone}
            onChange={(e) => update('tone', e.target.value)}
            placeholder="예: 격식 있고 권위적"
            list="tone-presets"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
          />
          <datalist id="tone-presets">
            {TONE_PRESETS.map((t) => <option key={t} value={t} />)}
          </datalist>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {TONE_PRESETS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => update('tone', t)}
                className="text-[10px] px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded"
              >
                {t}
              </button>
            ))}
          </div>
        </Field>

        <Field label="발화자 특성 (말씀자료 작성 시 참고)">
          <textarea
            value={form.background}
            onChange={(e) => update('background', e.target.value)}
            placeholder={'자주 쓰는 표현, 강조하는 가치, 피하는 표현 등을 자유롭게 입력.\n\n예:\n자주 쓰는 표현: "함께 만들어가는", "국민의 시각으로"\n강조 가치: 디지털플랫폼정부, 부처 간 협력\n피하는 표현: 진부한 미사여구, 자화자찬'}
            rows={6}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            말씀자료 작성 시 ⑤ 고급 옵션의 "페르소나" 필드에 자동 적용됩니다 (다음 작성부터).
          </p>
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isEdit ? '수정' : '저장'}
          </button>
        </div>
      </div>
    </div>
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
      <label className="block text-xs font-medium text-slate-700 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  )
}
