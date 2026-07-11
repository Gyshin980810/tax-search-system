/**
 * searchMerge 도메인 유틸 단위 테스트 (TAX-6B-26)
 *
 * - identityKey: 법령=법령명+조문번호 / 비법령=자료유형+externalId 우선, 사건번호 폴백
 * - mergeSearchItems: 순서 보존 + identityKey 중복 제거(first-wins) + 원본 무변형
 */
import { describe, it, expect } from 'vitest'
import { identityKey, mergeSearchItems } from '@/domain/searchMerge'
import type { TaxLaw } from '@/domain/TaxLaw'

function makeLaw(overrides: Partial<TaxLaw> = {}): TaxLaw {
  return {
    sourceType: '법령',
    lawName: '법인세법',
    articleNumber: '제1조',
    articleTitle: '목적',
    content: '내용',
    revisionDate: '2026-01-01',
    enforcementDate: '2026-01-01',
    sourceUrl: 'https://example.com',
    trustTier: 'T1',
    ...overrides,
  }
}

describe('identityKey — 자료 식별 키', () => {
  it('법령은 법령명+조문번호로 식별한다', () => {
    const law = makeLaw({ lawName: '소득세법', articleNumber: '제70조' })
    expect(identityKey(law)).toBe('법령|소득세법|제70조')
  })

  it('비법령(심판례)은 자료유형+사건번호로 식별한다', () => {
    const tribunal = makeLaw({
      sourceType: '심판례',
      lawName: '조세심판원 결정례',
      caseNumber: '조심2019서2461',
    })
    expect(identityKey(tribunal)).toBe('심판례|조심2019서2461')
  })

  it('externalId가 있는 비법령은 사건번호 대신 externalId로 식별한다', () => {
    const first = makeLaw({ sourceType: '해석례', caseNumber: '재산', externalId: 'NTS-1' })
    const second = makeLaw({ sourceType: '해석례', caseNumber: '재산', externalId: 'NTS-2' })

    expect(identityKey(first)).toBe('해석례|NTS-1')
    expect(identityKey(first)).not.toBe(identityKey(second))
  })

  it('같은 법령명이라도 조문번호가 다르면 다른 키다', () => {
    const a = makeLaw({ articleNumber: '제1조' })
    const b = makeLaw({ articleNumber: '제2조' })
    expect(identityKey(a)).not.toBe(identityKey(b))
  })
})

describe('mergeSearchItems — 순서 보존 병합 + 중복 제거', () => {
  it('목록 간 순서와 목록 내 순서를 모두 보존한다', () => {
    const q1 = [makeLaw({ articleNumber: '제1조' }), makeLaw({ articleNumber: '제2조' })]
    const q2 = [makeLaw({ articleNumber: '제3조' })]
    const merged = mergeSearchItems([q1, q2])
    expect(merged.map((l) => l.articleNumber)).toEqual(['제1조', '제2조', '제3조'])
  })

  it('여러 쿼리에 같은 자료가 있으면 처음 등장한 것만 남긴다(first-wins)', () => {
    const shared = makeLaw({ articleNumber: '제10조', articleTitle: '먼저' })
    const dupLater = makeLaw({ articleNumber: '제10조', articleTitle: '나중' })
    const q1 = [shared]
    const q2 = [dupLater, makeLaw({ articleNumber: '제20조' })]
    const merged = mergeSearchItems([q1, q2])
    expect(merged).toHaveLength(2)
    // 처음 등장한 항목(articleTitle '먼저')이 보존됨
    expect(merged[0].articleTitle).toBe('먼저')
    expect(merged[1].articleNumber).toBe('제20조')
  })

  it('비법령도 caseNumber 기준으로 중복 제거된다', () => {
    const t1 = makeLaw({ sourceType: '심판례', caseNumber: 'A', lawName: '조세심판원 결정례' })
    const t1dup = makeLaw({ sourceType: '심판례', caseNumber: 'A', lawName: '조세심판원 결정례' })
    const t2 = makeLaw({ sourceType: '심판례', caseNumber: 'B', lawName: '조세심판원 결정례' })
    const merged = mergeSearchItems([[t1], [t1dup, t2]])
    expect(merged.map((l) => l.caseNumber)).toEqual(['A', 'B'])
  })

  it('같은 caseNumber라도 externalId가 다르면 별도 자료로 유지한다', () => {
    const first = makeLaw({ sourceType: '해석례', caseNumber: '재산', externalId: 'NTS-1' })
    const second = makeLaw({ sourceType: '해석례', caseNumber: '재산', externalId: 'NTS-2' })

    expect(mergeSearchItems([[first], [second]])).toEqual([first, second])
  })

  it('빈 목록·빈 입력을 안전하게 처리한다', () => {
    expect(mergeSearchItems([])).toEqual([])
    expect(mergeSearchItems([[], []])).toEqual([])
  })

  it('원본 TaxLaw 객체를 변형하지 않는다(참조만 재배열)', () => {
    const law = makeLaw({ articleNumber: '제5조', content: '원문 그대로' })
    const merged = mergeSearchItems([[law]])
    // 같은 객체 참조가 그대로 유지되고 content가 변형되지 않음
    expect(merged[0]).toBe(law)
    expect(merged[0].content).toBe('원문 그대로')
  })
})
