/**
 * API 호출 헬퍼.
 *
 * LLM 키를 localStorage에서 읽어 헤더로 자동 전달.
 * 서버는 헤더에서만 키를 받고 응답 후 폐기.
 */
import { getActiveProvider, getStoredKey } from '../hooks/useLLMSettings'

const HEADER_NAMES = {
  anthropic: 'X-Anthropic-Key',
  gemini: 'X-Gemini-Key',
  openai: 'X-OpenAI-Key',
} as const

interface ApiOptions extends RequestInit {
  /** 사용자 LLM 키를 헤더에 첨부할지 (기본 true) */
  attachLLMKey?: boolean
  /** 헤더에 첨부할 특정 provider (기본: 활성 provider) */
  llmProvider?: 'anthropic' | 'gemini' | 'openai'
}

export async function callApi<T = unknown>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const { attachLLMKey = true, llmProvider, ...fetchOptions } = options

  const headers = new Headers(fetchOptions.headers)
  if (!headers.has('Content-Type') && fetchOptions.body) {
    headers.set('Content-Type', 'application/json')
  }

  if (attachLLMKey) {
    const provider = llmProvider ?? getActiveProvider()
    const key = getStoredKey(provider)
    if (key) {
      headers.set(HEADER_NAMES[provider], key)
    }
  }

  const resp = await fetch(path, { ...fetchOptions, headers })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`)
  }

  return resp.json()
}
