/**
 * TAX-6B-20-A: 국세청 세법해석례(ntsCgmExpc) 본문 수집기 순수 함수 단위 테스트
 *
 * 네트워크·파일시스템을 건드리지 않고 응답 파싱·매핑·빈본문 가드만 검증한다.
 * 가장 중요한 단언:
 *   ① content 원문 불변(CLAUDE.md §6.1) — 요지+회신을 원문 그대로 결합(§4.3 방안①)
 *   ② sourceUrl에 OC(키) 미노출(CLAUDE.md §7)
 *   ③ 어댑터(nationalTaxLaw.ts) 실시간 경로와 동일한 TaxLaw 형태(벡터/실시간 일치)
 *   ④ 빈 문서·삭제된 문서를 본문으로 오적재하지 않음(hasSubstantiveTaxlawBody)
 *
 * fixture는 실제 taxlaw.nts.go.kr /action.do 프로브 응답(2026-07-08, 티켓 §2.2 실호출)의
 * 필드 구조를 그대로 본떴다.
 */
import { describe, it, expect } from 'vitest'
import {
  extractNtstDcmId,
  parseListPage,
  hasSubstantiveTaxlawBody,
  parseActionBody,
  toNtsExpcSourceUrl,
  mapNtsExpcToTaxLaw,
  type NtsExpcListItem,
} from '../../scripts/collectNtsInterpretations'
import { findDuplicateCaseNumbers } from '../../scripts/collectTribunal'

// 실호출 형식을 본뜬 목록 응답(target=ntsCgmExpc, `{CgmExpc:{cgmExpc:[]}}`)
const SAMPLE_LIST = {
  CgmExpc: {
    totalCnt: '136280',
    cgmExpc: [
      {
        법령해석일련번호: '83626',
        안건번호: '법인22601-2200',
        안건명: '1986사업연도분 가지급금 적수계산방법',
        해석일자: '1988.08.05',
        법령해석상세링크: 'https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=010000000000100201',
      },
      {
        법령해석일련번호: '83627',
        안건번호: '법인46012-123',
        안건명: '부당행위계산 부인 관련 질의',
        해석일자: '2005.11.02',
        법령해석상세링크: 'https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=010000000000100202',
      },
    ],
  },
}

// action.do 본문 응답(target=ASIQTB002PR01) — 실제 프로브 응답 구조 그대로(2026-07-08)
const SAMPLE_ACTION_BODY = {
  status: 'SUCCESS',
  message: '',
  data: {
    ASIQTB002PR01: {
      dcmDVO: {
        ntstDcmId: '010000000000100201',
        ntstDcmDscmCntn: '법인22601-2200',
        ntstDcmTtl: '1986사업연도분 가지급금 적수계산방법',
        ntstDcmGistCntn:
          '1986 사업연도분 가지급금 적수계산 시 당해사업연도의 경과일수는 당해사업연도 개시일로부터 종료일까지의 경과일수로 하는 것임',
        ntstDcmCntn:
          ' 귀 질의의 경우 법인세법시행령 부칙(대통령령 제11813호)제10조 제2항 제1호의 "당해사업연도의 경과일수"는 당해사업연도 개시일로부터 종료일까지의 경과일수로 하는 것임.',
        ntstDcmRgtDt: '19880805',
      },
      dcmHwpEditorDVOList: [{ dcmFleByte: '<html><body><p>전문 HTML(방안①에서는 미사용)</p></body></html>' }],
    },
  },
}

