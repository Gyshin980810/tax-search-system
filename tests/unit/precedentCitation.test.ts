import { describe, it, expect } from 'vitest'
import {
  normalizeCaseNumber,
  normalizeTribunalCaseNumber,
  extractCitedCaseNumbers,
  buildCitationGraph,
  extractCitedTribunalNumbers,
  extractTribunalSelfId,
  splitBracketGroups,
  classifyCitationEdge,
  extractCitedDate,
  extractSnippet,
  parseReferencedCitations,
  findReversalSignals,
  parseReviewTable,
  classifyReviewVerdict,
  parseDocCell,
  parseOverruledTarget,
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

describe('precedentCitation (TAX-6B-31 인용 엣지 추출·분류)', () => {
  describe('extractCitedTribunalNumbers', () => {
    it('기관 접두(조심/국심/감심)가 붙은 심판례 번호를 추출한다', () => {
      const content = '(조심 2022서1437, 같은 뜻임) 및 국심2019중0088 참조'
      expect(extractCitedTribunalNumbers(content)).toEqual(['조심2022서1437', '국심2019중0088'])
    })

    it("'제' 유무·공백 변형을 모두 흡수한다", () => {
      const content = '조심 제2020부1234 결정'
      expect(extractCitedTribunalNumbers(content)).toEqual(['조심2020부1234'])
    })

    it('기관 접두 없는 숫자열은 매칭하지 않는다(오탐 차단)', () => {
      // '2022서1437'만 있고 기관 접두가 없으면 심판례 인용으로 보지 않는다
      const content = '2022서1437 사건에서'
      expect(extractCitedTribunalNumbers(content)).toEqual([])
    })

    it('자기 자신의 사건번호는 제외한다', () => {
      const content = '본 조심2022서1437 건은 조심 2019중0088 을 따른다'
      expect(extractCitedTribunalNumbers(content, '조심2022서1437')).toEqual(['조심2019중0088'])
    })

    it('본문의 0 없는 일련번호를 4자리로 0채움한다(DB 표기 통일)', () => {
      // 본문 '조심 2018지166' ↔ DB '조심2018지0166' 표기 차이 흡수
      const content = '조세심판원도 같이 판단한 바 있다(조심 2018지166, 같은 뜻임)'
      expect(extractCitedTribunalNumbers(content)).toEqual(['조심2018지0166'])
    })

    it('0채움된 자기 사건번호와 0 없는 본문 표기를 같은 사건으로 보고 제외한다', () => {
      const content = '본 건(조심 2022서1437)은 조심 2019중88 을 따른다'
      expect(extractCitedTribunalNumbers(content, '조심2022서1437')).toEqual(['조심2019중0088'])
    })
  })

  describe('normalizeTribunalCaseNumber', () => {
    it('일련번호를 4자리로 0채움한다', () => {
      expect(normalizeTribunalCaseNumber('조심 2018지166')).toBe('조심2018지0166')
      expect(normalizeTribunalCaseNumber('국심 2004서735')).toBe('국심2004서0735')
    })

    it('이미 4자리 이상이면 그대로 둔다', () => {
      expect(normalizeTribunalCaseNumber('조심2022서1437')).toBe('조심2022서1437')
      expect(normalizeTribunalCaseNumber('조심2023인10080')).toBe('조심2023인10080')
    })

    it('심판례 패턴이 아니면 공백 제거만 적용한다', () => {
      expect(normalizeTribunalCaseNumber('2001 두 4849')).toBe('2001두4849')
    })
  })

  describe('extractTribunalSelfId', () => {
    it('lawName에서 자기 심판례 사건번호를 추출한다', () => {
      expect(extractTribunalSelfId('조세심판원 조심 2026중1364')).toBe('조심2026중1364')
    })
    it('심판례 패턴이 없으면 null을 반환한다', () => {
      expect(extractTribunalSelfId('대법원 2002두9537 판결')).toBeNull()
    })
  })

  describe('splitBracketGroups', () => {
    it('괄호 (…) 단위로 그룹을 자르고 원문 인덱스를 보존한다', () => {
      const content = 'AAA (첫째 그룹) BBB (둘째 그룹) CCC'
      const groups = splitBracketGroups(content)
      expect(groups.map((g) => g.text)).toEqual(['첫째 그룹', '둘째 그룹'])
      // start/end로 원문을 다시 잘랐을 때 괄호까지 포함해 일치
      expect(content.slice(groups[0].start, groups[0].end + 1)).toBe('(첫째 그룹)')
    })

    it('미종결·불균형 괄호는 보수적으로 스킵한다(오탐 < 누락)', () => {
      expect(splitBracketGroups('열린 괄호 (닫히지 않음').map((g) => g.text)).toEqual([])
      expect(splitBracketGroups('짝 없는 ) 닫힘').map((g) => g.text)).toEqual([])
    })
  })

  describe('classifyCitationEdge (§2.4 사슬 인용 오분류 방지)', () => {
    it("'같은 뜻임'은 FOLLOWS로 분류한다", () => {
      expect(classifyCitationEdge('대법원 2002두9537 판결, 같은 뜻임')).toBe('FOLLOWS')
    })
    it("'원심판결'·'환송'은 APPEAL로 분류한다(선례 인용과 분리)", () => {
      expect(classifyCitationEdge('원심판결 2024누39327')).toBe('APPEAL')
      expect(classifyCitationEdge('환송 후 원심 2023누1234')).toBe('APPEAL')
    })
    it("'참조'·무표지는 REFERS(기본값)로 분류한다", () => {
      expect(classifyCitationEdge('대법원 2003두7392 판결 등 참조')).toBe('REFERS')
      expect(classifyCitationEdge('대법원 2003두7392 판결')).toBe('REFERS')
    })
    it('원심 신호가 같은 뜻임보다 우선한다(원심 오인 방지)', () => {
      // 극히 드물지만 두 신호가 섞이면 APPEAL이 이긴다(같은 사건 심급을 선례로 오인 금지)
      expect(classifyCitationEdge('환송판결과 같은 뜻임')).toBe('APPEAL')
    })
    it('사슬 인용: 그룹 끝 관용구를 그룹 내 모든 인용에 동일 적용한다', () => {
      // §2.4 실측: 앞쪽 인용의 관용구를 놓쳐 FOLLOWS를 REFERS로 오분류하던 6.2% 케이스
      const group =
        '대법원 2005.1.28. 선고 2002두2871 판결, 대법원 2023.11.16. 선고 2023두50004 판결, 같은 뜻임'
      const cited = extractCitedCaseNumbers(group)
      const type = classifyCitationEdge(group)
      // 그룹 안 두 인용 모두 같은 관계(FOLLOWS)로 판정돼야 한다
      expect(cited).toEqual(['2002두2871', '2023두50004'])
      expect(type).toBe('FOLLOWS')
    })
  })

  describe('extractCitedDate', () => {
    it("'YYYY. MM. DD. 선고' 날짜를 ISO로 파싱한다", () => {
      expect(extractCitedDate('대법원 2005. 1. 28. 선고 2002두2871 판결')).toBe('2005-01-28')
    })
    it('공백 없는 표기도 파싱한다', () => {
      expect(extractCitedDate('대법원 2023.11.16. 선고 2023두50004')).toBe('2023-11-16')
    })
    it('선고일이 없으면 null을 반환한다', () => {
      expect(extractCitedDate('대법원 2003두7392 판결 참조')).toBeNull()
    })
  })

  describe('extractSnippet (§6.1 원문 무결성)', () => {
    const content = '가나다라마바사아자차카타파하 대법원 2001두4849 판결 ABCDEFGHIJKLMNOP'
    it('발췌 결과는 항상 원문의 부분 문자열이다', () => {
      const idx = content.indexOf('2001두4849')
      const snippet = extractSnippet(content, idx, 10)
      expect(content.includes(snippet)).toBe(true)
    })
    it('경계에서도 원문 범위를 벗어나지 않는다', () => {
      expect(content.includes(extractSnippet(content, 0, 90))).toBe(true)
      expect(content.includes(extractSnippet(content, content.length, 90))).toBe(true)
    })
  })

  describe('parseReferencedCitations (참조판례 필드 정밀 파싱)', () => {
    it('법원명·선고일·사건번호를 인용 단위로 파싱한다', () => {
      const field =
        '대법원 1989. 7. 25. 선고 88누11926 판결(공1989, 1312), 대법원 2007. 2. 8. 선고 2006두4899 판결'
      expect(parseReferencedCitations(field)).toEqual([
        { caseNumber: '88누11926', court: '대법원', date: '1989-07-25' },
        { caseNumber: '2006두4899', court: '대법원', date: '2007-02-08' },
      ])
    })

    it('하급심 법원명(고등법원)도 파싱한다(충돌 14건 법원명 대조용)', () => {
      const field = '서울고등법원 1998. 3. 15. 선고 71구9 판결'
      expect(parseReferencedCitations(field)).toEqual([
        { caseNumber: '71구9', court: '서울고등법원', date: '1998-03-15' },
      ])
    })

    it("결정('자')도 파싱하고 중복 사건번호는 한 번만 담는다", () => {
      const field = '대법원 2010. 1. 14.자 2007마23200 결정, 대법원 2010. 1. 14.자 2007마23200 결정'
      expect(parseReferencedCitations(field)).toEqual([
        { caseNumber: '2007마23200', court: '대법원', date: '2010-01-14' },
      ])
    })

    it('빈 필드는 빈 배열을 반환한다', () => {
      expect(parseReferencedCitations('')).toEqual([])
    })
  })
})

describe('precedentCitation (TAX-6B-33 OVERRULED 검수 큐)', () => {
  describe('findReversalSignals', () => {
    it('전원합의체 신호를 탐지한다', () => {
      const content = '대법원 2013다61381 전원합의체 판결을 따른다'
      const signals = findReversalSignals(content)
      expect(signals.map((s) => s.signal)).toEqual(['전원합의체'])
    })

    it('판례변경 신호를 탐지한다', () => {
      const content = '종전 대법원 판례를 변경하는 취지의 판결이다'
      expect(findReversalSignals(content).map((s) => s.signal)).toEqual(['판례변경'])
    })

    it("'변경신고'는 판례변경으로 오인하지 않는다(오탐 차단, {0,6} 창 확인)", () => {
      // '판례'라는 단어 자체가 없으므로 매칭되지 않아야 한다
      const content = '부가가치세 변경신고를 하였다'
      expect(findReversalSignals(content)).toEqual([])
    })

    it('견해변경·배치범위변경 신호도 탐지한다', () => {
      const a = findReversalSignals('종전 견해를 변경하기로 한다')
      const b = findReversalSignals('이 판결에 배치되는 범위에서 이를 변경하기로 한다')
      expect(a.map((s) => s.signal)).toEqual(['견해변경'])
      expect(b.map((s) => s.signal)).toEqual(['배치범위변경'])
    })

    it('여러 신호를 등장 순서대로 반환한다', () => {
      const content = '전원합의체 판결로 종전 판례를 변경한다'
      const signals = findReversalSignals(content)
      expect(signals.map((s) => s.signal)).toEqual(['전원합의체', '판례변경'])
      expect(signals[0].index).toBeLessThan(signals[1].index)
    })

    it('신호 위치는 extractSnippet과 함께 써도 항상 원문 부분 문자열이다(§6.1)', () => {
      const content = '가나다라마바사 대법원 전원합의체 판결을 따른다 ABCDEFGHIJ'
      const [signal] = findReversalSignals(content)
      const snippet = extractSnippet(content, signal.index, 10)
      expect(content.includes(snippet)).toBe(true)
    })

    it('신호가 없으면 빈 배열을 반환한다', () => {
      expect(findReversalSignals('아무 신호도 없는 본문입니다.')).toEqual([])
    })
  })

  describe('parseReviewTable', () => {
    const header =
      '| # | 문서(사건번호) | 신호 | 원문 발췌 | 검수 결과 | 뒤집은 주체 | 뒤집힌 대상 |\n' +
      '|---|---|---|---|---|---|---|\n'

    it('확정(판례→판례) 행을 파싱한다', () => {
      const table = header + '| 1 | 심판례 조심2026중1148 | 전원합의체 | "발췌" | 확정(판례→판례) | 대법원 | 2008두150 |\n'
      const { rows, errors } = parseReviewTable(table)
      expect(errors).toEqual([])
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        no: 1,
        caseNumber: '심판례 조심2026중1148',
        verdict: '확정(판례→판례)',
        overruledBy: '대법원',
        overruledTarget: '2008두150',
      })
    })

    it('빈칸(미검수) 행도 정상 파싱한다(스킵 대상이지 오류 아님)', () => {
      const table = header + '| 1 | 판례 88누11926 | 전원합의체 | "발췌" |  |  |  |\n'
      const { rows, errors } = parseReviewTable(table)
      expect(errors).toEqual([])
      expect(rows[0].verdict).toBe('')
    })

    it('해당없음·보류 행도 정상 파싱한다', () => {
      const table =
        header +
        '| 1 | 판례 88누11926 | 전원합의체 | "발췌1" | 해당없음 |  |  |\n' +
        '| 2 | 판례 99누22222 | 판례변경 | "발췌2" | 보류 |  |  |\n'
      const { rows, errors } = parseReviewTable(table)
      expect(errors).toEqual([])
      expect(rows.map((r) => r.verdict)).toEqual(['해당없음', '보류'])
    })

    it('허용되지 않은 검수 결과 값은 오류로 보고한다(오타 차단)', () => {
      // 화살표를 ASCII '->'로 잘못 입력한 오타 사례
      const table = header + '| 1 | 판례 88누11926 | 전원합의체 | "발췌" | 확정(판례->판례) |  |  |\n'
      const { rows, errors } = parseReviewTable(table)
      expect(rows).toEqual([])
      expect(errors).toHaveLength(1)
      expect(errors[0].reason).toContain('확정(판례->판례)')
    })

    it('헤더·구분선 행은 데이터로 취급하지 않는다', () => {
      const { rows, errors } = parseReviewTable(header)
      expect(rows).toEqual([])
      expect(errors).toEqual([])
    })
  })

  describe('classifyReviewVerdict', () => {
    it('확정(판례→판례)는 apply로 분류한다', () => {
      expect(classifyReviewVerdict('확정(판례→판례)')).toBe('apply')
    })
    it('확정(입법→판례)는 superseded_by_law로 분류한다', () => {
      expect(classifyReviewVerdict('확정(입법→판례)')).toBe('superseded_by_law')
    })
    it('해당없음·보류·빈칸은 모두 skip으로 분류한다', () => {
      expect(classifyReviewVerdict('해당없음')).toBe('skip')
      expect(classifyReviewVerdict('보류')).toBe('skip')
      expect(classifyReviewVerdict('')).toBe('skip')
    })
  })

  describe('parseDocCell', () => {
    it('판례/심판례 접두 셀을 종류·사건번호로 분해한다', () => {
      expect(parseDocCell('판례 88누11926')).toEqual({ docType: '판례', caseNumber: '88누11926' })
      expect(parseDocCell('심판례 조심2022서1437')).toEqual({ docType: '심판례', caseNumber: '조심2022서1437' })
    })
    it('심판례 사건번호의 일련번호를 4자리로 0채움한다', () => {
      expect(parseDocCell('심판례 조심2018지166')).toEqual({ docType: '심판례', caseNumber: '조심2018지0166' })
    })
    it('알 수 없는 접두는 null을 반환한다(반영 차단)', () => {
      expect(parseDocCell('법령 소득세법')).toBeNull()
    })
    it('공백이 없는 셀은 null을 반환한다', () => {
      expect(parseDocCell('88누11926')).toBeNull()
    })
  })

  describe('parseOverruledTarget', () => {
    it('조심/국심/감심 접두는 심판례로 추정한다', () => {
      expect(parseOverruledTarget('조심2022서1437')).toEqual({ docType: '심판례', caseNumber: '조심2022서1437' })
    })
    it('접두가 없으면 판례로 간주한다', () => {
      expect(parseOverruledTarget('2008두150')).toEqual({ docType: '판례', caseNumber: '2008두150' })
    })
    it('빈 문자열은 null을 반환한다', () => {
      expect(parseOverruledTarget('')).toBeNull()
      expect(parseOverruledTarget('   ')).toBeNull()
    })
  })
})
