/**
 * @vitest-environment node
 *
 * TAX-6B-28: "직접 근거(법령 본문)를 찾지 못했습니다" 고지 코드 안전망 단위 테스트
 *
 * 배경: 죽은 라벨-값 프롬프트를 정리하면서, 전체 T3·T4(직접 근거 부재) 시 고지가
 *       프롬프트가 아니라 코드로 보장되도록 ensureNoDirectBasisDisclosure로 승격.
 *       기존 downgradeT3T4DirectCitations의 빈틈(LLM이 처음부터 🟡로 올바르게 붙이면
 *       고지 미보장)을 코드가 메운다.
 */
import { describe, it, expect } from 'vitest'
import { ensureNoDirectBasisDisclosure } from '@/adapters/llmAnswerGenerator'
import type { Citation } from '@/domain/Citation'
import type { TaxLaw } from '@/domain/TaxLaw'

const PREFIX = '직접 근거(법령 본문)를 찾지 못했습니다.'

function makeCitation(tier: TaxLaw['trustTier']): Citation {
  return {
    taxLaw: {
      sourceType: tier === 'T1' || tier === 'T2' ? '법령' : '심판례',
      lawName: '조세심판원 결정례',
      articleNumber: '',
      articleTitle: '쟁점',
      content: '내용',
      revisionDate: '',
      enforcementDate: '',
      sourceUrl: 'https://example.com',
      trustTier: tier,
      caseNumber: 'A1',
    },
    label: '🟡유사사례',
    excerpt: '발췌',
    temporalLabel: '[결정: 2020.01.01]',
  }
}

describe('ensureNoDirectBasisDisclosure — 직접 근거 부재 고지 안전망', () => {
  it('[핵심 빈틈] 전체 T3, LLM이 올바르게 🟡, matchStage=direct → 고지 자동 부착', () => {
    const summary = '유사 사례에서는 쟁점 비용이 손금으로 인정되었습니다.'
    const result = ensureNoDirectBasisDisclosure([makeCitation('T3')], summary, 'direct')
    expect(result.startsWith(PREFIX)).toBe(true)
    expect(result).toContain(summary) // 원문 뒤에 그대로 이어짐
  })

  it('[T1 존재] T1·T2가 하나라도 있으면 고지를 붙이지 않는다', () => {
    const summary = '법인세법 제19조에 따라 손금에 산입됩니다.'
    const result = ensureNoDirectBasisDisclosure(
      [makeCitation('T1'), makeCitation('T3')],
      summary,
      'direct',
    )
    expect(result).toBe(summary)
  })

  it('[expanded 스킵] matchStage=expanded는 downgradeVectorLabels가 처리하므로 관여하지 않는다', () => {
    const summary = '유사 사례 요약'
    const result = ensureNoDirectBasisDisclosure([makeCitation('T4')], summary, 'expanded')
    expect(result).toBe(summary)
  })

  it('[멱등] 이미 고지로 시작하면 중복 부착하지 않는다', () => {
    const summary = `${PREFIX} 유사 사례 요약`
    const result = ensureNoDirectBasisDisclosure([makeCitation('T3')], summary, 'direct')
    expect(result).toBe(summary)
  })

  it('[멱등2] "직접 근거를 찾지 못했습니다" 변형 고지로 시작해도 중복 부착 안 함', () => {
    const summary = '직접 근거를 찾지 못했습니다. 유사 사례만 있습니다.'
    const result = ensureNoDirectBasisDisclosure([makeCitation('T3')], summary, 'direct')
    expect(result).toBe(summary)
  })

  it('[빈 citations 무관여] citations가 비면 [summary 규칙]에 맡기고 손대지 않는다', () => {
    const summary = '검토할 자료가 없습니다.'
    const result = ensureNoDirectBasisDisclosure([], summary, 'direct')
    expect(result).toBe(summary)
  })

  it('[matchStage 미지정] undefined(비-fallback 경로)에서도 전체 T3면 고지 부착', () => {
    const summary = '유사 사례 요약'
    const result = ensureNoDirectBasisDisclosure([makeCitation('T3')], summary, undefined)
    expect(result.startsWith(PREFIX)).toBe(true)
  })
})