describe('collectNtsInterpretations (TAX-6B-20-A 세법해석례 본문 수집기 순수 함수)', () => {
  describe('extractNtstDcmId (법령해석상세링크 → taxlaw 크롤링 ID)', () => {
    it('상세링크에서 ntstDcmId(18자리)를 추출한다', () => {
      expect(
        extractNtstDcmId('https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=010000000000100201'),
      ).toBe('010000000000100201')
    })
    it('ntstDcmId가 없으면 빈 문자열을 반환한다', () => {
      expect(extractNtstDcmId('https://taxlaw.nts.go.kr/qt/USEQTA002P.do')).toBe('')
      expect(extractNtstDcmId('')).toBe('')
    })
  })

  describe('parseListPage', () => {
    it('totalCnt와 항목(ntstDcmId 포함)을 추출한다', () => {
      const { totalCnt, items } = parseListPage(SAMPLE_LIST)
      expect(totalCnt).toBe(136280)
      expect(items).toHaveLength(2)
      expect(items[0]).toMatchObject({
        serial: '83626',
        caseNumber: '법인22601-2200',
        caseName: '1986사업연도분 가지급금 적수계산방법',
        ntstDcmId: '010000000000100201',
      })
    })
    it('cgmExpc가 단건 객체여도 배열로 정규화한다', () => {
      const single = { CgmExpc: { totalCnt: '1', cgmExpc: SAMPLE_LIST.CgmExpc.cgmExpc[0] } }
      const { items } = parseListPage(single)
      expect(items).toHaveLength(1)
      expect(items[0].ntstDcmId).toBe('010000000000100201')
    })
    it('결과가 없으면 빈 배열을 반환한다', () => {
      expect(parseListPage({ CgmExpc: { totalCnt: '0' } }).items).toEqual([])
      expect(parseListPage({}).items).toEqual([])
    })
    it('상세링크가 없어 ntstDcmId를 추출하지 못하면 빈 문자열로 남긴다(호출부에서 필터링)', () => {
      const noLink = {
        CgmExpc: {
          totalCnt: '1',
          cgmExpc: { 법령해석일련번호: '1', 안건번호: 'X', 안건명: 'Y', 해석일자: '2020.01.01', 법령해석상세링크: '' },
        },
      }
      expect(parseListPage(noLink).items[0].ntstDcmId).toBe('')
    })
  })

  describe('hasSubstantiveTaxlawBody (빈본문·삭제 문서 가드)', () => {
    it('20자 이상 실질 내용이면 true', () => {
      expect(hasSubstantiveTaxlawBody('귀 질의의 경우 법인세법시행령 부칙 제10조에 따라 처리하는 것임.')).toBe(true)
    })
    it('20자 미만이면 false', () => {
      expect(hasSubstantiveTaxlawBody('짧은 내용')).toBe(false)
    })
    it('"내용없음"류 문구가 포함되면 false(길이와 무관)', () => {
      expect(hasSubstantiveTaxlawBody('조회된 내용이 없습니다. '.repeat(3))).toBe(false)
      expect(hasSubstantiveTaxlawBody('본문없음 '.repeat(10))).toBe(false)
    })
  })

  describe('parseActionBody (§4.3 방안① — 요지+회신 원문 결합, §6.1)', () => {
    it('요지(ntstDcmGistCntn)와 회신(ntstDcmCntn)을 줄바꿈으로 원문 그대로 결합한다', () => {
      const content = parseActionBody(SAMPLE_ACTION_BODY)
      expect(content).toBe(
        [
          SAMPLE_ACTION_BODY.data.ASIQTB002PR01.dcmDVO.ntstDcmGistCntn,
          SAMPLE_ACTION_BODY.data.ASIQTB002PR01.dcmDVO.ntstDcmCntn,
        ].join('\n'),
      )
    })
    it('HWP 전문(dcmHwpEditorDVOList)은 방안①에서 쓰지 않는다', () => {
      const content = parseActionBody(SAMPLE_ACTION_BODY)
      expect(content).not.toContain('<html>')
      expect(content).not.toContain('전문 HTML')
    })
    it('요지와 회신이 완전히 같으면 중복 결합하지 않는다(공식 API 중복 사례 방어)', () => {
      const dup = {
        data: {
          ASIQTB002PR01: {
            dcmDVO: {
              ntstDcmGistCntn: '동일한 내용의 해석 결과를 요지에 그대로 담은 문서 사례',
              ntstDcmCntn: '동일한 내용의 해석 결과를 요지에 그대로 담은 문서 사례',
            },
          },
        },
      }
      expect(parseActionBody(dup)).toBe('동일한 내용의 해석 결과를 요지에 그대로 담은 문서 사례')
    })
    it('dcmDVO가 없거나 내용이 빈약하면 빈 문자열을 반환한다', () => {
      expect(parseActionBody({})).toBe('')
      expect(parseActionBody({ data: {} })).toBe('')
      expect(
        parseActionBody({
          data: { ASIQTB002PR01: { dcmDVO: { ntstDcmGistCntn: '내용없음', ntstDcmCntn: '' } } },
        }),
      ).toBe('')
    })
  })

  describe('toNtsExpcSourceUrl (§7 키 미포함 링크)', () => {
    it('법령해석상세링크를 그대로 반환한다(이미 키 없는 공개 링크)', () => {
      const url = toNtsExpcSourceUrl('https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=010000000000100201')
      expect(url).toBe('https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=010000000000100201')
      expect(url).not.toMatch(/OC=/i)
    })
    it('만일 OC 파라미터가 섞여 있으면 제거한다(방어적)', () => {
      const url = toNtsExpcSourceUrl('https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=1&OC=secret')
      expect(url).not.toMatch(/OC=/i)
    })
    it('유효한 링크가 없으면 taxlaw 홈으로 폴백한다', () => {
      expect(toNtsExpcSourceUrl('')).toBe('https://taxlaw.nts.go.kr/')
    })
  })

  describe('mapNtsExpcToTaxLaw (어댑터 toNtsInterpretationTaxLaw와 동일 매핑 + content 채움)', () => {
    const item: NtsExpcListItem = {
      serial: '83626',
      caseNumber: '법인22601-2200',
      caseName: '1986사업연도분 가지급금 적수계산방법',
      decidedAt: '1988.08.05',
      detailLink: 'https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=010000000000100201',
      ntstDcmId: '010000000000100201',
    }

    it('해석례 T3 TaxLaw로 매핑한다', () => {
      const law = mapNtsExpcToTaxLaw(item, parseActionBody(SAMPLE_ACTION_BODY))
      expect(law).toMatchObject({
        sourceType: '해석례',
        trustTier: 'T3',
        articleNumber: '',
        enforcementDate: '',
        caseNumber: '법인22601-2200',
        issuingBody: '국세청',
        articleTitle: '1986사업연도분 가지급금 적수계산방법',
        decisionDate: '1988-08-05',
        revisionDate: '1988-08-05',
        lawName: '국세청 법인22601-2200',
      })
    })

    it('content를 원문 그대로 보존한다(§6.1)', () => {
      const content = parseActionBody(SAMPLE_ACTION_BODY)
      expect(mapNtsExpcToTaxLaw(item, content).content).toBe(content)
    })

    it('sourceUrl에 OC(키)를 포함하지 않는다(§7)', () => {
      const law = mapNtsExpcToTaxLaw(item, '')
      expect(law.sourceUrl).not.toMatch(/OC=/i)
      expect(law.content).toBe('') // 본문 미제공 허용(참고 목록 후보)
    })
  })

  describe('findDuplicateCaseNumbers 재사용(적재 전 V1 식별자 품질 게이트, collectTribunal과 공유)', () => {
    const baseItem: NtsExpcListItem = {
      serial: '83626',
      caseNumber: '법인22601-2200',
      caseName: '가지급금 적수계산방법',
      decidedAt: '1988.08.05',
      detailLink: 'https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=010000000000100201',
      ntstDcmId: '010000000000100201',
    }

    it('안건번호가 모두 다르면 빈 배열을 반환한다', () => {
      const laws = [
        mapNtsExpcToTaxLaw(baseItem, '본문 A'),
        mapNtsExpcToTaxLaw({ ...baseItem, ntstDcmId: '2', caseNumber: '법인46012-123' }, '본문 B'),
      ]
      expect(findDuplicateCaseNumbers(laws)).toEqual([])
    })

    it('같은 안건번호가 2건 이상이면 중복 리포트 항목을 반환한다', () => {
      const laws = [
        mapNtsExpcToTaxLaw(baseItem, '본문 A'),
        mapNtsExpcToTaxLaw({ ...baseItem, ntstDcmId: '2', caseName: '같은 안건번호 후속 항목' }, '본문 B'),
      ]
      expect(findDuplicateCaseNumbers(laws)).toEqual([
        {
          caseNumber: '법인22601-2200',
          count: 2,
          titles: ['가지급금 적수계산방법', '같은 안건번호 후속 항목'],
        },
      ])
    })
  })
})
