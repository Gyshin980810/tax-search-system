/**
 * @vitest-environment node
 *
 * TAX-010h: NationalTaxLawAdapter 통합 테스트 (MSW 모킹)
 * 실제 외부 API를 호출하지 않고, MSW로 응답을 인터셉트합니다.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse, delay } from 'msw'
import { NationalTaxLawAdapter } from '@/adapters/nationalTaxLaw'
import { searchTaxLaw } from '@/usecases/searchTaxLaw'
import { ApiTimeoutError } from '@/domain/errors'

// ─── 모킹 데이터 ────────────────────────────────────────────────────────────

const LAW_SEARCH_URL = 'https://www.law.go.kr/DRF/lawSearch.do'
const LAW_SERVICE_URL = 'https://www.law.go.kr/DRF/lawService.do'

const MOCK_LSI_SEQ = '276117'

const mockLawSearchResponse = {
  LawSearch: {
    resultCode: '00',
    totalCnt: '1',
    numOfRows: '5',
    page: '1',
    law: {
      법령일련번호: MOCK_LSI_SEQ,
      법령명한글: '부가가치세법',
      법령약칭명: '',
      법령구분명: '법률',
      공포일자: '20260101',
      시행일자: '20260101',
      공포번호: '21000',
    },
  },
}

function makeMockServiceResponse(articleCount: number) {
  return {
    법령: {
      기본정보: {
        법령명_한글: '부가가치세법',
        법종구분: { content: '법률' },
        공포일자: '20260101',
        시행일자: '20260101',
        법령ID: '001571',
      },
      조문: {
        조문단위: Array.from({ length: articleCount }, (_, i) => ({
          조문번호: i + 1,
          조문여부: '조문',
          조문시행일자: '20260101',
          조문내용: `제${i + 1}조(조문제목${i + 1}) 이 조문의 내용입니다.`,
          조문키: `key${i + 1}`,
        })),
      },
    },
  }
}

/** 정상 응답 핸들러 (12개 조문) */
const normalHandlers = [
  http.get(LAW_SEARCH_URL, () => HttpResponse.json(mockLawSearchResponse)),
  http.get(LAW_SERVICE_URL, () => HttpResponse.json(makeMockServiceResponse(12))),
]

// ─── 판례(target=prec) 모킹 — TAX-015 ──────────────────────────────────────

// 목록: 법원 출처 1건 + 국세 출처 1건(본문 미제공)
const mockPrecSearchResponse = {
  PrecSearch: {
    키워드: '손해배상',
    target: 'prec',
    prec: [
      {
        사건번호: '2020다288436',
        사건명: '손해배상(기)',
        선고일자: '2026.03.12',
        법원명: '대법원',
        데이터출처명: '대법원',
        판례일련번호: '618543',
        판례상세링크: '/DRF/lawService.do?OC=980810&target=prec&ID=618543&type=HTML&mobileYn=',
        사건종류명: '민사',
      },
      {
        사건번호: '인천지방법원-2025-구단-50403',
        사건명: '양도소득세 과세 적법',
        선고일자: '2026.04.14',
        법원명: '',
        데이터출처명: '국세법령정보시스템',
        판례일련번호: '618619',
        판례상세링크: '/DRF/lawService.do?OC=980810&target=prec&ID=618619&type=HTML&mobileYn=',
        사건종류명: '일반행정',
      },
    ],
  },
}

// 본문: 법원 출처(618543)만 제공, 국세 출처(618619)는 "없음" 응답
const mockPrecBody = {
  PrecService: {
    판시사항: '손해배상청구권의 성립 시기는 현실적으로 손해가 발생한 때이다.',
    판결요지: '예인비가 손해의 범위에 포함되는지는 특별한 사정을 심리해야 한다.',
    법원명: '대법원',
    사건번호: '2020다288436',
    선고일자: '20260312',
    사건명: '손해배상(기)',
  },
}
const mockPrecBodyNotFound = { Law: '일치하는 판례가 없습니다.  판례명을 확인하여 주십시오.' }

// ─── 법령해석례(target=expc) 모킹 — TAX-016A ────────────────────────────────

// 목록: 법령해석례 1건 (기재부 질의 → 법제처 회신)
const mockExpcSearchResponse = {
  Expc: {
    resultCode: '00',
    target: 'expc',
    expc: [
      {
        안건명: '양도소득세 비과세 대상 여부',
        안건번호: '12-0368',
        회신기관명: '법제처',
        질의기관명: '기획재정부',
        회신일자: '2026.02.20',
        법령해석례일련번호: '313499',
        법령해석례상세링크: '/DRF/lawService.do?OC=980810&target=expc&ID=313499&type=HTML&mobileYn=',
      },
    ],
  },
}

// 본문: 질의요지 + 회답 + 이유 제공
const mockExpcBody = {
  ExpcService: {
    안건명: '양도소득세 비과세 대상 여부',
    안건번호: '12-0368',
    해석기관명: '법제처',
    해석일자: '2026.02.20',
    질의기관명: '기획재정부',
    질의요지: '양도소득세 비과세 대상에 해당하는지 여부',
    회답: '비과세 대상에 해당한다.',
    이유: '관련 법령 규정에 따르면 해당 자산은 비과세 요건을 충족한다.',
  },
}

// ─── 국세청 법령해석(target=ntsCgmExpc) 모킹 — TAX-016B ──────────────────────
// 목록만 제공(본문 없음). 상세링크는 taxlaw.nts.go.kr 공개 뷰어(OC 키 미포함).
const mockNtsExpcSearchResponse = {
  CgmExpc: {
    resultCode: '00',
    totalCnt: '343',
    cgmExpc: [
      {
        id: 1,
        안건명: '가지급금 인정이자 계산방법',
        해석기관코드: '1210000',
        법령해석상세링크: 'https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=010000000000100201',
        안건번호: '법인22601-2200',
        법령해석일련번호: '107476',
        질의기관명: '',
        해석기관명: '국세청',
        해석일자: '2024.08.05',
        질의기관코드: '',
        데이터기준일시: '2025.02.22',
      },
    ],
  },
}

// ─── 조세심판원 결정례(target=ttSpecialDecc) 모킹 — TAX-016C ──────────────────
// 목록 래퍼는 일반 decc와 동일(`{Decc:{decc:[]}}`)이나 재결청='조세심판원'. 본문 제공.
const mockTtSpecialSearchResponse = {
  Decc: {
    resultCode: '00',
    totalCnt: '7257',
    decc: [
      {
        id: 1,
        특별행정심판재결례일련번호: '105794',
        사건명: '쟁점농지 양도소득세 과세처분의 당부',
        청구번호: '조심 2020부1558',
        처분일자: '',
        의결일자: '2020.06.16',
        처분청: '',
        재결청: '조세심판원',
        재결구분명: '조세',
        재결구분코드: '429150',
        // ⚠️ 상세링크는 OC(키) 포함 — 어댑터가 청구번호 검색 딥링크로 재구성해야 함
        행정심판재결례상세링크: '/DRF/lawService.do?OC=980810&target=ttSpecialDecc&ID=105794&type=HTML&mobileYn=',
        데이터기준일시: '2024.12.18',
      },
    ],
  },
}

