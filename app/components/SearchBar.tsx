'use client'

interface SearchBarProps {
  /** question: 질문 문자열, targetDate: YYYY-MM-DD 형식 (미지정 시 undefined) */
  onSubmit: (question: string, targetDate?: string) => void
  loading: boolean
}

export function SearchBar({ onSubmit, loading }: SearchBarProps) {
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const value = (form.elements.namedItem('question') as HTMLInputElement).value.trim()
    const dateValue = (form.elements.namedItem('targetDate') as HTMLInputElement).value
    if (value.length >= 2) onSubmit(value, dateValue || undefined)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex gap-2">
        <input
          name="question"
          type="text"
          maxLength={500}
          placeholder="예: 부가가치세 면세 대상이 무엇인가요?"
          disabled={loading}
          data-testid="question-input"
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
        />
        <button
          type="submit"
          disabled={loading}
          data-testid="submit-btn"
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
        >
          {loading ? '검색 중…' : '검색'}
        </button>
      </div>

      {/* 시점 지정 — 선택 입력 (FR-15, TAX-6A-5) */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 whitespace-nowrap">
          시점 지정 <span className="text-gray-400">(선택)</span>
        </span>
        <input
          name="targetDate"
          type="date"
          disabled={loading}
          data-testid="temporal-input"
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100"
        />
        <span className="text-xs text-gray-400">
          지정하면 해당 날짜 기준 법령을 우선 조회합니다
        </span>
      </div>
    </form>
  )
}
