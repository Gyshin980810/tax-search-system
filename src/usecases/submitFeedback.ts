import { createHash } from 'node:crypto'
import { detectPii, maskPhoneEmail } from '../utils/piiFilter'
import type { IOpsLogPort } from '../ports/opsLogPort'

/**
 * 조용한 틀림 신고 Usecase (TAX-030-B, FR-24)
 *
 * 검증(V1~V6)은 통과했으나 회계사가 실제 오답으로 판단한 답변을 신고로 수집한다.
 * 계층 규칙(CLAUDE.md §4): Port만 호출하고 DB I/O는 어댑터에 위임한다.
 *
 * ⚠️ fail-soft가 아님 — 신고는 회계사의 명시적 액션이라 결과 피드백이 중요하다.
 *    적재 실패(또는 PII 거부)는 호출 측(route)으로 전파해 적절한 HTTP 상태를 반환한다.
 *    (성공 부수효과로 조용히 삼키는 recordQuery[TAX-030-A]와 의도적으로 다르다.)
 *
 * @param opsLog - 운영 로그 Port (DATABASE_URL 유무에 따라 Pg/Null 주입)
 * @param rawQuestion - 신고 대상 답변의 원본 질문 (마스킹·해시 전)
 * @param reason - 회계사가 입력한 신고 사유 (선택 — 빈 값 가능)
 * @param sourceTypes - 답변에 사용된 출처 유형 목록 (['법령','심판례'] 등)
 * @throws {PiiDetectedError} 질문 또는 사유에 주민·사업자번호가 포함된 경우
 */
export async function submitFeedback(
  opsLog: IOpsLogPort,
  rawQuestion: string,
  reason: string | undefined,
  sourceTypes: string[],
): Promise<void> {
  const reasonText = reason ?? ''

  // 주민·사업자번호는 저장 거부 (CLAUDE.md §7) — 질문·사유 모두 검사
  detectPii(rawQuestion)
  detectPii(reasonText)

  // 휴대폰·이메일은 마스킹 후 저장 (CLAUDE.md §7, SSOT §14.2)
  const queryNorm = maskPhoneEmail(rawQuestion)
  const reasonNorm = maskPhoneEmail(reasonText)

  // SHA-256 앞 16자 — ops_query_log와 동일 질문 패턴 조인용(고유키 아님)
  const queryHash = createHash('sha256').update(rawQuestion).digest('hex').slice(0, 16)

  await opsLog.recordFeedback({
    queryHash,
    queryNorm,
    reason: reasonNorm,
    sourceTypes,
  })
}
