import 'server-only'
import { embed, embedMany } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createVoyage } from '@ai-sdk/voyage'
import type { IEmbeddingPort } from '../ports/embeddingPort'

/** text-embedding-3-small — 1536차원, OPENAI_API_KEY 재사용 (신규 키 0, 회계사 결정 2026-05-23) */
const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small'

/**
 * voyage-4 — 한국어 검색 정확도가 OpenAI 대비 우수(법률·다국어 도메인 강점, TAX-6B-15).
 * outputDimension=1024로 고정(voyage-4는 1536 미지원, 256/512/1024/2048 중 선택).
 * 1024는 마트료시카(MRL) 구조라 2048 정확도의 98%+ 유지하면서 저장·속도 효율이 좋다.
 * ⚠️ 이 차원은 DB 스키마 vector(1024)와 반드시 일치해야 함(scripts/migrate.sql).
 */
const VOYAGE_EMBEDDING_MODEL = 'voyage-4'
const VOYAGE_OUTPUT_DIMENSION = 1024

/**
 * OpenAI 임베딩 어댑터 (TAX-026-C)
 * IEmbeddingPort 구현체. voyage 전환(TAX-6B-15) 이후에도 롤백 경로로 유지한다.
 */
export class OpenAIEmbeddingAdapter implements IEmbeddingPort {
  private readonly openaiProvider

  constructor(apiKey: string) {
    this.openaiProvider = createOpenAI({ apiKey })
  }

  async embed(text: string): Promise<number[]> {
    const { embedding } = await embed({
      model: this.openaiProvider.embedding(OPENAI_EMBEDDING_MODEL),
      value: text,
    })
    return embedding
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const { embeddings } = await embedMany({
      model: this.openaiProvider.embedding(OPENAI_EMBEDDING_MODEL),
      values: texts,
    })
    return embeddings
  }
}

/**
 * Voyage 임베딩 어댑터 (TAX-6B-15)
 * IEmbeddingPort 구현체 — 인터페이스가 동일해 Usecase·검색 코드는 무변경.
 * 적재(embedBatch)와 질의(embed)가 같은 모델·차원을 써야 벡터 공간이 일치한다.
 */
export class VoyageEmbeddingAdapter implements IEmbeddingPort {
  private readonly voyageProvider

  constructor(apiKey: string) {
    this.voyageProvider = createVoyage({ apiKey })
  }

  async embed(text: string): Promise<number[]> {
    const { embedding } = await embed({
      model: this.voyageProvider.textEmbeddingModel(VOYAGE_EMBEDDING_MODEL),
      value: text,
      providerOptions: { voyage: { outputDimension: VOYAGE_OUTPUT_DIMENSION } },
    })
    return embedding
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const { embeddings } = await embedMany({
      model: this.voyageProvider.textEmbeddingModel(VOYAGE_EMBEDDING_MODEL),
      values: texts,
      providerOptions: { voyage: { outputDimension: VOYAGE_OUTPUT_DIMENSION } },
    })
    return embeddings
  }
}
