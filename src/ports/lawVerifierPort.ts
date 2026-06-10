import type { LabeledAnswer } from '../domain/LabeledAnswer'
import type { TaxLaw } from '../domain/TaxLaw'
import type { VerificationResult } from '../domain/VerificationResult'

/**
 * law-verifier 검증 Port 인터페이스 (SSOT §3.2, CLAUDE.md §6.4)
 *
 * Usecase(generateAnswer.ts)는 이 인터페이스만 의존합니다.
 * LawVerifierAdapter 교체 시 Usecase 코드 변경이 불필요합니다.
 *
 * 검증 흐름:
 *   [3] 답변 생성 완료 → verify() 호출 → [4] V1~V6 검증
 *   PASS: 회계사에게 답변 노출 허용
 *   FAIL: 재시도 정책 적용 → 재시도 후에도 FAIL → E-VERIFY-FAIL
 *
 * 재시도 정책 (Usecase가 VerificationResult를 보고 판단):
 *   V1(출처 존재) 실패 → 재검색 1회
 *   V2~V6 실패 → 재생성 1회
 *   재시도 후에도 FAIL → E-VERIFY-FAIL AppError throw
 */
export interface ILawVerifierPort {
  /**
   * LabeledAnswer를 V1~V6 체크리스트로 검증한다.
   *
   * @param answer      검증 대상 답변 (LLM이 생성한 LabeledAnswer)
   * @param sourceLaws  RAG [2]단계에서 검색한 원본 TaxLaw 배열 (V1·V2 검증의 기준)
   * @returns           PASS 또는 FAIL 상태와 항목별 결과, 실패 원인 목록
   */
  verify(answer: LabeledAnswer, sourceLaws: TaxLaw[]): Promise<VerificationResult>
}
