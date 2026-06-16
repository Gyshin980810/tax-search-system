import 'server-only'
import { Pool } from 'pg'
import type {
  IOpsLogPort,
  OpsQueryLogEntry,
  OpsFeedbackEntry,
  OpsFeedbackRow,
} from '../ports/opsLogPort'

/**
 * 운영 쿼리 로그 어댑터 — Neon Postgres INSERT (TAX-030-A, FR-23)
 *
 * pg Pool 패턴은 vectorSearch.ts와 동일(SSL rejectUnauthorized:false).
 * 기존 DATABASE_URL을 재사용하며 신규 환경변수는 없다 (CLAUDE.md §7.1).
 * 비즈니스 판단 없이 INSERT 1건만 수행한다 (CLAUDE.md §4 Adapter 책임).
 */
export class PgOpsLogAdapter implements IOpsLogPort {
  private readonly pool: Pool

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
  }

  async recordQuery(entry: OpsQueryLogEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO ops_query_log
         (query_norm, query_hash, match_stage, source_types, verify_status, failed_checks, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.queryNorm,
        entry.queryHash,
        entry.matchStage ?? null,
        entry.sourceTypes,
        entry.verifyStatus,
        entry.failedChecks,
        entry.latencyMs,
      ],
    )
  }

  // 조용한 틀림 신고 1건 적재 (TAX-030-B, FR-24) — 기존 Pool 재사용
  async recordFeedback(entry: OpsFeedbackEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO ops_feedback
         (query_hash, query_norm, reason, source_types)
       VALUES ($1, $2, $3, $4)`,
      [entry.queryHash, entry.queryNorm, entry.reason, entry.sourceTypes],
    )
  }

  // 신고 환류 집계 조회 (TAX-030-C) — query_hash로 묶어 빈도순 정렬, 읽기 전용
  // query_norm·source_types는 가장 최근 신고분을 대표값으로, reason은 빈 값 제외 후 모음.
  async listFeedback(): Promise<OpsFeedbackRow[]> {
    const { rows } = await this.pool.query(
      `SELECT
         query_hash,
         (array_agg(query_norm ORDER BY created_at DESC))[1]   AS query_norm,
         (array_agg(source_types ORDER BY created_at DESC))[1] AS source_types,
         array_remove(array_agg(NULLIF(reason, '') ORDER BY created_at DESC), NULL) AS reasons,
         COUNT(*)::int                                         AS report_count,
         MAX(created_at)                                       AS last_reported_at
       FROM ops_feedback
       GROUP BY query_hash
       ORDER BY report_count DESC, last_reported_at DESC`,
    )
    return rows.map((r) => ({
      queryHash: r.query_hash,
      queryNorm: r.query_norm,
      sourceTypes: r.source_types ?? [],
      reasons: r.reasons ?? [],
      reportCount: r.report_count,
      lastReportedAt:
        r.last_reported_at instanceof Date
          ? r.last_reported_at.toISOString()
          : String(r.last_reported_at),
    }))
  }
}

/**
 * 운영 쿼리 로그 no-op 어댑터 (TAX-030-A)
 *
 * DATABASE_URL이 없는 로컬·테스트 환경에서 주입한다.
 * recordQuery가 즉시 resolve해 수집을 조용히 건너뛴다(fail-soft 기본값).
 */
export class NullOpsLogAdapter implements IOpsLogPort {
  async recordQuery(_entry: OpsQueryLogEntry): Promise<void> {
    // no-op: 수집 비활성 환경 — 답변 생성에 영향을 주지 않는다
  }

  async recordFeedback(_entry: OpsFeedbackEntry): Promise<void> {
    // no-op: 수집 비활성 환경 — 신고는 조용히 건너뛴다(로컬·테스트용)
  }

  async listFeedback(): Promise<OpsFeedbackRow[]> {
    // no-op: 수집 비활성 환경 — 집계할 신고가 없으므로 빈 배열
    return []
  }
}
