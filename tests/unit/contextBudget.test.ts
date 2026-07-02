/**
 * contextBudget 유틸 단위 테스트 (TAX-042F)
 *
 * 입력 컨텍스트 윈도우 보호 유틸의 책임별 검증:
 *   - estimateTokens: 간이 한국어 토큰 추정 (한글 2, 기타 0.3)
 *   - compactLawContent: 짧은 본문 원본 / 긴 본문 중략 마커 / full 옵션
 *   - densifyArticleRefs: 괄호 조문명 제거 / 5% 미만 절감 시 원본
 *   - extractQuestionKeywords + relevanceScore: 매칭 가중치 보조
 *   - truncateForContext: short-circuit / Tier 정렬 / 최소 1건 / 인덱스 1:1
 */
import { describe, it, expect } from 'vitest'
import {
  estimateTokens,
  compactLawContent,
  densifyArticleRefs,
  extractQuestionKeywords,
  relevanceScore,
  truncateForContext,
} from '@/adapters/contextBudget'
import type { TaxLaw } from '@/domain/TaxLaw'

function makeLaw(overrides: Partial<TaxLaw> = {}): TaxLaw {
  return {
    sourceType: '법령',
    lawName: '법인세법',
    articleNumber: '제1조',
    articleTitle: '목적',
    content: '법인세법은 다음과 같이 정한다.',
    revisionDate: '2026-01-01',
    enforcementDate: '2026-01-01',
    sourceUrl: 'https://example.com',
    trustTier: 'T1',
    ...overrides,
  }
}

