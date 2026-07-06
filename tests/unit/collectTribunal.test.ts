/**
 * TAX-6B-18: 심판례 전량 수집기 순수 함수 단위 테스트
 *
 * 네트워크·파일시스템을 건드리지 않고 응답 파싱·매핑·키마스킹 규칙만 검증한다.
 * 가장 중요한 단언:
 *   ① content 원문 불변(CLAUDE.md §6.1 인용 무결성) — 주문+재결요지+이유 그대로 결합
 *   ② sourceUrl·로그에 OC(키) 미노출(CLAUDE.md §7)
 *   ③ 어댑터(nationalTaxLaw.ts) 실시간 경로와 동일한 TaxLaw 형태(벡터/실시간 일치)
 */
import { describe, it, expect } from 'vitest'
import {
  toIsoDateLoose,
  toTribunalSourceUrl,
  scrubOc,
  parseListPage,
  parseBody,
  parseReferencedDecisions,
  mapTribunalToTaxLaw,
  findDuplicateCaseNumbers,
  splitKnownNew,
  type TribunalListItem,
} from '../../scripts/collectTribunal'

// 실호출 형식을 본뜬 목록 응답(target=ttSpecialDecc, `{Decc:{decc:[]}}`)
const SAMPLE_LIST = {
  Decc: {
    totalCnt: '139791',
    decc: [
      {
        특별행정심판재결례일련번호: '401',
        청구번호: '조심 2020부1558',
        사건명: '양도소득세 부과처분 취소',
        의결일자: '2021.03.15',
        재결청: '조세심판원',
      },
      {
        특별행정심판재결례일련번호: '402',
        청구번호: '국심2004중3046',
        사건명: '부가가치세 경정 거부',
        의결일자: '2005.11.02',
        재결청: '조세심판원',
      },
    ],
  },
}

// 본문 응답(target=ttSpecialDecc, ID) — `{SpecialDeccService:{}}`
const SAMPLE_BODY = {
  SpecialDeccService: {
    청구번호: '조심 2020부1558',
    주문: '심판청구를 기각한다.',
    재결요지: '쟁점 부동산의 취득시기는 잔금청산일로 본다.',
    이유: '1. 처분개요\n청구인은 ...',
  },
}

