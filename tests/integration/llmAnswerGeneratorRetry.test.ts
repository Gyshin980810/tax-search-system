/**
 * @vitest-environment node
 *
 * TAX-042C 통합 테스트 — 재시도 wrapper (callOnce + performWithRetry)
 *
 * 풀세트 보강 A·B·C·D 검증:
 *   - 통합 1: transient(LlmNetworkError) → jitter backoff 후 2차 정상 (보강 B)
 *   - 통합 2: 1차·2차 모두 transient → 외부 LlmNetworkError 전파
 *   - 통합 3: NoObjectGeneratedError → 즉시 LlmSchemaValidationError (재시도 안 함)
 *   - 통합 4a: 빈/잘린 응답 → 재시도 후 정상 (보강 A)
 *   - 통합 4b: 1차·2차 모두 빈 응답 → LlmEmptyResponseError (보강 C)
 *   - 통합 5: 1차 429 + Retry-After: 2 → 2초 대기 후 2차 정상 (보강 D)
 *
 * 결정화 전략:
 *   - Math.random vi.spyOn(0): jitter backoff = baseMs 그대로
 *   - vi.useFakeTimers + vi.advanceTimersByTimeAsync: 대기 시간 정밀 제어
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { APICallError, NoObjectGeneratedError } from 'ai'
import {
  LlmNetworkError,
  LlmSchemaValidationError,
  LlmEmptyResponseError,
} from '@/domain/errors'
import type { TaxLaw } from '@/domain/TaxLaw'
import type { TemporalContext } from '@/domain/TemporalContext'

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return { ...actual, generateObject: vi.fn() }
})

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => () => 'mock-model'),
}))

import { generateObject } from 'ai'
import { OpenAIAnswerGeneratorAdapter } from '@/adapters/llmAnswerGenerator'

const MOCK_LAW: TaxLaw = {
  sourceType: '법령',
  lawName: '부가가치세법',
  articleNumber: '제26조',
  articleTitle: '재화 또는 용역의 공급에 대한 면세',
  content: '제26조 다음 각 호의 재화 또는 용역의 공급에 대하여는 부가가치세를 면제한다.',
  revisionDate: '2026-01-01',
  enforcementDate: '2026-01-01',
  sourceUrl: 'https://www.law.go.kr/lsInfoP.do?lsiSeq=276117',
  trustTier: 'T1',
}

const MOCK_TEMPORAL: TemporalContext = {
  requestedAt: new Date('2026-06-07'),
  explicit: false,
}

const NORMAL_RESPONSE = {
  object: {
    citations: [
      {
        lawIndex: 0,
        label: '🟢직접근거',
        focusHint: '부가가치세를 면제한다',
        temporalLabel: '[현행]',
      },
    ],
    summary: '면세 대상 재화·용역에는 부가가치세가 면제됩니다.',
    temporalLabel: '[현행]',
  },
}

const EMPTY_RESPONSE = {
  object: { citations: [], summary: '', temporalLabel: '[현행]' },
}

describe('OpenAIAnswerGeneratorAdapter — TAX-042C 재시도 wrapper', () => {
  let adapter: OpenAIAnswerGeneratorAdapter
  const mockedGenerateObject = vi.mocked(generateObject)

  beforeEach(() => {
    adapter = new OpenAIAnswerGeneratorAdapter()
    vi.clearAllMocks()
    // 보강 B jitter 결정화 — Math.random=0이면 getRetryDelay(500)=500ms 고정
    vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.useFakeTimers({ shouldAdvanceTime: false })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // ─── 통합 1 (보강 B) ─────────────────────────────────────────────
  it('통합 1: 1차 transient(fetch failed) → 500ms backoff 후 2차 정상 PASS', async () => {
    mockedGenerateObject
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(NORMAL_RESPONSE as never)

    const promise = adapter.generate([MOCK_LAW], '부가가치세 면세', MOCK_TEMPORAL)
    await vi.advanceTimersByTimeAsync(500)
    const result = await promise

    expect(result.citations).toHaveLength(1)
    expect(result.summary).toContain('면세')
    expect(mockedGenerateObject).toHaveBeenCalledTimes(2)
  })

  // ─── 통합 2 ──────────────────────────────────────────────────────
  it('통합 2: 1차·2차 모두 transient → LlmNetworkError 전파, mock 2회', async () => {
    mockedGenerateObject
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockRejectedValueOnce(new Error('fetch failed'))

    const promise = adapter.generate([MOCK_LAW], '질문', MOCK_TEMPORAL)
    // unhandled rejection 회피 — fake timer가 microtask 순서를 흩뜨릴 수 있어 사전 등록
    promise.catch(() => {})
    await vi.advanceTimersByTimeAsync(500)
    await expect(promise).rejects.toBeInstanceOf(LlmNetworkError)
    expect(mockedGenerateObject).toHaveBeenCalledTimes(2)
  })

  // ─── 통합 3 ──────────────────────────────────────────────────────
  it('통합 3: NoObjectGeneratedError → 즉시 LlmSchemaValidationError, mock 1회 (재시도 없음)', async () => {
    // NoObjectGeneratedError 생성자는 response·usage·finishReason 필수
    // 테스트는 에러 클래스 분류만 검증하므로 minimal valid mock으로 채움
    const schemaErr = new NoObjectGeneratedError({
      message: 'invalid schema',
      cause: new Error('zod validation failed'),
      text: '',
      response: { id: 'mock-id', timestamp: new Date(), modelId: 'mock-model' },
      usage: {
        inputTokens: undefined,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokens: undefined,
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
        totalTokens: undefined,
      },
      finishReason: 'error',
    })
    mockedGenerateObject.mockRejectedValueOnce(schemaErr)

    await expect(adapter.generate([MOCK_LAW], '질문', MOCK_TEMPORAL))
      .rejects.toBeInstanceOf(LlmSchemaValidationError)
    expect(mockedGenerateObject).toHaveBeenCalledTimes(1)
  })

  // ─── 통합 4a (보강 A) ────────────────────────────────────────────
  it('통합 4a: 1차 빈 응답(citations=0+summary 공백) → 500ms backoff 후 2차 정상 PASS', async () => {
    mockedGenerateObject
      .mockResolvedValueOnce(EMPTY_RESPONSE as never)
      .mockResolvedValueOnce(NORMAL_RESPONSE as never)

    const promise = adapter.generate([MOCK_LAW], '질문', MOCK_TEMPORAL)
    await vi.advanceTimersByTimeAsync(500)
    const result = await promise

    expect(result.citations).toHaveLength(1)
    expect(mockedGenerateObject).toHaveBeenCalledTimes(2)
  })

  // ─── 통합 4b (보강 C) ────────────────────────────────────────────
  it('통합 4b: 1차·2차 모두 빈 응답 → LlmEmptyResponseError, mock 2회', async () => {
    mockedGenerateObject
      .mockResolvedValueOnce(EMPTY_RESPONSE as never)
      .mockResolvedValueOnce(EMPTY_RESPONSE as never)

    const promise = adapter.generate([MOCK_LAW], '질문', MOCK_TEMPORAL)
    promise.catch(() => {})
    await vi.advanceTimersByTimeAsync(500)
    await expect(promise).rejects.toBeInstanceOf(LlmEmptyResponseError)
    expect(mockedGenerateObject).toHaveBeenCalledTimes(2)
  })

  // ─── 통합 5 (보강 D) ─────────────────────────────────────────────
  it('통합 5: 1차 429 + Retry-After: 2 → 2000ms 대기 후 2차 정상 (jitter 사용 안 함)', async () => {
    const rateLimitErr = new APICallError({
      message: 'rate limit exceeded',
      url: 'https://api.openai.com/v1/chat/completions',
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: { 'retry-after': '2' },
    })
    mockedGenerateObject
      .mockRejectedValueOnce(rateLimitErr)
      .mockResolvedValueOnce(NORMAL_RESPONSE as never)

    const promise = adapter.generate([MOCK_LAW], '질문', MOCK_TEMPORAL)
    // 500ms 시점 — Retry-After가 2000ms이므로 아직 2차 호출 안 됨
    await vi.advanceTimersByTimeAsync(500)
    expect(mockedGenerateObject).toHaveBeenCalledTimes(1)
    // 추가 1500ms → 누적 2000ms 도달, 2차 호출 발동
    await vi.advanceTimersByTimeAsync(1500)
    const result = await promise

    expect(result.citations).toHaveLength(1)
    expect(mockedGenerateObject).toHaveBeenCalledTimes(2)
  })
})
