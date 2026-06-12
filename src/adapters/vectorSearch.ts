import 'server-only'
import { Pool } from 'pg'
import type { IVectorSearchPort, VectorMatch } from '../ports/vectorSearchPort'
import type { TaxLaw, SourceType, TrustTier } from '../domain/TaxLaw'

interface DbRow {
  source_type: string
  law_name: string
  article_number: string | null
  case_number: string | null
  article_title: string | null
  content: string
  // DATE 컬럼은 pg 드라이버가 JS Date 객체로 반환한다 — 도메인 TaxLaw는 문자열을
  // 기대하므로 toIsoDateString으로 정규화해야 한다 (BUG: localeCompare 크래시 방지)
  revision_date: string | Date | null
  enforcement_date: string | Date | null
  source_url: string
  trust_tier: string
  issuing_body: string | null
  decision_date: string | Date | null
  similarity: number
}

/** pg DATE 컬럼 값(Date 객체 또는 문자열)을 'YYYY-MM-DD' 문자열로 정규화 */
function toIsoDateString(value: string | Date | null): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return value
}

function rowToTaxLaw(row: DbRow): TaxLaw {
  const decisionDate = toIsoDateString(row.decision_date)
  return {
    sourceType: row.source_type as SourceType,
    lawName: row.law_name,
    articleNumber: row.article_number ?? '',
    articleTitle: row.article_title ?? '',
    content: row.content,
    revisionDate: toIsoDateString(row.revision_date),
    enforcementDate: toIsoDateString(row.enforcement_date),
    sourceUrl: row.source_url,
    trustTier: row.trust_tier as TrustTier,
    ...(row.case_number  ? { caseNumber:  row.case_number }  : {}),
    ...(row.issuing_body ? { issuingBody: row.issuing_body } : {}),
    ...(decisionDate     ? { decisionDate }                  : {}),
  }
}

/**
 * pgvector 벡터 검색 어댑터 (TAX-026-D)
 * cosine 유사도(<=>)로 상위 topK 자료를 반환한다. IVectorSearchPort 구현체.
 */
export class PgVectorSearchAdapter implements IVectorSearchPort {
  private readonly pool: Pool

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
  }

  async searchSimilar(queryVector: number[], topK: number): Promise<VectorMatch[]> {
    // pgvector 리터럴 형식: '[0.1,0.2,...]'
    const vectorLiteral = `[${queryVector.join(',')}]`
    const { rows } = await this.pool.query<DbRow>(
      `SELECT source_type, law_name, article_number, case_number, article_title,
              content, revision_date, enforcement_date, source_url,
              trust_tier, issuing_body, decision_date,
              1 - (embedding <=> $1::vector) AS similarity
       FROM taxlaw_embeddings
       WHERE content != ''
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [vectorLiteral, topK],
    )
    return rows.map((row) => ({ item: rowToTaxLaw(row), similarity: row.similarity }))
  }
}
