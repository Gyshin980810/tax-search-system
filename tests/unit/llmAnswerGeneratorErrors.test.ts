/**
 * @vitest-environment node
 *
 * TAX-042A Stage 1 — OpenAIAnswerGeneratorAdapter catch 분기 세분화 단위 테스트.
 *
 * catch-all로 묶여 있던 LLM 호출 실패를 원인별로 정확히 분류함을 검증한다.
 * 정상 경로는 기존 통합 테스트(tests/integration/llmAnswerGenerator.test.ts)가 다루므로
 * 본 파일은 catch 분기만 좁게 검증한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  LlmSchemaValidationError,
  LlmNetworkError,
  LlmRateLimitError,
} from '@/domain/errors'
import type { TaxLaw } from '@/domain/TaxLaw'
import type { TemporalContext } from '@/domain/TemporalContext'

// 'ai' 패키지의 실제 클래스(APICallError·NoObjectGeneratedError)는 보존하고
// generateObject만 mock으로 교체한다. catch 분기가 isInstance(err)를 호출하므로
// 실제 클래스 인스턴스가 필요하다.
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    generateObject: vi.fn(),
  }
})

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => () => 'mock-model'),
}))

import { generateObject, APICallError, NoObjectGeneratedError } from 'ai'
import { OpenAIAnswerGeneratorAdapter } from '@/adapters/llmAnswerGenerator'

// ─── 픽스처 ─────────────────────────────────────────────────────────────────

const MOCK_LAW: TaxLaw = {
  sourceType: '법령',
  lawName: '부가가치세법',
  articleNumber: '제26조',
  articleTitle: '면세',
  content: '제26조 다음 각 호의 재화 또는 용역의 공급에 대하여는 부가가치세를 면제한다.',
  revisionDate: '2026-01-01',
  enforcementDate: '2026-01-01',
  sourceUrl: 'https://www.law.go.kr/test',
  trustTier: 'T1',
}

const MOCK_TEMPORAL: TemporalContext = {
  requestedAt: new Date('2026-06-07'),
  explicit: false,
}

// ─── 테스트 ─────────────────────────────────────────────────────────────────

describe('OpenAIAnswerGeneratorAdapter — catch 분기 세분화 (TAX-042A)', () => {
  let adapter: OpenAIAnswerGeneratorAdapter
  const mockedGenerateObject = vi.mocked(generateObject)

  beforeEach(() => {
    adapter = new OpenAIAnswerGeneratorAdapter()
    vi.clearAllMocks()
  })

  it('단위 1: NoObjectGeneratedError → LlmSchemaValidationError (cause 보존)', async () => {
    const zodLike = new Error('zod-violation')
    const wrap = new NoObjectGeneratedError({
      message: 'schema validation failed',
      cause: zodLike,
      text: '',
      response: { id: 'r', timestamp: new Date(), modelId: 'gpt-4o-mini' },
      usage: {
        inputTokens: 0,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokens: 0,
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
        totalTokens: 0,
      },
      finishReason: 'stop',
    })
    mockedGenerateObject.mockRejectedValueOnce(wrap)

    let caught: unknown
    try {
      await adapter.generate([MOCK_LAW], '질문', MOCK_TEMPORAL)
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(LlmSchemaValidationError)
    expect((caught as LlmSchemaValidationError).code).toBe('E-LLM-SCHEMA')
    expect((caught as Error).cause).toBe(wrap)
  })

  it('단위 2: APICallError(statusCode=429) → LlmRateLimitError (cause 보존)', async () => {
    const apiErr = new APICallError({
      message: 'rate limited',
      url: 'https://api.openai.com/v1/chat/completions',
      requestBodyValues: {},
      statusCode: 429,
      isRetryable: true,
    })
    // TAX-042C: transient 에러는 1회 재시도되므로 모든 호출에 같은 에러 반환 →
    //           2차도 실패 시 외부 catch가 LlmRateLimitError로 분류.
    mockedGenerateObject.mockRejectedValue(apiErr)

    let caught: unknown
    try {
      await adapter.generate([MOCK_LAW], '질문', MOCK_TEMPORAL)
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(LlmRateLimitError)
    expect((caught as LlmRateLimitError).code).toBe('E-LLM-RATELIMIT')
    expect((caught as Error).cause).toBe(apiErr)
  })

  it('단위 3: APICallError(statusCode=503) → LlmNetworkError (cause 보존)', async () => {
    const apiErr = new APICallError({
      message: 'service unavailable',
      url: 'https://api.openai.com/v1/chat/completions',
      requestBodyValues: {},
      statusCode: 503,
      isRetryable: true,
    })
    // TAX-042C: transient 1회 재시도. 둘 다 실패 → 외부 catch가 LlmNetworkError로 분류.
    mockedGenerateObject.mockRejectedValue(apiErr)

    let caught: unknown
    try {
      await adapter.generate([MOCK_LAW], '질문', MOCK_TEMPORAL)
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(LlmNetworkError)
    expect((caught as LlmNetworkError).code).toBe('E-LLM-NETWORK')
    expect((caught as Error).cause).toBe(apiErr)
  })

  it('단위 4: Node 네트워크 에러(ECONNRESET) → LlmNetworkError (cause 보존)', async () => {
    const netErr = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
    // TAX-042C: transient 1회 재시도. 둘 다 실패 → 외부 catch가 LlmNetworkError로 분류.
    mockedGenerateObject.mockRejectedValue(netErr)

    let caught: unknown
    try {
      await adapter.generate([MOCK_LAW], '질문', MOCK_TEMPORAL)
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(LlmNetworkError)
    expect((caught as LlmNetworkError).code).toBe('E-LLM-NETWORK')
    expect((caught as Error).cause).toBe(netErr)
  })
})