// 본문: 주문 + 재결요지 + 이유 제공 (발췌 인용 대상)
const mockTtSpecialBody = {
  SpecialDeccService: {
    재결청: '조세심판원',
    사건명: '쟁점농지 양도소득세 과세처분의 당부',
    청구번호: '',
    주문: '심판청구를 기각한다.',
    재결요지: '조특법 제69조 제1항 단서에 따라 비과세 대상에 해당하지 않는다.',
    이유: '1. 처분개요 청구인은 쟁점농지를 양도하고 양도소득세를 신고하였다. 처분청은 감면 대상이 아니라고 보아 과세하였다.',
    세목: '양도',
    관련법령: '「조세특례제한법」 제69조',
    의결일자: '20200616',
    특별행정심판재결례일련번호: '105794',
  },
}

/** target 쿼리로 법령/해석례/판례를 분기하는 핸들러 */
const lawAndPrecHandlers = [
  http.get(LAW_SEARCH_URL, ({ request }) => {
    const target = new URL(request.url).searchParams.get('target')
    if (target === 'prec') return HttpResponse.json(mockPrecSearchResponse)
    if (target === 'expc') return HttpResponse.json(mockExpcSearchResponse)
    if (target === 'ntsCgmExpc') return HttpResponse.json(mockNtsExpcSearchResponse)
    if (target === 'ttSpecialDecc') return HttpResponse.json(mockTtSpecialSearchResponse)
    return HttpResponse.json(mockLawSearchResponse)
  }),
  http.get(LAW_SERVICE_URL, ({ request }) => {
    const url = new URL(request.url)
    const target = url.searchParams.get('target')
    if (target === 'prec') {
      // 판례 본문 — 법원 출처(618543)만 본문 제공
      const id = url.searchParams.get('ID')
      return HttpResponse.json(id === '618543' ? mockPrecBody : mockPrecBodyNotFound)
    }
    if (target === 'expc') return HttpResponse.json(mockExpcBody)
    if (target === 'ttSpecialDecc') return HttpResponse.json(mockTtSpecialBody)
    return HttpResponse.json(makeMockServiceResponse(12))
  }),
]

// ─── MSW 서버 설정 ──────────────────────────────────────────────────────────

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

// ─── 시나리오 1: 정상 응답 ─────────────────────────────────────────────────

