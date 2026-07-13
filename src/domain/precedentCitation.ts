/**
 * 판례 인용 연결망 추출 — TAX-6B-23 (그래프 DB 전 효용 검증 PoC)
 *
 * 판례 본문(content)에서 "인용된 사건번호"를 정규식으로 추출하고, 보유 코퍼스 내부에서
 * 얼마나 서로 연결되는지(연결 밀도)를 집계한다. 그래프 DB(Apache AGE 등) 도입의 게이트.
 *
 * 대원칙(CLAUDE.md §6.1 인용 무결성):
 *   - content는 읽기 전용으로만 파싱한다 — 가공·요약·저장 절대 금지.
 *   - LLM·임베딩·외부 API 미사용. 순수 정규식 처리(과금 0·환각 0).
 *
 * 추출 정밀도 정책(보수적):
 *   - 사건번호 토큰을 아무 데서나 뽑지 않고 "…판결"/"…결정" 인용 맥락에서만 추출한다.
 *     → 법령 표현('제11조의2' 등)이 사건번호로 오인되는 오탐을 차단.
 *   - 오탐(없는 인용 생성)보다 누락이 안전하므로, 측정 밀도는 '하한(下限)'으로 해석한다
 *     (실제 연결은 같거나 더 촘촘). 누락 한계는 리포트에 명시한다.
 */

/**
 * 인용 사건번호 토큰 + 직후 '판결'/'결정' 맥락 매칭.
 *   예: '대법원 2002. 11. 8. 선고 2001두4849 판결' → '2001두4849'
 *   토큰 = 연도(2~4자리) + 사건부호(한글 1~3자: 두/누/도/구합 등) + 일련번호(숫자)
 *   사건부호 한글을 필수로 두어 순수 숫자·조문번호 오탐을 막는다.
 */
const CITATION_PATTERN = /([0-9]{2,4}[가-힣]{1,3}[0-9]+)\s*(?:판결|결정)/g

/**
 * 사건번호를 대조용으로 정규화한다(모든 공백 제거).
 * 인용 표기에 공백이 섞여도("2001 두 4849") 코퍼스 caseNumber와 일치하도록 흡수한다.
 */
export function normalizeCaseNumber(caseNumber: string): string {
  return caseNumber.replace(/\s+/g, '')
}

/**
 * 심판례 사건번호를 대조용으로 정규화한다(공백 제거 + 일련번호 4자리 0채움).
 *   본문 표기 '조심 2018지166' ↔ DB 표기 '조심2018지0166'의 0채움 차이를 흡수한다
 *   (TAX-6B-31 실측: body 엣지 in_corpus 5.8% → 81.3% 회복).
 *   일련번호가 이미 4자리 이상(예: 조심2023인10080)이면 그대로 둔다.
 */
export function normalizeTribunalCaseNumber(caseNumber: string): string {
  const norm = normalizeCaseNumber(caseNumber)
  const m = /^(조심|국심|감심)([0-9]{4})([가-힣])([0-9]+)$/.exec(norm)
  if (!m) return norm
  return `${m[1]}${m[2]}${m[3]}${m[4].padStart(4, '0')}`
}

/**
 * 판례 본문에서 인용된 사건번호 목록을 추출한다(정규화·중복 제거·자기참조 제외).
 * @param content       판례 본문(원문 그대로, 읽기 전용)
 * @param selfCaseNumber 출처 판례 자신의 사건번호 — 자기 인용 제외용(선택)
 * @returns 정규화된 사건번호 배열(중복 없음). 등장 순서 보존.
 */
export function extractCitedCaseNumbers(content: string, selfCaseNumber?: string): string[] {
  const self = selfCaseNumber ? normalizeCaseNumber(selfCaseNumber) : ''
  const found = new Set<string>()
  for (const match of content.matchAll(CITATION_PATTERN)) {
    const norm = normalizeCaseNumber(match[1])
    if (norm && norm !== self) found.add(norm)
  }
  return [...found]
}

// ─── 연결망 집계 (순수 함수 — 파일·DB 비의존) ────────────────────────────────

