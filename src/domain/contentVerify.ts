/**
 * 내용(도메인 정확도) 검증기 — TAX-6B-9 (방안 A: 규칙 기반, 결정론적)
 *
 * ⚠️ law-verifier V1~V6와 **완전히 분리**된 별도 레이어다 (SSOT §13.2, CLAUDE.md §6.4).
 *    - V1~V6: "인용 정직성"(검색 결과에 없는 조문을 지어냈는가, 발췌가 원문과 다른가) 검사
 *    - 본 모듈: "인용은 정직하지만 도메인상 틀린"(조용한 틀림) 유형 검사
 *
 * 왜 필요한가:
 *   G5-06 — "대체 조항도 존재하지 않습니다"(사실 오류, 실제론 통합세액공제로 흡수) → V1~V6 PASS
 *   G5-10 — 현행 직접 근거(조특법 제121조의17)를 검색에서 놓침 → "직접 근거 없음"으로 응답 → V1~V6 PASS
 *   두 경우 모두 "거짓말"이 아니라 "사실 오류·검색 누락"이라 V1~V6로는 잡을 수 없다.
 *
 * 동작 원리(LLM·외부 API 미사용, 항상 같은 결과):
 *   - mustInclude: summary에 반드시 포함되어야 할 키워드 (없으면 FAIL)
 *   - mustExclude: summary에 있으면 안 되는 표현 (있으면 FAIL)
 *
 * 정답(expectedContent)은 **회계사가 작성·검수**한다 (정답 자동 생성 금지 — SSOT §7.8·§13.2,
 * 자기참조 채점 방지).
 */

/**
 * 기대 명제 — 골든셋 케이스에 회계사가 작성하는 내용 검증 사양
 */
export interface ContentSpec {
  /** summary에 반드시 포함되어야 할 키워드 목록 (정답의 핵심 명제) */
  mustInclude?: string[]
  /** summary에 포함되면 안 되는 표현 목록 (사실 오류·검색 누락 단정 표현) */
  mustExclude?: string[]
}

/**
 * 내용 검증 결과 — V1~V6 결과와 별도 트랙으로 보고
 */
export interface ContentCheckResult {
  status: 'CONTENT_PASS' | 'CONTENT_FAIL'
  /** mustInclude 중 summary에 없어서 실패한 키워드 */
  failedMustInclude: string[]
  /** mustExclude 중 summary에 있어서 실패한 표현 */
  failedMustExclude: string[]
}

/**
 * 매칭용 텍스트 정규화 — 연속 공백을 단일 공백으로 축약하고 양끝 공백 제거.
 *
 * 인용 무결성(V2)처럼 문자 단위 엄격 비교가 아니라, 회계사가 작성한 도메인 키워드의
 * 단순 포함 여부를 보는 것이므로 공백 차이로 인한 오탐만 방지한다.
 */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 답변 summary가 회계사가 정의한 기대 명제(ContentSpec)를 만족하는지 검증한다.
 *
 * @param summary - 시스템이 생성한 답변 요약 (LabeledAnswer.summary)
 * @param spec - 회계사가 작성한 기대 명제 (mustInclude / mustExclude)
 * @returns CONTENT_PASS / CONTENT_FAIL 및 실패 항목 목록
 */
export function checkContent(summary: string, spec: ContentSpec): ContentCheckResult {
  const normalizedSummary = normalize(summary)

  // mustInclude: 각 키워드가 summary에 포함되어야 한다
  const failedMustInclude = (spec.mustInclude ?? []).filter(
    (keyword) => !normalizedSummary.includes(normalize(keyword))
  )

  // mustExclude: 각 표현이 summary에 없어야 한다
  const failedMustExclude = (spec.mustExclude ?? []).filter((phrase) =>
    normalizedSummary.includes(normalize(phrase))
  )

  const status =
    failedMustInclude.length === 0 && failedMustExclude.length === 0
      ? 'CONTENT_PASS'
      : 'CONTENT_FAIL'

  return { status, failedMustInclude, failedMustExclude }
}
