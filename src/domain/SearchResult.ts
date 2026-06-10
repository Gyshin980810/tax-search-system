import type { TaxLaw } from './TaxLaw'

/**
 * 검색 단계 — 어느 단계에서 결과가 채워졌는지 (TAX-026-F)
 * 라벨 자동 결정에 사용됨: direct→Trust Tier 따름, vector→🟡, expanded→⚪
 */
export type MatchStage = 'direct' | 'vector' | 'expanded'

/** 검색 결과 */
export interface SearchResult {
  /** 조문 목록 — 정렬: 개정일↓ → 시행일↓ → 조문번호↑ (SSOT §7.7) */
  items: TaxLaw[]
  /** 전체 검색 결과 수 */
  totalCount: number
  /** 결과를 채운 검색 단계 (하위호환 — 옵셔널, TAX-026-F) */
  matchStage?: MatchStage
}
