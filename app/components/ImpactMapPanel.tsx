'use client'

/**
 * ImpactMapPanel 컴포넌트 (TAX-034)
 *
 * 심판례 인용 카드 하단에 붙는 "관계 그래프 보기/닫기" 토글 패널.
 * - 버튼 클릭 시 /api/impact-map 호출 → mermaid SVG 렌더링
 * - lazy load: 최초 열기에서만 API 조회 (재클릭은 토글만)
 * - mermaid는 dynamic import (브라우저 전용 — SSR 방지)
 *
 * 계층 역할: 표현·인터랙션만 담당 (CLAUDE.md §4 UI 계층)
 * 비즈니스 로직·원문 가공 없음.
 */

import { useState, useCallback, useRef } from 'react'

/** /api/impact-map 성공 응답 모양 */
interface ImpactMapApiResponse {
  mermaid: string
}

interface ImpactMapPanelProps {
  /** 심판례 청구번호 — TaxLaw.caseNumber 값 */
  caseNumber: string
}

/**
 * mermaid 노드 ID에 안전한 문자열 생성
 * - 특수문자·공백 제거, 소문자 통일
 * - 같은 페이지에 심판례 카드가 여러 개여도 ID 충돌 없음
 */
function toSafeId(caseNumber: string): string {
  return 'imap-' + caseNumber.replace(/\W/g, '').toLowerCase()
}

export function ImpactMapPanel({ caseNumber }: ImpactMapPanelProps) {
  const [open, setOpen]       = useState(false)
  const [loaded, setLoaded]   = useState(false)   // 한 번 로드됐으면 재조회 X
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [svgHtml, setSvgHtml] = useState<string | null>(null)

  // mermaid는 최초 initialize 1회만 (중복 호출 방지)
  const mermaidInitialized = useRef(false)

  const fetchAndRender = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // ── 1. API 호출 ──────────────────────────────────────────────────────
      const res = await fetch(
        `/api/impact-map?caseNo=${encodeURIComponent(caseNumber)}`,
      )

      if (!res.ok) {
        // 에러 메시지는 API body에서 가져옴 (없으면 상태 코드 기본 문구)
        const body = await res.json().catch(() => ({})) as { message?: string }
        if (res.status === 404) {
          setError('관계 그래프 데이터를 찾지 못했습니다.')
        } else {
          setError(body.message ?? '그래프를 불러오는 중 오류가 발생했습니다.')
        }
        return
      }

      const data = await res.json() as ImpactMapApiResponse

      // ── 2. mermaid dynamic import (SSR 방지) ────────────────────────────
      const mermaid = (await import('mermaid')).default

      if (!mermaidInitialized.current) {
        mermaid.initialize({ startOnLoad: false, theme: 'default' })
        mermaidInitialized.current = true
      }

      // ── 3. SVG 렌더링 ────────────────────────────────────────────────────
      // uniqueId: 같은 페이지에 심판례 카드가 여러 개여도 충돌 없음
      const { svg } = await mermaid.render(toSafeId(caseNumber), data.mermaid)

      setSvgHtml(svg)
      setLoaded(true)
    } catch {
      setError('그래프를 불러오는 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }, [caseNumber])

  function handleToggle() {
    const nextOpen = !open
    setOpen(nextOpen)

    // 최초 열기 시에만 조회 — 이미 로드됐거나 로딩 중이면 토글만
    if (nextOpen && !loaded && !loading) {
      void fetchAndRender()
    }
  }

  const panelId = `panel-${toSafeId(caseNumber)}`

  return (
    <div className="mt-2">
      {/* 토글 버튼 */}
      <button
        onClick={handleToggle}
        className="text-xs text-amber-700 hover:text-amber-900 hover:underline flex items-center gap-1 transition-colors"
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span aria-hidden="true">{open ? '▲' : '▼'}</span>
        <span>{open ? '관계 그래프 닫기' : '관계 그래프 보기'}</span>
      </button>

      {/* 그래프 패널 */}
      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="심판례 관계 그래프"
          className="mt-2 border border-amber-100 rounded-lg bg-amber-50 p-3"
        >
          {/* 로딩 중 */}
          {loading && (
            <p
              data-testid="impact-map-loading"
              className="text-xs text-gray-500 text-center py-4"
            >
              관계 그래프 불러오는 중…
            </p>
          )}

          {/* 에러 */}
          {error && !loading && (
            <p
              data-testid="impact-map-error"
              className="text-xs text-red-600 py-2"
            >
              ⚠️ {error}
            </p>
          )}

          {/* SVG 그래프 */}
          {svgHtml && !loading && (
            <div
              data-testid="impact-map-svg"
              className="overflow-x-auto"
              // mermaid.render()가 반환한 SVG를 그대로 삽입 (원문 표현 그대로 — 가공 없음)
              dangerouslySetInnerHTML={{ __html: svgHtml }}
            />
          )}
        </div>
      )}
    </div>
  )
}
