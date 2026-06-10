/**
 * 시점 컨텍스트 — 회계사가 묻는 사실관계 발생 시점 (SSOT §3.3, CLAUDE.md §6.2)
 *
 * explicit=true 이면 회계사가 명시적으로 시점을 지정한 것.
 * explicit=false 이면 질문에서 시점을 추론(requestedAt 기준).
 * 시점이 모호한 경우 자의적 판단 금지 — 회계사에게 확인 요청.
 */
export interface TemporalContext {
  /** 답변 생성 요청 시각 */
  requestedAt: Date
  /** 회계사가 명시적으로 지정한 사실관계 기준 시점 (없으면 현행 기준) */
  targetDate?: Date
  /** 회계사가 시점을 명시적으로 지정했는지 여부 */
  explicit: boolean
}
