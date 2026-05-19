import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, X, Loader2, Eye, EyeOff, Trash2, AlertCircle } from 'lucide-react'
import { useLLMSettings, maskKey, type LLMProvider } from '../hooks/useLLMSettings'

interface ProviderConfig {
  id: LLMProvider
  name: string
  prefix: string
  consoleUrl: string
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    prefix: 'sk-ant-',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    prefix: 'AIza',
    consoleUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    prefix: 'sk-',
    consoleUrl: 'https://platform.openai.com/api-keys',
  },
]

type ValidateState =
  | { status: 'idle' }
  | { status: 'validating' }
  | { status: 'valid' }
  | { status: 'invalid'; error: string }

export default function SettingsPage() {
  const { provider, keys, saveKey, changeProvider, validateKeyFormat, clearAll } =
    useLLMSettings()
  const [inputValues, setInputValues] = useState<Record<LLMProvider, string>>({
    anthropic: '',
    gemini: '',
    openai: '',
  })
  const [showKey, setShowKey] = useState<Record<LLMProvider, boolean>>({
    anthropic: false,
    gemini: false,
    openai: false,
  })
  const [validateStates, setValidateStates] = useState<Record<LLMProvider, ValidateState>>({
    anthropic: { status: 'idle' },
    gemini: { status: 'idle' },
    openai: { status: 'idle' },
  })

  const handleSave = (p: LLMProvider) => {
    const value = inputValues[p].trim()
    if (!value) return
    if (!validateKeyFormat(p, value)) {
      setValidateStates((prev) => ({
        ...prev,
        [p]: { status: 'invalid', error: `${p} 키 형식이 아닙니다` },
      }))
      return
    }
    saveKey(p, value)
    setInputValues((prev) => ({ ...prev, [p]: '' }))
    setValidateStates((prev) => ({ ...prev, [p]: { status: 'idle' } }))
  }

  const handleTest = async (p: LLMProvider) => {
    const key = keys[p]
    if (!key) return
    setValidateStates((prev) => ({ ...prev, [p]: { status: 'validating' } }))
    try {
      const resp = await fetch('/api/validate-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: p, api_key: key }),
      })
      const data = await resp.json()
      if (data.valid) {
        setValidateStates((prev) => ({ ...prev, [p]: { status: 'valid' } }))
      } else {
        setValidateStates((prev) => ({
          ...prev,
          [p]: { status: 'invalid', error: data.error ?? '검증 실패' },
        }))
      }
    } catch (e) {
      setValidateStates((prev) => ({
        ...prev,
        [p]: { status: 'invalid', error: e instanceof Error ? e.message : String(e) },
      }))
    }
  }

  const handleDelete = (p: LLMProvider) => {
    saveKey(p, '')
    setValidateStates((prev) => ({ ...prev, [p]: { status: 'idle' } }))
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-4 h-4" />
            허브로
          </Link>
          <h1 className="text-base font-semibold text-slate-900">설정</h1>
          <div className="w-12" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* 기본 모델 */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="text-base font-semibold text-slate-900 mb-1">기본 사용 모델</h2>
          <p className="text-xs text-slate-500 mb-4">
            작성 시 기본으로 호출할 LLM. 설정한 키가 있는 모델만 선택 가능.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {PROVIDERS.map((p) => {
              const hasKey = !!keys[p.id]
              const isActive = provider === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => hasKey && changeProvider(p.id)}
                  disabled={!hasKey}
                  className={`p-3 rounded-xl border text-sm transition-all ${
                    isActive
                      ? 'border-blue-500 bg-blue-50 text-blue-900 font-medium'
                      : hasKey
                      ? 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                      : 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  {p.name.split(' ')[0]}
                </button>
              )
            })}
          </div>
        </section>

        {/* 각 LLM 키 */}
        {PROVIDERS.map((p) => {
          const storedKey = keys[p.id]
          const inputValue = inputValues[p.id]
          const state = validateStates[p.id]
          const visible = showKey[p.id]

          return (
            <section key={p.id} className="bg-white rounded-2xl border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-semibold text-slate-900">{p.name}</h3>
                <a
                  href={p.consoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline"
                >
                  키 발급 →
                </a>
              </div>
              <p className="text-xs text-slate-500 mb-4">키는 브라우저에만 저장됩니다</p>

              {storedKey ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg">
                    <code className="flex-1 text-sm font-mono text-slate-700">
                      {visible ? storedKey : maskKey(storedKey)}
                    </code>
                    <button
                      onClick={() =>
                        setShowKey((prev) => ({ ...prev, [p.id]: !prev[p.id] }))
                      }
                      className="text-slate-400 hover:text-slate-600"
                      aria-label={visible ? '숨기기' : '보기'}
                    >
                      {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleTest(p.id)}
                      disabled={state.status === 'validating'}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50"
                    >
                      {state.status === 'validating' && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      )}
                      {state.status === 'valid' && <Check className="w-3.5 h-3.5" />}
                      {state.status === 'invalid' && <X className="w-3.5 h-3.5" />}
                      {state.status === 'idle' && '테스트'}
                      {state.status === 'validating' && '확인 중'}
                      {state.status === 'valid' && '유효함'}
                      {state.status === 'invalid' && '재테스트'}
                    </button>
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      삭제
                    </button>
                  </div>
                  {state.status === 'invalid' && (
                    <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg">
                      <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-red-700">{state.error}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="password"
                    placeholder={`${p.prefix}...`}
                    value={inputValue}
                    onChange={(e) =>
                      setInputValues((prev) => ({ ...prev, [p.id]: e.target.value }))
                    }
                    onKeyDown={(e) => e.key === 'Enter' && handleSave(p.id)}
                    className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={() => handleSave(p.id)}
                    disabled={!inputValue.trim()}
                    className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50"
                  >
                    저장
                  </button>
                </div>
              )}
            </section>
          )
        })}

        {/* 보안 안내 */}
        <section className="bg-blue-50 border border-blue-100 rounded-2xl p-6">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">보안 모델</h3>
          <ul className="space-y-1.5 text-xs text-blue-800">
            <li>• 키는 본 브라우저 localStorage에만 저장됩니다</li>
            <li>• 서버는 키를 받아 LLM 호출에만 쓰고 즉시 폐기 (저장·로깅 금지)</li>
            <li>• 호출 비용·한도는 본인 LLM 계정에 청구됩니다</li>
            <li>• 다른 사람과 PC 공유 시 사용 후 "모든 로컬 데이터 삭제" 권장</li>
          </ul>
        </section>

        {/* 데이터 관리 */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6">
          <h3 className="text-base font-semibold text-slate-900 mb-3">데이터 관리</h3>
          <button
            onClick={() => {
              if (confirm('모든 로컬 데이터(API 키 포함)를 삭제하시겠습니까?')) {
                clearAll()
              }
            }}
            className="text-sm text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg"
          >
            모든 로컬 데이터 삭제
          </button>
        </section>
      </main>
    </div>
  )
}
