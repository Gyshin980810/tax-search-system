import type { TaxLaw } from '../domain/TaxLaw'

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
  /** 질의 벡터와 유사한 상위 topK 자료 반환 */
  searchSimilar(queryVector: number[], topK: number): Promise<VectorMatch[]>
}
