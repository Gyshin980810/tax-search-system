import 'server-only'
import { embed, embedMany } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import type { IEmbeddingPort } from '../ports/embeddingPort'

/** text-embedding-3-small — 1536차원, OPENAI_API_KEY 재사용 (신규 키 0, 회계사 결정 2026-05-23) */
const EMBEDDING_MODEL = 'text-embedding-3-small'

/**
 * OpenAI 임베딩 어댑터 (TAX-026-C)
 * IEmbeddingPort 구현체. 모델 교체 시 이 파일만 수정하면 됨.
 */
export class OpenAIEmbeddingAdapter implements IEmbeddingPort {
  private readonly openaiProvider

  constructor(apiKey: string) {
    this.openaiProvider = createOpenAI({ apiKey })
  }

  async embed(text: string): Promise<number[]> {
    const { embedding } = await embed({
      model: this.openaiProvider.embedding(EMBEDDING_MODEL),
      value: text,
    })
    return embedding
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const { embeddings } = await embedMany({
      model: this.openaiProvider.embedding(EMBEDDING_MODEL),
      values: texts,
    })
    return embeddings
  }
}
