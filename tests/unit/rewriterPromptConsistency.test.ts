/**
 * 쿼리 변환 SYSTEM_PROMPT 내부 정합성 가드 (TAX-6B-27)
 *
 * 배경: 규칙 3의 "10자 이내" 상한이 규칙 6~8(TAX-042G 축 결합) 및 그 예시(11~16자)와
 *       모순되어, LLM이 상한을 지키려 축 결합을 깨뜨리는 재현율 저하가 있었다.
 *
 * 이 테스트는 프롬프트가 다시 모순 상태로 회귀하지 않도록 다음을 잠근다:
 *   (1) 자체 예시가 위반하는 하드 글자수 상한("N자 이내")이 없다.
 *   (2) 축 결합(법리축+사실축) 지침은 그대로 유지된다(정답 기준 불변).
 */
import { describe, it, expect } from 'vitest'
import { SYSTEM_PROMPT } from '@/adapters/llmQueryRewriter'

describe('llmQueryRewriter SYSTEM_PROMPT 정합성 (TAX-6B-27)', () => {
  it('(1) 자체 예시가 위반하는 하드 글자수 상한("N자 이내")이 없다', () => {
    // "10자 이내", "8자 이내" 같은 숫자 글자수 상한 패턴을 금지.
    expect(SYSTEM_PROMPT).not.toMatch(/\d+\s*자\s*이내/)
  })

  it('(2) 축 결합(법리축+사실축) 지침은 유지된다 — 재현율 기준 불변', () => {
    expect(SYSTEM_PROMPT).toContain('법리축')
    expect(SYSTEM_PROMPT).toContain('사실축')
    // TAX-042G 축 결합 예시가 그대로 살아 있어야 한다.
    expect(SYSTEM_PROMPT).toContain('양도소득세 비과세 1세대1주택')
  })

  it('(3) 프롬프트가 스스로 모순되지 않는다 — 예시 키워드가 명시 상한을 위반하지 않음', () => {
    // 명시적 "N자 이내" 상한이 있다면, 프롬프트에 등장하는 모든 따옴표 예시가
    // 그 상한을 지켜야 한다. 상한이 없으면(현재 정책) 자동 통과.
    const limitMatch = SYSTEM_PROMPT.match(/(\d+)\s*자\s*이내/)
    if (limitMatch) {
      const limit = Number(limitMatch[1])
      const examples = [...SYSTEM_PROMPT.matchAll(/"([^"]+)"/g)].map((m) => m[1])
      const violating = examples.filter((ex) => ex.length > limit)
      expect(violating).toEqual([])
    } else {
      expect(limitMatch).toBeNull()
    }
  })
})
