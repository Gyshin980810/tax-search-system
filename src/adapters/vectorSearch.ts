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
  revision_date: string | null
  enforcement_date: string | null
  source_url: string
  trust_tier: string
  issuing_body: string | null
  decision_date: string | null
  similarity: number
}

function rowToTaxLaw(row: DbRow): TaxLaw {
  return {
    sourceType: row.source_type as SourceType,
    lawName: row.law_name,
    articleNumber: row.article_number ?? '',
    articleTitle: row.article_title ?? '',
    content: row.content,
    revisionDate: row.revision_date ?? '',
    enforcementDate: row.enforcement_date ?? '',
    sourceUrl: row.source_url,
    trustTier: row.trust_tier as TrustTier,
    ...(row.case_number   ? { caseNumber:   row.case_number }   : {}),
    ...(row.issuing_body  ? { issuingBody:  row.issuing_body }  : {}),
    ...(row.decision_date ? { decisionDate: row.decision_date } : {}),
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
