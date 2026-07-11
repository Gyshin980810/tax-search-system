import { describe, expect, it } from 'vitest'
import { rowToTaxLaw, type DbRow } from '@/adapters/vectorSearch'

function makeRow(overrides: Partial<DbRow> = {}): DbRow {
  return {
    source_type: '해석례',
    law_name: '국세청 재산',
    article_number: null,
    case_number: '재산',
    article_title: '해석례 제목',
    content: '원문 내용',
    revision_date: '2024-01-01',
    enforcement_date: null,
    source_url: 'https://taxlaw.nts.go.kr/example?ntstDcmId=NTS-1',
    trust_tier: 'T3',
    issuing_body: '국세청',
    decision_date: '2024-01-01',
    external_id: 'NTS-1',
    similarity: 0.8,
    ...overrides,
  }
}

describe('rowToTaxLaw — pgvector 행 매핑', () => {
  it('metadata의 externalId를 TaxLaw에 전달한다', () => {
    expect(rowToTaxLaw(makeRow()).externalId).toBe('NTS-1')
  })

  it('기존 행의 externalId가 NULL이면 필드를 만들지 않는다', () => {
    expect(rowToTaxLaw(makeRow({ external_id: null }))).not.toHaveProperty('externalId')
  })
})