/** 그래프 적재 시 재사용할 엣지(인용 관계) */
export interface CitationEdge {
  /** 인용하는 판례(출처)의 사건번호 — 정규화 */
  from: string
  /** 인용된 사건번호 — 정규화 */
  to: string
  /** to가 보유 코퍼스 안에 존재하는가(내부 엣지 여부) */
  inCorpus: boolean
}

/** 코퍼스 입력 최소 형태 — caseNumber + content만 필요 */
export interface CitationNode {
  caseNumber: string
  content: string
}

/** 연결망 밀도 지표 — 그래프 DB 도입 의사결정 입력 */
export interface CitationStats {
  /** 전체 노드(판례) 수 */
  totalNodes: number
  /** 인용을 1건 이상 포함한 노드 수(맥락 무관) */
  nodesWithAnyCitation: number
  /** 추출된 총 엣지 수(중복 제거 후) */
  totalEdges: number
  /** 내부 엣지 수(인용 대상이 코퍼스 내 존재) */
  internalEdges: number
  /** 외부 엣지 수(인용 대상이 코퍼스 밖) */
  externalEdges: number
  /** 내부 인용을 1건 이상 가진 노드 수 */
  nodesWithInternalEdge: number
  /** 내부 연결 밀도 = nodesWithInternalEdge / totalNodes (0~1) */
  internalDensity: number
  /** 고립 노드 수(내부 인용·피인용 모두 0) */
  isolatedNodes: number
  /** 피인용 상위(허브 후보) — 내부 엣지 기준 내림차순 */
  topCited: { caseNumber: string; inDegree: number }[]
}

/**
 * 코퍼스 전체의 인용 엣지와 밀도 지표를 산출한다.
 * @param nodes   판례 노드 목록(caseNumber + content)
 * @param topN    피인용 상위 몇 건을 리포트할지(기본 10)
 */
export function buildCitationGraph(
  nodes: CitationNode[],
  topN = 10,
): { edges: CitationEdge[]; stats: CitationStats } {
  // 코퍼스 사건번호 집합(정규화) — 내부/외부 판정용
  const corpus = new Set<string>()
  for (const node of nodes) {
    const norm = normalizeCaseNumber(node.caseNumber)
    if (norm) corpus.add(norm)
  }

  const edges: CitationEdge[] = []
  const inDegree = new Map<string, number>() // 내부 피인용 횟수
  const hasInternalOut = new Set<string>() // 내부 인용을 가진 출처
  let nodesWithAnyCitation = 0

  for (const node of nodes) {
    const from = normalizeCaseNumber(node.caseNumber)
    const cited = extractCitedCaseNumbers(node.content, from)
    if (cited.length > 0) nodesWithAnyCitation++

    for (const to of cited) {
      const inCorpus = corpus.has(to)
      edges.push({ from, to, inCorpus })
      if (inCorpus) {
        hasInternalOut.add(from)
        inDegree.set(to, (inDegree.get(to) ?? 0) + 1)
      }
    }
  }

  const internalEdges = edges.filter((e) => e.inCorpus).length
  const externalEdges = edges.length - internalEdges

  // 고립 노드: 내부 인용(out)도 없고 내부 피인용(in)도 없는 코퍼스 노드
  let isolatedNodes = 0
  for (const cn of corpus) {
    if (!hasInternalOut.has(cn) && !inDegree.has(cn)) isolatedNodes++
  }

  const topCited = [...inDegree.entries()]
    .map(([caseNumber, deg]) => ({ caseNumber, inDegree: deg }))
    .sort((a, b) => b.inDegree - a.inDegree || a.caseNumber.localeCompare(b.caseNumber))
    .slice(0, topN)

  const totalNodes = nodes.length
  const stats: CitationStats = {
    totalNodes,
    nodesWithAnyCitation,
    totalEdges: edges.length,
    internalEdges,
    externalEdges,
    nodesWithInternalEdge: hasInternalOut.size,
    internalDensity: totalNodes > 0 ? hasInternalOut.size / totalNodes : 0,
    isolatedNodes,
    topCited,
  }
  return { edges, stats }
}

