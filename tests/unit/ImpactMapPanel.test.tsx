/**
 * ImpactMapPanel 단위 테스트 (TAX-034)
 *
 * - mermaid: vi.mock으로 mock (jsdom 환경에서 동작 불가)
 * - fetch: vi.stubGlobal로 mock
 * - @testing-library/react render + screen + fireEvent + waitFor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ImpactMapPanel } from '../../app/components/ImpactMapPanel'

// ── mermaid mock ──────────────────────────────────────────────────────────────
// jsdom 환경에서는 SVG 렌더링 불가 → mock으로 대체
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({
      svg: '<svg data-testid="mermaid-svg-output"><text>graph</text></svg>',
    }),
  },
}))

// ── fetch mock 헬퍼 ──────────────────────────────────────────────────────────

/** 성공 응답 생성 */
function mockFetchSuccess(mermaidCode = 'graph LR\n  A --> B') {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ map: {}, mermaid: mermaidCode }),
  })
}

/** 에러 응답 생성 */
function mockFetchError(status: number, message: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({ error: 'ERR', message }),
  })
}

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe('ImpactMapPanel', () => {
  const CASE_NUMBER = '조심2011서1540'

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── 초기 렌더링 ──────────────────────────────────────────────────────────

  it('초기 렌더링: "관계 그래프 보기" 버튼이 노출된다', () => {
    render(<ImpactMapPanel caseNumber={CASE_NUMBER} />)

    expect(screen.getByRole('button', { name: /관계 그래프 보기/ })).toBeInTheDocument()
  })

  it('초기 상태: 패널이 닫혀 있어서 로딩·에러·SVG가 보이지 않는다', () => {
    render(<ImpactMapPanel caseNumber={CASE_NUMBER} />)

    expect(screen.queryByTestId('impact-map-loading')).not.toBeInTheDocument()
    expect(screen.queryByTestId('impact-map-error')).not.toBeInTheDocument()
    expect(screen.queryByTestId('impact-map-svg')).not.toBeInTheDocument()
  })

  it('버튼의 aria-expanded가 초기에 false이다', () => {
    render(<ImpactMapPanel caseNumber={CASE_NUMBER} />)

    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
  })

  // ── 클릭 → 로딩 ──────────────────────────────────────────────────────────

  it('버튼 클릭 시 로딩 텍스트가 표시된다', async () => {
    // fetch가 느리게 resolve되도록 Promise를 지연
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () => new Promise(() => { /* 영원히 pending */ }),
      ),
    )

    render(<ImpactMapPanel caseNumber={CASE_NUMBER} />)
    fireEvent.click(screen.getByRole('button'))

    expect(await screen.findByTestId('impact-map-loading')).toBeInTheDocument()
  })

  it('버튼 클릭 후 aria-expanded가 true가 된다', () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {})))

    render(<ImpactMapPanel caseNumber={CASE_NUMBER} />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
  })

  // ── API 성공 → SVG 렌더링 ─────────────────────────────────────────────────

  it('API 성공 시 SVG 패널이 렌더링된다', async () => {
    vi.stubGlobal('fetch', mockFetchSuccess())

    render(<ImpactMapPanel caseNumber={CASE_NUMBER} />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByTestId('impact-map-svg')).toBeInTheDocument()
    })
    // 로딩은 사라져야 한다
    expect(screen.queryByTestId('impact-map-loading')).not.toBeInTheDocument()
  })

  it('API 성공 시 에러 메시지가 없다', async () => {
    vi.stubGlobal('fetch', mockFetchSuccess())

    render(<ImpactMapPanel caseNumber={CASE_NUMBER} />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByTestId('impact-map-svg')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('impact-map-error')).not.toBeInTheDocument()
  })

  it('버튼 텍스트가 열린 후 "관계 그래프 닫기"로 바뀐다', async () => {
    vi.stubGlobal('fetch', mockFetchSuccess())

    render(<ImpactMapPanel caseNumber={CASE_NUMBER} />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => screen.getByTestId('impact-map-svg'))

    expect(screen.getByRole('button', { name: /관계 그래프 닫기/ })).toBeInTheDocument()
  })

  // ── API 에러 ─────────────────────────────────────────────────────────────

  it('API 404 시 "데이터를 찾지 못했습니다" 에러 메시지가 표시된다', async () => {
    vi.stubGlobal('fetch', mockFetchError(404, '심판례를 찾지 못했습니다'))

    render(<ImpactMapPanel caseNumber={CASE_NUMBER} />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByTestId('impact-map-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('impact-map-error')).toHaveTextContent('관계 그래프 데이터를 찾지 못했습니다')
  })

  it('API 503 시 API body 메시지가 에러로 표시된다', async () => {
    vi.stubGlobal('fetch', mockFetchError(503, '서버가 일시적으로 응답하지 않습니다'))

    render(<ImpactMapPanel caseNumber={CASE_NUMBER} />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByTestId('impact-map-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('impact-map-error')).toHaveTextContent('서버가 일시적으로 응답하지 않습니다')
  })

  it('API 에러 시 SVG가 렌더링되지 않는다', async () => {
    vi.stubGlobal('fetch', mockFetchError(500, '서버 오류'))

    render(<ImpactMapPanel caseNumber={CASE_NUMBER} />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => screen.getByTestId('impact-map-error'))
    expect(screen.queryByTestId('impact-map-svg')).not.toBeInTheDocument()
  })

  // ── 네트워크 예외 ─────────────────────────────────────────────────────────

  it('fetch 자체가 throw되면 일반 에러 메시지가 표시된다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network Error')))

    render(<ImpactMapPanel caseNumber={CASE_NUMBER} />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByTestId('impact-map-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('impact-map-error')).toHaveTextContent('그래프를 불러오는 중 오류가 발생했습니다')
  })

  // ── 토글 ─────────────────────────────────────────────────────────────────

  it('열린 후 다시 클릭하면 패널이 닫힌다', async () => {
    vi.stubGlobal('fetch', mockFetchSuccess())

    render(<ImpactMapPanel caseNumber={CASE_NUMBER} />)
    // 열기
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => screen.getByTestId('impact-map-svg'))

    // 닫기
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByTestId('impact-map-svg')).not.toBeInTheDocument()
    expect(screen.queryByTestId('impact-map-loading')).not.toBeInTheDocument()
  })

  it('닫은 후 다시 열면 fetch를 재호출하지 않는다', async () => {
    const fetchMock = mockFetchSuccess()
    vi.stubGlobal('fetch', fetchMock)

    render(<ImpactMapPanel caseNumber={CASE_NUMBER} />)

    // 1회 열기
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => screen.getByTestId('impact-map-svg'))

    // 닫기
    fireEvent.click(screen.getByRole('button'))

    // 2회 열기
    fireEvent.click(screen.getByRole('button'))

    // fetch는 딱 1회만 호출
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // SVG는 다시 나타남 (캐시된 값)
    expect(screen.getByTestId('impact-map-svg')).toBeInTheDocument()
  })

  // ── fetch 인수 확인 ───────────────────────────────────────────────────────

  it('fetch가 올바른 API URL로 호출된다', async () => {
    const fetchMock = mockFetchSuccess()
    vi.stubGlobal('fetch', fetchMock)

    render(<ImpactMapPanel caseNumber={CASE_NUMBER} />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => screen.getByTestId('impact-map-svg'))

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/impact-map?caseNo=${encodeURIComponent(CASE_NUMBER)}`,
    )
  })

  it('caseNumber의 특수문자가 URL 인코딩되어 전달된다', async () => {
    const fetchMock = mockFetchSuccess()
    vi.stubGlobal('fetch', fetchMock)

    const specialCase = '조심 2020부 1234'
    render(<ImpactMapPanel caseNumber={specialCase} />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => screen.getByTestId('impact-map-svg'))

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/impact-map?caseNo=${encodeURIComponent(specialCase)}`,
    )
  })
})
