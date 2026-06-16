import type { MatchStage } from '../domain/SearchResult'

/**
 * 운영 쿼리 로그 1건 (TAX-030-A, FR-23)
 *
 * 회계사 식별 정보(이메일·이름·IP)를 일절 포함하지 않는다 (CLAUDE.md §7).
 * - queryNorm: maskPhoneEmail 적용 후 질문 (휴대폰·이메일 마스킹)
 * - queryHash: SHA-256(원본질문) 앞 16자 — 중복 패턴 집계용(고유키 아님)
 */
export interface OpsQueryLogEntry {
  /** 마스킹된 질문 — maskPhoneEmail 적용 후 */
  queryNorm: string
  /** SHA-256(원본질문) 앞 16자 — 패턴 집계용 */
  queryHash: string
  /** 검색 단계 — 'direct'|'vector'|'expanded' (옵셔널) */
  matchStage?: MatchStage
  /** 답변에 사용된 출처 유형 목록 — ['법령','심판례'] 등 */
  sourceTypes: string[]
  /** 검증 상태 — 성공(PASS) 또는 E-VERIFY-FAIL(FAIL) */
  verifyStatus: 'PASS' | 'FAIL'
  /** 실패한 검증 항목 — ['v2','v3'] 등 (PASS면 빈 배열) */
  failedChecks: string[]
  /** 처리 소요 시간(ms) */
  latencyMs: number
}

/**
 * 운영 쿼리 로그 Port 인터페이스 (TAX-030-A)
 *
 * Usecase는 이 Port만 호출하고 DB I/O는 어댑터에 위임한다 (CLAUDE.md §4).
 * 적재 실패가 답변 생성을 막지 않도록(fail-soft) 호출 측에서 예외를 삼킨다.
 * 👎 신고(recordFeedback)는 TAX-030-B에서 본 인터페이스에 확장 예정.
 */
export interface IOpsLogPort {
  /** 쿼리 처리 메타데이터 1건을 적재한다 */
  recordQuery(entry: OpsQueryLogEntry): Promise<void>
}
