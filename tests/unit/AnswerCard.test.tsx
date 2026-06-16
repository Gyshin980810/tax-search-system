/**
 * AnswerCard 단위 테스트 (TAX-6B-2·TAX-6B-4)
 *
 * - 부칙·경과조치 배지 표시 (6B-2)
 * - 즐겨찾기 토글 (6B-4)
 *
 * ImpactMapPanel은 mermaid 의존(jsdom 불가) → mock으로 대체.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AnswerCard } from '../../app/components/AnswerCard'
import type { LabeledAnswer } from '../../src/domain/LabeledAnswer'
import type { TaxLaw } from '../../src/domain/TaxLaw'
import type { Citation } from '../../src/domain/Citation'

// ImpactMapPanel은 mermaid를 import → jsdom에서 동작 불가하므로 mock
vi.mock('../../app/components/ImpactMapPanel', () => ({
  ImpactMapPanel: () => null,
}))

// ── fixture 헬퍼 ──────────────────────────────────────────────────────────────

/** 본법령 조문 TaxLaw(T1) */
function makeArticle(): TaxLaw {
  return {
    sourceType: '법령',
    lawName: '소득세법',
    articleNumber: '제55조',
    articleTitle: '세율',
    content: '거주자의 종합소득에 대한 소득세는 (…) 과세표준에 다음의 세율을 적용하여 계산한다.',
    revisionDate: '2025-12-23',
    enforcementDate: '2026-01-01',
    sourceUrl: 'https://www.law.go.kr/법령/소득세법',
    trustTier: 'T1',
  }
}

/** 부칙·경과조치 TaxLaw(T2) — TAX-6B-1 buchikToTaxLaw 산출물 형태 */
function makeAddendum(): TaxLaw {
  return {
    sourceType: '법령',
    lawName: '소득세법 부칙',
    articleNumber: '부칙 <제20615호, 2025.12.23>',
    articleTitle: '부칙',
    content: '제1조(시행일) 이 법은 2026년 1월 1일부터 시행한다.',
    revisionDate: '2025-12-23',
    enforcementDate: '2025-12-23',
    sourceUrl: 'https://www.law.go.kr/법령/소득세법',
    trustTier: 'T2',
  }
}

function makeCitation(taxLaw: TaxLaw): Citation {
  return {
    taxLaw,
    label: '🟢직접근거',
    excerpt: taxLaw.content,
    temporalLabel: '[현행]',
  }
}

/** PASS 상태 LabeledAnswer 조립 */
function makeAnswer(citations: Citation[]): LabeledAnswer {
  return {
    rawQuestion: '소득세 세율과 시행일을 알려줘',
    citations,
    summary: '소득세법 제55조 세율과 부칙 시행일입니다.',
    disclaimer: '면책 고지 문구.',
    temporalLabel: '[현행]',
    verificationResult: {
      status: 'PASS',
      checks: { v1: true, v2: true, v3: true, v4: true, v5: true, v6: true },
      failReasons: [],
    },
    generatedAt: new Date('2026-06-14T00:00:00Z'),
  }
}

const BOOKMARK_KEY = 'tax-bookmarks'

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe('AnswerCard — 부칙·경과조치 표시 (TAX-6B-2)', () => {
  it('부칙 citation에 ⏱경과조치 배지를 노출한다', () => {
    const answer = makeAnswer([makeCitation(makeAddendum())])
    render(<AnswerCard answer={answer} />)

    const badge = screen.getByTestId('addendum-badge')
    expect(badge).toBeTruthy()
    expect(badge.textContent).toContain('경과조치')
  })

  it('일반 조문(T1) citation에는 경과조치 배지를 노출하지 않는다', () => {
    const answer = makeAnswer([makeCitation(makeArticle())])
    render(<AnswerCard answer={answer} />)

    expect(screen.queryByTestId('addendum-badge')).toBeNull()
  })

  it('조문 + 부칙 혼합 시 부칙 카드에만 배지를 노출한다', () => {
    const answer = makeAnswer([
      makeCitation(makeArticle()),
      makeCitation(makeAddendum()),
    ])
    render(<AnswerCard answer={answer} />)

    // 배지는 정확히 1개(부칙 카드)만 존재
    expect(screen.getAllByTestId('addendum-badge')).toHaveLength(1)
  })
})

