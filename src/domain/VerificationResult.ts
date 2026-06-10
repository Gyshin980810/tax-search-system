/**
 * law-verifier V1~V6 검증 결과 (CLAUDE.md §6.4)
 *
 * M3에서 law-verifier가 통합되어 verify()가 PASS/FAIL을 산출합니다.
 * status='PENDING'은 검증을 수행하지 않은 상태(골든셋 픽스처 초기값 등)이며,
 * 회계사에게는 검증 미완료임을 명시하고 노출되지 않습니다(AnswerCard 화이트리스트).
 */
export type VerifyStatus = 'PASS' | 'FAIL' | 'PENDING'

export interface VerificationResult {
  /** 전체 검증 상태 */
  status: VerifyStatus
  /** 항목별 검증 결과 */
  checks: {
    /** V1: 인용된 모든 조문이 검색 결과에 존재 */
    v1: boolean
    /** V2: 모든 발췌가 원문과 문자 단위 일치 */
    v2: boolean
    /** V3: Trust Tier에 맞는 라벨 사용 */
    v3: boolean
    /** V4: 시점 라벨 부착 여부 */
    v4: boolean
    /** V5: 면책 고지 부착 여부 */
    v5: boolean
    /** V6: 🟡 라벨에서 단정형 표현 미사용 */
    v6: boolean
  }
  /** 실패 시 원인 목록 */
  failReasons: string[]
}

/** PENDING 기본값 생성 헬퍼 — 골든셋 픽스처 초기값 등 검증 미수행 표현용 */
export function pendingVerification(): VerificationResult {
  return {
    status: 'PENDING',
    checks: { v1: false, v2: false, v3: false, v4: false, v5: false, v6: false },
    failReasons: [],
  }
}
