/**
 * TAX-6A-5: 시점 모호성 감지 함수 단위 테스트
 *
 * page.tsx 내부의 hasAmbiguousTemporal 로직을 순수함수로 추출해 테스트.
 * CLAUDE.md §6.2 — 모호한 시점 표현 시 자의적 판단 금지, 시점 확인 요청.
 */
import { describe, it, expect } from 'vitest'

const AMBIGUOUS_PATTERNS = [
  '예전', '이전 법', '이전법', '개정 전', '개정전',
  '구 법', '구법', '종전', '과거 법령', '예전 법',
]

function hasAmbiguousTemporal(question: string): boolean {
  if (!AMBIGUOUS_PATTERNS.some((p) => question.includes(p))) return false
  return !/\d{4}년/.test(question)
}

describe('hasAmbiguousTemporal — 시점 모호성 감지', () => {
  it('모호 패턴 없는 질문 → false', () => {
    expect(hasAmbiguousTemporal('부가가치세 면세 대상은 무엇인가요?')).toBe(false)
  })

  it('"예전" 포함, 연도 없음 → true', () => {
    expect(hasAmbiguousTemporal('예전 소득세법에서 기본공제는 얼마였나요?')).toBe(true)
  })

  it('"이전 법" 포함, 연도 없음 → true', () => {
    expect(hasAmbiguousTemporal('이전 법 기준으로 설명해 주세요.')).toBe(true)
  })

  it('"개정 전" 포함, 연도 없음 → true', () => {
    expect(hasAmbiguousTemporal('개정 전 규정이 궁금합니다.')).toBe(true)
  })

  it('"구법" 포함, 연도 없음 → true', () => {
    expect(hasAmbiguousTemporal('구법 적용 여부를 알고 싶습니다.')).toBe(true)
  })

  it('"종전" 포함, 연도 없음 → true', () => {
    expect(hasAmbiguousTemporal('종전 규정에서는 어떻게 처리했나요?')).toBe(true)
  })

  it('"예전" 포함이지만 구체 연도(YYYY년) 있음 → false', () => {
    expect(hasAmbiguousTemporal('2020년 기준 예전 소득세법 공제 금액')).toBe(false)
  })

  it('"이전법" 포함이지만 구체 연도 있음 → false', () => {
    expect(hasAmbiguousTemporal('2018년 이전법 적용 여부')).toBe(false)
  })

  it('연도만 있고 모호 패턴 없음 → false', () => {
    expect(hasAmbiguousTemporal('2022년 법인세율은 얼마인가요?')).toBe(false)
  })
})