describe('estimateTokens — 간이 한국어 토큰 추정', () => {
  it('빈 문자열은 0 토큰', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('한글 1자 ≈ 2 토큰 (100자 → 200)', () => {
    expect(estimateTokens('가'.repeat(100))).toBe(200)
  })

  it('영문 100자 ≈ 30 토큰 (Math.ceil 적용)', () => {
    expect(estimateTokens('a'.repeat(100))).toBe(30)
  })
})

describe('compactLawContent — 본문 계단식 축약', () => {
  it('짧은 본문(1000자)은 원본 그대로 유지', () => {
    const s = '가'.repeat(1000)
    expect(compactLawContent(s)).toBe(s)
  })

  it('긴 본문(5000자+)은 "⋯ 중략 N자 ⋯" 마커 포함', () => {
    const s =
      '이 법은 다음과 같이 정한다.\n' + '가'.repeat(5000) + '\n이상과 같이 한다. '
    const r = compactLawContent(s)
    expect(r).toContain('⋯ 중략')
    expect(r).toContain('자 ⋯')
    expect(r.length).toBeLessThan(s.length)
  })

  it('opts.full=true 시 축약 비활성', () => {
    const s = '가'.repeat(5000)
    expect(compactLawContent(s, { full: true })).toBe(s)
  })
})

describe('densifyArticleRefs — 참조 조문 군더더기 제거', () => {
  it('괄호 조문명 제거: "제26조(법인세 과세표준의 계산)" → "제26조"', () => {
    const result = densifyArticleRefs('제26조(법인세 과세표준의 계산)에 따라 계산')
    expect(result).toContain('제26조에 따라 계산')
    expect(result).not.toContain('과세표준의 계산)')
  })

  it('5% 미만 절감 시 원본 유지 (짧은 단순 텍스트)', () => {
    const s = '제1조 단순 내용'
    expect(densifyArticleRefs(s)).toBe(s)
  })

  it('빈 문자열은 빈 문자열 유지', () => {
    expect(densifyArticleRefs('')).toBe('')
  })
})

describe('extractQuestionKeywords / relevanceScore — 매칭 가중치', () => {
  it('STOPWORDS("관련") 제거, 2자 이상 토큰 유지', () => {
    const keywords = extractQuestionKeywords('법인세법 손비 관련')
    expect(keywords).toContain('법인세법')
    expect(keywords).toContain('손비')
    expect(keywords).not.toContain('관련')
  })

  it('제목(lawName + articleTitle) 매칭은 강신호 2점씩 (TAX-6B-25)', () => {
    const law = makeLaw({ lawName: '법인세법 시행령', articleTitle: '손비의 범위' })
    // '법인세법' → lawName 매칭(+2), '손비' → articleTitle 매칭(+2)
    expect(relevanceScore(law, ['법인세법', '손비'])).toBe(4)
  })

  it('제목엔 없고 본문에만 있는 쟁점은 약신호 1점 (TAX-6B-25 핵심)', () => {
    // 제목("법인세법 목적")엔 '접대비'가 없지만 본문엔 있음 → 기존엔 0점이던 것이 1점으로
    const law = makeLaw({
      articleTitle: '목적',
      content: '접대비의 손금산입 한도는 다음과 같이 정한다.',
    })
    expect(relevanceScore(law, ['접대비'])).toBe(1)
  })

  it('제목·본문 양쪽에 있으면 강신호로 1회만 계산(중복 합산 금지)', () => {
    const law = makeLaw({ articleTitle: '손비의 범위', content: '손비란 다음과 같다.' })
    // '손비'가 제목·본문 양쪽에 있어도 강신호 2점만(2+1=3 아님)
    expect(relevanceScore(law, ['손비'])).toBe(2)
  })

  it('제목·본문 어디에도 없는 키워드는 0점', () => {
    const law = makeLaw({ articleTitle: '목적', content: '법인세법은 다음과 같이 정한다.' })
    expect(relevanceScore(law, ['양도소득세'])).toBe(0)
  })
})

describe('truncateForContext — 컨텍스트 윈도우 보호', () => {
  it('짧은 fixture short-circuit — 원본 객체 그대로 반환 (회귀 0건)', () => {
    const laws = [
      makeLaw({ content: '가'.repeat(100) }),
      makeLaw({ content: '나'.repeat(100), articleNumber: '제2조' }),
    ]
    const result = truncateForContext(laws, '법인세법 손비')
    expect(result.promptLaws).toBe(laws)
    expect(result.originalRefs).toBe(laws)
  })

  it('누적 컷오프 — T1이 T3·T4보다 우선 보존 (Tier 정렬)', () => {
    const big = '가'.repeat(4000)
    const laws = [
      makeLaw({ trustTier: 'T4', content: big, articleNumber: '제100조' }),
      makeLaw({
        trustTier: 'T1',
        content: big,
        articleNumber: '제1조',
        articleTitle: '손비의 범위',
      }),
      makeLaw({ trustTier: 'T3', content: big, articleNumber: '제50조' }),
    ]
    const result = truncateForContext(laws, '법인세법 손비', 5000)
    expect(result.promptLaws.length).toBeGreaterThanOrEqual(1)
    expect(result.promptLaws.length).toBe(result.originalRefs.length)
    expect(result.originalRefs[0].trustTier).toBe('T1')
  })

  it('본문에만 쟁점이 있는 조문이 컷오프에서 보존된다 (TAX-6B-25 핵심 회귀)', () => {
    const filler = '가'.repeat(4000)
    const laws = [
      // A(제10조): 제목·본문 모두 쟁점 없음 → 관련도 0
      makeLaw({ articleNumber: '제10조', articleTitle: '목적', content: filler }),
      // B(제25조): 제목엔 없지만 본문에 쟁점("접대비") 있음 → 관련도 1
      //   기존(제목만 평가)에선 A·B 모두 0점 동점 → 입력 순서대로 A가 앞 → 예산 부족 시 B 탈락.
      //   TAX-6B-25 이후 B가 1점으로 앞서 정렬 → 예산 1건이면 B가 살아남아야 한다.
      makeLaw({
        articleNumber: '제25조',
        articleTitle: '기타',
        content: `접대비 손금산입 한도는 다음과 같다. ${filler}`,
      }),
    ]
    // 큰 조문 1건만 들어갈 예산으로 컷오프 강제
    const result = truncateForContext(laws, '접대비 손금 한도', 3000)
    expect(result.originalRefs.length).toBe(1)
    expect(result.originalRefs[0].articleNumber).toBe('제25조')
  })

  it('최소 1건 보장 — 모든 조문이 한도 초과여도 sorted[0] 포함', () => {
    const huge = '가'.repeat(50_000)
    const laws = [makeLaw({ content: huge })]
    const result = truncateForContext(laws, '질문', 100)
    expect(result.promptLaws.length).toBe(1)
    expect(result.originalRefs.length).toBe(1)
  })

  it('인덱스 1:1 대응 — promptLaws[i].sourceUrl === originalRefs[i].sourceUrl', () => {
    const laws = [
      makeLaw({ sourceUrl: 'https://a', articleNumber: '제1조' }),
      makeLaw({ sourceUrl: 'https://b', articleNumber: '제2조', trustTier: 'T2' }),
    ]
    const result = truncateForContext(laws, '법인세법')
    for (let i = 0; i < result.promptLaws.length; i++) {
      expect(result.promptLaws[i].sourceUrl).toBe(result.originalRefs[i].sourceUrl)
    }
  })

  it('빈 배열 입력 안전 처리', () => {
    const result = truncateForContext([], '질문')
    expect(result.promptLaws).toEqual([])
    expect(result.originalRefs).toEqual([])
  })
})
