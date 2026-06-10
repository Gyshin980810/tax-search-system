/**
 * 검색 쿼리 값 객체
 * PII 필터 통과 후 Usecase에서 생성됩니다 (CLAUDE.md §7)
 */
export interface SearchQuery {
  /** 검색 키워드 — PII 검증 완료된 값 */
  keyword: string
  /** 쿼리 생성 시각 — 시점 라벨 부착에 사용 (CLAUDE.md §6.2) */
  requestedAt: Date
  /**
   * 조문번호 힌트 (TAX-049) — 사전 룩업에서만 부여(선택).
   *
   * 부여되면 어댑터 `fetchArticles`는 해당 법령의 모든 조문 중
   * 이 조문번호(예: "제70조")와 정확히 일치하는 조문만 items에 포함한다.
   * 외부 검색 호출 수는 그대로(증가 없음).
   * 부여되지 않으면 어댑터는 기존 동작(모든 조문 반환) — 회귀 무영향.
   */
  articleNumberHint?: string
}
