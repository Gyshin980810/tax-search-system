import 'server-only'
import { Pool } from 'pg'
import type { ICitationGraphPort, CitationEdge } from '../ports/citationGraphPort'
import type { TaxLaw, SourceType, TrustTier } from '../domain/TaxLaw'

/** taxlaw_embeddings 문서 조회 행 (embedding 컬럼 제외 — 본문 조회 전용) */
interface DocRow {
  source_type: string
  law_name: string
  article_number: string | null
  case_number: string | null
  article_title: string | null
  content: string
  revision_date: string | Date | null
  enforcement_date: string | Date | null
  source_url: string
  trust_tier: string
  issuing_body: string | null
  decision_date: string | Date | null
}

/**
 * pg DATE 컬럼 값(Date 객체 또는 문자열)을 'YYYY-MM-DD' 문자열로 정규화.
 * (vectorSearch.ts와 동일 규칙 — 해당 파일 무변경 유지를 위해 최소 중복)
 */
function toIsoDateString(value: string | Date | null): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return value
}

/** taxlaw_embeddings 행 → 도메인 TaxLaw (content 원문 그대로, §6.1 무변형) */
function rowToTaxLaw(row: DocRow): TaxLaw {
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
 * 인용 그래프 조회 어댑터 (TAX-6B-32) — ICitationGraphPort 구현체.
 *
 * citation_edges(순수 텍스트 엣지, TAX-6B-31 적재)와 taxlaw_embeddings를 SQL 배치로 조회한다.
 *  - 모든 조회는 `= ANY($1)` 배치 1쿼리(왕복 최대 3회) — LLM·임베딩 호출 0(P95 보호).
 *  - 입력 사건번호는 usecase에서 이미 정규화(normalizeTribunalCaseNumber)돼 들어온다고 가정한다
 *    — DB의 from_id/to_id/case_number가 같은 정규화 형식이므로 표기 변이로 어긋나지 않는다.
 *  - vectorSearch.ts의 Pool 연결 패턴을 따른다(Neon SSL).
 */
export class PgCitationGraphAdapter implements ICitationGraphPort {
  private readonly pool: Pool

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
  }

  /**
   * 1-hop 확장: 주어진 문서들이 인용한 대상 엣지.
   *  - in_corpus=true(코퍼스 보유분)만 — 확장은 실제 조회 가능한 문서로 한정.
   *  - edge_type IN ('FOLLOWS','REFERS')만 — APPEAL(원심/환송)은 "선례 지지"가 아니라
   *    "같은 사건 다른 심급"이므로 확장에서 제외한다(TAX-6B-32 §2.3).
   */
  async getOutgoing(caseNumbers: string[]): Promise<CitationEdge[]> {
    if (caseNumbers.length === 0) return []
    const { rows } = await this.pool.query<{ from_id: string; to_id: string; to_type: string; edge_type: string }>(
      `SELECT from_id, to_id, to_type, edge_type
       FROM citation_edges
       WHERE from_id = ANY($1) AND in_corpus = true
         AND edge_type IN ('FOLLOWS','REFERS')`,
      [caseNumbers],
    )
    return rows.map((r) => ({ fromId: r.from_id, toId: r.to_id, toType: r.to_type, edgeType: r.edge_type }))
  }

  /** 피인용수(in-degree) — 각 사건번호가 몇 번 인용됐는지 집계 */
  async getInDegrees(caseNumbers: string[]): Promise<Map<string, number>> {
    if (caseNumbers.length === 0) return new Map()
    const { rows } = await this.pool.query<{ to_id: string; n: string }>(
      `SELECT to_id, count(*)::int AS n
       FROM citation_edges
       WHERE to_id = ANY($1)
       GROUP BY to_id`,
      [caseNumbers],
    )
    // count(*)는 pg에서 문자열로 오므로 Number로 변환
    return new Map(rows.map((r) => [r.to_id, Number(r.n)]))
  }

  /** 확장 문서 본문 조회 — 사건번호로 taxlaw_embeddings 조회(content 원문 그대로) */
  async getDocumentsByCaseNumbers(caseNumbers: string[]): Promise<TaxLaw[]> {
    if (caseNumbers.length === 0) return []
    const { rows } = await this.pool.query<DocRow>(
      `SELECT source_type, law_name, article_number, case_number, article_title,
              content, revision_date, enforcement_date, source_url,
              trust_tier, issuing_body, decision_date
       FROM taxlaw_embeddings
       WHERE case_number = ANY($1) AND content != ''`,
      [caseNumbers],
    )
    return rows.map(rowToTaxLaw)
  }
}
