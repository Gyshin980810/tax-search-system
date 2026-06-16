import 'server-only'
import { Pool } from 'pg'
import type { IOpsLogPort, OpsQueryLogEntry } from '../ports/opsLogPort'

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
}