describe('collectTribunal (TAX-6B-18 심판례 수집기 순수 함수)', () => {
  describe('toIsoDateLoose', () => {
    it('"YYYY.MM.DD"를 "YYYY-MM-DD"로 정규화한다', () => {
      expect(toIsoDateLoose('2021.03.15')).toBe('2021-03-15')
    })
    it('빈 값·해석 불가 값은 안전하게 처리한다', () => {
      expect(toIsoDateLoose('')).toBe('')
      expect(toIsoDateLoose('상시')).toBe('상시')
    })
  })

  describe('toTribunalSourceUrl (§7 키 미포함 링크)', () => {
    it('청구번호로 공개 뷰어 딥링크를 만들고 OC를 포함하지 않는다', () => {
      const url = toTribunalSourceUrl('조심 2020부1558')
      expect(url).toContain('/allDeccSc.do?query=')
      expect(url).not.toMatch(/OC=/i)
    })
    it('청구번호가 없으면 검색 진입 링크로 폴백한다', () => {
      expect(toTribunalSourceUrl('')).toBe('https://www.law.go.kr/allDeccSc.do')
    })
  })

  describe('scrubOc (§7 로그 키 마스킹)', () => {
    it('URL 내 OC 파라미터를 마스킹한다', () => {
      const masked = scrubOc('https://www.law.go.kr/DRF/lawService.do?OC=secret123&target=ttSpecialDecc')
      expect(masked).toContain('OC=***')
      expect(masked).not.toContain('secret123')
    })
  })

  describe('parseListPage', () => {
    it('totalCnt와 항목을 추출한다', () => {
      const { totalCnt, items } = parseListPage(SAMPLE_LIST)
      expect(totalCnt).toBe(139791)
      expect(items).toHaveLength(2)
      expect(items[0]).toMatchObject({
        seq: '401',
        caseNumber: '조심 2020부1558',
        caseName: '양도소득세 부과처분 취소',
        agency: '조세심판원',
      })
    })
    it('decc가 단건 객체여도 배열로 정규화한다', () => {
      const single = { Decc: { totalCnt: '1', decc: SAMPLE_LIST.Decc.decc[0] } }
      const { items } = parseListPage(single)
      expect(items).toHaveLength(1)
      expect(items[0].seq).toBe('401')
    })
    it('결과가 없으면 빈 배열을 반환한다', () => {
      expect(parseListPage({ Decc: { totalCnt: '0' } }).items).toEqual([])
      expect(parseListPage({}).items).toEqual([])
    })
  })

  describe('parseBody (§6.1 원문 그대로 결합)', () => {
    it('주문+재결요지+이유를 줄바꿈으로 원문 그대로 결합한다', () => {
      const content = parseBody(SAMPLE_BODY)
      expect(content).toBe(
        '심판청구를 기각한다.\n쟁점 부동산의 취득시기는 잔금청산일로 본다.\n1. 처분개요\n청구인은 ...',
      )
    })
    it('일부 필드 누락 시 있는 것만 결합한다', () => {
      const content = parseBody({ SpecialDeccService: { 주문: '기각한다.' } })
      expect(content).toBe('기각한다.')
    })
    it('본문 미제공 시 빈 문자열을 반환한다', () => {
      expect(parseBody({})).toBe('')
      expect(parseBody({ SpecialDeccService: {} })).toBe('')
    })
  })

  describe('parseReferencedDecisions (TAX-6B-37 참조결정, §6.1 무가공)', () => {
    it('참조결정 필드를 trim만 적용해 원문 그대로 반환한다', () => {
      const ref = parseReferencedDecisions({
        SpecialDeccService: { 참조결정: '  조심2022서1437 / 조심2016부3139 / 조심2023서9833  ' },
      })
      expect(ref).toBe('조심2022서1437 / 조심2016부3139 / 조심2023서9833')
    })
    it('참조결정이 없거나 빈 값이면 빈 문자열을 반환한다', () => {
      expect(parseReferencedDecisions({ SpecialDeccService: { 참조결정: '' } })).toBe('')
      expect(parseReferencedDecisions({ SpecialDeccService: {} })).toBe('')
      expect(parseReferencedDecisions({})).toBe('')
    })
    it('content(주문/재결요지/이유)와 독립적으로 파싱한다', () => {
      // 같은 응답에서 content와 참조결정이 서로 영향을 주지 않는다
      const body = {
        SpecialDeccService: { 주문: '기각한다.', 참조결정: '조심2020부1558' },
      }
      expect(parseBody(body)).toBe('기각한다.')
      expect(parseReferencedDecisions(body)).toBe('조심2020부1558')
    })
  })

  describe('mapTribunalToTaxLaw (어댑터 toTribunalTaxLaw와 동일 매핑)', () => {
    const item: TribunalListItem = {
      seq: '401',
      caseNumber: '조심 2020부1558',
      caseName: '양도소득세 부과처분 취소',
      decidedAt: '2021.03.15',
      agency: '조세심판원',
    }

    it('심판례 T3 TaxLaw로 매핑한다', () => {
      const law = mapTribunalToTaxLaw(item, parseBody(SAMPLE_BODY))
      expect(law).toMatchObject({
        sourceType: '심판례',
        trustTier: 'T3',
        articleNumber: '',
        enforcementDate: '',
        caseNumber: '조심 2020부1558',
        issuingBody: '조세심판원',
        articleTitle: '양도소득세 부과처분 취소',
        decisionDate: '2021-03-15',
        revisionDate: '2021-03-15',
        lawName: '조세심판원 조심 2020부1558',
      })
    })

    it('content를 원문 그대로 보존한다(§6.1)', () => {
      const content = parseBody(SAMPLE_BODY)
      const law = mapTribunalToTaxLaw(item, content)
      expect(law.content).toBe(content) // 변형 0
    })

    it('sourceUrl에 OC(키)를 포함하지 않는다(§7)', () => {
      const law = mapTribunalToTaxLaw(item, '')
      expect(law.sourceUrl).not.toMatch(/OC=/i)
      expect(law.content).toBe('') // 본문 미제공 허용(참고 목록 후보)
    })

    it('재결청 누락 시 "조세심판원"으로 폴백한다', () => {
      const law = mapTribunalToTaxLaw({ ...item, agency: '' }, '')
      expect(law.issuingBody).toBe('조세심판원')
    })
  })

  describe('findDuplicateCaseNumbers (적재 전 V1 식별자 품질 게이트)', () => {
    const baseItem: TribunalListItem = {
      seq: '401',
      caseNumber: '조심 2020부1558',
      caseName: '양도소득세 부과처분 취소',
      decidedAt: '2021.03.15',
      agency: '조세심판원',
    }

    it('caseNumber가 모두 다르면 빈 배열을 반환한다', () => {
      const laws = [
        mapTribunalToTaxLaw(baseItem, '본문 A'),
        mapTribunalToTaxLaw({ ...baseItem, seq: '402', caseNumber: '국심2004중3046' }, '본문 B'),
      ]
      expect(findDuplicateCaseNumbers(laws)).toEqual([])
    })

    it('같은 caseNumber가 2건 이상이면 중복 리포트 항목을 반환한다', () => {
      const laws = [
        mapTribunalToTaxLaw(baseItem, '본문 A'),
        mapTribunalToTaxLaw({ ...baseItem, seq: '402', caseName: '같은 청구번호 후속 항목' }, '본문 B'),
        mapTribunalToTaxLaw({ ...baseItem, seq: '403', caseNumber: '국심2004중3046' }, '본문 C'),
      ]
      expect(findDuplicateCaseNumbers(laws)).toEqual([
        {
          caseNumber: '조심 2020부1558',
          count: 2,
          titles: ['양도소득세 부과처분 취소', '같은 청구번호 후속 항목'],
        },
      ])
    })

    it('caseNumber가 비어 있는 항목은 중복 판정에서 제외한다', () => {
      const laws = [
        mapTribunalToTaxLaw({ ...baseItem, seq: '401', caseNumber: '' }, '본문 A'),
        mapTribunalToTaxLaw({ ...baseItem, seq: '402', caseNumber: '' }, '본문 B'),
      ]
      expect(findDuplicateCaseNumbers(laws)).toEqual([])
    })
  })

  describe('splitKnownNew (TAX-6B-34 증분 수집 조기 종료 판정)', () => {
    const mk = (seq: string, caseNumber: string): TribunalListItem => ({
      seq,
      caseNumber,
      caseName: '사건명',
      decidedAt: '2026.07.01',
      agency: '조세심판원',
    })
    const emptySets = { caseNumbers: new Set<string>(), seqs: new Set<string>() }

    it('기지 caseNumber는 제외하고 신규만 남긴다', () => {
      const items = [mk('1', '조심 2026부0001'), mk('2', '조심 2026부0002')]
      const { fresh, knownCount } = splitKnownNew(items, {
        caseNumbers: new Set(['조심 2026부0001']),
        seqs: new Set<string>(),
      })
      expect(fresh.map((it) => it.seq)).toEqual(['2'])
      expect(knownCount).toBe(1)
    })

    it('페이지 전체가 기지면 fresh가 비어 조기 종료 조건이 된다', () => {
      const items = [mk('1', '조심 2026부0001'), mk('2', '조심 2026부0002')]
      const { fresh, knownCount } = splitKnownNew(items, {
        caseNumbers: new Set(['조심 2026부0001', '조심 2026부0002']),
        seqs: new Set<string>(),
      })
      expect(fresh).toEqual([])
      expect(knownCount).toBe(2)
    })

    it('seq 기지(원장에 이미 수집됨)도 제외한다 — 병합 사건번호 자가 치유 경로', () => {
      const items = [mk('1', '조심 2026부0001')]
      const { fresh } = splitKnownNew(items, {
        caseNumbers: new Set<string>(),
        seqs: new Set(['1']),
      })
      expect(fresh).toEqual([])
    })

    it('caseNumber 누락 항목은 seq로만 대조해 신규로 유지한다(놓침 방지)', () => {
      const items = [mk('1', '')]
      expect(splitKnownNew(items, emptySets).fresh).toHaveLength(1)
    })

    it('seq 누락 항목은 본문 조회 불가이므로 기지로 취급한다', () => {
      const items = [mk('', '조심 2026부0001')]
      const { fresh, knownCount } = splitKnownNew(items, emptySets)
      expect(fresh).toEqual([])
      expect(knownCount).toBe(1)
    })
  })
})