// ─── TAX-6B-31: 인용 엣지 추출·분류 (판례·심판례 3방향, DB 적재용) ─────────────
//
// 위 buildCitationGraph는 PoC(밀도 측정)용이고, 아래는 실제 citation_edges 적재를
// 위한 순수함수들이다. 관계 종류(FOLLOWS/REFERS/APPEAL)를 인용 직후 관용구로
// 결정론적으로 분류하고, 심판례 인용 패턴과 원문 무결 발췌(snippet)를 제공한다.

/**
 * 엣지 관계 종류 — 인용 직후 관용구로 결정론 분류.
 *   - FOLLOWS: '같은 뜻임' = 선례 지지 (강한 관계)
 *   - REFERS : '참조'·무표지 = 참고 (약한 관계, 기본값)
 *   - APPEAL : '원심판결'·'환송' = 같은 사건의 심급 관계 (선례 인용과 분리, §2.4 ③)
 */
export type CitationEdgeType = 'FOLLOWS' | 'REFERS' | 'APPEAL' | 'OVERRULED'

/**
 * 심판례 인용 패턴 — 기관 접두(조심/국심/감심)를 필수로 두어 오탐을 차단한다.
 *   예: '(조심 2022서1437, 같은 뜻임)' → 기관 '조심' + 번호 '2022서1437'
 *   Fable 재평가 프로브(2026-07-02, 심판례 139,840건 전수)에서 검증한 패턴과 동일.
 * global 플래그 사용 시 lastIndex 상태를 갖는 점에 주의 — 아래 함수들은 매 호출마다
 * 새 정규식 인스턴스를 만들거나 matchAll로 소비해 상태 오염을 피한다.
 */
const TRIBUNAL_CITATION_SOURCE = '(조심|국심|감심)\\s*제?\\s*([0-9]{4}[가-힣][0-9]+)'

/**
 * 심판례 본문에서 인용된 심판례 사건번호 목록을 추출한다(정규화·중복 제거·자기참조 제외).
 * @param content        심판례/판례 본문(원문 그대로, 읽기 전용)
 * @param selfCaseNumber 출처 자신의 사건번호 — 자기 인용 제외용(선택, 정규화 전/후 무관)
 * @returns 정규화된 심판례 사건번호 배열(예: '조심2022서1437'). 등장 순서 보존.
 */
export function extractCitedTribunalNumbers(content: string, selfCaseNumber?: string): string[] {
  const self = selfCaseNumber ? normalizeTribunalCaseNumber(selfCaseNumber) : ''
  const found = new Set<string>()
  for (const match of content.matchAll(new RegExp(TRIBUNAL_CITATION_SOURCE, 'g'))) {
    // match[1]=기관(조심 등), match[2]=번호(2022서1437) → 붙여서 정규화(0채움 포함)
    const norm = normalizeTribunalCaseNumber(match[1] + match[2])
    if (norm && norm !== self) found.add(norm)
  }
  return [...found]
}

/**
 * 심판례 자기 사건번호를 lawName에서 추출한다.
 *   예: '조세심판원 조심 2026중1364' → '조심2026중1364'(정규화)
 * @returns 정규화된 자기 사건번호, 패턴이 없으면 null
 */
export function extractTribunalSelfId(lawName: string): string | null {
  const m = new RegExp(TRIBUNAL_CITATION_SOURCE).exec(lawName)
  if (!m) return null
  return normalizeTribunalCaseNumber(m[1] + m[2])
}

/**
 * 본문을 괄호 (…) 그룹 단위로 자른다(TAX-6B-31 §2.4 ① 보강).
 * 심판례·판례 인용은 거의 전부 괄호 안에 있고, "같은 뜻임" 같은 관용구는 그룹 끝에
 * 한 번만 나와 그룹 내 여러 인용에 공통 적용된다. 따라서 그룹째 잘라야 사슬 인용을
 * 올바로 분류할 수 있다("매치 후 40자 창" 방식의 6.2% 오분류 해소).
 * 중첩은 최외곽 그룹으로 묶고, 미종결·불균형 괄호는 보수적으로 스킵한다(오탐 < 누락).
 * @returns 각 그룹의 { text(괄호 안 내용), start, end(원문 인덱스) }
 */
