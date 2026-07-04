/**
 * TAX-6B-35: 세법 판례 증분 수집기 순수 함수 단위 테스트
 *
 * 네트워크·파일시스템을 건드리지 않고 응답 파싱·정규화·매핑 규칙만 검증한다.
 * 가장 중요한 단언:
 *   ① content 원문 불변(CLAUDE.md §6.1) — 판시사항+판결요지 그대로 결합
 *   ② sourceUrl·로그에 OC(키) 미노출(CLAUDE.md §7)
 *   ③ 사건번호 표기 이원성("2025두36013" vs "대법원-2025-두-34754") 정규화 —
 *      content_hash가 판례 dedup에 무력하므로(TAX-6B-35 §중복 방지) 이 정규화가 유일한 안전망
 */
import { describe, it, expect } from 'vitest'
import {
  TAX_LAW_JO_BASE,
  buildJoQueries,
  parsePrecListPage,
  normalizeCaseTokens,
  isKnownCase,
  isCourtSource,
  toPrecSourceUrl,
  parsePrecBody,
  mapPrecedentToTaxLaw,
  type PrecListItem,
} from '../../scripts/collectPrecedent'

// 실호출 형식을 본뜬 목록 응답(target=prec, `{PrecSearch:{prec:[]}}`) — 2026-07-04 프로브 필드 기준
const SAMPLE_LIST = {
  PrecSearch: {
    totalCnt: '1521',
    prec: [
      {
        판례일련번호: '250001',
        사건번호: '2025두36013',
        사건명: '법인세부과처분등취소',
        선고일자: '2026.04.30',
        법원명: '대법원',
        데이터출처명: '법원',
        사건종류명: '세무',
      },
      {
        판례일련번호: '250002',
        사건번호: '2025다210837',
        사건명: '부당이득금',
        선고일자: '2026.04.30',
        법원명: '대법원',
        데이터출처명: '법원',
        사건종류명: '민사',
      },
      {
        판례일련번호: '250003',
        사건번호: '대법원-2025-두-34754',
        사건명: '보유주식을 배우자에게 증여',
        선고일자: '2026.03.12',
        법원명: '',
        데이터출처명: '국세법령정보시스템',
        사건종류명: '일반행정',
      },
    ],
  },
}

// 본문 응답(target=prec, ID) — `{PrecService:{}}`
const SAMPLE_BODY = {
  PrecService: {
    사건번호: '2025두36013',
    판시사항: '[1] 부당행위계산 부인의 요건',
    판결요지: '[1] 특수관계인 간 거래가 경제적 합리성을 결여한 경우 ...',
  },
}

