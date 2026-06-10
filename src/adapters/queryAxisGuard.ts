import 'server-only'
import type { SearchQuery } from '../domain/SearchQuery'

/**
 * TAX-042G — queryRewriter 광범위 키워드 거버넌스
 *
 * 배경:
 *   TAX-042F 진단에서 G-S-법인-06 컨텍스트 윈도우 4.2배 초과의 근본 원인이
 *   queryRewriter가 "법인세법"(243건), "법인세 시행령"(296건) 같은 한 단어
 *   광범위 키워드를 그대로 반환하는 구조임이 확인됨.
 *
 * 처방 (korean-law-mcp compact-query-planner.ts:332 buildOriginalQueryAxes 인사이트):
 *   검색 키워드를 "법리축(어떤 법령)" + "사실축(어떤 쟁점)" 결합 형태로 강제.
 *   LLM 출력이 한 단어 또는 법령명 단독이면 질문에서 사실축 토큰을 자동 부착.
 *
 * 도메인 무결성 보호 (CLAUDE.md §7):
 *   - 후처리는 SearchQuery.keyword 문자열에만 영향. TaxLaw·답변·시점 라벨 무영향
 *   - 사실축 토큰은 회계사가 입력한 question에서만 추출 → 새 PII 소스 없음
 *   - 본 어댑터 진입 시점에 question은 상위 Usecase의 PII 필터 통과 후 상태
 *
 * 인사이트 출처:
 *   korean-law-mcp v3.4.0 src/tools/compact-query-planner.ts:68/79/115/332
 *   (세법 도메인 한정으로 가벼운 셋만 이식. 건설·노동·이혼 사전은 미이식)
 */

/**
 * 법리축 단독 사용 금지 셋 — 검색 결과 200건 이상 dump하는 광범위 법령명·세목.
 * 모두 사실축 보강 대상이며, 사실축 추출 실패 시 원본 그대로 통과(회귀 0건 보장).
 */
const LEGAL_AXIS_BROAD = new Set([
  '법인세법',
  '소득세법',
  '부가가치세법',
  '상속세및증여세법',
  '상속세 및 증여세법',
  '국세기본법',
  '조세특례제한법',
  '국세징수법',
  '지방세법',
  '지방세기본법',
  '지방세징수법',
  '법인세 시행령',
  '소득세 시행령',
  '부가가치세 시행령',
  '법인세법 시행령',
  '소득세법 시행령',
  '부가가치세법 시행령',
  '시행령',
  '시행규칙',
])

/**
 * "~법" / "~법 시행령" / "~법 시행규칙" 형태 단독 패턴.
 * LEGAL_AXIS_BROAD에 명시 안 된 법령명도 단독 사용 시 광범위로 간주.
 */
const LEGAL_SUFFIX_PATTERN = /^[가-힣]+법(?:\s*시행령|\s*시행규칙)?$/

/**
 * 사실축 토큰 추출 시 제외할 보조어 셋.
 * compact-query-planner.ts:115 ORIGINAL_QUERY_STOPWORDS의 세법 도메인 적응본.
 */
const FACT_AXIS_STOPWORDS = new Set([
  '관련',
  '대한',
  '관한',
  '경우',
  '등',
  '이며',
  '입니다',
  '여부',
  '방법',
  '절차',
  '알려줘',
  '알려주세요',
  '찾아줘',
  '찾아주세요',
  '문의',
  '질문',
  '검색',
  '조회',
  '판단',
  '의견',
  '확인',
  '내용',
  '사례',
  '관계',
  '있는지',
  '있나요',
  '되나요',
  '되는지',
  '하는지',
  '하나요',
  '입니까',
  '인가요',
  '인지',
  '것인지',
  '같은',
])

/**
 * 사실축 토큰 추출 시 단독 제거할 법리축 노이즈.
 * 사실축 부착 시점에는 법리축이 이미 키워드 머리에 있으므로 중복 부착 회피.
 */
const LEGAL_AXIS_NOISE = new Set([
  '법인세',
  '소득세',
  '부가세',
  '부가가치세',
  '상속세',
  '증여세',
  '지방세',
  '국세',
  '조세',
  '세금',
  '세법',
  '법령',
  '조문',
  '시행령',
  '시행규칙',
])

/**
 * 키워드가 광범위해 사실축 보강이 필요한지 판정.
 *
 * - LEGAL_AXIS_BROAD 셋에 명시된 단독 법령·시행령 표현
 * - "~법", "~법 시행령", "~법 시행규칙" 단독 패턴
 * - 공백 없는 단일 토큰이고 6자 이하인 경우(예: "손비")는 이미 좁으므로 false
 */
export function isTooBroad(keyword: string): boolean {
  const compact = keyword.trim()
  if (!compact) return false
  if (LEGAL_AXIS_BROAD.has(compact)) return true
  if (LEGAL_SUFFIX_PATTERN.test(compact)) return true
  return false
}

/**
 * 질문에서 사실축 토큰 추출.
 *
 * 1) 한글·숫자 외 문자를 공백으로 치환 후 토큰화
 * 2) 2자 이상, FACT_AXIS_STOPWORDS·LEGAL_AXIS_NOISE 제외
 * 3) 등장 순서 유지하며 유니크
 *
 * 회계사 질문은 상위 Usecase의 PII 필터를 통과한 상태이므로 새 PII 유입 없음.
 */
export function extractFactAxisTokens(question: string): string[] {
  const raw = question
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)

  const seen = new Set<string>()
  const out: string[] = []
  for (const t of raw) {
    if (FACT_AXIS_STOPWORDS.has(t)) continue
    if (LEGAL_AXIS_NOISE.has(t)) continue
    if (LEGAL_AXIS_BROAD.has(t)) continue
    if (LEGAL_SUFFIX_PATTERN.test(t)) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/**
 * 광범위 키워드에 질문 기반 사실축 토큰을 부착해 검색 범위를 좁힌다.
 *
 * 동작:
 *   - 한 단어 광범위 키워드(`isTooBroad`) + 사실축 토큰 ≥ 1개 → 상위 2개 부착
 *   - 광범위 키워드인데 사실축 추출 실패 → 원본 그대로 통과(회귀 0건 보장)
 *   - 이미 좁은 키워드(공백 포함 또는 LEGAL_AXIS_BROAD 미해당) → 무변경
 *   - 결과 배열은 입력과 길이·순서 동일(SearchQuery.requestedAt 보존)
 *
 * @param queries LLM이 반환한 SearchQuery 배열
 * @param question 회계사 자연어 질문 (사실축 추출 소스)
 */
export function enforceAxisCombination(
  queries: SearchQuery[],
  question: string,
): SearchQuery[] {
  if (queries.length === 0) return queries

  const factTokens = extractFactAxisTokens(question)
  if (factTokens.length === 0) return queries

  const topFacts = factTokens.slice(0, 2).join(' ')

  return queries.map((q) => {
    if (!isTooBroad(q.keyword)) return q
    const compact = q.keyword.trim()
    if (compact.includes(topFacts)) return q
    return { ...q, keyword: `${compact} ${topFacts}` }
  })
}
