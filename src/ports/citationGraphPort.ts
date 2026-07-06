import type { TaxLaw } from '../domain/TaxLaw'

/**
 * 인용 엣지 1개 — citation_edges 행의 조회용 투영 (TAX-6B-32).
 * 원문에 명시된 상호 인용(from_id → to_id)만 담으며, 임베딩·LLM 산물이 아니다.
 */
export interface CitationEdge {
  /** 인용하는 문서 사건번호(정규화됨) */
  fromId: string
  /** 인용된 문서 사건번호(정규화됨) */
  toId: string
  /** 인용된 문서 유형 — '판례' | '심판례' */
  toType: string
  /** 관계 유형 — 'FOLLOWS'(같은 뜻임) | 'REFERS'(참조). APPEAL(원심/환송)은 어댑터에서 제외 */
  edgeType: string
}

/**
 * 인용 그래프 조회 포트 (TAX-6B-32).
 *
 * generateAnswer usecase가 참고 목록 확정 직전에 citation_edges를 조회해
 *  ① 원문이 직접 지목한 선례를 참고 목록에 1-hop 확장하고,
 *  ② 피인용수(권위 신호)로 정렬을 부스트하는 데 쓴다.
 *
 * - IVectorSearchPort와 독립된 신규 포트다(기존 포트 무변경 → 무회귀 보장, TAX-6B-26 선례).
 * - 확장 문서는 참고 목록(references)에만 추가되며 발췌 인용(citation)으로 승격되지 않는다
 *   (SSOT §7.4, V1~V6 비대상). 원문(content)은 코퍼스 그대로 반환한다(§6.1).
 * - 미주입·DB 오류 시 usecase가 그래프 없이 기존 동작으로 복귀한다(graceful degrade).
 */
export interface ICitationGraphPort {
  /** 1-hop: 주어진 문서들이 인용한 대상 중 코퍼스 보유분(in_corpus)만, FOLLOWS/REFERS만 */
  getOutgoing(caseNumbers: string[]): Promise<CitationEdge[]>

  /** 피인용수(in-degree) — 각 사건번호가 몇 번 인용됐는지(권위 신호) */
  getInDegrees(caseNumbers: string[]): Promise<Map<string, number>>

  /** 확장 문서 본문 조회 — taxlaw_embeddings에서 사건번호로(content 원문 그대로) */
  getDocumentsByCaseNumbers(caseNumbers: string[]): Promise<TaxLaw[]>
}
