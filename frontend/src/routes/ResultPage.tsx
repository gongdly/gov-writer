import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Copy, Check, RefreshCw, FileEdit, Megaphone, FileText } from 'lucide-react'

interface StoredResult {
  generated_text: string
  rag_used: boolean
  rag_count: number
  draft_id: string | null
  char_count: number
  doc_type: 'speech' | 'press'
  form_data: Record<string, unknown>
  provider: string
  created_at: string
}

export default function ResultPage() {
  const navigate = useNavigate()
  const [result, setResult] = useState<StoredResult | null>(null)
  const [editedText, setEditedText] = useState('')
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const raw = sessionStorage.getItem('gw_last_result')
    if (!raw) {
      navigate('/')
      return
    }
    try {
      const parsed = JSON.parse(raw) as StoredResult
      setResult(parsed)
      setEditedText(parsed.generated_text)
    } catch {
      navigate('/')
    }
  }, [navigate])

  if (!result) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        결과를 불러오는 중...
      </div>
    )
  }

  const isPress = result.doc_type === 'press'
  const Icon = isPress ? Megaphone : FileText
  const color = isPress ? 'green' : 'blue'
  const docTypeName = isPress ? '보도자료' : '말씀자료'

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editedText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert('복사 실패. 텍스트 영역을 직접 선택하여 복사해주세요.')
    }
  }

  const handleRegenerate = () => {
    if (!confirm('처음부터 다시 생성하시겠습니까? 현재 편집 내용은 사라집니다.')) return
    // 입력 폼 데이터를 다시 sessionStorage에 두고 /write로 이동
    sessionStorage.setItem('gw_prefill_form', JSON.stringify(result.form_data))
    navigate(`/write?type=${result.doc_type}`)
  }

  const charCount = editedText.length
  const targetChars = (result.form_data?.target_chars as number) || 1500
  const charRatio = targetChars > 0 ? (charCount / targetChars) * 100 : 0
  const charStatus =
    charRatio < 95 ? 'short' : charRatio > 105 ? 'long' : 'good'

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-4 h-4" /> 허브로
          </Link>
          <div className="flex items-center gap-2">
            <div className={`p-1.5 bg-${color}-50 rounded-lg`}>
              <Icon className={`w-4 h-4 text-${color}-600`} />
            </div>
            <h1 className="text-base font-semibold text-slate-900">{docTypeName} 작성 결과</h1>
          </div>
          <div className="w-12" />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* 메타 정보 */}
        <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="모델" value={result.provider.toUpperCase()} />
          <Stat
            label="글자수"
            value={`${charCount.toLocaleString()} / ${targetChars.toLocaleString()}`}
            status={charStatus}
          />
          <Stat
            label="RAG 참조"
            value={result.rag_used ? `${result.rag_count}건` : '미사용'}
          />
          <Stat
            label="저장"
            value={result.draft_id ? '이력 저장됨' : '저장 안 됨'}
          />
        </div>

        {/* 액션 버튼 */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(!editing)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg ${
                editing
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-700 hover:border-slate-300'
              }`}
            >
              <FileEdit className="w-3.5 h-3.5" />
              {editing ? '편집 종료' : '편집'}
            </button>
            <button
              onClick={handleRegenerate}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-slate-200 text-slate-700 hover:border-slate-300 rounded-lg"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              재생성
            </button>
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-slate-900 text-white hover:bg-slate-800 rounded-lg font-medium"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5" />
                복사됨
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                전체 복사
              </>
            )}
          </button>
        </div>

        {/* 본문 */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {editing ? (
            <textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              className="w-full p-8 text-sm leading-relaxed font-mono resize-none focus:outline-none"
              style={{ minHeight: '600px', fontFamily: 'Pretendard, system-ui, sans-serif' }}
            />
          ) : (
            <pre
              className="w-full p-8 text-sm leading-relaxed whitespace-pre-wrap break-words"
              style={{ fontFamily: 'Pretendard, system-ui, sans-serif' }}
            >
              {editedText}
            </pre>
          )}
        </div>

        {/* 안내 */}
        <div className="mt-6 p-4 bg-blue-50 border border-blue-100 rounded-xl">
          <p className="text-xs text-blue-900 leading-relaxed">
            <strong>다음 단계 (Phase 3.5에서 추가 예정):</strong> HWPX 파일 다운로드.
            현재는 "전체 복사" 후 한글·결재 시스템에 붙여넣으시면 됩니다.
            본문 편집 후 복사도 가능합니다.
          </p>
        </div>

        {/* 결과 일관성 표시 */}
        <div className="mt-4 text-xs text-slate-400 text-center">
          작성일시: {new Date(result.created_at).toLocaleString('ko-KR')}
          {result.draft_id && ` · 이력 ID: ${result.draft_id.slice(0, 8)}`}
        </div>
      </main>
    </div>
  )
}

function Stat({
  label,
  value,
  status,
}: {
  label: string
  value: string
  status?: 'short' | 'good' | 'long'
}) {
  const color =
    status === 'good'
      ? 'text-green-700'
      : status === 'short'
      ? 'text-amber-700'
      : status === 'long'
      ? 'text-red-700'
      : 'text-slate-900'

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-sm font-semibold ${color}`}>{value}</p>
    </div>
  )
}
