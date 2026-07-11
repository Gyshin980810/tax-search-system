import { describe, expect, it } from 'vitest'
import { inspectNonLawCaseNumbers } from '../../scripts/embedQuality'
import type { TaxLaw } from '@/domain/TaxLaw'

const BASE_LAW: TaxLaw = {
  sourceType: '법령',
  lawName: '소득세법',
  articleNumber: '제89조',
  articleTitle: '비과세 양도소득',
  content: '제89조(비과세 양도소득) 원문',
  revisionDate: '2026-01-01',
  enforcementDate: '2026-01-01',
  sourceUrl: 'https://www.law.go.kr/law',
  trustTier: 'T1',
}

function makeNonLaw(sourceType: '판례' | '해석례' | '심판례', caseNumber: string | undefined): TaxLaw {
  return {
    sourceType,
    lawName: `${sourceType} 제목`,
    articleNumber: '',
    articleTitle: `${sourceType} 제목`,
    content: `${sourceType} 본문 원문`,
    revisionDate: '2024-01-01',
    enforcementDate: '',
    sourceUrl: `https://example.com/${sourceType}/${caseNumber ?? 'missing'}`,
    trustTier: sourceType === '판례' ? 'T4' : 'T3',
    ...(caseNumber !== undefined ? { caseNumber } : {}),
    issuingBody: sourceType === '심판례' ? '조세심판원' : '대법원',
    decisionDate: '2024-01-01',
  }
}

describe('embed input quality — 비법령 caseNumber 검사', () => {
  it('법령은 검사 대상에서 제외하고 비법령만 집계한다', () => {
    const report = inspectNonLawCaseNumbers([
      BASE_LAW,
      makeNonLaw('판례', '2020두32227'),
      makeNonLaw('심판례', '조심2024중1'),
    ])

    expect(report.checked).toBe(3)
    expect(report.nonLawChecked).toBe(2)
    expect(report.hasIssues).toBe(false)
  })

  it('같은 sourceType 안에서 중복 caseNumber를 보고한다', () => {
    const report = inspectNonLawCaseNumbers([
      makeNonLaw('심판례', '조심2024중1'),
      makeNonLaw('심판례', '조심2024중1'),
      makeNonLaw('판례', '조심2024중1'),
    ])

    expect(report.hasIssues).toBe(true)
    expect(report.duplicateCaseNumbers).toHaveLength(1)
    expect(report.duplicateCaseNumbers[0]).toMatchObject({
      sourceType: '심판례',
      caseNumber: '조심2024중1',
      count: 2,
    })
  })

  it('sourceType이 다르면 같은 caseNumber여도 중복으로 보지 않는다', () => {
    const report = inspectNonLawCaseNumbers([
      makeNonLaw('심판례', '2020두32227'),
      makeNonLaw('판례', '2020두32227'),
    ])

    expect(report.hasIssues).toBe(false)
    expect(report.duplicateCaseNumbers).toHaveLength(0)
  })

  it('externalId가 있으면 caseNumber 대신 externalId로 중복을 판정한다', () => {
    const report = inspectNonLawCaseNumbers([
      { ...makeNonLaw('해석례', '재산'), externalId: 'NTS-1' },
      { ...makeNonLaw('해석례', '재산'), externalId: 'NTS-2' },
    ])

    expect(report.hasIssues).toBe(false)
  })

  it('같은 externalId는 caseNumber가 달라도 중복으로 보고한다', () => {
    const report = inspectNonLawCaseNumbers([
      { ...makeNonLaw('해석례', '재산'), externalId: 'NTS-1' },
      { ...makeNonLaw('해석례', '소득'), externalId: 'NTS-1' },
    ])

    expect(report.duplicateCaseNumbers).toHaveLength(1)
    expect(report.duplicateCaseNumbers[0]).toMatchObject({ externalId: 'NTS-1', count: 2 })
  })

  it('비법령 caseNumber 누락과 공백을 보고한다', () => {
    const report = inspectNonLawCaseNumbers([
      makeNonLaw('해석례', undefined),
      makeNonLaw('심판례', '   '),
    ])

    expect(report.hasIssues).toBe(true)
    expect(report.missingCaseNumbers).toHaveLength(2)
    expect(report.missingCaseNumbers.map((i) => i.sourceType)).toEqual(
      expect.arrayContaining(['심판례', '해석례']),
    )
  })
})