export function splitBracketGroups(
  content: string,
): { text: string; start: number; end: number }[] {
  const groups: { text: string; start: number; end: number }[] = []
  let depth = 0
  let openIndex = -1
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    if (ch === '(') {
      if (depth === 0) openIndex = i
      depth++
    } else if (ch === ')') {
      if (depth > 0) {
        depth--
        if (depth === 0 && openIndex >= 0) {
          groups.push({ text: content.slice(openIndex + 1, i), start: openIndex, end: i })
          openIndex = -1
        }
      }
      // depth 0에서 ')' = 불균형 → 무시(보수적)
    }
  }
  return groups
}

/**
 * 괄호 그룹 텍스트에서 인용 관계 종류를 결정론적으로 분류한다(TAX-6B-31 §2.4).
 * 우선순위: APPEAL(원심/환송) > FOLLOWS(같은 뜻임) > REFERS(그 외 전부·기본값).
 *   - APPEAL을 먼저 걸러 "같은 사건의 원심"을 "선례 인용"으로 오인하지 않는다(§2.4 ③).
 *   - 가장 약한 주장(REFERS)이 기본값이라, 확실한 신호가 없으면 관계를 과장하지 않는다.
 * 그룹 내 모든 인용에 동일하게 적용해 사슬 인용의 앞쪽 인용 오분류를 막는다.
 */
export function classifyCitationEdge(groupText: string): CitationEdgeType {
  if (/원심판결|환송/.test(groupText)) return 'APPEAL'
  if (/같은\s*뜻임/.test(groupText)) return 'FOLLOWS'
  return 'REFERS'
}

/**
 * 그룹 내 "YYYY. MM. DD. 선고"류 선고일을 ISO(YYYY-MM-DD)로 파싱한다(TAX-6B-31 §2.4 ④).
 * 시간 방향 검증(from.결정일 ≥ to.선고일)용 — 첫 번째 날짜만 반환, 없으면 null.
 */
export function extractCitedDate(groupText: string): string | null {
  const m = /([0-9]{4})\.\s*([0-9]{1,2})\.\s*([0-9]{1,2})\.\s*선고/.exec(groupText)
  if (!m) return null
  const [, y, mo, d] = m
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
}

/**
 * 인용 지점 주변 ±length자를 원문에서 잘라낸다(TAX-6B-31, §6.1 인용 무결성).
 * content.slice()만 사용하므로 반환값은 항상 원문의 부분 문자열이다(변형 0 보장).
 */
export function extractSnippet(content: string, index: number, length = 90): string {
  const start = Math.max(0, index - length)
  const end = Math.min(content.length, index + length)
  return content.slice(start, end)
}

/** 참조판례 필드에서 파싱한 인용 1건 — 법원명·선고일 동반(TAX-6B-31 §2.4 ②) */
export interface ParsedReferencedCitation {
  /** 정규화된 사건번호(예: '88누11926') */
  caseNumber: string
  /** 인용된 법원명(예: '대법원', '서울고등법원') — 충돌 14건 법원명 대조용(§2.4 정정) */
  court: string
  /** 선고일 ISO(YYYY-MM-DD) — 시간방향 검증용 */
  date: string | null
}

/**
 * 대법원 판례의 `참조판례` 구조화 필드를 인용 단위로 파싱한다(TAX-6B-31 §2.4 ②).
 *   예: '대법원 1989. 7. 25. 선고 88누11926 판결(공1989, 1312), 대법원 2007. 2. 8. 선고 2006두4899 판결'
 *       → [{ caseNumber:'88누11926', court:'대법원', date:'1989-07-25' }, { caseNumber:'2006두4899', ... }]
 * "법원명 + 선고일 + 사건번호"가 정리돼 있어 본문 정규식보다 오탐 위험이 없고 날짜 대조까지 된다.
 * 필드 원문은 읽기 전용 — 파싱만 하며 변형·저장하지 않는다(§6.1).
 */
