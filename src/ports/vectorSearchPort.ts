import type { TaxLaw, SourceType } from '../domain/TaxLaw'

/**
 * 벡터 유사도 검색 결과 — TaxLaw + cosine 유사도 점수 (TAX-026-D)
 */
export interface VectorMatch {
  /** 원문 보존 TaxLaw (§6.1 무변형) */
  item: TaxLaw
  /** cosine 유사도: 0~1, 1에 가까울수록 유사 */
  similarity: number
}

/**
 * 벡터 검색 Port 인터페이스 (TAX-026-D)
 * 질의 벡터와 가까운 자료를 cosine 유사도로 검색. DB(pgvector ↔ Pinecone) 교체 가능.
 */
export interface IVectorSearchPort {
  /**
   * 질의 벡터와 유사한 상위 topK 자료 반환.
   * @param sourceType 지정 시 해당 자료유형('판례' 등)만 검색 (TAX-6B-14 판례 라이브 배선).
   *                   생략 시 전체 코퍼스를 대상으로 한다(기존 동작 유지).
   */
  searchSimilar(queryVector: number[], topK: number, sourceType?: SourceType): Promise<VectorMatch[]>
}
