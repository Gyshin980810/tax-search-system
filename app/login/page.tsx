'use client'
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * 로그인 폼 본체.
 * useSearchParams를 쓰므로 Suspense 경계 안에서 렌더링합니다(Next.js 요구사항).
 */
function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // 입력값·상태 — camelCase (CLAUDE.md 명명 규칙)
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  /**
   * 폼 제출 시 패스코드를 검증 API로 보냅니다.
   * @param {React.FormEvent} event
   */
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault() // 페이지 새로고침 기본동작 막기
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      })

      if (!res.ok) {
        const body = (await res.json()) as { message?: string }
        setError(body.message ?? '로그인에 실패했습니다.')
        return
      }

      // 성공 — 원래 가려던 경로로 이동(없으면 메인).
      // open redirect 방지: 내부 경로('/'로 시작, '//' 제외)만 허용
      const from = searchParams.get('from')
      const safeFrom = from && from.startsWith('/') && !from.startsWith('//') ? from : '/'
      router.push(safeFrom)
      router.refresh() // 미들웨어가 새 쿠키를 인식하도록 갱신
    } catch {
      setError('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white border border-gray-200 rounded-lg shadow-sm px-6 py-8 space-y-5"
      >
        <div className="space-y-1 text-center">
          <h2 className="text-lg font-semibold text-gray-800">베타 접근</h2>
          <p className="text-sm text-gray-500">전달받은 패스코드를 입력해 주세요.</p>
        </div>

        <div className="space-y-1">
          <label htmlFor="passcode" className="block text-sm font-medium text-gray-700">
            패스코드
          </label>
          <input
            id="passcode"
            type="password"
            autoComplete="current-password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            disabled={loading}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500 disabled:bg-gray-100"
            placeholder="패스코드 입력"
          />
        </div>

        {error && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || passcode.length === 0}
          className="w-full rounded-md bg-gray-800 text-white text-sm font-medium py-2.5 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? '확인 중…' : '입장'}
        </button>
      </form>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="text-center py-12 text-sm text-gray-400">불러오는 중…</div>}>
      <LoginForm />
    </Suspense>
  )
}
