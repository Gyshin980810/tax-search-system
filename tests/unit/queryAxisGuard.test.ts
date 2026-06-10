/**
 * queryAxisGuard 단위 테스트 (TAX-042G)
 *
 * 광범위 키워드 거버넌스의 책임별 검증:
 *   - isTooBroad: LEGAL_AXIS_BROAD 셋 / "~법" 패턴 / 좁은 키워드 무변경
 *   - extractFactAxisTokens: STOPWORDS·LEGAL_AXIS_NOISE 제거, 유니크 순서 유지
 *   - enforceAxisCombination: 광범위 보강 / 좁은 무변경 / 사실축 0개 시 원본 / 길이 보존
 */
import { describe, it, expect } from 'vitest'
import {
  isTooBroad,
  extractFactAxisTokens,
  enforceAxisCombination,
} from '@/adapters/queryAxisGuard'
import type { SearchQuery } from '@/domain/SearchQuery'

const REQUESTED_AT = new Date('2026-06-07T00:00:00Z')

function makeQuery(keyword: string): SearchQuery {
  return { keyword, requestedAt: REQUESTED_AT }
}

describe('isTooBroad — 광범위 키워드 판정', () => {
  it('"법인세법" 단독은 광범위 (LEGAL_AXIS_BROAD)', () => {
    expect(isTooBroad('법인세법')).toBe(true)
  })

  it('"법인세 시행령" 단독은 광범위', () => {
    expect(isTooBroad('법인세 시행령')).toBe(true)
  })

  it('"법인세법 시행령" 단독도 광범위', () => {
    expect(isTooBroad('법인세법 시행령')).toBe(true)
  })

  it('"~법" 패턴 단독은 광범위 (정규식)', () => {
    expect(isTooBroad('관세법')).toBe(true)
  })

  it('"법인세법 손비" 같이 결합된 키워드는 좁음', () => {
    expect(isTooBroad('법인세법 손비')).toBe(false)
  })

  it('"손비"·"접대비" 같은 짧은 사실축 단독은 광범위로 보지 않음', () => {
    expect(isTooBroad('손비')).toBe(false)
    expect(isTooBroad('접대비')).toBe(false)
  })

  it('빈 문자열·공백은 광범위 아님 (false-safe)', () => {
    expect(isTooBroad('')).toBe(false)
    expect(isTooBroad('   ')).toBe(false)
  })
})

describe('extractFactAxisTokens — 질문에서 사실축 토큰 추출', () => {
  it('STOPWORDS("관련", "여부", "알려줘") 제거', () => {
    const tokens = extractFactAxisTokens('법인세법 손비 관련 여부 알려줘')
    expect(tokens).toContain('손비')
    expect(tokens).not.toContain('관련')
    expect(tokens).not.toContain('여부')
    expect(tokens).not.toContain('알려줘')
  })

  it('LEGAL_AXIS_NOISE("법인세", "세금") 제거', () => {
    const tokens = extractFactAxisTokens('법인세 접대비 손금산입 한도')
    expect(tokens).not.toContain('법인세')
    expect(tokens).toContain('접대비')
    expect(tokens).toContain('손금산입')
    expect(tokens).toContain('한도')
  })

  it('LEGAL_AXIS_BROAD("법인세법") 자체도 사실축에서 제외', () => {
    const tokens = extractFactAxisTokens('법인세법 손비 부인')
    expect(tokens).not.toContain('법인세법')
    expect(tokens).toContain('손비')
    expect(tokens).toContain('부인')
  })

  it('2자 미만 토큰 제거', () => {
    const tokens = extractFactAxisTokens('가 손비 나')
    expect(tokens).toEqual(['손비'])
  })

  it('등장 순서 유지, 중복 제거', () => {
    const tokens = extractFactAxisTokens('손비 손비 접대비 손비')
    expect(tokens).toEqual(['손비', '접대비'])
  })

  it('빈 문자열은 빈 배열', () => {
    expect(extractFactAxisTokens('')).toEqual([])
  })
})

describe('enforceAxisCombination — 광범위 보강', () => {
  it('"법인세법" 단독 → "법인세법 손비 부인"으로 보강 (상위 2개)', () => {
    const queries = [makeQuery('법인세법')]
    const result = enforceAxisCombination(queries, '법인세법 손비 부인 가능 여부')
    expect(result).toHaveLength(1)
    expect(result[0].keyword).toBe('법인세법 손비 부인')
  })

  it('"법인세 시행령" 광범위도 동일 패턴으로 보강', () => {
    const queries = [makeQuery('법인세 시행령')]
    const result = enforceAxisCombination(queries, '법인세 시행령 접대비 한도')
    expect(result[0].keyword).toBe('법인세 시행령 접대비 한도')
  })

  it('이미 좁은 키워드("법인세법 손비")는 무변경', () => {
    const queries = [makeQuery('법인세법 손비')]
    const result = enforceAxisCombination(queries, '법인세법 손비 관련')
    expect(result[0].keyword).toBe('법인세법 손비')
  })

  it('사실축 0개(질문에 사실축 없음) → 원본 그대로 (회귀 0건 보장)', () => {
    const queries = [makeQuery('법인세법')]
    const result = enforceAxisCombination(queries, '법인세법 관련 알려줘')
    expect(result[0].keyword).toBe('법인세법')
  })

  it('배열 길이·순서·requestedAt 보존', () => {
    const queries = [
      makeQuery('법인세법'),
      makeQuery('손비 항목'),
      makeQuery('법인세 시행령'),
    ]
    const result = enforceAxisCombination(queries, '법인세법 손비 부인 사례')
    expect(result).toHaveLength(3)
    expect(result[1].keyword).toBe('손비 항목')
    expect(result[0].requestedAt).toBe(REQUESTED_AT)
    expect(result[2].requestedAt).toBe(REQUESTED_AT)
  })

  it('빈 배열 입력은 빈 배열 반환 (안전)', () => {
    const result = enforceAxisCombination([], '법인세법 손비')
    expect(result).toEqual([])
  })

  it('보강 시 사실축이 이미 키워드에 포함되어 있으면 중복 부착 회피', () => {
    const queries = [makeQuery('법인세법 손비')]
    const result = enforceAxisCombination(queries, '법인세법 손비 부인')
    expect(result[0].keyword).toBe('법인세법 손비')
  })
})
