'use client'

import { useState, useEffect, useRef } from 'react'
import { detectPii, maskPhoneEmail } from '@/utils/piiFilter'
import { PiiDetectedError } from '@/domain/errors'

const RECENT_KEY = 'tax-recent-queries'
const MAX_RECENT = 5

function loadRecent(): string[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function saveRecent(masked: string): void {
  const list = loadRecent().filter((q) => q !== masked)
  list.unshift(masked)
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)))
}

interface SearchBarProps {
  /** question: 질문 문자열, targetDate: YYYY-MM-DD 형식 (미지정 시 undefined) */
  onSubmit: (question: string, targetDate?: string) => void
  loading: boolean
}

export function SearchBar({ onSubmit, loading }: SearchBarProps) {
  const [question, setQuestion] = useState('')
  const [piiError, setPiiError] = useState<string | null>(null)
  const [recentQueries, setRecentQueries] = useState<string[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // localStorage는 서버 렌더링 시 존재하지 않으므로 마운트 후 동기화가 의도된 설계다.
    // useState 지연 초기화로 옮기면 서버·클라이언트 결과가 달라져 하이드레이션 불일치가 난다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecentQueries(loadRecent())
  }, [])

  // Ctrl+K (또는 Cmd+K) 로 검색 입력란 포커스 (TAX-6B-5)
  useEffect(() => {
    function handleGlobal(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleGlobal)
    return () => document.removeEventListener('keydown', handleGlobal)
  }, [])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const value = question.trim()
    const form = e.currentTarget
    const dateValue = (form.elements.namedItem('targetDate') as HTMLInputElement).value

    if (value.length < 2) return

    try {
      detectPii(value)
    } catch (err) {
      if (err instanceof PiiDetectedError) {
        setPiiError(err.message)
        return
      }
      throw err
    }

    setPiiError(null)
    // 원문 저장 금지: 휴대폰·이메일 마스킹 후 localStorage 보관 (§7, FR-11)
    const masked = maskPhoneEmail(value)
    saveRecent(masked)
    setRecentQueries(loadRecent())
    setShowDropdown(false)
    onSubmit(value, dateValue || undefined)
  }

  function handleSelectRecent(q: string) {
    setQuestion(q)
    setShowDropdown(false)
    setPiiError(null)
    inputRef.current?.focus()
  }

  return (
    <form onSubmit={handleSubmit} aria-label="세법 검색" className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            name="question"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showDropdown}
            aria-controls="recent-dropdown"
            value={question}
            onChange={(e) => { setQuestion(e.target.value); setPiiError(null) }}
            onFocus={() => { if (recentQueries.length > 0) setShowDropdown(true) }}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            onKeyDown={(e) => { if (e.key === 'Escape') setShowDropdown(false) }}
            maxLength={500}
            placeholder="예: 부가가치세 면세 대상이 무엇인가요? (Ctrl+K)"
            disabled={loading}
            data-testid="question-input"
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          />
          {showDropdown && recentQueries.length > 0 && (
            <ul
              id="recent-dropdown"
              role="listbox"
              aria-label="최근 검색어"
              data-testid="recent-dropdown"
              className="absolute top-full left-0 right-0 z-10 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto"
            >
              {recentQueries.map((q, idx) => (
                <li key={idx} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onMouseDown={() => handleSelectRecent(q)}
                    data-testid="recent-item"
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="submit"
          disabled={loading}
          data-testid="submit-btn"
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
        >
          {loading ? '검색 중…' : '검색'}
        </button>
      </div>

      {/* PII 거부 에러 인라인 표시 (§7) */}
      {piiError && (
        <p
          data-testid="pii-error"
          className="text-xs text-red-600"
        >
          {piiError}
        </p>
      )}

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
