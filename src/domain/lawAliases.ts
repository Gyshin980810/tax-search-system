/**
 * 세법 약칭 사전 + 법령명 정확매칭 선택 (TAX-031)
 *
 * 목적(통증 A): 검색 API 랭킹 1위가 동음이의 법령일 수 있다(실측: "지방세법" → 1위 "지방교부세법").
 *   현재 어댑터는 `laws[0]`을 무조건 채택해 오매칭이 발생한다. 본 모듈은
 *   (1) 회계사 약칭을 정식 법령명으로 정규화하고,
 *   (2) 검색 후보에서 정식 법령명과 가장 정확히 일치하는 법령을 선택한다.
 *
 * 이 모듈은 순수 함수만 포함한다(외부 I/O·부수효과 없음) → 단위 테스트로 검증.
 * 매칭 "근거"는 로깅 대신 반환값(matchType)으로 노출한다(어댑터에 로깅 인프라 없음, §9.7 최소 변경).
 */

/**
 * 세법 약칭 → 정식 법령명 사전 (회계사 확정 2026-05-24).
 * 닫힌 집합으로 시작하며, 확장 시 회계사 승인 필요(임의 추가 금지).
 * 정식 법령명(예: "소득세법")은 별칭이 아니므로 등록하지 않는다 — 그대로 통과시킨다.
 */
export const LAW_ALIASES: Readonly<Record<string, string>> = {
  조특법: '조세특례제한법',
  국기법: '국세기본법',
  부가세법: '부가가치세법',
  상증세법: '상속세 및 증여세법',
  상증법: '상속세 및 증여세법',
  종부세법: '종합부동산세법',
}

/**
 * 약칭을 정식 법령명으로 정규화한다. 사전에 없으면 입력을 그대로(공백 제거) 반환한다.
 * @param keyword 회계사 검색어(법령명 또는 약칭)
 * @returns 정식 법령명(약칭이면 확장, 아니면 trim된 원본)
 */
export function normalizeLawName(keyword: string): string {
  const trimmed = (keyword ?? '').trim()
  return LAW_ALIASES[trimmed] ?? trimmed
}

/** 매칭 근거 — 정확도가 높은 순서 (exact > prefix > partial > fallback) */
export type LawMatchType = 'exact' | 'prefix' | 'partial' | 'fallback'

export interface LawMatch<T> {
  law: T
  /** 어떤 규칙으로 선택됐는지 — 로깅 대신 추적·테스트에 사용 */
  matchType: LawMatchType
}

/**
 * 검색 후보 중 정식 법령명과 가장 정확히 일치하는 법령을 선택한다.
 * 우선순위: 완전일치 > 접두일치 > 부분일치 > 첫 번째(폴백).
 *
 * - 완전일치가 접두일치를 이기므로 "지방세법"이 "지방세법 시행령"보다 우선된다.
 * - 폴백(매칭 실패)은 기존 동작(laws[0])과 동일하되 matchType='fallback'으로 신호한다.
 *
 * @param laws  검색 결과 후보(법령명한글 필드 보유). 빈 배열이면 null.
 * @param normalizedName  normalizeLawName으로 정규화된 정식 법령명
 */
export function selectBestLaw<T extends { 법령명한글: string }>(
  laws: readonly T[],
  normalizedName: string,
): LawMatch<T> | null {
  if (laws.length === 0) return null
  const target = (normalizedName ?? '').trim()

  // 1) 완전일치 — "지방세법" === "지방세법"
  const exact = laws.find((l) => l.법령명한글 === target)
  if (exact) return { law: exact, matchType: 'exact' }

  // 2) 접두일치 — "지방세법 시행령".startsWith("지방세법")
  const prefix = laws.find((l) => l.법령명한글.startsWith(target))
  if (prefix) return { law: prefix, matchType: 'prefix' }

  // 3) 부분일치 — 법령명한글에 검색어가 포함
  const partial = laws.find((l) => l.법령명한글.includes(target))
  if (partial) return { law: partial, matchType: 'partial' }

  // 4) 폴백 — 기존 동작(첫 번째) 유지하되 신호
  return { law: laws[0], matchType: 'fallback' }
}
