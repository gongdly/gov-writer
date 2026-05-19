import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

interface Props {
  title: string
  phase: string
}

export default function PlaceholderPage({ title, phase }: Props) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-4 h-4" />
            홈
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold text-slate-900 mb-3">{title}</h1>
        {phase ? (
          <p className="text-sm text-slate-500">
            {phase}에서 구현됩니다.
          </p>
        ) : (
          <p className="text-sm text-slate-500">페이지를 찾을 수 없습니다.</p>
        )}
      </main>
    </div>
  )
}
