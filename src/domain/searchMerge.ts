import type { TaxLaw } from './TaxLaw'

/**
 * 검색 결과 병합·중복 제거 도메인 유틸 (TAX-6B-26)
 *
 * 배경:
 *   llmQueryRewriter는 서로 다른 검색어를 최대 3개까지 생성하지만
 *   generateAnswer가 queries[0] 하나만 검색해 나머지 쿼리의 근거가 통째로 버려졌다(재현율 손실).
 *   다중 쿼리 검색 결과를 하나로 합칠 때, 어느 단계에서 병합하든 동일한 식별 기준으로
 *   중복을 제거해야 하므로 그 기준을 이 도메인 모듈에 단일 진실 원천으로 둔다.
 */

/**
 * 자료 식별 키 — 검색 결과 병합·중복 제거의 단일 기준.
 * 법령=법령명+조문번호 / 비법령=자료유형+externalId 우선, 사건번호 폴백.
 * FallbackSearchPort의 벡터 병합(TAX-026-F)과 같은 기준을 공유해 중복 정책을 일원화한다.
 */
export function identityKey(t: TaxLaw): string {
  return t.sourceType === '법령'
    ? `법령|${t.lawName}|${t.articleNumber}`
    : `${t.sourceType}|${t.externalId?.trim() || (t.caseNumber ?? '')}`
}

/**
 * 여러 검색 결과 목록을 순서 보존 병합 + identityKey 기준 중복 제거.
 *
 * - 목록 간 순서(쿼리 우선순위)와 목록 내 순서(Trust Tier 정렬)를 모두 보존한다.
 * - 같은 자료가 여러 쿼리에서 나오면 **처음 등장한 항목만** 남긴다(first-wins).
 * - 원본 TaxLaw 객체를 변형하지 않는다(CLAUDE.md §6.1) — 참조만 재배열한다.
 */
export function mergeSearchItems(itemLists: TaxLaw[][]): TaxLaw[] {
  const seen = new Set<string>()
  const merged: TaxLaw[] = []
  for (const items of itemLists) {
    for (const item of items) {
      const key = identityKey(item)
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(item)
    }
  }
  return merged
}