export function parseReferencedCitations(field: string): ParsedReferencedCitation[] {
  // 법원명(대법원/헌법재판소/…법원) + YYYY.MM.DD.(선고|자) + 사건번호
  const pattern =
    /(대법원|헌법재판소|[가-힣]+법원)\s+([0-9]{4})\.\s*([0-9]{1,2})\.\s*([0-9]{1,2})\.\s*(?:선고|자)?\s*([0-9]{2,4}[가-힣]{1,3}[0-9]+)/g
  const out: ParsedReferencedCitation[] = []
  const seen = new Set<string>()
  for (const m of field.matchAll(pattern)) {
    const [, court, y, mo, d, rawCase] = m
    const caseNumber = normalizeCaseNumber(rawCase)
    if (!caseNumber || seen.has(caseNumber)) continue
    seen.add(caseNumber)
    out.push({
      caseNumber,
      court,
      date: `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`,
    })
  }
  return out
}

// ─── TAX-6B-33: 뒤집힘(OVERRULED) 신호 탐지 + 검수 표 파싱 ──────────────────────
//
// 판례·심판례 본문에서 "이후 뒤집힌 법리일 수 있다"는 신호(전원합의체·판례변경 등)만
// 후보로 탐지한다. 방향·주체 판정은 LLM이 아니라 회계사가 검수 표에 직접 기입하며,
// 이 파일은 그 표를 결정론적으로 파싱만 한다(§6.1 원문 보존 — LLM 판정 금지 원칙).

/** 뒤집힘 후보 신호 종류(재평가 프로브 검증분, TAX-6B-33 §2.1 실측치와 대응) */
export type ReversalSignalName = '판례변경' | '배치범위변경' | '전원합의체' | '견해변경'

/** 신호 이름 → 정규식 소스. global 플래그는 findReversalSignals에서 매 호출마다 새로 부여한다. */
export const REVERSAL_PATTERNS: { name: ReversalSignalName; source: string }[] = [
  { name: '판례변경', source: '판례.{0,6}변경' },
  { name: '배치범위변경', source: '배치되는\\s*범위에서.{0,10}변경' },
  { name: '전원합의체', source: '전원합의체' },
  { name: '견해변경', source: '견해.{0,6}변경' },
]

/** 본문에서 탐지된 뒤집힘 후보 신호 1건 — 위치는 발췌(extractSnippet) 호출용 */
export interface ReversalSignal {
  signal: ReversalSignalName
  index: number
}

/**
 * 본문에서 뒤집힘 후보 신호를 전부 탐지한다(등장 순서 정렬, 중복 위치 허용).
 * 신호는 "확정"이 아니라 "회계사 검수가 필요한 후보"일 뿐이다 — 이 함수는 방향·주체를
 * 판단하지 않는다(결정론 원칙, LLM 미사용).
 * @param content 판례·심판례 본문(원문 그대로, 읽기 전용)
 */
export function findReversalSignals(content: string): ReversalSignal[] {
  const found: ReversalSignal[] = []
  for (const def of REVERSAL_PATTERNS) {
    for (const m of content.matchAll(new RegExp(def.source, 'g'))) {
      found.push({ signal: def.name, index: m.index ?? 0 })
    }
  }
  return found.sort((a, b) => a.index - b.index)
}

/** 검수 표의 "검수 결과" 컬럼 허용값(빈칸=미검수 포함) — 이 밖의 문구는 오타로 간주해 오류 처리 */
export type ReviewVerdict = '확정(판례→판례)' | '확정(입법→판례)' | '해당없음' | '보류' | ''

const VALID_VERDICTS = new Set<string>(['확정(판례→판례)', '확정(입법→판례)', '해당없음', '보류', ''])

/** 검수 표 한 행(파싱 결과) — docs/review/OVERRULED_candidates_*.md 표 컬럼과 1:1 대응 */
export interface ReviewRow {
  no: number
  caseNumber: string
  signal: string
  snippet: string
  verdict: ReviewVerdict
  overruledBy: string
  overruledTarget: string
}

/** 검수 표 파싱 시 발견된 오류(허용되지 않는 검수 결과 값 등) — 원본 줄 번호 동반 */
export interface ReviewTableError {
  line: number
  reason: string
}

