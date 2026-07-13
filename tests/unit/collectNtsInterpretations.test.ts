/**
 * TAX-6B-20-A: 국세청 세법해석례(ntsCgmExpc) 본문 수집기 순수 함수 단위 테스트
 *
 * 네트워크·파일시스템을 건드리지 않고 응답 파싱·매핑·빈본문 가드만 검증한다.
 * 가장 중요한 단언:
 *   ① content 원문 불변(CLAUDE.md §6.1) — 요지+회신+HWP 전문을 원문 그대로 결합(§4.3 방안②)
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
  jitterDelayMs,
  parseListPage,
  hasSubstantiveTaxlawBody,
  htmlToText,
  extractHwpFullText,
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

// HWP 첨부 전문(html 변환본) — 실측 구조 본뜸(2026-07-09): '○ 사실관계'·'관련 조세법령'·
// 다른 세법해석례(관련사례) 인용이 한 본문에 함께 담긴다(§4.3 방안②의 근거).
const SAMPLE_HWP_HTML =
  '<html><head></head><body>' +
  '<p><span class="bold">1. 질의내용 요약</span></p>' +
  '<p>○ 사실관계</p>' +
  '<p>&nbsp;질의 법인은 1986 사업연도분 가지급금 적수계산 방법을 문의함.</p>' +
  '<p>○ 질의내용</p>' +
  '<p>경과일수 산정의 기준일이 사업연도 개시일인지 여부</p>' +
  '<p><span class="bold">2. 질의내용에 대한 자료</span></p>' +
  '<p>가. 관련 조세법령</p>' +
  '<p>○ 법인세법 시행령 제11조 &lt;개정 1985&gt;</p>' +
  '<p>○ 서면1팀-1438, 2005.11.28.</p>' + // 관련사례(다른 세법해석례) 인용
  '<p>비과세되는 상금과 부상은 국가 예산으로 국가가 수여하는 것을 말함.</p>' +
  '</body></html>'

// action.do 본문 응답(target=ASIQTB002PR01) — 실제 프로브 응답 구조 그대로(2026-07-09)
// dcmHwpEditorDVOList: HWP 원본(dcmFleTy='hwp', 빈 내용) + 변환본(dcmFleTy='html')이 함께 온다.
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
      dcmHwpEditorDVOList: [
        { dcmFleTy: 'hwp', dcmFleByte: '' }, // HWP 원본(빈 내용) — 결합에서 제외되어야 함
        { dcmFleTy: 'html', dcmFleByte: SAMPLE_HWP_HTML },
      ],
    },
  },
}

// HWP 전문이 없는 옛 문서(예: 1988년 건) — 요지+회신만 저장되는 하위 호환 경로 검증용
const SAMPLE_ACTION_BODY_NO_HWP = {
  data: {
    ASIQTB002PR01: {
      dcmDVO: {
        ntstDcmGistCntn: '가지급금 적수계산 시 경과일수는 사업연도 개시일부터 종료일까지로 하는 것임',
        ntstDcmCntn: ' 귀 질의의 경우 경과일수는 사업연도 개시일로부터 종료일까지의 경과일수로 하는 것임.',
      },
      dcmHwpEditorDVOList: [{ dcmFleTy: 'hwp', dcmFleByte: '' }], // 변환본 없음
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

  describe('jitterDelayMs (매너 크롤링 랜덤 지터 지연 — 고정 간격 봇 탐지 회피)', () => {
    it('rnd=0이면 최소값, rnd≈1이면 최대값을 반환한다(경계 포함)', () => {
      expect(jitterDelayMs(500, 1500, () => 0)).toBe(500)
      expect(jitterDelayMs(500, 1500, () => 0.999999)).toBe(1500)
    })
    it('중간 난수는 범위 안의 정수를 반환한다', () => {
      const ms = jitterDelayMs(500, 1500, () => 0.5)
      expect(ms).toBe(1000)
      expect(Number.isInteger(ms)).toBe(true)
    })
    it('기본 범위(500~1500ms)에서 난수와 무관하게 항상 경계 안에 든다', () => {
      for (const r of [0, 0.1, 0.42, 0.73, 0.999999]) {
        const ms = jitterDelayMs(undefined, undefined, () => r)
        expect(ms).toBeGreaterThanOrEqual(500)
        expect(ms).toBeLessThanOrEqual(1500)
      }
    })
    it('min>max로 잘못 주어져도 방어적으로 정상 범위를 만든다', () => {
      const ms = jitterDelayMs(1500, 500, () => 0.5)
      expect(ms).toBeGreaterThanOrEqual(500)
      expect(ms).toBeLessThanOrEqual(1500)
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

  describe('htmlToText (HWP 전문 HTML → 텍스트 충실 변환, §4.3 방안②·§6.1)', () => {
    it('태그를 제거하되 문단 구조(개행)와 실제 텍스트는 보존한다', () => {
      const text = htmlToText('<p>첫째 줄</p><p>둘째 줄</p>')
      expect(text).toBe('첫째 줄\n둘째 줄')
      expect(text).not.toContain('<')
    })
    it('<br>을 개행으로 바꾼다', () => {
      expect(htmlToText('앞<br/>뒤')).toBe('앞\n뒤')
    })
    it('HTML 엔티티(&lt; &gt; &amp; &nbsp; &quot; 숫자)를 원문 문자로 복원한다', () => {
      expect(htmlToText('<p>제11조 &lt;개정 1985&gt; A&amp;B&nbsp;C &quot;인용&quot; &#12300;낫표&#12301;</p>')).toBe(
        '제11조 <개정 1985> A&B C "인용" 「낫표」',
      )
    })
    it('&amp;lt; 는 이중 복원하지 않고 &lt; 텍스트로 남긴다', () => {
      expect(htmlToText('<p>&amp;lt;</p>')).toBe('&lt;')
    })
    it('HWP 특수문자(󰡒 󰡓 ·【】)를 손대지 않고 원문 그대로 보존한다(§6.1 왜곡 방지)', () => {
      const src = '<p>제12조 【비과세소득】 󰡒상금과 부상󰡓</p>'
      expect(htmlToText(src)).toBe('제12조 【비과세소득】 󰡒상금과 부상󰡓')
    })
    it('빈 입력·공백만이면 빈 문자열', () => {
      expect(htmlToText('')).toBe('')
      expect(htmlToText('   ')).toBe('')
      expect(htmlToText('<p>&nbsp;</p>')).toBe('')
    })
  })

  describe('extractHwpFullText (dcmHwpEditorDVOList에서 html 전문만 선별)', () => {
    it('내용 있는 html 항목만 텍스트화하고 빈 HWP 원본은 제외한다', () => {
      const text = extractHwpFullText([
        { dcmFleTy: 'hwp', dcmFleByte: '' },
        { dcmFleTy: 'html', dcmFleByte: '<p>사실관계 요약</p>' },
      ])
      expect(text).toBe('사실관계 요약')
    })
    it('dcmFleTy가 없어도 HTML 태그가 보이면 채택한다(방어적)', () => {
      expect(extractHwpFullText([{ dcmFleByte: '<p>관련사례 서면1팀-1438</p>' }])).toContain('관련사례')
    })
    it('배열이 아니거나 비어 있으면 빈 문자열', () => {
      expect(extractHwpFullText(undefined)).toBe('')
      expect(extractHwpFullText([])).toBe('')
      expect(extractHwpFullText([{ dcmFleTy: 'hwp', dcmFleByte: '' }])).toBe('')
    })
  })

  describe('parseActionBody (§4.3 방안② — 요지+회신+HWP 전문 결합, §6.1)', () => {
    it('요지·회신을 원문 그대로 결합하고, 그 뒤에 HWP 전문(사실관계·관련법령·관련사례)을 덧붙인다', () => {
      const content = parseActionBody(SAMPLE_ACTION_BODY)
      const dvo = SAMPLE_ACTION_BODY.data.ASIQTB002PR01.dcmDVO
      // 앞부분: 요지 + 회신을 줄바꿈으로 원문 결합(기존 관례)
      expect(content.startsWith([dvo.ntstDcmGistCntn, dvo.ntstDcmCntn].join('\n'))).toBe(true)
      // 뒷부분: HWP 전문에서 사실관계·관련법령·관련사례(다른 해석례)까지 포함
      expect(content).toContain('○ 사실관계')
      expect(content).toContain('법인세법 시행령 제11조 <개정 1985>') // 관련법령 + 엔티티 복원
      expect(content).toContain('서면1팀-1438, 2005.11.28.') // 관련사례(다른 세법해석례)
      // HTML 태그는 남지 않는다(단, &lt;개정 1985&gt; → <개정 1985> 같은 정상 텍스트의 '<'는 허용)
      expect(content).not.toMatch(/<\/?(html|body|p|span|div|br|h[1-6]|table|tr|td|th)\b/i)
    })
    it('HWP 전문이 없는 옛 문서는 요지+회신만 저장한다(하위 호환)', () => {
      const content = parseActionBody(SAMPLE_ACTION_BODY_NO_HWP)
      const dvo = SAMPLE_ACTION_BODY_NO_HWP.data.ASIQTB002PR01.dcmDVO
      expect(content).toBe([dvo.ntstDcmGistCntn, dvo.ntstDcmCntn].join('\n'))
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
