/**
 * TAX-049: 조문번호 매핑 사전(`articleNumberHints`) 단위 테스트
 *
 * 목적: 회계사 자연어 키워드를 정식 법령명(`keyword`)과 조문번호(`articleNumberHint`)로
 * 분리해 반환하는 사전의 매칭 정확성·중복 처리·골든셋 대표 케이스 커버를 검증.
 * 옵션 A 통합 후 — 어댑터 `fetchArticles`가 articleNumberHint로 T1 조문을 정확 추출.
 */
import { describe, it, expect } from 'vitest'
import {
  ARTICLE_NUMBER_HINTS,
  lookupArticleHints,
} from '@/domain/articleNumberHints'

const REQUESTED_AT = new Date('2026-06-09T00:00:00Z')

describe('lookupArticleHints — 기본 매칭', () => {
  it('단일 키워드 매칭 시 keyword=정식 법령명, articleNumberHint=조문번호로 분리 반환한다', () => {
    const result = lookupArticleHints('종합소득세 확정신고기한은 언제인가요?', REQUESTED_AT)
    expect(result).toHaveLength(1)
    expect(result[0]?.keyword).toBe('소득세법')
    expect(result[0]?.articleNumberHint).toBe('제70조')
    expect(result[0]?.requestedAt).toBe(REQUESTED_AT)
  })

  it('미매칭 질문은 빈 배열을 반환한다 (LLM fallback 보장)', () => {
    const result = lookupArticleHints('전혀 다른 비세법 주제 질문', REQUESTED_AT)
    expect(result).toEqual([])
  })

  it('빈 문자열은 빈 배열을 반환한다', () => {
    expect(lookupArticleHints('', REQUESTED_AT)).toEqual([])
  })

  it('한 항목의 여러 키워드 중 하나만 포함되어도 매칭된다', () => {
    const a = lookupArticleHints('자녀세액공제 한도', REQUESTED_AT)
    const b = lookupArticleHints('자녀공제는 얼마인가요?', REQUESTED_AT)
    expect(a[0]?.keyword).toBe('소득세법')
    expect(a[0]?.articleNumberHint).toBe('제59조의2')
    expect(b[0]?.keyword).toBe('소득세법')
    expect(b[0]?.articleNumberHint).toBe('제59조의2')
  })

  it('시행령 매칭 시 keyword는 "소득세법 시행령" 형태로 반환된다', () => {
    const result = lookupArticleHints('일시적 2주택 비과세 적용?', REQUESTED_AT)
    const hit = result.find((q) => q.articleNumberHint === '제155조')
    expect(hit?.keyword).toBe('소득세법 시행령')
  })
})

describe('lookupArticleHints — 다중 매칭 & 중복 제거', () => {
  it('서로 다른 조문이 매칭되면 모두 반환한다 (같은 법령 다른 조문)', () => {
    const result = lookupArticleHints(
      '양도소득세 과세대상과 양도소득세 세율을 알려주세요',
      REQUESTED_AT,
    )
    const pairs = result.map((q) => `${q.keyword}|${q.articleNumberHint ?? ''}`)
    expect(pairs).toContain('소득세법|제94조')
    expect(pairs).toContain('소득세법|제104조')
  })

  it('동일 lawName+articleNumber는 한 번만 반환된다(중복 제거)', () => {
    const result = lookupArticleHints(
      '일시적 2주택 1세대1주택 특례 적용은?',
      REQUESTED_AT,
    )
    const targeted = result.filter(
      (q) => q.keyword === '소득세법 시행령' && q.articleNumberHint === '제155조',
    )
    expect(targeted).toHaveLength(1)
  })
})

describe('lookupArticleHints — 골든셋 대표 케이스 커버', () => {
  it.each([
    ['종합소득세 확정신고기한은?', '소득세법', '제70조', 'G-S-소득-03'],
    ['배우자 상속공제 한도는?', '상속세 및 증여세법', '제19조', 'G-S-상증-01'],
    ['법인세 과세표준 구간별 세율은?', '법인세법', '제55조', 'G-S-법인-01'],
    ['면세 재화 또는 용역의 공급은?', '부가가치세법', '제26조', 'G-S-부가-01'],
    ['본인 기본공제는 얼마인가요?', '소득세법', '제50조', 'G-1'],
    ['1세대 1주택 비과세 요건은?', '소득세법', '제89조', 'G-2'],
    ['업무무관 지출은 손금 인정되나요?', '법인세법', '제19조', 'G-3'],
    ['상속세 기초공제는?', '상속세 및 증여세법', '제18조', 'G-4'],
    ['재산세 납부 기한은?', '지방세법', '제115조', 'G-5'],
  ])('"%s" → keyword=%s, articleNumberHint=%s (%s)', (question, expectedLaw, expectedArt) => {
    const result = lookupArticleHints(question, REQUESTED_AT)
    const hit = result.find(
      (q) => q.keyword === expectedLaw && q.articleNumberHint === expectedArt,
    )
    expect(hit, `expected ${expectedLaw} ${expectedArt} in results`).toBeDefined()
  })
})

describe('ARTICLE_NUMBER_HINTS — 사전 무결성', () => {
  it('회계사 검수 완료 사전은 47개 항목이다 (2026-06-09)', () => {
    expect(ARTICLE_NUMBER_HINTS).toHaveLength(47)
  })

  it('모든 항목은 keywords 1개 이상·lawName·articleNumber를 가진다', () => {
    for (const hint of ARTICLE_NUMBER_HINTS) {
      expect(hint.keywords.length).toBeGreaterThanOrEqual(1)
      expect(hint.lawName).toMatch(/법$|시행령$|시행규칙$/)
      expect(hint.articleNumber).toMatch(/^제\d+조(의\d+)?$/)
      for (const kw of hint.keywords) {
        expect(kw.trim()).not.toBe('')
      }
    }
  })

  it('동일 lawName+articleNumber 중복 항목이 없다', () => {
    const seen = new Set<string>()
    for (const hint of ARTICLE_NUMBER_HINTS) {
      const key = `${hint.lawName} ${hint.articleNumber}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })

  it('각 항목의 모든 키워드로 검색하면 해당 (lawName, articleNumber) 쌍이 결과에 포함된다', () => {
    // 주의: 부분 문자열 매칭 특성상 한 질문이 다른 항목과도 동시 매칭될 수 있음
    // (예: "그 밖의 인적공제"는 #1의 "인적공제"도 포함). 그래서 contain 검사로 확인.
    for (const hint of ARTICLE_NUMBER_HINTS) {
      for (const kw of hint.keywords) {
        const sqs = lookupArticleHints(kw, REQUESTED_AT)
        const pairs = sqs.map((q) => `${q.keyword}|${q.articleNumberHint ?? ''}`)
        const expected = `${hint.lawName}|${hint.articleNumber}`
        expect(pairs, `[${expected}] keyword="${kw}"`).toContain(expected)
      }
    }
  })
})
