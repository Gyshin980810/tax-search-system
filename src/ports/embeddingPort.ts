/**
 * 임베딩 Port 인터페이스 (TAX-026-C)
 * 텍스트 → 벡터 변환. 모델(OpenAI ↔ Voyage)을 교체해도 Usecase 코드 무변경.
 */
export interface IEmbeddingPort {
  /** 단건 임베딩 — 질의 벡터 생성용 */
  embed(text: string): Promise<number[]>
  /** 배치 임베딩 — 법령 적재 배치용 (API 호출 횟수 최소화) */
  embedBatch(texts: string[]): Promise<number[][]>
}
