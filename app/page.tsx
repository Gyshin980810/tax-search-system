'use client'
import { useState } from 'react'
import { SearchBar } from './components/SearchBar'
import { AnswerCard } from './components/AnswerCard'
import type { LabeledAnswer } from '@/domain/LabeledAnswer'

export default function Home() {
  const [answer, setAnswer] = useState<LabeledAnswer | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  async function handleSearch(question: string) {
    setLoading(true)
    setError(null)
    setErrorCode(null)
    setAnswer(null)

    try {
      const res = await fetch('/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })

      if (!res.ok) {
        const body = await res.json() as { error?: string; message?: string }
        setErrorCode(body.error ?? null)
        setError(body.message ?? '오류가 발생했습니다.')
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