describe('NationalTaxLawAdapter 통합 테스트 (MSW)', () => {

  it('[정상] 부가가치세 검색 시 10건 이상 결과를 반환한다', async () => {
    server.use(...normalHandlers)

    const adapter = new NationalTaxLawAdapter()
    const result = await searchTaxLaw(adapter, '부가가치세')

    expect(result.items.length).toBeGreaterThanOrEqual(10)
    expect(result.totalCount).toBe(12)
  })

  it('[정상] 모든 결과에 sourceUrl이 포함된다', async () => {
    server.use(...normalHandlers)

    const adapter = new NationalTaxLawAdapter()
    const result = await searchTaxLaw(adapter, '부가가치세')

    result.items.forEach(item => {
      expect(item.sourceUrl).toBeTruthy()
      expect(item.sourceUrl).toContain('https://www.law.go.kr')
      // API 키 미포함 확인
      expect(item.sourceUrl).not.toContain('OC=')
    })
  })

  it('[정렬] 동일 쿼리 2회 호출 시 동일 순서로 반환한다 (결정론성)', async () => {
    server.use(...normalHandlers)

    // 같은 키워드로 두 번 호출해 실제 결정론성을 검증
    const adapter1 = new NationalTaxLawAdapter()
    const result1 = await searchTaxLaw(adapter1, '결정론테스트')

    server.use(...normalHandlers)
    const adapter2 = new NationalTaxLawAdapter()
    const result2 = await searchTaxLaw(adapter2, '결정론테스트')

    const nums1 = result1.items.map(i => i.articleNumber)
    const nums2 = result2.items.map(i => i.articleNumber)
    expect(nums1).toEqual(nums2)
  })

  it('[정렬] 조문번호가 오름차순으로 정렬된다 (동일 날짜 조건)', async () => {
    server.use(...normalHandlers)

    const adapter = new NationalTaxLawAdapter()
    const result = await searchTaxLaw(adapter, '부가가치세')

    const numbers = result.items
      .map(i => parseInt(i.articleNumber.replace(/[^0-9]/g, '') || '0', 10))
      .filter(n => n > 0)

    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i]).toBeGreaterThanOrEqual(numbers[i - 1])
    }
  })

  // ─── 시나리오 2: 타임아웃 ─────────────────────────────────────────────

  it('[타임아웃] API 무응답 시 ApiTimeoutError를 throw한다', async () => {
    server.use(
      http.get(LAW_SEARCH_URL, async () => {
        await delay('infinite')
        return HttpResponse.json({})
      }),
    )

    const adapter = new NationalTaxLawAdapter()
    await expect(searchTaxLaw(adapter, '타임아웃테스트')).rejects.toBeInstanceOf(ApiTimeoutError)
  }, 10000)

  // ─── 시나리오 3: 빈 결과 ─────────────────────────────────────────────

  it('[빈결과] 법령 검색 결과가 없으면 items [], totalCount 0을 반환한다', async () => {
    server.use(
      http.get(LAW_SEARCH_URL, () =>
        HttpResponse.json({
          LawSearch: { resultCode: '00', totalCnt: '0', numOfRows: '5', page: '1' },
        }),
      ),
    )

    const adapter = new NationalTaxLawAdapter()
    const result = await searchTaxLaw(adapter, '존재하지않는키워드XYZ')

    expect(result.items).toEqual([])
    expect(result.totalCount).toBe(0)
  })

  // ─── 시나리오 4: 판례 병합 (TAX-015) ──────────────────────────────────
  describe('판례 검색 병합 (TAX-015)', () => {
    it('[병합] 법령과 판례를 함께 반환하고, 판례는 법령 뒤에 온다', async () => {
      server.use(...lawAndPrecHandlers)

      const adapter = new NationalTaxLawAdapter()
      const result = await searchTaxLaw(adapter, '손해배상_병합')

      const laws = result.items.filter((i) => i.sourceType === '법령')
      const precs = result.items.filter((i) => i.sourceType === '판례')
      expect(laws.length).toBeGreaterThan(0)
      // TAX-015B: 법원 출처(본문 있음) + 국세 출처(본문 없음) 모두 포함
      expect(precs.length).toBe(2)

      // 법령(직접 근거)이 판례(유사 사례)보다 앞에 위치
      const lastLawIdx = result.items.map((i) => i.sourceType).lastIndexOf('법령')
      const firstPrecIdx = result.items.findIndex((i) => i.sourceType === '판례')
      expect(lastLawIdx).toBeLessThan(firstPrecIdx)
    })

    it('[판례] 법원 출처 판례는 본문·메타·T4·키없는 링크를 가진다', async () => {
      server.use(...lawAndPrecHandlers)

      const adapter = new NationalTaxLawAdapter()
      const result = await searchTaxLaw(adapter, '손해배상_메타')

      // TAX-015B: 본문 없는 국세 출처 판례도 함께 반환되며 선고일↓ 정렬상 더 최근
      //  판례가 앞에 올 수 있다. 이 테스트의 대상은 "법원 출처 판례"이므로
      //  사건번호로 대법원 판례를 명시적으로 지목한다(첫 판례 가정 금지).
      const prec = result.items.find(
        (i) => i.sourceType === '판례' && i.caseNumber === '2020다288436',
      )
      expect(prec).toBeDefined()
      expect(prec!.trustTier).toBe('T4')
      expect(prec!.caseNumber).toBe('2020다288436')
      expect(prec!.issuingBody).toBe('대법원')
      expect(prec!.decisionDate).toBe('2026-03-12')
      expect(prec!.content).toContain('손해배상청구권의 성립 시기')
      // 원문 링크에 API 키(OC) 미포함 (CLAUDE.md §7)
      expect(prec!.sourceUrl).not.toContain('OC=')
      expect(prec!.sourceUrl).toContain('precInfoP.do')
    })

    it('[참고] 국세 출처 판례(본문 미제공)도 메타와 함께 포함되되 content는 비어있다 (TAX-015B)', async () => {
      server.use(...lawAndPrecHandlers)

      const adapter = new NationalTaxLawAdapter()
      const result = await searchTaxLaw(adapter, '손해배상_참고')

      const noBodyPrec = result.items.find(
        (i) => i.sourceType === '판례' && i.caseNumber === '인천지방법원-2025-구단-50403',
      )
      // 과거 TAX-015에선 제외됐으나, TAX-015B부터 참고 목록 대상으로 포함한다.
      expect(noBodyPrec).toBeDefined()
      expect(noBodyPrec!.content).toBe('') // 본문 미제공 → 빈 문자열(발췌 인용 불가)
      expect(noBodyPrec!.sourceUrl).toContain('precInfoP.do') // 원문 링크는 제공
      expect(noBodyPrec!.sourceUrl).not.toContain('OC=') // API 키 미노출 (CLAUDE.md §7)
    })

    it('[부분실패] 판례 검색이 실패해도 법령 결과는 반환된다', async () => {
      server.use(
        http.get(LAW_SEARCH_URL, ({ request }) => {
          const target = new URL(request.url).searchParams.get('target')
          if (target === 'prec') return HttpResponse.error() // 판례 검색만 실패
          return HttpResponse.json(mockLawSearchResponse)
        }),
        http.get(LAW_SERVICE_URL, () => HttpResponse.json(makeMockServiceResponse(12))),
      )

      const adapter = new NationalTaxLawAdapter()
      const result = await searchTaxLaw(adapter, '부분실패테스트')

      expect(result.items.filter((i) => i.sourceType === '법령').length).toBeGreaterThan(0)
      expect(result.items.filter((i) => i.sourceType === '판례').length).toBe(0)
    })
  })

  // ─── 시나리오 5: 법령해석례 병합 (TAX-016A) ──────────────────────────────
  describe('법령해석례 검색 (TAX-016A)', () => {
    it('[해석례] 법령해석례는 목록·메타·T3·키없는 링크를 가진다 (TAX-6B-19: 본문 미조회)', async () => {
      server.use(...lawAndPrecHandlers)

      const adapter = new NationalTaxLawAdapter()
      const result = await searchTaxLaw(adapter, '양도소득세_해석례')

      const expc = result.items.find((i) => i.sourceType === '해석례')
      expect(expc).toBeDefined()
      expect(expc!.trustTier).toBe('T3')
      expect(expc!.caseNumber).toBe('12-0368')          // 안건번호 = V1 식별자
      expect(expc!.issuingBody).toBe('법제처')           // 회신기관
      expect(expc!.decisionDate).toBe('2026-02-20')      // 회신일자 정규화
      expect(expc!.articleTitle).toBe('양도소득세 비과세 대상 여부')
      // TAX-6B-19: 본문 조회 제거 — content는 항상 빈 문자열(참고 목록 트랙)
      expect(expc!.content).toBe('')
      // 본문은 원문 링크로 확인. API 키(OC) 미포함, 공개 뷰어 경로 (CLAUDE.md §7)
      expect(expc!.sourceUrl).not.toContain('OC=')
      expect(expc!.sourceUrl).toContain('expcInfoP.do')
    })

    it('[병합] Trust Tier 순으로 법령→해석례→판례 정렬된다', async () => {
      server.use(...lawAndPrecHandlers)

      const adapter = new NationalTaxLawAdapter()
      const result = await searchTaxLaw(adapter, '양도소득세_병합순서')

      const types = result.items.map((i) => i.sourceType)
      const lastLawIdx = types.lastIndexOf('법령')
      const firstExpcIdx = types.indexOf('해석례')
      const firstPrecIdx = types.indexOf('판례')

      // 법령(T1·T2) < 해석례(T3) < 판례(T4)
      expect(lastLawIdx).toBeLessThan(firstExpcIdx)
      expect(firstExpcIdx).toBeLessThan(firstPrecIdx)
    })

    it('[부분실패] 해석례 검색이 실패해도 법령·판례 결과는 반환된다', async () => {
      server.use(
        http.get(LAW_SEARCH_URL, ({ request }) => {
          const target = new URL(request.url).searchParams.get('target')
          if (target === 'expc') return HttpResponse.error()  // 해석례 검색만 실패
          if (target === 'prec') return HttpResponse.json(mockPrecSearchResponse)
          return HttpResponse.json(mockLawSearchResponse)
        }),
        http.get(LAW_SERVICE_URL, ({ request }) => {
          const url = new URL(request.url)
          if (url.searchParams.get('target') === 'prec') {
            const id = url.searchParams.get('ID')
            return HttpResponse.json(id === '618543' ? mockPrecBody : mockPrecBodyNotFound)
          }
          return HttpResponse.json(makeMockServiceResponse(12))
        }),
      )

      const adapter = new NationalTaxLawAdapter()
      const result = await searchTaxLaw(adapter, '해석례부분실패')

      expect(result.items.filter((i) => i.sourceType === '법령').length).toBeGreaterThan(0)
      expect(result.items.filter((i) => i.sourceType === '판례').length).toBeGreaterThan(0)
      expect(result.items.filter((i) => i.sourceType === '해석례').length).toBe(0)
    })
  })

  // ─── 시나리오 6: 국세청 법령해석 병합 (TAX-016B) ─────────────────────────
  describe('국세청 법령해석 검색 (TAX-016B)', () => {
    it('[국세청해석] 본문 없는 메타·T3·국세청 기관·키없는 링크를 가진다', async () => {
      server.use(...lawAndPrecHandlers)

      const adapter = new NationalTaxLawAdapter()
      const result = await searchTaxLaw(adapter, '가지급금_국세청해석')

      // 법제처 해석례(expc)와 같은 sourceType이지만 issuingBody='국세청'으로 구분
      const nts = result.items.find(
        (i) => i.sourceType === '해석례' && i.issuingBody === '국세청',
      )
      expect(nts).toBeDefined()
      expect(nts!.trustTier).toBe('T3')
      expect(nts!.caseNumber).toBe('법인22601-2200')          // 안건번호 = V1 식별자
      expect(nts!.decisionDate).toBe('2024-08-05')            // 해석일자 정규화
      expect(nts!.articleTitle).toBe('가지급금 인정이자 계산방법')
      // 국세청 해석은 본문 미제공 → content는 빈 문자열(발췌 인용 불가, 참고 목록 대상)
      expect(nts!.content).toBe('')
      // 원문 링크 = taxlaw.nts.go.kr 공개 뷰어, API 키(OC) 미포함 (CLAUDE.md §7)
      expect(nts!.sourceUrl).toContain('taxlaw.nts.go.kr')
      expect(nts!.sourceUrl).not.toContain('OC=')
    })

    it('[병합] 국세청 해석이 결과에 포함되고 판례보다 앞에 온다', async () => {
      server.use(...lawAndPrecHandlers)

      const adapter = new NationalTaxLawAdapter()
      const result = await searchTaxLaw(adapter, '가지급금_병합')

      const ntsIdx = result.items.findIndex(
        (i) => i.sourceType === '해석례' && i.issuingBody === '국세청',
      )
      const firstPrecIdx = result.items.findIndex((i) => i.sourceType === '판례')
      expect(ntsIdx).toBeGreaterThanOrEqual(0)
      expect(ntsIdx).toBeLessThan(firstPrecIdx) // 해석례(T3) < 판례(T4)
    })

    it('[부분실패] 국세청 해석 검색이 실패해도 법령·법제처 해석례는 반환된다', async () => {
      server.use(
        http.get(LAW_SEARCH_URL, ({ request }) => {
          const target = new URL(request.url).searchParams.get('target')
          if (target === 'ntsCgmExpc') return HttpResponse.error() // 국세청 해석만 실패
          if (target === 'expc') return HttpResponse.json(mockExpcSearchResponse)
          if (target === 'prec') return HttpResponse.json(mockPrecSearchResponse)
          return HttpResponse.json(mockLawSearchResponse)
        }),
        http.get(LAW_SERVICE_URL, ({ request }) => {
          const url = new URL(request.url)
          const target = url.searchParams.get('target')
          if (target === 'prec') {
            const id = url.searchParams.get('ID')
            return HttpResponse.json(id === '618543' ? mockPrecBody : mockPrecBodyNotFound)
          }
          if (target === 'expc') return HttpResponse.json(mockExpcBody)
          return HttpResponse.json(makeMockServiceResponse(12))
        }),
      )

      const adapter = new NationalTaxLawAdapter()
      const result = await searchTaxLaw(adapter, '국세청해석부분실패')

      expect(result.items.filter((i) => i.sourceType === '법령').length).toBeGreaterThan(0)
      // 법제처 해석례(expc)는 정상 반환
      expect(
        result.items.filter((i) => i.sourceType === '해석례' && i.issuingBody === '법제처').length,
      ).toBeGreaterThan(0)
      // 국세청 해석만 빠짐
      expect(
        result.items.filter((i) => i.sourceType === '해석례' && i.issuingBody === '국세청').length,
      ).toBe(0)
    })
  })

  // ─── 시나리오 7: 조세심판원 결정례 병합 (TAX-016C) ───────────────────────
  describe('조세심판원 결정례 검색 (TAX-016C)', () => {
    it('[심판례] 본문·메타·T3·조세심판원 기관·키없는 링크를 가진다', async () => {
      server.use(...lawAndPrecHandlers)

      const adapter = new NationalTaxLawAdapter()
      const result = await searchTaxLaw(adapter, '양도소득세_심판례')

      const tribunal = result.items.find((i) => i.sourceType === '심판례')
      expect(tribunal).toBeDefined()
      expect(tribunal!.trustTier).toBe('T3')
      expect(tribunal!.issuingBody).toBe('조세심판원')
      expect(tribunal!.caseNumber).toBe('조심 2020부1558')   // 청구번호 = V1 식별자
      expect(tribunal!.decisionDate).toBe('2020-06-16')       // 의결일자 정규화
      expect(tribunal!.articleTitle).toBe('쟁점농지 양도소득세 과세처분의 당부')
      // 본문 = 주문 + 재결요지 + 이유 (발췌 인용 대상, 원문 보존)
      expect(tribunal!.content).toContain('심판청구를 기각한다')
      expect(tribunal!.content).toContain('조특법 제69조')
      // 원문 링크 = 청구번호 검색 딥링크, API 키(OC) 미포함 (CLAUDE.md §7)
      expect(tribunal!.sourceUrl).not.toContain('OC=')
      expect(tribunal!.sourceUrl).toContain('allDeccSc.do')
    })

    it('[병합] 심판례는 법령보다 뒤, 판례보다 앞에 온다', async () => {
      server.use(...lawAndPrecHandlers)

      const adapter = new NationalTaxLawAdapter()
      const result = await searchTaxLaw(adapter, '양도소득세_심판병합')

      const types = result.items.map((i) => i.sourceType)
      const lastLawIdx = types.lastIndexOf('법령')
      const firstTribunalIdx = types.indexOf('심판례')
      const firstPrecIdx = types.indexOf('판례')
      expect(firstTribunalIdx).toBeGreaterThan(lastLawIdx) // 법령(T1·T2) < 심판례(T3)
      expect(firstTribunalIdx).toBeLessThan(firstPrecIdx)  // 심판례(T3) < 판례(T4)
    })

    it('[부분실패] 심판례 검색이 실패해도 법령·판례 결과는 반환된다', async () => {
      server.use(
        http.get(LAW_SEARCH_URL, ({ request }) => {
          const target = new URL(request.url).searchParams.get('target')
          if (target === 'ttSpecialDecc') return HttpResponse.error() // 심판례 검색만 실패
          if (target === 'prec') return HttpResponse.json(mockPrecSearchResponse)
          return HttpResponse.json(mockLawSearchResponse)
        }),
        http.get(LAW_SERVICE_URL, ({ request }) => {
          const url = new URL(request.url)
          if (url.searchParams.get('target') === 'prec') {
            const id = url.searchParams.get('ID')
            return HttpResponse.json(id === '618543' ? mockPrecBody : mockPrecBodyNotFound)
          }
          return HttpResponse.json(makeMockServiceResponse(12))
        }),
      )

      const adapter = new NationalTaxLawAdapter()
      const result = await searchTaxLaw(adapter, '심판례부분실패')

      expect(result.items.filter((i) => i.sourceType === '법령').length).toBeGreaterThan(0)
      expect(result.items.filter((i) => i.sourceType === '판례').length).toBeGreaterThan(0)
      expect(result.items.filter((i) => i.sourceType === '심판례').length).toBe(0)
    })
  })

  // ─── TAX-018 리팩터 안전망 ────────────────────────────────────────────────────
  //
  // 이후 TAX-019~023 리팩터(빌더 통합·제네릭화·URL 네임스페이스)의 회귀 그물.
  // 리팩터 후 이 스냅샷/폴백 케이스가 diff=0이어야 "출력 무변경"이 기계적으로 증명된다.
  // 프로덕션 코드 변경 없음.

  // ── 빈 기관명 케이스 mock — lawName 폴백 테스트 전용 ─────────────────────────

  // 판례: 법원명 빈 문자열 (데이터출처명='대법원' → isCourtSource=true → 본문 조회 O)
  const mockPrecNoCourtName = {
    PrecSearch: {
      prec: [{
        사건번호: '2020다288436',
        사건명: '손해배상(기)',
        선고일자: '2026.03.12',
        법원명: '',
        데이터출처명: '대법원',
        판례일련번호: '618543',
        판례상세링크: '/DRF/lawService.do?OC=980810&target=prec&ID=618543&type=HTML&mobileYn=',
        사건종류명: '민사',
      }],
    },
  }

  // 법제처 해석례: 회신기관명 빈 문자열 (issuingBody 폴백 없음)
  const mockExpcNoIssuingBody = {
    Expc: {
      resultCode: '00',
      expc: [{
        안건명: '양도소득세 비과세 대상 여부',
        안건번호: '12-0368',
        회신기관명: '',
        질의기관명: '기획재정부',
        회신일자: '2026.02.20',
        법령해석례일련번호: '313499',
        법령해석례상세링크: '/DRF/lawService.do?OC=980810&target=expc&ID=313499&type=HTML&mobileYn=',
      }],
    },
  }

  // 국세청 해석: 해석기관명 빈 문자열 (issuingBody = '' || '국세청' → '국세청' 폴백)
  const mockNtsNoIssuingBody = {
    CgmExpc: {
      resultCode: '00',
      totalCnt: '1',
      cgmExpc: [{
        id: 1,
        안건명: '가지급금 인정이자 계산방법',
        해석기관코드: '1210000',
        법령해석상세링크: 'https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=010000000000100201',
        안건번호: '법인22601-2200',
        법령해석일련번호: '107476',
        질의기관명: '',
        해석기관명: '',
        해석일자: '2024.08.05',
        질의기관코드: '',
      }],
    },
  }

  // 심판례: 재결청 빈 문자열 (issuingBody = '' || '조세심판원' → '조세심판원' 폴백)
  const mockTribunalNoIssuingBody = {
    Decc: {
      resultCode: '00',
      totalCnt: '1',
      decc: [{
        id: 1,
        특별행정심판재결례일련번호: '105794',
        사건명: '쟁점농지 양도소득세 과세처분의 당부',
        청구번호: '조심 2020부1558',
        의결일자: '2020.06.16',
        재결청: '',
        재결구분명: '조세',
      }],
    },
  }

  describe('TAX-018 안전망 — 비법령 4트랙 변환 결과 스냅샷', () => {
    it('[스냅샷] 판례(대법원·본문있음) 전체 필드 고정', async () => {
      server.use(...lawAndPrecHandlers)
      const result = await searchTaxLaw(new NationalTaxLawAdapter(), 'snap_판례_대법원')
      const item = result.items.find((i) => i.caseNumber === '2020다288436')
      expect(item).toMatchSnapshot()
    })

    it('[스냅샷] 판례(국세출처·본문없음) 전체 필드 고정', async () => {
      server.use(...lawAndPrecHandlers)
      const result = await searchTaxLaw(new NationalTaxLawAdapter(), 'snap_판례_국세')
      const item = result.items.find((i) => i.caseNumber === '인천지방법원-2025-구단-50403')
      expect(item).toMatchSnapshot()
    })

    it('[스냅샷] 법제처 해석례(12-0368) 전체 필드 고정', async () => {
      server.use(...lawAndPrecHandlers)
      const result = await searchTaxLaw(new NationalTaxLawAdapter(), 'snap_해석례_법제처')
      const item = result.items.find((i) => i.caseNumber === '12-0368')
      expect(item).toMatchSnapshot()
    })

    it('[스냅샷] 국세청 해석(법인22601-2200) 전체 필드 고정', async () => {
      server.use(...lawAndPrecHandlers)
      const result = await searchTaxLaw(new NationalTaxLawAdapter(), 'snap_해석례_국세청')
      const item = result.items.find((i) => i.sourceType === '해석례' && i.issuingBody === '국세청')
      expect(item).toMatchSnapshot()
    })

    it('[스냅샷] 심판례(조심 2020부1558) 전체 필드 고정', async () => {
      server.use(...lawAndPrecHandlers)
      const result = await searchTaxLaw(new NationalTaxLawAdapter(), 'snap_심판례')
      const item = result.items.find((i) => i.sourceType === '심판례')
      expect(item).toMatchSnapshot()
    })
  })

  describe('TAX-018 안전망 — lawName 폴백 규칙 고정 (빌더 통합 회귀 방지)', () => {
    it('[판례] 법원명이 비면 lawName = 사건번호만, issuingBody = 데이터출처명', async () => {
      server.use(
        http.get(LAW_SEARCH_URL, ({ request }) => {
          const target = new URL(request.url).searchParams.get('target')
          if (target === 'prec') return HttpResponse.json(mockPrecNoCourtName)
          if (target === 'expc') return HttpResponse.json({ Expc: { resultCode: '00' } })
          if (target === 'ntsCgmExpc') return HttpResponse.json({ CgmExpc: { resultCode: '00' } })
          if (target === 'ttSpecialDecc') return HttpResponse.json({ Decc: { resultCode: '00' } })
          return HttpResponse.json({ LawSearch: { resultCode: '00', totalCnt: '0' } })
        }),
        http.get(LAW_SERVICE_URL, ({ request }) => {
          const target = new URL(request.url).searchParams.get('target')
          if (target === 'prec') return HttpResponse.json(mockPrecBody)
          return HttpResponse.json(makeMockServiceResponse(0))
        }),
      )
      const result = await searchTaxLaw(new NationalTaxLawAdapter(), 'fallback_판례_법원명빈')
      const prec = result.items.find((i) => i.sourceType === '판례')
      expect(prec).toBeDefined()
      expect(prec!.lawName).toBe('2020다288436') // 법원명 없으면 사건번호만 (폴백 없음)
      expect(prec!.issuingBody).toBe('대법원')   // 데이터출처명으로 채워짐
    })

    it('[법제처] 회신기관명이 비면 lawName = 안건번호만, issuingBody 빈 문자열', async () => {
      server.use(
        http.get(LAW_SEARCH_URL, ({ request }) => {
          const target = new URL(request.url).searchParams.get('target')
          if (target === 'expc') return HttpResponse.json(mockExpcNoIssuingBody)
          if (target === 'prec') return HttpResponse.json({ PrecSearch: { resultCode: '00' } })
          if (target === 'ntsCgmExpc') return HttpResponse.json({ CgmExpc: { resultCode: '00' } })
          if (target === 'ttSpecialDecc') return HttpResponse.json({ Decc: { resultCode: '00' } })
          return HttpResponse.json({ LawSearch: { resultCode: '00', totalCnt: '0' } })
        }),
        http.get(LAW_SERVICE_URL, ({ request }) => {
          const target = new URL(request.url).searchParams.get('target')
          if (target === 'expc') return HttpResponse.json(mockExpcBody)
          return HttpResponse.json(makeMockServiceResponse(0))
        }),
      )
      const result = await searchTaxLaw(new NationalTaxLawAdapter(), 'fallback_해석례_기관빈')
      const expc = result.items.find((i) => i.sourceType === '해석례')
      expect(expc).toBeDefined()
      expect(expc!.lawName).toBe('12-0368') // 기관명 없으면 안건번호만 (폴백 없음)
      expect(expc!.issuingBody).toBe('')    // issuingBody도 빈 문자열
    })

    it("[국세청] 해석기관명이 비면 issuingBody = '국세청', lawName = '국세청 {안건번호}' (폴백 결합)", async () => {
      server.use(
        http.get(LAW_SEARCH_URL, ({ request }) => {
          const target = new URL(request.url).searchParams.get('target')
          if (target === 'ntsCgmExpc') return HttpResponse.json(mockNtsNoIssuingBody)
          if (target === 'prec') return HttpResponse.json({ PrecSearch: { resultCode: '00' } })
          if (target === 'expc') return HttpResponse.json({ Expc: { resultCode: '00' } })
          if (target === 'ttSpecialDecc') return HttpResponse.json({ Decc: { resultCode: '00' } })
          return HttpResponse.json({ LawSearch: { resultCode: '00', totalCnt: '0' } })
        }),
        // 국세청은 본문 조회(lawService.do) 없음 — 핸들러 불필요
      )
      const result = await searchTaxLaw(new NationalTaxLawAdapter(), 'fallback_국세청_기관빈')
      const nts = result.items.find((i) => i.sourceType === '해석례')
      expect(nts).toBeDefined()
      expect(nts!.issuingBody).toBe('국세청')              // 폴백 '국세청' 채워짐
      expect(nts!.lawName).toBe('국세청 법인22601-2200')   // 항상 결합 = '국세청 {안건번호}'
    })

    it("[심판례] 재결청이 비면 issuingBody = '조세심판원', lawName = '조세심판원 {청구번호}' (폴백 결합)", async () => {
      server.use(
        http.get(LAW_SEARCH_URL, ({ request }) => {
          const target = new URL(request.url).searchParams.get('target')
          if (target === 'ttSpecialDecc') return HttpResponse.json(mockTribunalNoIssuingBody)
          if (target === 'prec') return HttpResponse.json({ PrecSearch: { resultCode: '00' } })
          if (target === 'expc') return HttpResponse.json({ Expc: { resultCode: '00' } })
          if (target === 'ntsCgmExpc') return HttpResponse.json({ CgmExpc: { resultCode: '00' } })
          return HttpResponse.json({ LawSearch: { resultCode: '00', totalCnt: '0' } })
        }),
        http.get(LAW_SERVICE_URL, ({ request }) => {
          const target = new URL(request.url).searchParams.get('target')
          if (target === 'ttSpecialDecc') return HttpResponse.json(mockTtSpecialBody)
          return HttpResponse.json(makeMockServiceResponse(0))
        }),
      )
      const result = await searchTaxLaw(new NationalTaxLawAdapter(), 'fallback_심판례_재결청빈')
      const tribunal = result.items.find((i) => i.sourceType === '심판례')
      expect(tribunal).toBeDefined()
      expect(tribunal!.issuingBody).toBe('조세심판원')                 // 폴백 '조세심판원'
      expect(tribunal!.lawName).toBe('조세심판원 조심 2020부1558')     // 폴백 후 결합
    })
  })

  // ─── 시나리오 8: 법령 매칭 정확도 (TAX-031) ──────────────────────────────
  //
  // 통증 A: 검색 API 랭킹 1위가 동음이의 법령일 수 있다(실측: "지방세법" → 1위 "지방교부세법").
  // 정확매칭 선택(selectBestLaw)과 약칭 정규화(normalizeLawName)가 어댑터에 연결됐는지 검증.
  describe('법령 매칭 정확도 (TAX-031)', () => {
    // "지방세법" 검색 → [0] 지방교부세법(오답 유발), [1] 지방세법(정답)
    const mockDisambiguationSearch = {
      LawSearch: {
        resultCode: '00',
        totalCnt: '2',
        law: [
          {
            법령일련번호: '268061',
            법령명한글: '지방교부세법',
            법령약칭명: '',
            법령구분명: '법률',
            공포일자: '20260101',
            시행일자: '20260101',
            공포번호: '21000',
          },
          {
            법령일련번호: '282559',
            법령명한글: '지방세법',
            법령약칭명: '',
            법령구분명: '법률',
            공포일자: '20260101',
            시행일자: '20260101',
            공포번호: '21001',
          },
        ],
      },
    }

    // MST에 따라 다른 법령 조문을 반환 — 어댑터가 어떤 법령을 골랐는지 결과로 드러난다
    const serviceByMst = (mst: string | null) => {
      const lawName = mst === '282559' ? '지방세법' : '지방교부세법'
      return {
        법령: {
          기본정보: {
            법령명_한글: lawName,
            법종구분: { content: '법률' },
            공포일자: '20260101',
            시행일자: '20260101',
            법령ID: '001234',
          },
          조문: {
            조문단위: [
              {
                조문번호: 11,
                조문여부: '조문',
                조문시행일자: '20260101',
                조문내용: `제11조(${lawName} 조문) 본문 내용입니다.`,
                조문키: 'k11',
              },
            ],
          },
        },
      }
    }

    /** 법령 트랙만 다수 후보를 주고, 비법령 4트랙은 빈 응답으로 처리 */
    const disambiguationHandlers = (onQuery?: (q: string) => void) => [
      http.get(LAW_SEARCH_URL, ({ request }) => {
        const url = new URL(request.url)
        const target = url.searchParams.get('target')
        if (target === 'law') {
          onQuery?.(url.searchParams.get('query') ?? '')
          return HttpResponse.json(mockDisambiguationSearch)
        }
        if (target === 'prec') return HttpResponse.json({ PrecSearch: { resultCode: '00' } })
        if (target === 'expc') return HttpResponse.json({ Expc: { resultCode: '00' } })
        if (target === 'ntsCgmExpc') return HttpResponse.json({ CgmExpc: { resultCode: '00' } })
        if (target === 'ttSpecialDecc') return HttpResponse.json({ Decc: { resultCode: '00' } })
        return HttpResponse.json({ LawSearch: { resultCode: '00', totalCnt: '0' } })
      }),
      http.get(LAW_SERVICE_URL, ({ request }) => {
        const mst = new URL(request.url).searchParams.get('MST')
        return HttpResponse.json(serviceByMst(mst))
      }),
    ]

    it('[핵심] 1위가 지방교부세법이어도 "지방세법"을 근거로 선택한다', async () => {
      server.use(...disambiguationHandlers())

      const adapter = new NationalTaxLawAdapter()
      // keyword가 매칭 로직에 직접 쓰이므로 실제 입력값("지방세법") 그대로 사용한다
      const result = await searchTaxLaw(adapter, '지방세법')

      const laws = result.items.filter((i) => i.sourceType === '법령')
      expect(laws.length).toBeGreaterThan(0)
      // 정확매칭이 없었다면 laws[0]='지방교부세법'이 선택돼 실패한다
      laws.forEach((l) => expect(l.lawName).toBe('지방세법'))
    })

    it('[약칭] "상증세법" 검색은 정식명 "상속세 및 증여세법"으로 API를 호출한다', async () => {
      let capturedQuery = ''
      server.use(...disambiguationHandlers((q) => (capturedQuery = q)))

      const adapter = new NationalTaxLawAdapter()
      await searchTaxLaw(adapter, '상증세법')

      expect(capturedQuery).toBe('상속세 및 증여세법')
    })
  })

  // ─── 시나리오 9: 조문 본문 항·호 조립 (TAX-032) ──────────────────────────
  //
  // 통증 B: 기존 content엔 조문내용(제목 줄)만 담겨 본문이 누락됐다.
  // 응답에 이미 온 항·호 하위노드를 어댑터가 추가 호출 없이 조립하는지 검증.
  describe('조문 본문 항·호 조립 (TAX-032)', () => {
    // 항·호가 포함된 조문 응답 (실측 구조 — 항내용 문자열 + 호 다수)
    const mockArticleWithHang = {
      법령: {
        기본정보: {
          법령명_한글: '부가가치세법',
          법종구분: { content: '법률' },
          공포일자: '20260101',
          시행일자: '20260101',
          법령ID: '001571',
        },
        조문: {
          조문단위: [
            {
              조문번호: 26,
              조문여부: '조문',
              조문시행일자: '20260101',
              조문내용: '제26조(재화 또는 용역의 공급에 대한 면세)',
              조문키: 'k26',
              항: [
                {
                  항번호: '①',
                  항내용: '① 다음 각 호의 재화 또는 용역의 공급에 대하여는 부가가치세를 면제한다.',
                  호: [
                    { 호번호: '1.', 호내용: '1.  가공되지 아니한 식료품' },
                    { 호번호: '2.', 호내용: '2.  수돗물' },
                  ],
                },
              ],
            },
          ],
        },
      },
    }

    /** 법령 트랙만 항 포함 조문을 주고, 비법령 4트랙은 빈 응답 */
    const hangHandlers = [
      http.get(LAW_SEARCH_URL, ({ request }) => {
        const target = new URL(request.url).searchParams.get('target')
        if (target === 'law') return HttpResponse.json(mockLawSearchResponse)
        if (target === 'prec') return HttpResponse.json({ PrecSearch: { resultCode: '00' } })
        if (target === 'expc') return HttpResponse.json({ Expc: { resultCode: '00' } })
        if (target === 'ntsCgmExpc') return HttpResponse.json({ CgmExpc: { resultCode: '00' } })
        if (target === 'ttSpecialDecc') return HttpResponse.json({ Decc: { resultCode: '00' } })
        return HttpResponse.json({ LawSearch: { resultCode: '00', totalCnt: '0' } })
      }),
      http.get(LAW_SERVICE_URL, () => HttpResponse.json(mockArticleWithHang)),
    ]

    it('[조립] content에 조문내용뿐 아니라 항·호 본문이 포함된다', async () => {
      server.use(...hangHandlers)

      const adapter = new NationalTaxLawAdapter()
      const result = await searchTaxLaw(adapter, '면세_조립')

      const law = result.items.find((i) => i.sourceType === '법령')
      expect(law).toBeDefined()
      // 제목 + 항 + 호가 모두 원문 그대로 content에 포함 (통증 B 해소)
      expect(law!.content).toContain('제26조(재화 또는 용역의 공급에 대한 면세)')
      expect(law!.content).toContain('① 다음 각 호의 재화 또는 용역의 공급에 대하여는 부가가치세를 면제한다.')
      expect(law!.content).toContain('1.  가공되지 아니한 식료품')
      expect(law!.content).toContain('2.  수돗물')
    })

    it('[제목 보존] 조립이 articleNumber·articleTitle 파싱을 오염시키지 않는다', async () => {
      server.use(...hangHandlers)

      const adapter = new NationalTaxLawAdapter()
      const result = await searchTaxLaw(adapter, '면세_제목')

      const law = result.items.find((i) => i.sourceType === '법령')
      expect(law).toBeDefined()
      // 제목 파싱은 조문내용(제목 줄)만 사용 — content 조립과 분리
      expect(law!.articleNumber).toBe('제26조')
      expect(law!.articleTitle).toBe('재화 또는 용역의 공급에 대한 면세')
    })
  })

  // ─── 시나리오 10: TAX-039 비법령 어댑터 매핑 회귀 방지 ─────────────────────
  //
  // V4 시점 라벨 [결정: YYYY.MM.DD]가 폴백되지 않도록(SSOT §7.2 매핑 표),
  // 4트랙(판례·법제처해석례·국세청해석·심판례) 모두 decisionDate가
  // 정확히 YYYY-MM-DD 정규식에 매칭됨을 명시적으로 단언한다.
  //
  // 어댑터 매핑이 손상돼 다른 형식(YYYY.MM.DD·YYYYMMDD)이 흘러나오면 즉시 FAIL
  // → buildNonlawCases.ts·llmAnswerGenerator의 [결정] 라벨 폴백을 봉인한다.
  describe('TAX-039 비법령 어댑터 매핑 회귀 방지', () => {
    const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

    it.each([
      { name: '판례(대법원)',     caseNumber: '2020다288436',     issuingBody: '대법원',     sourceType: '판례'   as const },
      { name: '법제처 해석례',   caseNumber: '12-0368',           issuingBody: '법제처',     sourceType: '해석례' as const },
      { name: '국세청 해석',     caseNumber: '법인22601-2200',    issuingBody: '국세청',     sourceType: '해석례' as const },
      { name: '심판례',          caseNumber: '조심 2020부1558',   issuingBody: '조세심판원', sourceType: '심판례' as const },
    ])('[$name] decisionDate가 YYYY-MM-DD 정규식 매칭 · caseNumber·issuingBody 채워진다', async ({ caseNumber, issuingBody, sourceType }) => {
      server.use(...lawAndPrecHandlers)

      const adapter = new NationalTaxLawAdapter()
      const result = await searchTaxLaw(adapter, `tax039_${caseNumber}`)

      // sourceType+caseNumber 조합으로 매칭(해석례 2트랙 issuingBody 구분)
      const item = result.items.find(
        (i) => i.sourceType === sourceType && i.caseNumber === caseNumber,
      )
      expect(item).toBeDefined()
      // 핵심: decisionDate가 ISO 형식 정규식에 정확히 매칭 (V4 폴백 방어)
      expect(item!.decisionDate).toMatch(ISO_DATE_RE)
      // caseNumber·issuingBody는 비법령 V1 식별·표시에 필수
      expect(item!.caseNumber).toBeTruthy()
      expect(item!.issuingBody).toBe(issuingBody)
    })
  })

  // ─── TAX-6B-11: 비법령 후보 확대 + 관련도 기반 본문 선별 ─────────────────────
  describe('비법령 후보 확대·관련도 본문 선별 (TAX-6B-11)', () => {
    /** 심판례 목록 8건: 사건명에 '양도소득세' 5건(관련) + '취득세' 3건(무관). API 기본 순서는 무관을 앞에 둠 */
    function makeTribunalList() {
      const relevant = Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        특별행정심판재결례일련번호: `R${i + 1}`,
        사건명: `양도소득세 과세처분의 당부 ${i + 1}`,
        청구번호: `조심 2020서000${i + 1}`,
        의결일자: `2020.0${i + 1}.01`,
        재결청: '조세심판원',
      }))
      const irrelevant = Array.from({ length: 3 }, (_, i) => ({
        id: 100 + i,
        특별행정심판재결례일련번호: `X${i + 1}`,
        사건명: `취득세 부과처분 취소 ${i + 1}`,
        청구번호: `조심 2021서000${i + 1}`,
        의결일자: `2021.0${i + 1}.01`,
        재결청: '조세심판원',
      }))
      // 외부 API 기본 순서는 관련도와 무관하다고 가정 — 무관 항목을 앞에 배치해 정렬 효과를 검증
      return { Decc: { resultCode: '00', totalCnt: '8', decc: [...irrelevant, ...relevant] } }
    }

    /** 본문 조회된 일련번호를 bodyFetchIds에 누적하는 핸들러(심판례만 동작, 나머지 트랙은 빈 결과) */
    function makeHandlers(bodyFetchIds: string[]) {
      return [
        http.get(LAW_SEARCH_URL, ({ request }) => {
          const target = new URL(request.url).searchParams.get('target')
          if (target === 'ttSpecialDecc') return HttpResponse.json(makeTribunalList())
          if (target === 'prec') return HttpResponse.json({ PrecSearch: {} })
          if (target === 'expc') return HttpResponse.json({ Expc: {} })
          if (target === 'ntsCgmExpc') return HttpResponse.json({ CgmExpc: {} })
          return HttpResponse.json({ LawSearch: { resultCode: '00', totalCnt: '0' } })
        }),
        http.get(LAW_SERVICE_URL, ({ request }) => {
          const url = new URL(request.url)
          if (url.searchParams.get('target') === 'ttSpecialDecc') {
            const id = url.searchParams.get('ID') ?? ''
            bodyFetchIds.push(id)
            return HttpResponse.json({
              SpecialDeccService: {
                주문: '심판청구를 기각한다.',
                재결요지: '쟁점은 양도소득세 과세의 당부이다.',
                이유: '처분은 정당하다.',
                의결일자: '20200101',
                특별행정심판재결례일련번호: id,
              },
            })
          }
          return HttpResponse.json({})
        }),
      ]
    }

    it('목록은 넓게 가져오되 본문은 관련도 상위 5건만 조회한다 (N+1 제어)', async () => {
      const bodyFetchIds: string[] = []
      server.use(...makeHandlers(bodyFetchIds))

      const adapter = new NationalTaxLawAdapter()
      // 고유 prefix로 어댑터 캐시 충돌 회피('양도소득세' 토큰은 관련도 매칭용으로 유지)
      const result = await searchTaxLaw(adapter, 'tax6b11limit 양도소득세')

      const tribunals = result.items.filter((i) => i.sourceType === '심판례')
      // 목록 8건 전부 반환(유실 방지)
      expect(tribunals).toHaveLength(8)
      // 본문 조회는 상위 5건만 (P95 보호 — 기존 본문 조회 건수 유지)
      expect(bodyFetchIds).toHaveLength(5)
      // 본문 조회된 5건은 모두 관련(양도소득세) 항목(R*) — 무관(X*)은 본문 미조회
      expect(bodyFetchIds.every((id) => id.startsWith('R'))).toBe(true)
    })

    it('관련 항목은 본문(content)을 갖고, 무관 항목은 content가 비어 참고 목록 후보가 된다', async () => {
      const bodyFetchIds: string[] = []
      server.use(...makeHandlers(bodyFetchIds))

      const adapter = new NationalTaxLawAdapter()
      const result = await searchTaxLaw(adapter, 'tax6b11body 양도소득세')

      const tribunals = result.items.filter((i) => i.sourceType === '심판례')
      const withBody = tribunals.filter((t) => t.content.trim() !== '')
      const noBody = tribunals.filter((t) => t.content.trim() === '')
      // 관련(양도소득세) 5건은 본문 보유, 무관(취득세) 3건은 본문 없음
      expect(withBody).toHaveLength(5)
      expect(noBody).toHaveLength(3)
      expect(withBody.every((t) => t.articleTitle.includes('양도소득세'))).toBe(true)
      expect(noBody.every((t) => t.articleTitle.includes('취득세'))).toBe(true)
    })
  })
})
