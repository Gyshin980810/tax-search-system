/**
 * TAX-052: 비법령 수집·정규화 순수 함수 단위 테스트
 *
 * 외부 API를 호출하지 않고, 필터·중복 제거·상한·정렬·원문 보존 규칙만 검증한다.
 * 가장 중요한 단언: content 원문 불변(CLAUDE.md §6.1 인용 무결성).
 */
import { describe, it, expect } from 'vitest'
import {
  isEmbeddableNonlaw,
  dedupByCaseNumber,
  applyPerKeywordLimit,
  sortByTargetPriority,
  normalizeCaseNumber,
  CONTENT_MIN_LENGTH,
} from '../../scripts/collectNonlaw'
import type { TaxLaw, SourceType } from '../../src/domain/TaxLaw'

/** 테스트용 비법령 TaxLaw 팩토리 */
function makeNonlaw(overrides: Partial<TaxLaw> = {}): TaxLaw {
  return {
    sourceType: '심판례',
    lawName: '조세심판원 결정례',
    articleNumber: '',
    articleTitle: '테스트 사건',
    content: '가'.repeat(CONTENT_MIN_LENGTH), // 기본은 임계값 충족
    revisionDate: '',
    enforcementDate: '',
    sourceUrl: 'https://example.com/case',
    trustTier: 'T3',
    caseNumber: '조심2012서2999',
    issuingBody: '조세심판원',
    decisionDate: '2013-05-01',
    ...overrides,
  }
}

describe('normalizeCaseNumber — 사건번호 정규화', () => {
  it('공백 제거·소문자화로 표기 변형을 흡수한다', () => {
    expect(normalizeCaseNumber('조심 2012서2999')).toBe('조심2012서2999')
    expect(normalizeCaseNumber('  대법원 2010두1234  ')).toBe('대법원2010두1234')
  })
})

describe('isEmbeddableNonlaw — 임베딩 가능 판정', () => {
  it('비법령 + caseNumber + 충분한 본문이면 통과', () => {
    expect(isEmbeddableNonlaw(makeNonlaw())).toBe(true)
  })

  it('법령(sourceType=법령)은 제외한다', () => {
    expect(isEmbeddableNonlaw(makeNonlaw({ sourceType: '법령' as SourceType }))).toBe(false)
  })

  it('caseNumber가 없거나 빈 문자열이면 제외한다', () => {
    expect(isEmbeddableNonlaw(makeNonlaw({ caseNumber: undefined }))).toBe(false)
    expect(isEmbeddableNonlaw(makeNonlaw({ caseNumber: '   ' }))).toBe(false)
  })

  it('본문이 최소 길이 미만이면 제외한다(제목만 있는 국세청해석류 컷)', () => {
    expect(isEmbeddableNonlaw(makeNonlaw({ content: '짧은 본문' }))).toBe(false)
    expect(isEmbeddableNonlaw(makeNonlaw({ content: '' }))).toBe(false)
  })

  it('minLength 인자로 임계값을 조정할 수 있다', () => {
    const short = makeNonlaw({ content: '가'.repeat(100) })
    expect(isEmbeddableNonlaw(short, 200)).toBe(false)
    expect(isEmbeddableNonlaw(short, 50)).toBe(true)
  })
})

describe('dedupByCaseNumber — 사건번호 중복 제거', () => {
  it('같은 사건번호(표기 변형 포함)는 한 번만 남긴다', () => {
    const items = [
      makeNonlaw({ caseNumber: '조심2012서2999', articleTitle: '첫번째' }),
      makeNonlaw({ caseNumber: '조심 2012서2999', articleTitle: '중복(공백차이)' }),
      makeNonlaw({ caseNumber: '대법원2010두1234', articleTitle: '다른사건' }),
    ]
    const result = dedupByCaseNumber(items)
    expect(result).toHaveLength(2)
    // 먼저 등장한 항목이 보존된다
    expect(result[0].articleTitle).toBe('첫번째')
  })
})

describe('applyPerKeywordLimit — 키워드당 상한', () => {
  it('상한을 초과하면 앞에서부터 잘라낸다', () => {
    const items = Array.from({ length: 50 }, (_, i) => makeNonlaw({ caseNumber: `사건${i}` }))
    expect(applyPerKeywordLimit(items, 30)).toHaveLength(30)
  })

  it('상한 이하면 그대로 둔다', () => {
    const items = [makeNonlaw(), makeNonlaw({ caseNumber: '다른' })]
    expect(applyPerKeywordLimit(items, 30)).toHaveLength(2)
  })
})

describe('sortByTargetPriority — 심판례·해석례 우선, 판례 차순', () => {
  it('우선순위 순으로 정렬한다', () => {
    const items = [
      makeNonlaw({ sourceType: '판례', caseNumber: 'p1' }),
      makeNonlaw({ sourceType: '심판례', caseNumber: 't1' }),
      makeNonlaw({ sourceType: '해석례', caseNumber: 'e1' }),
    ]
    const result = sortByTargetPriority(items)
    expect(result.map((r) => r.sourceType)).toEqual(['심판례', '해석례', '판례'])
  })

  it('동순위는 입력 순서를 유지한다(안정 정렬)', () => {
    const items = [
      makeNonlaw({ sourceType: '심판례', caseNumber: 'a' }),
      makeNonlaw({ sourceType: '심판례', caseNumber: 'b' }),
    ]
    expect(sortByTargetPriority(items).map((r) => r.caseNumber)).toEqual(['a', 'b'])
  })
})

describe('원문 보존 — CLAUDE.md §6.1 (가장 중요한 단언)', () => {
  it('필터·중복제거·정렬을 거쳐도 content가 문자 단위로 불변이다', () => {
    const original = '가나다 (…) 제26조 제1항 제12호 — 원문 그대로\n둘째 줄'.repeat(20)
    const item = makeNonlaw({ content: original })
    const piped = sortByTargetPriority(
      dedupByCaseNumber(applyPerKeywordLimit([item], 30).filter((i) => isEmbeddableNonlaw(i))),
    )
    expect(piped).toHaveLength(1)
    // 참조 동일성이 아니라 문자열 값이 정확히 일치해야 한다(변형 0)
    expect(piped[0].content).toBe(original)
  })
})
