import { Link } from 'react-router-dom'
import { AlertCircle, CheckCircle2, KeyRound } from 'lucide-react'
import { getActiveProvider, getStoredKey } from '../hooks/useLLMSettings'

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic Claude',
  gemini: 'Google Gemini',
  openai: 'OpenAI GPT',
}

/**
 * API 키 설정 상태 배너.
 *
 * 미설정: 빨간 배너 + "설정 페이지로 이동" 버튼
 * 설정됨: 작은 회색 배너 + 사용 중인 모델 표시
 */
export default function ApiKeyBanner() {
  const provider = getActiveProvider()
  const hasKey = !!getStoredKey(provider)

  if (!hasKey) {
    return (
      <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-amber-900 text-sm">
              API 키가 설정되지 않았습니다
            </p>
            <p className="text-xs text-amber-800 mt-1">
              작성을 시작하려면 Claude · Gemini · OpenAI 중 하나의 API 키를 먼저 등록해주세요.
            </p>
            <Link
              to="/settings"
              className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 text-xs bg-amber-700 text-white rounded-lg hover:bg-amber-800 font-medium"
            >
              <KeyRound className="w-3.5 h-3.5" />
              설정 페이지로 이동
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-slate-600">
        <CheckCircle2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
        <span>
          사용 모델: <strong className="text-slate-900">{PROVIDER_LABELS[provider] || provider}</strong>
        </span>
        <Link to="/settings" className="ml-auto text-slate-500 hover:text-slate-900 underline">
          변경
        </Link>
      </div>
    </div>
  )
}
