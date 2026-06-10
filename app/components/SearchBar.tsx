'use client'

interface SearchBarProps {
  onSubmit: (question: string) => void
  loading: boolean
}

export function SearchBar({ onSubmit, loading }: SearchBarProps) {
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const value = (form.elements.namedItem('question') as HTMLInputElement).value.trim()
    if (value.length >= 2) onSubmit(value)
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
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
    </form>
  )
}
