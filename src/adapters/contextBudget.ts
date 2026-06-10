import 'server-only'
import type { TaxLaw, TrustTier } from '../domain/TaxLaw'

/**
 * TAX-042F — LLM 입력 컨텍스트 윈도우 보호 유틸
 *
 * 배경:
 *   GPT-4o-mini 입력 한도 128K 토큰. TAX-042B 진단에서 G-S-법인-06이
 *   검색 결과 누적 약 54만 토큰(4배 초과)으로 100% 실패.
 *   queryRewriter가 광범위 키워드를 생성하는 근본 원인은 TAX-042G로 분리.
 *
 * 처방 (korean-law-mcp 검증 패턴 이식):
 *   A. compactLawContent — decision-compact.ts:36 패턴. 본문 앞 1500자 + 중략
 *      마커 + 뒤 500자. 한국어 종결어미 가드(한다/있다/본다/정한다).
 *   B. densifyArticleRefs — densifyLawRefs:99 패턴. "제26조(법인세 과세표준의
 *      계산)" → "제26조". 5% 미만 절감 시 원본 유지.
 *   C. truncateForContext — Tier 정렬(T1→T2→T3→T4) + 질문 키워드 매칭 가중치
 *      + 누적 ≤ SAFE_INPUT_TOKENS 컷오프 + 최소 1건 보장.
 *
 * V1·V2 인용 무결성 보호 (CLAUDE.md §6.1·§6.4):
 *   TaxLaw 객체 원본은 절대 mutate하지 않는다. 압축은 LLM 프롬프트 임시본에만
 *   적용하고, 원본 객체 참조는 TruncateResult.originalRefs로 별도 보존한다.
 *   citations 매핑은 originalRefs를 사용하므로 extractExcerpt가 원본 content와
 *   대조해 V2 substring 보장이 그대로 유지된다.
 */

/**
 * 안전 입력 토큰 한도.
 * GPT-4o-mini 128K = (시스템 프롬프트 + 회계사 질문 + 메타 약 16K) +
 * (출력 16K 예약) + (안전 마진) 후 60K로 보수적 책정 (인간 승인 2026-06-07).
 */
export const SAFE_INPUT_TOKENS = 60_000

/** Trust Tier 우선순위 (낮을수록 우선 보존). */
export const TIER_RANK: Record<TrustTier, number> = { T1: 1, T2: 2, T3: 3, T4: 4 }

/**
 * 한국어 키워드 추출 시 무시할 stopwords.
 * compact-query-planner.ts:115의 정신만 차용한 최소 셋.
 */
const STOPWORDS = new Set(['이며', '이라', '입니다', '관련', '대한', '관한', '경우', '등'])

/**
 * 간이 한국어 토큰 추정 (외부 의존성 추가 금지 제약).
 * 한글 1자 ≈ 2토큰, 그 외 1자 ≈ 0.3토큰 (GPT 계열 근사).
 * 정확도 부족분은 SAFE_INPUT_TOKENS 보수적 책정으로 흡수.
 */
export function estimateTokens(s: string): number {
  let hangul = 0
  let other = 0
  for (const ch of s) {
    if (ch >= '가' && ch <= '힣') hangul++
    else other++
  }
  return Math.ceil(hangul * 2 + other * 0.3)
}

/** compactLawContent 옵션. full=true 시 축약 비활성. */
export interface CompactOptions {
  full?: boolean
}

/**
 * 본문 계단식 축약 — korean-law-mcp decision-compact.ts:36 한국어 법조문 적응.
 *
 * - 짧은 본문(HEAD+TAIL+MIN_SAVE 이하)은 절감 효과 없으므로 원본 유지
 * - 한국어 법조문 종결어미("한다.", "있다.", "본다.", "정한다.")에서 자름
 * - 경계 못 찾으면 원시 슬라이스 fallback
 * - 실질 절감(omitted) 미달 시 원본 유지
 */
export function compactLawContent(content: string, opts: CompactOptions = {}): string {
  if (opts.full || !content) return content

  const HEAD = 1500
  const TAIL = 500
  const MIN_SAVE = 1000

  if (content.length <= HEAD + TAIL + MIN_SAVE) return content

  // HEAD — 앞쪽 HEAD자까지 중 문장 끝(종결어미)에서 자름
  const headRaw = content.slice(0, HEAD)
  const headBoundaries = [
    headRaw.lastIndexOf('한다.\n'),
    headRaw.lastIndexOf('있다.\n'),
    headRaw.lastIndexOf('본다.\n'),
    headRaw.lastIndexOf('정한다.\n'),
    headRaw.lastIndexOf('한다. '),
    headRaw.lastIndexOf('있다. '),
    headRaw.lastIndexOf('본다. '),
    headRaw.lastIndexOf('정한다. '),
    headRaw.lastIndexOf('.\n\n'),
    headRaw.lastIndexOf('\n\n'),
    headRaw.lastIndexOf('. '),
  ]
  const headCutCandidate = Math.max(...headBoundaries)
  const headCut = headCutCandidate > HEAD * 0.5 ? headCutCandidate + 2 : HEAD
  const head = content.slice(0, headCut).trimEnd()

  // TAIL — 뒤쪽 TAIL자 범위 중 문장 시작에서 자름
  const tailStart = content.length - TAIL
  const tailRaw = content.slice(tailStart)
  const tailBoundaryIdx = [
    tailRaw.indexOf('\n\n'),
    tailRaw.indexOf('한다. '),
    tailRaw.indexOf('있다. '),
    tailRaw.indexOf('본다. '),
    tailRaw.indexOf('정한다. '),
  ]
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0]

  const tailFrom =
    tailBoundaryIdx !== undefined && tailBoundaryIdx < TAIL * 0.5
      ? tailStart + tailBoundaryIdx + 2
      : tailStart
  const tail = content.slice(tailFrom).trimStart()

  const omitted = content.length - head.length - tail.length
  if (omitted < MIN_SAVE) return content

  return `${head}\n\n⋯ 중략 ${omitted.toLocaleString()}자 ⋯\n\n${tail}`
}

