/**
 * 비법령 검색 자연어 정규화 (TAX-043 옵션 B + C)
 *
 * 목적:
 *   비법령 4트랙(판례·해석례·NTS해석·심판례)은 외부 API에 query.keyword를 그대로 전달한다.
 *   회계사 자연어 군더더기("찾아줘", "여부", "관련")가 검색 노이즈로 작용하고,
 *   사건번호("2023두12345", "조심2023서0001")가 입력되어도 본문 검색만 수행해 정확매칭을 놓친다.
 *
 *   본 모듈은 비법령 트랙 진입 직전에 두 가지 정규화만 수행한다:
 *     B) 불용어 제거       — 회계사 자연어 군더더기 제거 (사전 25개)
 *     C) 사건번호 정확매칭  — 사건번호 발견 시 단독 검색어로 분리 (점수 최우선 정신 — korean-law-mcp)
 *
 * 보호:
 *   - 입력만 정규화한다. 검색 결과(TaxLaw[]) 데이터는 손대지 않는다 (CLAUDE.md §6.1 원문 보존).
 *   - 법령 트랙(fetchArticles) 무관 — normalizeLawName(lawAliases.ts)과 분리.
 *   - 보수적 fallback: 정규화 후 검색어가 비면(토큰 0개) 원본을 그대로 사용한다.
 *
 * 출처: docs/reports/TAX-042E_nonlaw-search-insights.md §3 옵션 B + C
 *       원본 패턴: C:\Users\sfami\WorkSpace\korean-law-mcp-main\src\tools\compact-query-planner.ts
 */

/**
 * 비법령 검색 불용어 사전 (회계사 결정 2026-06-08 — A안 약 25개).
 *
 * 5그룹으로 구성:
 *   ① 의문·요청 동사  — 회계사 자연어 끝맺음
 *   ② 관계어         — 검색 노이즈가 큰 조사·연결어
 *   ③ 메타 명사       — 트랙 자체를 가리키는 단어(이미 트랙별 검색이므로 중복)
 *   ④ 추상어         — 의미 명확화에 기여하지 않는 일반어
 *   ⑤ 단위·수식어     — 사실관계와 무관한 일반어
 *
 * 닫힌 집합으로 시작 — 사전 확장은 회계사 승인 필요(임의 추가 금지).
 * 핵심 세무 단어(가산세·신고누락·환급·양도세 등)는 절대 포함하지 않는다.
 */
export const NONLAW_STOPWORDS: ReadonlySet<string> = new Set([
  // ① 의문·요청 동사
  '찾아줘', '찾아주세요', '알려줘', '알려주세요', '보여줘', '보여주세요',
  '검색', '조회',
  // ② 관계어
  '관련', '관한', '대한', '대해', '대하여',
  // ③ 메타 명사 — 4트랙 검색이 트랙별로 분리되어 있으므로 중복
  '판례', '판결', '결정', '사례', '해석',
  // ④ 추상어
  '여부', '가능', '가능한가요', '되나요', '되는지', '어떤', '어떻게',
  // ⑤ 단위·수식어
  '얼마', '기준', '경우', '때',
])

/**
 * 대법원·하급심 사건번호 정규식.
 *
 * 패턴: 연도(4) + 사건분류기호 + 번호(1~8)
 *   - 연도 prefix `(?:19|20)\d{2}`로 일반 단어("두 사람", "가산세") 오매칭 차단.
 *   - 사건분류기호는 대법원 코드 + 행정·조세 사건 빈출 코드.
 *   - 공백 허용(`\s*`) — "2023 두 12345" 같은 자연 입력 흡수.
 */
export const COURT_CASE_RE =
  /(?:19|20)\d{2}\s*(?:고합|고단|두|누|구|마|가|나|다|라|기|아|자|차|카|파|허|흐|선|노|도|재)\s*\d{1,8}/u

/**
 * 조세심판원 청구번호 정규식.
 *
 * 패턴: "조심" + 연도(4) + 지역기호(한글 1) + 번호(1~4)
 *   - 예: "조심2023서0001", "조심 2023 서 0001"
 *   - 지역기호는 1글자(서·부·광·전·북·남 등). 다글자 확장 발견 시 조정.
 */
export const TRIBUNAL_CASE_RE = /조심\s*\d{4}\s*[가-힣]\s*\d{1,4}/u

export type NormalizationApplied = 'stopwords' | 'court_case' | 'tribunal_case'

export interface NormalizedNonLawQuery {
  /** 사건번호 발견 시 정확매칭용 단일 검색어(공백 제거). 없으면 null */
  caseNumber: string | null
  /** 불용어 제거 후 검색어. 모두 불용어로 제거되면 원본 보존(보수적 fallback) */
  keyword: string
  /** 어떤 정규화가 일어났는지(디버그·테스트용) */
  applied: NormalizationApplied[]
}

/**
 * 불용어 제거 (사전 매칭은 토큰 단위 정확매칭).
 *
 * 토큰 0개로 줄어들면 원본을 보존한다 — 회계사가 불용어만 입력한 경우에도
 * 외부 API에 빈 query를 보내 검색이 무력화되는 사고를 막는다.
 */
function stripStopwords(input: string): { keyword: string; changed: boolean } {
  // 공백·쉼표·마침표·물음표·느낌표·하이픈으로 토큰 분리(한국어 자연어 기준)
  const tokens = input.split(/[\s,.\-?!]+/u).filter(Boolean)
  const kept = tokens.filter((t) => !NONLAW_STOPWORDS.has(t))

  if (kept.length === 0) {
    return { keyword: input, changed: false }
  }
  const joined = kept.join(' ')
  return { keyword: joined, changed: joined !== input }
}

/**
 * 비법령 검색용 자연어 정규화.
 *
 * 흐름:
 *   1) trim → 빈 문자열은 그대로 반환
 *   2) 심판례 사건번호 매치 → caseNumber 단독 분리(공백 제거)
 *   3) 판례 사건번호 매치   → caseNumber 단독 분리(공백 제거)
 *   4) 불용어 제거 후 keyword 반환
 *
 * 사건번호 발견 시에도 keyword는 함께 반환한다 — 어댑터가 트랙별로
 * caseNumber 정확매칭 미지원(해석례·NTS해석)일 때 keyword fallback 가능.
 */
export function normalizeNonLawQuery(raw: string): NormalizedNonLawQuery {
  const trimmed = (raw ?? '').trim()
  const applied: NormalizationApplied[] = []

  if (trimmed === '') {
    return { caseNumber: null, keyword: '', applied }
  }

  // 심판례를 판례보다 먼저 검사 — "조심" 접두로 명확히 구분되며 우선순위 보장
  const tribunalMatch = trimmed.match(TRIBUNAL_CASE_RE)
  if (tribunalMatch) {
    applied.push('tribunal_case')
    const caseNumber = tribunalMatch[0].replace(/\s+/g, '')
    const stripped = stripStopwords(trimmed)
    if (stripped.changed) applied.push('stopwords')
    return { caseNumber, keyword: stripped.keyword, applied }
  }

  const courtMatch = trimmed.match(COURT_CASE_RE)
  if (courtMatch) {
    applied.push('court_case')
    const caseNumber = courtMatch[0].replace(/\s+/g, '')
    const stripped = stripStopwords(trimmed)
    if (stripped.changed) applied.push('stopwords')
    return { caseNumber, keyword: stripped.keyword, applied }
  }

  const stripped = stripStopwords(trimmed)
  if (stripped.changed) applied.push('stopwords')
  return { caseNumber: null, keyword: stripped.keyword, applied }
}