describe('collectPrecedent (TAX-6B-35 판례 증분 수집기 순수 함수)', () => {
  describe('buildJoQueries (회계사 확정: 국세 8법 + 지방세 3법, 각 시행령 포함)', () => {
    it('11개 세법 × (법률+시행령) = 22개 JO 질의를 만든다', () => {
      const queries = buildJoQueries()
      expect(TAX_LAW_JO_BASE).toHaveLength(11)
      expect(queries).toHaveLength(22)
      expect(queries).toContain('법인세법')
      expect(queries).toContain('법인세법 시행령')
      expect(queries).toContain('지방세특례제한법 시행령')
    })
  })

  describe('parsePrecListPage', () => {
    it('totalCnt와 항목을 추출한다', () => {
      const { totalCnt, items } = parsePrecListPage(SAMPLE_LIST)
      expect(totalCnt).toBe(1521)
      expect(items).toHaveLength(3)
      expect(items[0]).toMatchObject({
        seq: '250001',
        caseNumber: '2025두36013',
        caseName: '법인세부과처분등취소',
        court: '대법원',
        dataSource: '법원',
        caseType: '세무',
      })
    })
    it('prec이 단건 객체여도 배열로 정규화한다', () => {
      const single = { PrecSearch: { totalCnt: '1', prec: SAMPLE_LIST.PrecSearch.prec[0] } }
      const { items } = parsePrecListPage(single)
      expect(items).toHaveLength(1)
      expect(items[0].seq).toBe('250001')
    })
    it('결과가 없으면 빈 배열을 반환한다', () => {
      expect(parsePrecListPage({ PrecSearch: { totalCnt: '0' } }).items).toEqual([])
      expect(parsePrecListPage({}).items).toEqual([])
    })
  })

  describe('normalizeCaseTokens (사건번호 표기 이원성 흡수 — 판례 dedup의 유일한 안전망)', () => {
    it('법원 표기("2025두36013")를 그대로 토큰화한다', () => {
      expect(normalizeCaseTokens('2025두36013')).toEqual(['2025두36013'])
    })
    it('국세법령정보시스템 표기("대법원-2025-두-34754")를 동일 토큰으로 정규화한다', () => {
      expect(normalizeCaseTokens('대법원-2025-두-34754')).toEqual(['2025두34754'])
      // 하이픈 없는 접두 표기("대법원2024두34641")도 동일 규칙
      expect(normalizeCaseTokens('대법원2024두34641')).toEqual(['2024두34641'])
    })
    it('병합 사건은 토큰을 모두 추출한다 (DB 실측 표기 기준)', () => {
      expect(normalizeCaseTokens('2013구합59576, 2014구합67529(병합)')).toEqual([
        '2013구합59576',
        '2014구합67529',
      ])
    })
    it('패턴이 없으면 빈 배열을 반환한다', () => {
      expect(normalizeCaseTokens('')).toEqual([])
      expect(normalizeCaseTokens('사건번호 미상')).toEqual([])
    })
  })

  describe('isKnownCase', () => {
    const known = new Set(['2025두36013', '2014구합67529'])
    it('표기가 달라도 정규화 토큰이 일치하면 기지로 판정한다', () => {
      expect(isKnownCase('대법원-2025-두-36013', known)).toBe(true)
    })
    it('병합 사건은 토큰 하나만 일치해도 기지로 판정한다(중복 적재 방지 우선)', () => {
      expect(isKnownCase('2013구합59576, 2014구합67529(병합)', known)).toBe(true)
    })
    it('토큰이 전부 미지이거나 추출 불가면 신규로 판정한다', () => {
      expect(isKnownCase('2026두10001', known)).toBe(false)
      expect(isKnownCase('', known)).toBe(false)
    })
  })

  describe('isCourtSource (본문 제공 여부 — 어댑터 searchPrecedents와 동일 판정)', () => {
    it('국세법령정보시스템 출처만 본문 미제공으로 판정한다', () => {
      expect(isCourtSource('법원')).toBe(true)
      expect(isCourtSource('국세법령정보시스템')).toBe(false)
      expect(isCourtSource('')).toBe(true)
    })
  })

  describe('parsePrecBody (§6.1 원문 그대로 결합)', () => {
    it('판시사항+판결요지를 줄바꿈으로 원문 그대로 결합한다', () => {
      expect(parsePrecBody(SAMPLE_BODY)).toBe(
        '[1] 부당행위계산 부인의 요건\n[1] 특수관계인 간 거래가 경제적 합리성을 결여한 경우 ...',
      )
    })
    it('일부 필드 누락 시 있는 것만 결합한다', () => {
      expect(parsePrecBody({ PrecService: { 판결요지: '요지만 있음' } })).toBe('요지만 있음')
    })
    it('본문 미제공 시 빈 문자열을 반환한다', () => {
      expect(parsePrecBody({})).toBe('')
      expect(parsePrecBody({ PrecService: {} })).toBe('')
    })
  })

  describe('mapPrecedentToTaxLaw (어댑터 toPrecedentTaxLaw와 동일 매핑)', () => {
    const item: PrecListItem = {
      seq: '250001',
      caseNumber: '2025두36013',
      caseName: '법인세부과처분등취소',
      decidedAt: '2026.04.30',
      court: '대법원',
      dataSource: '법원',
      caseType: '세무',
    }

    it('판례 T4 TaxLaw로 매핑한다', () => {
      const law = mapPrecedentToTaxLaw(item, parsePrecBody(SAMPLE_BODY))
      expect(law).toMatchObject({
        sourceType: '판례',
        trustTier: 'T4',
        articleNumber: '',
        enforcementDate: '',
        caseNumber: '2025두36013',
        issuingBody: '대법원',
        articleTitle: '법인세부과처분등취소',
        decisionDate: '2026-04-30',
        revisionDate: '2026-04-30',
        lawName: '대법원 2025두36013',
      })
    })

    it('content를 원문 그대로 보존한다(§6.1)', () => {
      const content = parsePrecBody(SAMPLE_BODY)
      expect(mapPrecedentToTaxLaw(item, content).content).toBe(content) // 변형 0
    })

    it('sourceUrl은 키 없는 공개 뷰어 링크다(§7)', () => {
      const law = mapPrecedentToTaxLaw(item, '')
      expect(law.sourceUrl).toBe(toPrecSourceUrl('250001'))
      expect(law.sourceUrl).toContain('/precInfoP.do?precSeq=250001')
      expect(law.sourceUrl).not.toMatch(/OC=/i)
    })

    it('법원명 누락 시 데이터출처명을 issuingBody로, 사건번호를 lawName으로 쓴다', () => {
      const law = mapPrecedentToTaxLaw(
        { ...item, court: '', dataSource: '국세법령정보시스템' },
        '',
      )
      expect(law.issuingBody).toBe('국세법령정보시스템')
      expect(law.lawName).toBe('2025두36013')
      expect(law.content).toBe('') // 본문 미제공 허용(참고 목록 후보)
    })
  })
})
