/**
 * 비법령(판례·심판례·해석례) 관련도 점수 (TAX-6B-10 usecase + TAX-6B-11 adapter 공유).
 *
 * 검색어 토큰이 자료의 사건명·명칭(강한 신호)과 본문(약한 신호)에 얼마나 포함되는지로 점수화한다.
 *  - usecase(generateAnswer): 참고 목록 정렬·컷오프에 사용(제목 + 본문).
 *  - adapter(nationalTaxLaw): 목록 단계에서 본문 조회 대상 선별에 사용(제목만 — 본문은 아직 미조회).
 *
 * 부분 문자열 포함(includes) 기반의 가벼운 휴리스틱이며, 원문을 변형하지 않고 읽기만 한다 (CLAUDE.md §6.1).
 * 두 계층이 같은 기준으로 동작하도록 단일 진실 원천으로 둔다. 의미 기반 유사도(벡터DB)는 별도 트랙이다.
 */
import { NONLAW_STOPWORDS } from './nonLawQueryNormalize'

/** 사건명·명칭 매칭 가중치(강한 신호) — 본문 매칭보다 우선 */
export const TITLE_MATCH_WEIGHT = 2
/** 본문(content) 매칭 가중치(약한 신호) — 제목엔 없지만 본문에서 쟁점을 다루는 자료를 건짐 */
export const BODY_MATCH_WEIGHT = 1

/**
 * 검색어를 관련도 산정용 토큰으로 분해한다.
 *  - 2글자 이상만 사용(한 글자 토큰의 과매칭 방지).
 *  - 비법령 불용어("관련", "여부" 등)는 제거 — 헛매칭으로 무관 자료가 점수를 얻는 것을 막는다.
 *    (사전은 nonLawQueryNormalize의 NONLAW_STOPWORDS 재활용)
 */
export function extractTerms(keyword: string): string[] {
  return keyword
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !NONLAW_STOPWORDS.has(t))
}

/**
 * 관련도 점수를 산출한다.
 *  - title(사건명·명칭) 매칭 = 강한 신호(TITLE_MATCH_WEIGHT).
 *  - body(본문) 매칭 = 약한 신호(BODY_MATCH_WEIGHT). 목록 단계에서는 body=''로 호출(본문 미조회).
 *  - 한 term이 양쪽에 있으면 강한 신호로만 1회 계산(중복 합산 금지).
 */
export function scoreRelevance(title: string, body: string, terms: string[]): number {
  let score = 0
  for (const term of terms) {
    if (title.includes(term)) score += TITLE_MATCH_WEIGHT
    else if (body.includes(term)) score += BODY_MATCH_WEIGHT
  }
  return score
}

// ─── 의미(벡터) 유사도 — TAX-6B-12 방향 C ─────────────────────────────────────
//
// 글자(부분문자열) 매칭은 표기 변이("양도소득세"↔"양도세")·동의어를 놓친다.
// 의미 임베딩의 cosine 유사도로 이를 보강하되, 글자 점수와 가중합해 둘 중 한 신호만 강해도 살린다.

/**
 * 의미 유사도 가중치 — 글자 점수(정수)와 합산하기 위한 스케일.
 *  combinedScore = textScore + SEMANTIC_WEIGHT × cosine 이므로,
 *  글자 0점이어도 cosine ≈ 1/SEMANTIC_WEIGHT(≈0.33) 이상이면 컷오프(MIN_RELEVANCE_SCORE=1)를 통과한다.
 *  (값↑ = 의미 신호를 더 신뢰. 실측 후 튜닝 여지)
 */
export const SEMANTIC_WEIGHT = 3

/**
 * 두 벡터의 cosine 유사도(-1~1)를 계산한다.
 *  - 길이가 0이거나 서로 다르면 0(안전).
 *  - 한쪽이라도 영벡터면 0(0 나눗셈 방지).
 * 원문을 읽지 않는 순수 수치 연산이다 (CLAUDE.md §6.1 무관).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * 글자 점수와 의미 유사도를 가중합한다.
 *  combined = textScore + SEMANTIC_WEIGHT × max(0, cosine)
 *  - 음수 cosine(반대 의미)은 0으로 클램프 — 점수를 깎지 않는다(글자 신호 보존).
 *  - 글자 점수 1+ 자료는 cosine과 무관하게 통과(기존 동작 회귀 없음).
 */
export function combinedScore(textScore: number, cosine: number): number {
  return textScore + SEMANTIC_WEIGHT * Math.max(0, cosine)
}

// ─── 피인용 부스트 — TAX-6B-32 (인용 그래프 랭킹) ─────────────────────────────
//
// 참고 목록 정렬에 "권위 신호"(피인용수)를 반영한다. 많이 인용된 확립 선례를 위로 올리되,
// 189회짜리 허브가 검색 결과를 지배하지 않도록 log 스케일로 완만하게 가산한다.

/**
 * 피인용 부스트 가중치 — 보수적 시작값(TAX-6B-32, 회계사 결정 2026-07-06 "보수적 착수").
 * 테스트로 고정 후 골든셋 회귀로 부작용을 확인하고 실측 튜닝한다.
 */
export const CITATION_BOOST_WEIGHT = 0.5

/**
 * 피인용수 → 점수 부스트. log 스케일이라 완만하다.
 *  - inDegree 0 → 0점(부스트 없음), 1회 → ≈0.35점, 189회(리딩 케이스) → ≈2.65점.
 *  - "권위는 정답이 아님"(TAX-6B-32 §7) — 1회 인용과 189회 인용이 하늘·땅으로 벌어지지 않게.
 *  - 음수 방어: 비정상 입력(음수)은 0으로 간주.
 * 원문을 읽지 않는 순수 수치 연산이다(§6.1 무관).
 */
export function citationBoost(inDegree: number): number {
  return CITATION_BOOST_WEIGHT * Math.log1p(Math.max(0, inDegree))
}
