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
