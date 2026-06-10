import type { Citation } from './Citation'
import type { TaxLaw } from './TaxLaw'
import type { VerificationResult } from './VerificationResult'

/**
 * V3 라벨 적정성 진단 마커 — TAX-042D 풀세트 보강 E·F·G (운영·로그 전용)
 *
 * ⚠️ V3 PASS/FAIL 판정 자체는 lawVerifier.ts의 checkV3가 단독 수행한다.
 *    본 타입은 진단 신호일 뿐 회계사 화면 라벨에 영향을 주지 않는다
 *    (CLAUDE.md §6.4 V3·V6 판정 로직 절대 무변경 보호).
 *
 * - verifyMarker:
 *     VERIFIED        — V3 PASS (Tier-라벨 매핑 정확)
 *     PARTIAL_VERIFIED — V3 FAIL이지만 안전 방향(T1·T2 자료에 ⚪참고자료, over-cautious)
 *     LABEL_MISMATCH  — 위 어느 쪽도 아님 (위험 방향, T3·T4 자료에 🟢직접근거 등)
 * - tierMatchGrade: verifyMarker 근거 등급(exact|loose|mismatch)
 * - v3Groups: V3 세부 그룹별 진단(라벨 enum / Tier 매핑 / 폐지)
 */
export interface VerifyDiagnostics {
  verifyMarker: 'VERIFIED' | 'PARTIAL_VERIFIED' | 'LABEL_MISMATCH'
  tierMatchGrade: 'exact' | 'loose' | 'mismatch'
  v3Groups: {
    labelEnum: 'pass' | 'fail'
    tierMapping: 'pass' | 'fail'
    deprecation: 'pass' | 'fail'
  }
}

/**
 * 라벨링된 답변 — RAG 3단계([3] 답변 생성) 산출물 (SSOT §3.3)
 *
 * citations 배열에 있는 excerpt는 원문과 문자 단위 일치 필수 (CLAUDE.md §6.1).
 * disclaimer는 src/domain/disclaimer.ts의 DISCLAIMER 상수 그대로 사용.
 * verificationResult.status가 PENDING이면 회계사에게 검증 미완료 안내 필수.
 */
export interface LabeledAnswer {
  /** 회계사가 입력한 원본 질문 */
  rawQuestion: string
  /** 인용 목록 — Trust Tier 내림차순 정렬 */
  citations: Citation[]
  /** LLM 생성 요약 — 🟡 유사사례에서 단정형 표현 금지 */
  summary: string
  /** 면책 고지 — DISCLAIMER 상수 그대로 */
  disclaimer: string
  /** 전체 답변의 시점 라벨 */
  temporalLabel: string
  /** law-verifier V1~V6 검증 결과 (M2: PENDING) */
  verificationResult: VerificationResult
  /** 답변 생성 시각 */
  generatedAt: Date
  /**
   * 참고 목록 — 본문 미제공으로 발췌 인용할 수 없는 비법령 자료 (TAX-015B).
   *
   * 세법 판례의 대부분(국세청 출처)은 공식 API가 본문을 제공하지 않아 발췌 인용이
   * 불가능하다. 이런 자료를 결과에서 제외하면 회계사가 관련 판례 존재조차 못 보므로,
   * 사건명·선고일·원문 링크만 ⚪참고자료로 노출한다.
   *
   * - 검색 결과 원문(메타)이라 환각 위험이 없다.
   * - citation이 아니므로 law-verifier V1~V6 검증 대상이 아니다.
   * - 발췌(excerpt)를 생성하지 않는다(V2 우회 금지 — citation으로 승격 불가).
   */
  references?: TaxLaw[]
  /**
   * V3 라벨 적정성 진단 마커 — TAX-042D 풀세트 보강 E·F·G (운영·로그 전용).
   *
   * generateAnswer Usecase가 runTwoStage 종료 직후 부착한다.
   * lawVerifier의 V3 PASS/FAIL 판정과 독립이며 회계사 화면 라벨에 영향을 주지 않는다.
   */
  diagnostics?: VerifyDiagnostics
}
