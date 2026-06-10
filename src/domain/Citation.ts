import type { TaxLaw } from './TaxLaw'

/**
 * 인용 라벨 — CLAUDE.md §6.3 라벨링 시스템
 * 직접근거: T1/T2 출처, 단정형 허용
 * 유사사례: T3/T4 출처 또는 사실관계 차이 있음, 단정형 금지
 * 참고자료: 관련 쟁점만 다룸
 * 폐지: 폐지·삭제된 조문
 */
export type CitationLabel =
  | '🟢직접근거'
  | '🟡유사사례'
  | '⚪참고자료'
  | '⚫폐지'

/**
 * 인용 — 법령 조문에서 발췌한 단위 (CLAUDE.md §6.1)
 *
 * excerpt는 taxLaw.content 원문에서 직접 추출해야 하며,
 * LLM이 임의로 생성·의역한 텍스트는 절대 허용되지 않습니다.
 * 부분 인용 시 생략 표시는 (…)로 통일합니다.
 */
export interface Citation {
  /** 원본 법령 조문 — 변형 금지, 참조만 허용 */
  taxLaw: TaxLaw
  /** 신뢰도 라벨 */
  label: CitationLabel
  /** 조문 원문에서 직접 발췌한 텍스트 — 원문과 문자 단위 일치 필수 */
  excerpt: string
  /** 시점 라벨 — [현행] | [적용 시점: YYYY.MM.DD~YYYY.MM.DD] | [폐지: YYYY.MM.DD] */
  temporalLabel: string
}