describe('AnswerCard — 라벨 툴팁·ARIA (TAX-6B-5)', () => {
  it('라벨 배지에 title 속성이 있다', () => {
    render(<AnswerCard answer={makeAnswer([makeCitation(makeArticle())])} />)
    const badge = screen.getByTestId('label-badge')
    expect(badge.getAttribute('title')).toBeTruthy()
    expect(badge.getAttribute('title')).toContain('직접 근거')
  })

  it('인용 카드에 role="article"이 있다', () => {
    render(<AnswerCard answer={makeAnswer([makeCitation(makeArticle())])} />)
    expect(screen.getByRole('article')).toBeTruthy()
  })
})

describe('AnswerCard — 즐겨찾기 토글 (TAX-6B-4)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('즐겨찾기 버튼이 렌더링된다', () => {
    render(<AnswerCard answer={makeAnswer([makeCitation(makeArticle())])} />)
    expect(screen.getByTestId('bookmark-btn')).toBeTruthy()
  })

  it('초기 상태에서 즐겨찾기 미등록(☆)으로 표시된다', () => {
    render(<AnswerCard answer={makeAnswer([makeCitation(makeArticle())])} />)
    expect(screen.getByTestId('bookmark-btn').textContent).toBe('☆')
  })

  it('버튼 클릭 시 localStorage에 저장된다', () => {
    const answer = makeAnswer([makeCitation(makeArticle())])
    render(<AnswerCard answer={answer} />)

    fireEvent.click(screen.getByTestId('bookmark-btn'))

    const stored = JSON.parse(localStorage.getItem(BOOKMARK_KEY) ?? '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0].rawQuestion).toBe(answer.rawQuestion)
  })

  it('저장 후 다시 클릭 시 localStorage에서 제거된다', () => {
    const answer = makeAnswer([makeCitation(makeArticle())])
    render(<AnswerCard answer={answer} />)

    fireEvent.click(screen.getByTestId('bookmark-btn')) // 추가
    fireEvent.click(screen.getByTestId('bookmark-btn')) // 제거

    const stored = JSON.parse(localStorage.getItem(BOOKMARK_KEY) ?? '[]')
    expect(stored).toHaveLength(0)
  })
})

describe('AnswerCard — 조용한 틀림 신고 👎 (TAX-030-B, FR-24)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('👎 신고 버튼이 렌더링된다', () => {
    render(<AnswerCard answer={makeAnswer([makeCitation(makeArticle())])} />)
    expect(screen.getByTestId('feedback-open-btn')).toBeTruthy()
  })

  it('버튼 클릭 시 사유 입력창과 신고 버튼이 노출된다', () => {
    render(<AnswerCard answer={makeAnswer([makeCitation(makeArticle())])} />)

    fireEvent.click(screen.getByTestId('feedback-open-btn'))

    expect(screen.getByTestId('feedback-reason-input')).toBeTruthy()
    expect(screen.getByTestId('feedback-submit-btn')).toBeTruthy()
  })

  it('신고 제출 시 /api/feedback에 질문·사유·sourceTypes를 전송하고 완료 메시지를 표시한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const answer = makeAnswer([makeCitation(makeArticle())])
    render(<AnswerCard answer={answer} />)

    fireEvent.click(screen.getByTestId('feedback-open-btn'))
    fireEvent.change(screen.getByTestId('feedback-reason-input'), {
      target: { value: '결론이 반대입니다' },
    })
    fireEvent.click(screen.getByTestId('feedback-submit-btn'))

    // 완료 메시지가 비동기로 나타난다
    expect(await screen.findByTestId('feedback-done')).toBeTruthy()

    // 올바른 엔드포인트·바디로 호출됐는지 확인
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/feedback',
      expect.objectContaining({ method: 'POST' }),
    )
    const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(sentBody.question).toBe(answer.rawQuestion)
    expect(sentBody.reason).toBe('결론이 반대입니다')
    expect(sentBody.sourceTypes).toEqual(['법령'])
  })

  it('전송 실패(ok=false) 시 에러 메시지를 표시한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    render(<AnswerCard answer={makeAnswer([makeCitation(makeArticle())])} />)

    fireEvent.click(screen.getByTestId('feedback-open-btn'))
    fireEvent.click(screen.getByTestId('feedback-submit-btn'))

    expect(await screen.findByTestId('feedback-error')).toBeTruthy()
  })
})