/**
 * 참조 조문 군더더기 제거 — korean-law-mcp densifyLawRefs:99 패턴.
 *
 * "제26조(법인세 과세표준의 계산)" → "제26조"
 * "제1항(적용범위)" → "제1항"
 *
 * 법령명·조문번호 자체는 보존(LLM이 후속 인용 시 파싱 필요).
 * 절감률 5% 미만이면 원본 유지(이득 없는 변형 회피).
 */
export function densifyArticleRefs(content: string): string {
  if (!content) return content
  const compact = content.replace(
    /(제\d+조(?:의\d+)?|제\d+항|제\d+호)\s*\([^)]{3,40}\)/g,
    '$1',
  )
  if (compact.length >= content.length * 0.95) return content
  return compact
}

/**
 * 질문에서 매칭 가중치 산정용 키워드 추출.
 * 2자 이상 토큰, STOPWORDS 제거, 유니크 보장.
 */
export function extractQuestionKeywords(question: string): string[] {
  const tokens = question
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
  return Array.from(new Set(tokens))
}

/**
 * 질문 키워드와 lawName + articleTitle의 매칭 개수.
 * 같은 Trust Tier 내에서 직접 관련 조문을 우선 보존하기 위한 보조 점수.
 */
export function relevanceScore(law: TaxLaw, keywords: string[]): number {
  const haystack = `${law.lawName} ${law.articleTitle}`
  return keywords.filter((k) => haystack.includes(k)).length
}

/**
 * truncateForContext 결과.
 * promptLaws[i] ↔ originalRefs[i] 인덱스 1:1 대응을 보장한다.
 * - promptLaws: 압축 임시본 (buildLawsContext에 전달 — LLM 입력)
 * - originalRefs: 원본 TaxLaw 객체 참조 (citations.taxLaw 매핑·V1·V2 검증용)
 */
export interface TruncateResult {
  promptLaws: TaxLaw[]
  originalRefs: TaxLaw[]
}

/**
 * 컨텍스트 윈도우 보호용 사전 축약·컷오프.
 *
 * 1) 짧은 fixture short-circuit — 모든 content가 2500자 이하이고 누적 토큰이
 *    safe의 절반 미만이면 원본 그대로 반환(회귀 0건 보장).
 * 2) Trust Tier 정렬 (T1→T4) + 같은 Tier 안에서 질문 키워드 매칭 가중치 정렬.
 * 3) 각 조문은 densifyArticleRefs → compactLawContent 순으로 압축 후 토큰 추정.
 * 4) 누적이 safeTokens 초과면 컷오프. 최소 1건은 무조건 포함(회계사 "직접 근거
 *    없음" 빈도 증가 방지).
 */
export function truncateForContext(
  laws: TaxLaw[],
  question: string,
  safeTokens: number = SAFE_INPUT_TOKENS,
): TruncateResult {
  if (laws.length === 0) return { promptLaws: [], originalRefs: [] }

  // (1) 짧은 fixture short-circuit
  const allShort = laws.every((l) => l.content.length <= 2500)
  const rawTokens = laws.reduce((s, l) => s + estimateTokens(l.content), 0)
  if (allShort && rawTokens < safeTokens * 0.5) {
    return { promptLaws: laws, originalRefs: laws }
  }

  // (2) Tier + 키워드 가중치 정렬
  const keywords = extractQuestionKeywords(question)
  const sorted = [...laws].sort((a, b) => {
    const tierDiff = TIER_RANK[a.trustTier] - TIER_RANK[b.trustTier]
    if (tierDiff !== 0) return tierDiff
    return relevanceScore(b, keywords) - relevanceScore(a, keywords)
  })

  // (3) 각 조문 압축 + (4) 누적 컷오프
  const promptLaws: TaxLaw[] = []
  const originalRefs: TaxLaw[] = []
  let cumulative = 0
  for (const law of sorted) {
    const compacted = compactLawContent(densifyArticleRefs(law.content))
    const tok = estimateTokens(`${law.lawName} ${law.articleNumber} ${compacted}`)
    if (cumulative + tok > safeTokens) break
    promptLaws.push({ ...law, content: compacted })
    originalRefs.push(law)
    cumulative += tok
  }

  // (4) 최소 1건 보장 — 모든 조문이 한도 초과여도 sorted[0]은 포함
  if (promptLaws.length === 0 && sorted.length > 0) {
    const first = sorted[0]
    const compacted = compactLawContent(densifyArticleRefs(first.content))
    promptLaws.push({ ...first, content: compacted })
    originalRefs.push(first)
  }

  return { promptLaws, originalRefs }
}
