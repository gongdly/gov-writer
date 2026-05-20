import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, FileText, Megaphone, MessageCircleQuestion, Search, Eye, RotateCw, Trash2,
  Loader2, AlertCircle, ChevronLeft, ChevronRight, X, Copy, Check, Settings,
} from 'lucide-react'

interface DraftListItem {
  id: string
  doc_type: 'speech' | 'press' | 'explain'
  title: string
  form_data: Record<string, unknown>
  created_at: string
  updated_at: string
}

interface DraftDetail extends DraftListItem {
  generated_text: string
}

const PAGE_SIZE = 20

export default function HistoryPage() {
  const navigate = useNavigate()
  const [drafts, setDrafts] = useState<DraftListItem[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [docType, setDocType] = useState<'all' | 'speech' | 'press' | 'explain'>('all')
  const [viewing, setViewing] = useState<DraftDetail | null>(null)

  const fetchDrafts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      if (search) params.set('search', search)
      if (docType !== 'all') params.set('doc_type', docType)
      const res = await fetch(`/api/drafts?${params}`)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setDrafts(data.drafts || [])
      setTotal(data.total || 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [offset, search, docType])

  useEffect(() => {
    fetchDrafts()
  }, [fetchDrafts])

  const handleSearch = () => {
    setSearch(searchInput.trim())
    setOffset(0)
  }

  const handleView = async (draftId: string) => {
    try {
      const res = await fetch(`/api/drafts/${draftId}`)
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as DraftDetail
      setViewing(data)
    } catch (e) {
      alert(`조회 실패: ${e instanceof Error ? e.message : e}`)
    }
  }

  const handleReuse = (draft: DraftListItem) => {
    if (!confirm(`"${draft.title}"의 입력값으로 새로 작성하시겠습니까?`)) return
    // form_data를 sessionStorage에 저장하고 작성 페이지로 이동
    sessionStorage.setItem('gw_reuse_form_data', JSON.stringify({
      doc_type: draft.doc_type,
      form_data: draft.form_data,
    }))
    if (draft.doc_type === 'explain') {
      navigate('/explain?reuse=1')
    } else {
      navigate(`/write?type=${draft.doc_type}&reuse=1`)
    }
  }

  const handleDelete = async (draftId: string, title: string) => {
    if (!confirm(`"${title}" 작성 이력을 삭제하시겠습니까?\n\n복구할 수 없습니다.`)) return
    try {
      const res = await fetch(`/api/drafts/${draftId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      fetchDrafts()
    } catch (e) {
      alert(`삭제 실패: ${e instanceof Error ? e.message : e}`)
    }
  }

  const hasNext = offset + PAGE_SIZE < total
  const hasPrev = offset > 0

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-4 h-4" /> 홈
          </Link>
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-600" />
            <h1 className="text-sm sm:text-base font-semibold text-slate-900 truncate">작성 이력</h1>
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

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {/* 검색·필터 */}
        <div className="mb-5 bg-white rounded-2xl border border-slate-200 p-4">
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="제목으로 검색..."
              className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={handleSearch}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800"
            >
              <Search className="w-3.5 h-3.5" /> 검색
            </button>
          </div>
          <div className="flex gap-2">
            {(['all', 'speech', 'press', 'explain'] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setDocType(t); setOffset(0) }}
                className={`px-3 py-1.5 text-xs rounded-full border transition-all ${
                  docType === t
                    ? 'border-blue-500 bg-blue-50 text-blue-900 font-medium'
                    : 'border-slate-200 hover:border-slate-300 text-slate-600'
                }`}
              >
                {t === 'all' ? '전체' : t === 'speech' ? '말씀자료' : t === 'press' ? '보도자료' : '설명자료'}
              </button>
            ))}
          </div>
        </div>

        {/* 로딩·에러 */}
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

        {/* 빈 상태 */}
        {!loading && !error && drafts.length === 0 && (
          <div className="text-center py-16">
            <FileText className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="text-sm text-slate-500 mb-4">
              {search || docType !== 'all'
                ? '조건에 맞는 이력이 없습니다.'
                : '아직 작성 이력이 없습니다.'}
            </p>
            <Link
              to="/"
              className="inline-block px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              새 문서 작성
            </Link>
          </div>
        )}

        {/* 이력 목록 */}
        {!loading && !error && drafts.length > 0 && (
          <>
            <div className="space-y-2">
              {drafts.map((d) => (
                <div
                  key={d.id}
                  className="bg-white rounded-xl border border-slate-200 p-4 hover:border-slate-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`text-xs px-2 py-0.5 rounded ${
                            d.doc_type === 'press'
                              ? 'bg-green-50 text-green-700'
                              : d.doc_type === 'explain'
                              ? 'bg-amber-50 text-amber-800'
                              : 'bg-blue-50 text-blue-700'
                          }`}
                        >
                          {d.doc_type === 'press' ? (
                            <span className="flex items-center gap-1">
                              <Megaphone className="w-3 h-3" /> 보도자료
                            </span>
                          ) : d.doc_type === 'explain' ? (
                            <span className="flex items-center gap-1">
                              <MessageCircleQuestion className="w-3 h-3" /> 설명자료
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <FileText className="w-3 h-3" /> 말씀자료
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-slate-400">
                          {new Date(d.created_at).toLocaleString('ko-KR', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <h3 className="font-medium text-sm text-slate-900 truncate">
                        {d.title || '(제목 없음)'}
                      </h3>
                    </div>

                    <div className="flex flex-shrink-0 gap-0.5 sm:gap-1">
                      <button
                        onClick={() => handleView(d.id)}
                        title="본문 보기"
                        className="p-1.5 sm:p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleReuse(d)}
                        title="이 입력값으로 새로 작성"
                        className="p-1.5 sm:p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
                      >
                        <RotateCw className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(d.id, d.title)}
                        title="삭제"
                        className="p-1.5 sm:p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* 페이지네이션 */}
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <span>
                총 {total.toLocaleString()}건 ·{' '}
                {Math.min(offset + 1, total).toLocaleString()}~
                {Math.min(offset + drafts.length, total).toLocaleString()}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={!hasPrev}
                  className="p-1.5 text-slate-500 hover:text-slate-900 disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={!hasNext}
                  className="p-1.5 text-slate-500 hover:text-slate-900 disabled:opacity-30"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}

        {/* 본문 보기 모달 */}
        {viewing && (
          <ViewModal draft={viewing} onClose={() => setViewing(null)} />
        )}
      </main>
    </div>
  )
}

function ViewModal({ draft, onClose }: { draft: DraftDetail; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState<'md' | 'hwpx' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(draft.generated_text)
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
      let url: string
      let body: Record<string, unknown>

      if (draft.doc_type === 'press') {
        // 보도자료: generated_text는 JSON 문자열
        let parsed: {
          title?: string
          subtitle?: string
          lead_paragraph?: string
          body_paragraphs?: string[]
        } = {}
        try {
          parsed = JSON.parse(draft.generated_text)
        } catch {
          throw new Error('보도자료 본문 파싱 실패. 옛 데이터는 다운로드를 지원하지 않습니다.')
        }
        url = `/api/download/press/${format}`
        body = {
          title: parsed.title || draft.title,
          subtitle: parsed.subtitle || '',
          lead_paragraph: parsed.lead_paragraph || '',
          body_paragraphs: parsed.body_paragraphs || [],
        }
      } else if (draft.doc_type === 'explain') {
        // 설명자료: generated_text는 JSON 문자열
        let parsed: any = {}
        try {
          parsed = JSON.parse(draft.generated_text)
        } catch {
          throw new Error('설명자료 본문 파싱 실패. 재사용 후 새로 다운로드해주세요.')
        }
        url = `/api/download/explain/${format}`
        body = {
          title: parsed.title || draft.title,
          report_date: parsed.report_date || '',
          ministry_name: parsed.ministry_name || '',
          article: parsed.article || {},
          position_paragraphs: parsed.position_paragraphs || [],
          contacts: [],  // 🔒 이력에는 담당자 미저장. 재사용 후 직접 입력.
        }
      } else {
        // 말씀자료: 그대로 텍스트
        url = `/api/download/speech/${format}`
        body = {
          generated_text: draft.generated_text,
          title: draft.title,
        }
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text() || `${format} 변환 실패`)

      const cd = res.headers.get('content-disposition') || ''
      let fname = `${draft.title || 'document'}.${format}`
      const m = cd.match(/filename\*=UTF-8''([^;]+)/i)
      if (m) {
        try { fname = decodeURIComponent(m[1]) } catch { /* ignore */ }
      }
      const blob = await res.blob()
      const objUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objUrl
      a.download = fname
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl max-w-3xl w-full max-h-[90vh] sm:max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  draft.doc_type === 'press'
                    ? 'bg-green-50 text-green-700'
                    : draft.doc_type === 'explain'
                    ? 'bg-amber-50 text-amber-800'
                    : 'bg-blue-50 text-blue-700'
                }`}
              >
                {draft.doc_type === 'press'
                  ? '보도자료'
                  : draft.doc_type === 'explain'
                  ? '설명자료'
                  : '말씀자료'}
              </span>
              <span className="text-xs text-slate-400">
                {new Date(draft.created_at).toLocaleString('ko-KR')}
              </span>
            </div>
            <h2 className="text-base font-semibold text-slate-900 truncate">
              {draft.title}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-1 sm:gap-1.5">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 text-xs border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? '복사됨' : '복사'}
            </button>
            <button
              onClick={() => handleDownload('md')}
              disabled={downloading !== null}
              className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 text-xs border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50"
            >
              {downloading === 'md' && <Loader2 className="w-3 h-3 animate-spin" />}
              MD
            </button>
            <button
              onClick={() => handleDownload('hwpx')}
              disabled={downloading !== null}
              className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 text-xs bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50"
            >
              {downloading === 'hwpx' && <Loader2 className="w-3 h-3 animate-spin" />}
              HWPX
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg sm:ml-1"
              title="닫기"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        {error && (
          <div className="mx-4 mt-3 flex items-start gap-2 p-2 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-6">
          <pre
            className="text-sm leading-relaxed whitespace-pre-wrap break-words text-slate-800"
            style={{ fontFamily: 'Pretendard, system-ui, sans-serif' }}
          >
            {draft.generated_text}
          </pre>
        </div>
      </div>
    </div>
  )
}
