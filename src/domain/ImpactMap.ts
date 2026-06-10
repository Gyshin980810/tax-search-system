/**
 * 심판례 관계 그래프 도메인 타입 (TAX-033)
 *
 * 중심: 심판례 1건
 * 엣지 종류:
 *   - '관련법령' → 심판례가 직접 명시한 근거 조문 (모두 🟢, 추정 없음)
 *   - '참조결정' → 심판례가 직접 명시한 참조 심판례 (모두 🟢, 추정 없음)
 *
 * 설계 원칙:
 *   - 노드 라벨은 원문 조각 그대로 보존 (§6.1 원문 보존)
 *   - 키워드 근사 엣지는 이 타입에 포함하지 않는다 (전부 명시 연계)
 */

import type { TrustTier } from './TaxLaw'

/**
 * 그래프 노드 — 심판례 또는 근거 조문/참조 심판례
 */
export interface ImpactNode {
  /**
   * mermaid 노드 ID — 영문+숫자+밑줄만 허용
   * safeNodeId()로 생성 (src/domain/mermaid.ts)
   */
  id: string
  /**
   * 표시 라벨 — 원문 조각 그대로 (§6.1 원문 보존)
   * 예: "조심2011서1540", "「조세특례제한법」 제69조"
   */
  label: string
  /**
   * 노드 유형
   * - 'tribunal'     : 중심 심판례
   * - 'law_article'  : 근거 조문 (관련법령 엣지의 목적지)
   * - 'tribunal_ref' : 참조 심판례 (참조결정 엣지의 목적지)
   */
  type: 'tribunal' | 'law_article' | 'tribunal_ref'
  /** 출처 신뢰 등급 */
  trustTier: TrustTier
  /** 원문 링크 (제공 가능 시) */
  sourceUrl?: string
  /** 법령명 — type=law_article 시, 「」에서 추출한 원문 */
  lawName?: string
  /** 법령명 정규화 값 — normalizeLawName() 결과 (매칭·그룹핑용) */
  lawNameNormalized?: string
  /** 조문 표기 원문 — type=law_article 시 (예: 제69조, 시행령제89조) */
  articleRef?: string
}

/**
 * 그래프 엣지 — 심판례↔조문 또는 심판례↔심판례 관계
 */
export interface ImpactEdge {
  /** 출발 노드 ID */
  fromId: string
  /** 도착 노드 ID */
  toId: string
  /**
   * 관계 유형
   * - '관련법령' : 심판례 → 근거 조문 (심판례 본문 명시, 🟢)
   * - '참조결정' : 심판례 → 참조 심판례 (심판례 본문 명시, 🟢)
   */
  relation: '관련법령' | '참조결정'
  /** 엣지 표시 라벨 */
  label: string
}

/**
 * 심판례 관계 그래프 전체
 *
 * 중심 심판례 1건 + 엣지로 연결된 노드들의 집합.
 * 모든 엣지는 심판례 원문의 명시적 참조를 근거로 한다 (추정 엣지 없음).
 *
 * 주의: 청구번호(caseNumber)는 반드시 목록 응답 값을 사용한다.
 *   본문(ttSpecialDecc) 청구번호는 API에서 항상 빈값으로 반환됨 (진단5 확인).
 */
export interface ImpactMap {
  /** 중심 노드 ID */
  centerId: string
  /**
   * 청구번호 — 목록 응답(ttSpecialDecc 목록) 값 사용 필수
   * 형식 예: "조심 2020부1558", "조심2012중1992", "국심1996중2199"
   */
  caseNumber: string
  /** 사건명 */
  caseName: string
  /** 세목 (예: 양도소득세, 법인세) */
  taxType: string
  /** 결정일 (YYYY-MM-DD 또는 원문 형식) */
  decisionDate: string
  /** 재결청 (예: 조세심판원) */
  agency: string
  /** 그래프 노드 목록 (중심 포함) */
  nodes: ImpactNode[]
  /** 그래프 엣지 목록 */
  edges: ImpactEdge[]
}
