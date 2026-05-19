/**
 * LLM 설정 훅.
 *
 * 모든 LLM API 키는 localStorage에만 저장. 서버 전송은 요청 헤더로만.
 */
import { useEffect, useState, useCallback } from 'react'

export type LLMProvider = 'anthropic' | 'gemini' | 'openai'

const STORAGE_KEYS = {
  provider: 'gw_llm_provider',
  anthropic: 'gw_llm_key_anthropic',
  gemini: 'gw_llm_key_gemini',
  openai: 'gw_llm_key_openai',
} as const

const KEY_PATTERNS: Record<LLMProvider, RegExp> = {
  anthropic: /^sk-ant-/,
  gemini: /^AIza/,
  openai: /^sk-/,
}

export function getStoredKey(provider: LLMProvider): string | null {
  return localStorage.getItem(STORAGE_KEYS[provider])
}

export function getActiveProvider(): LLMProvider {
  const stored = localStorage.getItem(STORAGE_KEYS.provider) as LLMProvider | null
  return stored ?? 'gemini'
}

export function maskKey(key: string): string {
  if (!key || key.length < 8) return '••••'
  return key.slice(0, 7) + '••••••••' + key.slice(-4)
}

export function useLLMSettings() {
  const [provider, setProvider] = useState<LLMProvider>('gemini')
  const [keys, setKeys] = useState<Record<LLMProvider, string>>({
    anthropic: '',
    gemini: '',
    openai: '',
  })

  // 초기 로드
  useEffect(() => {
    setProvider(getActiveProvider())
    setKeys({
      anthropic: getStoredKey('anthropic') ?? '',
      gemini: getStoredKey('gemini') ?? '',
      openai: getStoredKey('openai') ?? '',
    })
  }, [])

  const saveKey = useCallback((p: LLMProvider, value: string) => {
    if (value.trim() === '') {
      localStorage.removeItem(STORAGE_KEYS[p])
      setKeys((prev) => ({ ...prev, [p]: '' }))
      return
    }
    localStorage.setItem(STORAGE_KEYS[p], value.trim())
    setKeys((prev) => ({ ...prev, [p]: value.trim() }))
  }, [])

  const changeProvider = useCallback((p: LLMProvider) => {
    localStorage.setItem(STORAGE_KEYS.provider, p)
    setProvider(p)
  }, [])

  const validateKeyFormat = useCallback((p: LLMProvider, value: string): boolean => {
    return KEY_PATTERNS[p].test(value)
  }, [])

  const clearAll = useCallback(() => {
    Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k))
    setKeys({ anthropic: '', gemini: '', openai: '' })
    setProvider('gemini')
  }, [])

  return {
    provider,
    keys,
    saveKey,
    changeProvider,
    validateKeyFormat,
    clearAll,
  }
}
