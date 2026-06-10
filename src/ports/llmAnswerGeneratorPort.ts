import type { TaxLaw } from '../domain/TaxLaw'
import type { LabeledAnswer } from '../domain/LabeledAnswer'
import type { TemporalContext } from '../domain/TemporalContext'
import type { MatchStage } from '../domain/SearchResult'

/**
 * LLM 답변 생성 Port 인터페이스 (SSOT §3.3 [3]단계)
 *
 * 검색된 TaxLaw 배열을 받아 라벨링·시점 표기·인용 무결성을 보장한
 * LabeledAnswer를 생성합니다. Adapter 교체 시 Usecase 코드 변경 불필요.
 */
export interface IAnswerGeneratorPort {
  /**
   * 법령 검색 결과 → 라벨링된 답변 생성
   * @param laws 검색된 법령 조문 배열 (원문 보존 필수)
   * @param question 회계사 원본 질문
   * @param temporal 시점 컨텍스트
   * @param matchStage 검색 단계 — vector/expanded 시 라벨 강제 하향 (TAX-026-G, 옵셔널)
   * @returns 라벨링·시점 표기된 답변 (verificationResult는 M2에서 PENDING)
   */
  generate(
    laws: TaxLaw[],
    question: string,
    temporal: TemporalContext,
    matchStage?: MatchStage,
  ): Promise<LabeledAnswer>
}
