/**
 * TAX-6A-4: SearchQuery.targetDate 시점 필터 단위 테스트
 *
 * 검증 대상:
 *   1. SearchQuery에 targetDate 필드가 존재하고 선택적임
 *   2. targetDate 지정 시 revisionDate <= targetDate 인 조문만 필터
 *   3. targetDate 미지정 시 기존 동작(전체 반환) 유지
 */
import { describe, it, expect } from 'vitest'
import type { SearchQuery } from '@/domain/SearchQuery'
import type { TaxLaw } from '@/domain/TaxLaw'

// ─── 헬퍼 ───────────────────────────────────────────────────────────────────

function makeArticle(revisionDate: string): TaxLaw {
  return {
    sourceType: '법령',
    lawName: '부가가치세법',
    articleNumber: `제${revisionDate}조`,
    articleTitle: '테스트',
    content: '내용',
    revisionDate,
    enforcementDate: revisionDate,
    sourceUrl: 'https://www.law.go.kr',
    trustTier: 'T1',
  }
}

/**
 * 어댑터 내부 시점 필터 로직을 순수함수로 추출해 테스트
 * (nationalTaxLaw.ts의 targetYmd 필터 로직과 동일)
 */
function applyTemporalFilter(items: TaxLaw[], targetDate?: Date): TaxLaw[] {
  if (!targetDate) return items
  const targetYmd = targetDate.toISOString().slice(0, 10).replace(/-/g, '')
  return items.filter((it) => !it.revisionDate || it.revisionDate.replace(/-/g, '') <= targetYmd)
}

// ─── 테스트 ──────────────────────────────────────────────────────────────────

describe('SearchQuery.targetDate 타입 확인', () => {
  it('targetDate 없이 SearchQuery 생성 가능 (하위호환)', () => {
    const q: SearchQuery = { keyword: '소득세법', requestedAt: new Date() }
    expect(q.targetDate).toBeUndefined()
  })

  it('targetDate 포함 SearchQuery 생성 가능', () => {
    const d = new Date('2021-01-01')
    const q: SearchQuery = { keyword: '소득세법', requestedAt: new Date(), targetDate: d }
    expect(q.targetDate).toBe(d)
  })

  it('articleNumberHint와 targetDate 동시 사용 가능', () => {
    const q: SearchQuery = {
      keyword: '소득세법',
      requestedAt: new Date(),
      articleNumberHint: '제70조',
      targetDate: new Date('2022-06-01'),
    }
    expect(q.articleNumberHint).toBe('제70조')
    expect(q.targetDate?.toISOString().slice(0, 10)).toBe('2022-06-01')
  })
})

describe('시점 필터 로직 (revisionDate <= targetDate)', () => {
  const articles = [
    makeArticle('2018-01-01'),
    makeArticle('2020-06-15'),
    makeArticle('2022-01-01'),
    makeArticle('2024-07-01'),
    makeArticle('2026-01-01'),
  ]

  it('targetDate 미지정 시 전체 반환', () => {
    const result = applyTemporalFilter(articles)
    expect(result).toHaveLength(5)
  })

  it('targetDate=2020-06-15 → 2020-06-15 이하 조문만 반환', () => {
    const result = applyTemporalFilter(articles, new Date('2020-06-15'))
    expect(result.map((a) => a.revisionDate)).toEqual(['2018-01-01', '2020-06-15'])
  })

  it('targetDate=2022-01-01 → 경계값 포함', () => {
    const result = applyTemporalFilter(articles, new Date('2022-01-01'))
    expect(result).toHaveLength(3)
    expect(result.map((a) => a.revisionDate)).toContain('2022-01-01')
  })

  it('targetDate=2017-12-31 → 0건 반환 (모든 조문이 이후 시행)', () => {
    const result = applyTemporalFilter(articles, new Date('2017-12-31'))
    expect(result).toHaveLength(0)
  })

  it('targetDate=2030-01-01 → 전체 반환 (미래 날짜)', () => {
    const result = applyTemporalFilter(articles, new Date('2030-01-01'))
    expect(result).toHaveLength(5)
  })

  it('revisionDate 없는 조문은 targetDate 무관 포함', () => {
    const noDate: TaxLaw = { ...makeArticle(''), revisionDate: '' }
    const result = applyTemporalFilter([noDate], new Date('2018-01-01'))
    expect(result).toHaveLength(1)
  })
})