/** parseReviewTable 결과 — rows는 유효 행만, errors는 오류 행(반영 차단용) */
export interface ReviewTableParseResult {
  rows: ReviewRow[]
  errors: ReviewTableError[]
}

/**
 * 검수 표(마크다운) 파싱 — "검수 결과" 컬럼이 허용값 5종
 * (확정(판례→판례) / 확정(입법→판례) / 해당없음 / 보류 / 빈칸) 중 하나가 아니면
 * 해당 행을 errors로 보고한다(오타로 인한 오반영을 applyOverruledReview에서 차단하기 위함).
 * 헤더 행(`#`으로 시작)과 구분선 행(`---`)은 건너뛴다.
 * @param markdown `| # | 문서(사건번호) | 신호 | 원문 발췌 | 검수 결과 | 뒤집은 주체 | 뒤집힌 대상 |` 표
 */
export function parseReviewTable(markdown: string): ReviewTableParseResult {
  const rows: ReviewRow[] = []
  const errors: ReviewTableError[] = []
  const lines = markdown.split('\n')

  lines.forEach((rawLine, i) => {
    const line = rawLine.trim()
    if (!line.startsWith('|')) return
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length < 7) return

    const [noStr, caseNumber, signal, snippet, verdict, overruledBy, overruledTarget] = cells
    if (noStr === '#') return // 헤더 행
    if (/^-+$/.test(noStr)) return // 구분선 행(|---|---|...)
    const no = Number(noStr)
    if (!Number.isFinite(no)) return // 표 밖 잡음 행(무시)

    if (!VALID_VERDICTS.has(verdict)) {
      errors.push({ line: i + 1, reason: `허용되지 않은 검수 결과 값: "${verdict}" (행 #${noStr})` })
      return
    }
    rows.push({
      no,
      caseNumber,
      signal,
      snippet,
      verdict: verdict as ReviewVerdict,
      overruledBy,
      overruledTarget,
    })
  })

  return { rows, errors }
}

/** 검수 결과 값 → 반영 동작 분류(순수함수, DB 비의존) — applyOverruledReview.ts가 이 분류만 따른다 */
export type ReviewAction = 'apply' | 'superseded_by_law' | 'skip'

export function classifyReviewVerdict(verdict: ReviewVerdict): ReviewAction {
  if (verdict === '확정(판례→판례)') return 'apply'
  if (verdict === '확정(입법→판례)') return 'superseded_by_law'
  return 'skip' // 해당없음 · 보류 · 빈칸
}

/** 문서(사건번호) 셀 또는 "뒤집힌 대상" 셀을 분해한 결과 */
export interface ParsedDocCell {
  docType: '판례' | '심판례'
  caseNumber: string
}

/**
 * 검수 표 "문서(사건번호)" 셀("판례 88누11926" / "심판례 조심2022서1437", extractOverruledCandidates.ts가
 * 생성한 고정 형식)을 분해한다. 형식이 다르면 null(반영 차단 — 조용히 잘못 파싱하지 않음).
 */
export function parseDocCell(cell: string): ParsedDocCell | null {
  const idx = cell.indexOf(' ')
  if (idx < 0) return null
  const docType = cell.slice(0, idx)
  const raw = cell.slice(idx + 1).trim()
  if (docType !== '판례' && docType !== '심판례') return null
  const caseNumber = docType === '심판례' ? normalizeTribunalCaseNumber(raw) : normalizeCaseNumber(raw)
  return caseNumber ? { docType, caseNumber } : null
}

/**
 * "뒤집힌 대상" 셀은 회계사가 자유 기입하므로 접두(조심/국심/감심)로 종류를 추정한다.
 * 접두가 없으면 판례로 간주한다(코퍼스 대다수가 판례 사건번호 표기이므로 보수적 기본값).
 */
export function parseOverruledTarget(raw: string): ParsedDocCell | null {
  const t = raw.trim()
  if (!t) return null
  if (/^(조심|국심|감심)/.test(t)) {
    const cn = normalizeTribunalCaseNumber(t)
    return cn ? { docType: '심판례', caseNumber: cn } : null
  }
  const cn = normalizeCaseNumber(t)
  return cn ? { docType: '판례', caseNumber: cn } : null
}
