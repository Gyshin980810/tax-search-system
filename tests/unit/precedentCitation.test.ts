import { describe, it, expect } from 'vitest'
import {
  normalizeCaseNumber,
  extractCitedCaseNumbers,
  buildCitationGraph,
} from '@/domain/precedentCitation'

describe('precedentCitation (TAX-6B-23 판례 인용 연결망)', () => {
  describe('normalizeCaseNumber', () => {
    it('모든 공백을 제거한다', () => {
      expect(normalizeCaseNumber('2001 두 4849')).toBe('2001두4849')
    })
    it('공백 없는 사건번호는 그대로 둔다', () => {
      expect(normalizeCaseNumber('2022두33507')).toBe('2022두33507')
    })
  })

  describe('extractCitedCaseNumbers', () => {
    it("표준 인용('대법원 … 선고 … 판결')에서 사건번호를 뽑는다", () => {
      const content = '대법원 2002. 11. 8. 선고 2001두4849 판결 참조'
      expect(extractCitedCaseNumbers(content)).toEqual(['2001두4849'])
    })

    it("결정('… 결정')도 인용으로 인식한다", () => {
      const content = '대법원 2010. 1. 14.자 2007마23200 결정'
      expect(extractCitedCaseNumbers(content)).toEqual(['2007마23200'])
    })

    it('여러 인용을 모두 추출하고 중복은 제거한다', () => {
      const content =
        '… 2001두4849 판결 … 2019두56333 판결 … 다시 2001두4849 판결'
      expect(extractCitedCaseNumbers(content)).toEqual(['2001두4849', '2019두56333'])
    })

    it('자기 자신의 사건번호는 제외한다(자기 인용 방지)', () => {
      const content = '본 2022두33507 판결 … 참조 2001두4849 판결'
      expect(extractCitedCaseNumbers(content, '2022두33507')).toEqual(['2001두4849'])
    })

    it("법령 표현('제11조의2')은 사건번호로 오인하지 않는다(오탐 차단)", () => {
      // '판결'/'결정' 맥락이 없으므로 추출되지 않아야 한다
      const content = '소득세법 제11조의2 제1항 제3호에 따라'
      expect(extractCitedCaseNumbers(content)).toEqual([])
    })

    it('연도 2자리 옛 사건번호도 인식한다', () => {
      const content = '대법원 1995. 5. 30. 선고 95누12345 판결'
      expect(extractCitedCaseNumbers(content)).toEqual(['95누12345'])
    })

    it('인용이 없으면 빈 배열을 반환한다', () => {
      expect(extractCitedCaseNumbers('인용이 전혀 없는 본문입니다.')).toEqual([])
    })
  })

  describe('buildCitationGraph', () => {
    const nodes = [
      // A는 B(코퍼스 내부)와 9999두1(코퍼스 외부)을 인용
      { caseNumber: '2020두100', content: '… 2020두200 판결 … 9999두1 판결' },
      // B는 인용 없음 (A에게 피인용만 됨)
      { caseNumber: '2020두200', content: '인용 없음' },
      // C는 B를 인용 → B 피인용 2회
      { caseNumber: '2020두300', content: '참조 2020두200 판결' },
    ]

    it('내부/외부 엣지를 정확히 분류한다', () => {
      const { stats } = buildCitationGraph(nodes)
      expect(stats.totalNodes).toBe(3)
      expect(stats.totalEdges).toBe(3) // A→B, A→외부, C→B
      expect(stats.internalEdges).toBe(2) // A→B, C→B
      expect(stats.externalEdges).toBe(1) // A→9999두1
    })

    it('내부 연결을 가진 노드 수와 밀도를 계산한다', () => {
      const { stats } = buildCitationGraph(nodes)
      // 내부 인용(out)을 가진 노드 = A, C → 2건
      expect(stats.nodesWithInternalEdge).toBe(2)
      expect(stats.internalDensity).toBeCloseTo(2 / 3)
    })

    it('피인용 상위(허브)를 내림차순으로 집계한다', () => {
      const { stats } = buildCitationGraph(nodes)
      expect(stats.topCited[0]).toEqual({ caseNumber: '2020두200', inDegree: 2 })
    })

    it('고립 노드(내부 인용·피인용 0)를 센다', () => {
      // 위 nodes엔 고립 노드 없음(A=out, B=in, C=out). 외부만 인용하는 고립 케이스 추가
      const withIsolated = [...nodes, { caseNumber: '2020두999', content: '오직 9999두2 판결만 인용' }]
      const { stats } = buildCitationGraph(withIsolated)
      expect(stats.isolatedNodes).toBe(1) // 2020두999
    })

    it('엣지 목록에 inCorpus 플래그가 정확히 표기된다', () => {
      const { edges } = buildCitationGraph(nodes)
      const external = edges.find((e) => e.to === '9999두1')
      expect(external?.inCorpus).toBe(false)
      const internal = edges.find((e) => e.from === '2020두100' && e.to === '2020두200')
      expect(internal?.inCorpus).toBe(true)
    })
  })
})
