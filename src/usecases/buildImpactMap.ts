/**
 * buildImpactMap Usecase (TAX-033)
 *
 * 심판례 청구번호를 받아서 심판례 관계 그래프(ImpactMap)를 조립한다.
 *
 * 책임:
 *   1. PII 필터 — 주민번호·사업자번호 포함 시 즉시 거부
 *   2. IImpactMapPort를 통해 심판례 관계 원문 데이터(TribunalRelationsRaw) 조회
 *   3. parseRelatedLaws / parseReferences 로 원문 분해
 *   4. 노드·엣지 조립 → ImpactMap 반환
 *   5. mermaid 코드 생성
 *
 * 금지:
 *   - fetch/HTTP 직접 호출 (Port만 사용 — CLAUDE.md §4)
 *   - 추정 엣지 생성 (원문 명시 없는 연계 — §9.1 인용 무결성)
 *   - 원문 의역·요약 (§6.1)
 */

import { detectPii } from '../utils/piiFilter'
import type { IImpactMapPort } from '../ports/impactMapPort'
import type { ImpactMap, ImpactNode, ImpactEdge } from '../domain/ImpactMap'
import { parseRelatedLaws, parseReferences } from '../domain/relatedLawParser'
import { buildMermaid, safeNodeId } from '../domain/mermaid'

/**
 * buildImpactMap 유스케이스 출력
 */
export interface ImpactMapResult {
  /** 조립된 관계 그래프 */
  map: ImpactMap
  /** mermaid graph LR 코드 */
  mermaid: string
}

/**
 * 심판례 관계 그래프를 조립한다.
 *
 * @param port    IImpactMapPort 구현체 (NationalTaxLawAdapter)
 * @param caseNumber 조회할 심판례 청구번호 (예: "조심2011서1540")
 * @returns ImpactMapResult 또는 null (심판례를 찾지 못한 경우)
 * @throws {PiiDetectedError} 청구번호에 PII 패턴 감지 시
 */
export async function buildImpactMap(
  port: IImpactMapPort,
  caseNumber: string,
): Promise<ImpactMapResult | null> {
  // 1단계: PII 필터 — 청구번호에 주민번호 등이 포함되면 즉시 거부
  detectPii(caseNumber)

  // 2단계: 관계 원문 데이터 조회
  const raw = await port.fetchTribunalRelations(caseNumber.trim())
  if (!raw) return null

  // 3단계: 원문 분해
  const relatedLaws = parseRelatedLaws(raw.relatedLawsRaw)
  const references = parseReferences(raw.referencesRaw)

  // 4단계: 노드·엣지 조립

  // 중심 노드 (심판례)
  const centerId = safeNodeId('tri', raw.caseNumber)
  const centerNode: ImpactNode = {
    id: centerId,
    label: raw.caseNumber,        // 원문 청구번호 그대로
    type: 'tribunal',
    trustTier: 'T3',
    sourceUrl: raw.sourceUrl,
  }

  const nodes: ImpactNode[] = [centerNode]
  const edges: ImpactEdge[] = []

  // 관련법령 노드·엣지 (중심 → 법령 조문)
  for (const ref of relatedLaws) {
    const nodeId = safeNodeId('law', ref.rawText)
    const lawNode: ImpactNode = {
      id: nodeId,
      label: ref.rawText,             // 원문 조각 그대로 (§6.1)
      type: 'law_article',
      trustTier: 'T1',                // 법령 조문 = T1 (단, 시행령/규칙도 T1로 동일 처리)
      lawName: ref.lawName,
      lawNameNormalized: ref.lawNameNormalized,
      articleRef: ref.articleRef,
    }
    // 중복 노드 방지 (같은 ID가 이미 있으면 건너뜀)
    if (!nodes.find((n) => n.id === nodeId)) {
      nodes.push(lawNode)
    }
    edges.push({
      fromId: centerId,
      toId: nodeId,
      relation: '관련법령',
      label: '관련법령',
    })
  }

  // 참조결정 노드·엣지 (중심 → 참조 심판례)
  for (const ref of references) {
    const nodeId = safeNodeId('ref', ref.rawText)
    const refNode: ImpactNode = {
      id: nodeId,
      label: ref.rawText,           // 원문 청구번호 그대로 (§6.1)
      type: 'tribunal_ref',
      trustTier: 'T3',
    }
    if (!nodes.find((n) => n.id === nodeId)) {
      nodes.push(refNode)
    }
    edges.push({
      fromId: centerId,
      toId: nodeId,
      relation: '참조결정',
      label: '참조결정',
    })
  }

  const map: ImpactMap = {
    centerId,
    caseNumber: raw.caseNumber,
    caseName: raw.caseName,
    taxType: raw.taxType,
    decisionDate: raw.decisionDate,
    agency: raw.agency,
    nodes,
    edges,
  }

  // 5단계: mermaid 코드 생성
  const mermaid = buildMermaid(map)

  return { map, mermaid }
}
