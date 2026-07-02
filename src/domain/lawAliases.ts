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

// ─── TAX-6B-24: 법리축 분리 ──────────────────────────────────────────────────
//
// 배경: TAX-042G(enforceAxisCombination)가 검색어를 "법리축 + 사실축" 결합 형태로
//   강제한다(예: "법인세법" → "법인세법 손비"). 이 결합 키워드가 그대로 법령명 검색
//   (searchLaws)·법령 선택(selectBestLaw)에 쓰이면, "법인세법 손비"라는 법령명은 없으므로
//   searchLaws 0건 또는 selectBestLaw fallback(laws[0] 무조건 채택)으로 추락해 TAX-031
//   정확매칭이 무력화된다.
//
// 처방: 법령명 매칭 경로에는 법리축("법인세법")만 넘기고, 사실축("손비")은 분리한다.
//   순수 함수이므로 단위 테스트로 검증한다(외부 I/O·부수효과 없음).
//
// 주의(§6.1 무관): 원문을 읽지 않고 검색어 문자열만 토큰 분해한다.

/**
 * splitLegalAxis 결과.
 * - legalAxis: 법령명 검색·selectBestLaw에 사용할 법리축.
 *   법령명 토큰을 못 찾으면 입력 전체를 그대로 담아 기존 동작을 보존한다(회귀 0건).
 * - factAxis: 조문 선별용 사실축. 본 티켓(TAX-6B-24)에서는 소비하지 않으며,
 *   TAX-6B-25가 필요 시 동일 함수로 재도출한다. 없으면 빈 문자열.
 */
export interface LegalAxisSplit {
  legalAxis: string
  factAxis: string
}

/** "~법" 형태 법령명 머리 토큰 (예: "법인세법", "증여세법", "조특법"). */
const LAW_HEAD_TOKEN = /^[가-힣]+법$/
/** 법령명 뒤에 붙는 하위 법령 토큰 (예: "법인세법 시행령"). */
const LAW_TAIL_TOKEN = /^(시행령|시행규칙)$/

/**
 * 검색어에서 법리축(법령명)과 사실축(쟁점)을 분리한다.
 *
 * 규칙:
 *  1) 공백으로 토큰화한 뒤 "~법" 패턴에 맞는 **마지막** 토큰을 법령명 끝으로 본다.
 *     - 처음부터 그 토큰까지를 법리축으로 묶어 다단어 법령명("상속세 및 증여세법")을 보존한다.
 *     - 바로 뒤에 "시행령"/"시행규칙"이 오면 함께 흡수한다("법인세법 시행령").
 *  2) "~법" 토큰이 없으면(예: "접대비") 입력 전체를 legalAxis로 반환한다
 *     → 기존 동작(searchLaws에 원본 전달)과 동일, 회귀 0건.
 *
 * @param keyword 검색어(결합 키워드일 수 있음)
 */
export function splitLegalAxis(keyword: string): LegalAxisSplit {
  const trimmed = (keyword ?? '').trim()
  if (!trimmed) return { legalAxis: '', factAxis: '' }

  const tokens = trimmed.split(/\s+/)

  // "~법" 패턴에 맞는 마지막 토큰 위치 탐색
  let headIdx = -1
  for (let i = 0; i < tokens.length; i++) {
    if (LAW_HEAD_TOKEN.test(tokens[i])) headIdx = i
  }

  // 법령명 토큰이 없으면 원본 그대로 통과 (회귀 0건 보장)
  if (headIdx === -1) return { legalAxis: trimmed, factAxis: '' }

  // "시행령"/"시행규칙" 후행 토큰 흡수
  let endIdx = headIdx
  if (endIdx + 1 < tokens.length && LAW_TAIL_TOKEN.test(tokens[endIdx + 1])) {
    endIdx += 1
  }

  const legalAxis = tokens.slice(0, endIdx + 1).join(' ')
  const factAxis = tokens.slice(endIdx + 1).join(' ')
  return { legalAxis, factAxis }
}
