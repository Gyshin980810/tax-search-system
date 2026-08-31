'use client'
import { useState } from 'react'
import { SearchBar } from './components/SearchBar'
import { AnswerCard } from './components/AnswerCard'
import { BookmarkList } from './components/BookmarkList'
import type { LabeledAnswer } from '@/domain/LabeledAnswer'

// 시점 모호성 감지 패턴 (CLAUDE.md §6.2 — 자의적 판단 금지, 회계사에게 확인 요청)
const AMBIGUOUS_TEMPORAL_PATTERNS = [
  '예전', '이전 법', '이전법', '개정 전', '개정전',
  '구 법', '구법', '종전', '과거 법령', '예전 법',
]

/**
 * 질문에 모호한 시점 표현이 있는지 감지한다.
 * 단, 구체적 연도(예: 2020년)가 명시된 경우는 모호하지 않으므로 제외.
 */
function hasAmbiguousTemporal(question: string): boolean {
  if (!AMBIGUOUS_TEMPORAL_PATTERNS.some((p) => question.includes(p))) return false
  // 구체적 연도(YYYY년)가 있으면 모호성 없음
  return !/\d{4}년/.test(question)
}

export default function Home() {
  const [answer, setAnswer] = useState<LabeledAnswer | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [temporalAmbiguous, setTemporalAmbiguous] = useState(false)

  async function handleSearch(question: string, targetDate?: string) {
    // 시점 미지정 + 모호 표현 감지 → 자의적 판단 금지, 시점 확인 요청 (CLAUDE.md §6.2)
    if (!targetDate && hasAmbiguousTemporal(question)) {
      setTemporalAmbiguous(true)
      setError(null)
      setErrorCode(null)
      setAnswer(null)
      return
    }

    setTemporalAmbiguous(false)
    setLoading(true)
    setError(null)
    setErrorCode(null)
    setAnswer(null)

    try {
      const reqBody: { question: string; targetDate?: string } = { question }
      if (targetDate) reqBody.targetDate = targetDate

      const res = await fetch('/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
      })

      if (!res.ok) {
        const resBody = await res.json() as { error?: string; message?: string }
        setErrorCode(resBody.error ?? null)
        setError(resBody.message ?? '오류가 발생했습니다.')
        return
      }

      setAnswer(await res.json() as LabeledAnswer)
    } catch {
      setError('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <SearchBar onSubmit={handleSearch} loading={loading} />

      {/* 즐겨찾기 목록 — 북마크가 있을 때만 표시 (TAX-6B-4, FR-12) */}
      <BookmarkList onSelect={(q) => void handleSearch(q)} />

      {/* E-TEMPORAL-AMBIGUOUS: 시점 모호 감지 — 날짜 지정 요청 (CLAUDE.md §6.2, TAX-6A-5) */}
      {temporalAmbiguous && (
        <div
          data-testid="temporal-ambiguous-warning"
          className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-4 space-y-1"
        >
          <p className="text-sm font-semibold text-amber-800">시점 확인 필요</p>
          <p className="text-sm text-amber-700">
            질문에 과거 시점 표현이 감지되었습니다. 위 &apos;시점 지정&apos;에서 기준 날짜를 선택하거나,
            질문에 구체적인 연도(예: 2020년)를 명시해 주세요.
          </p>
        </div>
      )}

      {/* E-VERIFY-FAIL: 검증 실패 — 회계사에게 직접 확인 안내 */}
      {error && errorCode === 'E-VERIFY-FAIL' && (
        <div
          data-testid="verify-fail-message"
          className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-4 space-y-1"
        >
          <p className="text-sm font-semibold text-orange-800">확인 어려움</p>
          <p className="text-sm text-orange-700">
            이 질문은 현재 검증이 어렵습니다. 국세청 또는 전문가에게 직접 문의해 주세요.
          </p>
        </div>
      )}

      {/* 그 외 일반 오류 */}
      {error && errorCode !== 'E-VERIFY-FAIL' && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {loading && (
        <div className="text-sm text-gray-500 text-center py-8">
          법령 검색 및 답변 생성 중입니다…
        </div>
      )}

      {/* PASS 답변만 표시 (PENDING은 AnswerCard 내부에서 차단) */}
      {answer && <AnswerCard answer={answer} />}
    </div>
  )
}
