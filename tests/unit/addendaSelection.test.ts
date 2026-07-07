/**
 * @vitest-environment node
 *
 * TAX-6B-1: 부칙·경과조치 선별 및 TaxLaw 매핑 단위 테스트
 *
 * 부칙 원문은 flattenText 경로로 문자 그대로 결합되어야 하며, 테스트는 선별 순서와
 * 라벨 메타데이터만 검증한다.
 */
import { describe, expect, it } from 'vitest'
import { buchikToTaxLaw, selectRelevantAddenda } from '@/adapters/nationalTaxLaw'

type RawBuchikFixture = Parameters<typeof selectRelevantAddenda>[0][number]

function makeBuchik(overrides: Partial<RawBuchikFixture> = {}): RawBuchikFixture {
  const promulgationDate = overrides.부칙공포일자 ?? '20200101'
  const promulgationNumber = overrides.부칙공포번호 ?? '100'

  return {
    부칙키: `key-${promulgationDate}-${promulgationNumber}`,
    부칙공포일자: promulgationDate,
    부칙공포번호: promulgationNumber,
    부칙내용: [
      `부칙 <제${promulgationNumber}호, ${promulgationDate}>`,
      `제1조(시행일) 이 부칙은 ${promulgationDate}부터 시행한다.`,
    ],
    ...overrides,
  }
}

describe('selectRelevantAddenda — 시점 관련 부칙 선별', () => {
  it('targetDate 미지정 시 최신 공포 2개를 반환한다', () => {
    const result = selectRelevantAddenda([
      makeBuchik({ 부칙공포일자: '20181231', 부칙공포번호: '1' }),
      makeBuchik({ 부칙공포일자: '20200609', 부칙공포번호: '2' }),
      makeBuchik({ 부칙공포일자: '20240101', 부칙공포번호: '3' }),
    ])

    expect(result.map((b) => b.부칙공포일자)).toEqual(['20240101', '20200609'])
  })

  it('targetDate 지정 시 직전 1개와 직후 1개 경계 부칙을 반환한다', () => {
    const result = selectRelevantAddenda(
      [
        makeBuchik({ 부칙공포일자: '20180101', 부칙공포번호: '1' }),
        makeBuchik({ 부칙공포일자: '20191231', 부칙공포번호: '2' }),
        makeBuchik({ 부칙공포일자: '20200609', 부칙공포번호: '3' }),
        makeBuchik({ 부칙공포일자: '20220101', 부칙공포번호: '4' }),
      ],
      new Date('2020-01-01'),
    )

    expect(result.map((b) => b.부칙공포일자)).toEqual(['20191231', '20200609'])
  })

  it('동일 공포일자는 공포번호와 부칙키로 결정론적 tie-break를 적용한다', () => {
    const addenda = [
      makeBuchik({ 부칙키: 'k-100', 부칙공포일자: '20200101', 부칙공포번호: '100' }),
      makeBuchik({ 부칙키: 'k-300', 부칙공포일자: '20200101', 부칙공포번호: '300' }),
      makeBuchik({ 부칙키: 'k-200', 부칙공포일자: '20200101', 부칙공포번호: '200' }),
    ]

    const first = selectRelevantAddenda(addenda)
    const reversed = selectRelevantAddenda([...addenda].reverse())

    expect(first.map((b) => b.부칙공포번호)).toEqual(['300', '200'])
    expect(reversed.map((b) => b.부칙공포번호)).toEqual(['300', '200'])
  })

  it('공포번호가 없으면 부칙키로 동일 공포일자 순서를 고정한다', () => {
    const addenda = [
      makeBuchik({ 부칙키: 'k-b', 부칙공포일자: '20200101', 부칙공포번호: '' }),
      makeBuchik({ 부칙키: 'k-c', 부칙공포일자: '20200101', 부칙공포번호: '' }),
      makeBuchik({ 부칙키: 'k-a', 부칙공포일자: '20200101', 부칙공포번호: '' }),
    ]

    const result = selectRelevantAddenda(addenda)

    expect(result.map((b) => b.부칙키)).toEqual(['k-c', 'k-b'])
  })
})

describe('buchikToTaxLaw — 부칙 TaxLaw 매핑', () => {
  it('T2 법령 자료로 매핑하고 sourceUrl에는 OC 키를 포함하지 않는다', () => {
    const law = buchikToTaxLaw(
      makeBuchik({
        부칙공포일자: '20200609',
        부칙공포번호: '17757',
        부칙내용: [
          '부칙 <제17757호, 20200609>',
          ['제1조(시행일) 이 법은 공포한 날부터 시행한다.', '제2조(경과조치) 종전의 규정에 따른다.'],
        ],
      }),
      '소득세법',
      '123456',
    )

    expect(law.sourceType).toBe('법령')
    expect(law.lawName).toBe('소득세법 부칙')
    expect(law.trustTier).toBe('T2')
    expect(law.articleTitle).toBe('부칙')
    expect(law.articleNumber).toBe('부칙 <제17757호, 20200609>')
    expect(law.revisionDate).toBe('2020-06-09')
    expect(law.enforcementDate).toBe('2020-06-09')
    expect(law.content).toBe(
      '부칙 <제17757호, 20200609>\n' +
        '제1조(시행일) 이 법은 공포한 날부터 시행한다.\n' +
        '제2조(경과조치) 종전의 규정에 따른다.',
    )
    expect(law.sourceUrl).toContain('lsiSeq=123456')
    expect(law.sourceUrl).not.toContain('OC=')
  })

  it('첫 줄이 부칙이 아니면 공포일자와 부칙키를 이용해 유일 식별자를 만든다', () => {
    const first = buchikToTaxLaw(
      makeBuchik({
        부칙키: 'addenda-a',
        부칙공포일자: '20200609',
        부칙공포번호: '',
        부칙내용: '제1조(시행일) 이 법은 공포한 날부터 시행한다.',
      }),
      '소득세법',
      '123456',
    )
    const second = buchikToTaxLaw(
      makeBuchik({
        부칙키: 'addenda-b',
        부칙공포일자: '20200609',
        부칙공포번호: '',
        부칙내용: '제2조(경과조치) 종전의 규정에 따른다.',
      }),
      '소득세법',
      '123456',
    )

    expect(first.articleNumber).toBe('부칙 <2020-06-09, addenda-a>')
    expect(second.articleNumber).toBe('부칙 <2020-06-09, addenda-b>')
    expect(first.articleNumber).not.toBe(second.articleNumber)
    expect(first.articleNumber).not.toBe('부칙 <제호>')
  })
})
