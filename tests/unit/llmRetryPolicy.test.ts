/**
 * llmRetryPolicy 단위 테스트 (TAX-042C-1)
 *
 * 책임별 검증:
 *   - isTransientNetworkError: 도메인 에러 분류 + AI SDK ducktype
 *   - detectEmptyResponse: AND 조건 엄격성 (빈약 케이스 보호)
 *   - getRetryDelay: jitter 결정화 (Math.random mock)
 *   - parseRetryAfter: 초/HTTP-date/상한 클램프/null 처리
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  isTransientNetworkError,
  detectEmptyResponse,
  getRetryDelay,
  parseRetryAfter,
  LlmEmptyResponseError,
} from '@/adapters/llmRetryPolicy'
import {
  LlmNetworkError,
  LlmRateLimitError,
  LlmTimeoutError,
  LlmSchemaValidationError,
} from '@/domain/errors'

describe('isTransientNetworkError — 일시적 오류 판정', () => {
  it('LlmNetworkError 인스턴스는 transient', () => {
    expect(isTransientNetworkError(new LlmNetworkError())).toBe(true)
  })

  it('LlmRateLimitError 인스턴스는 transient', () => {
    expect(isTransientNetworkError(new LlmRateLimitError())).toBe(true)
  })

  it('statusCode 429·500·502·503·504 ducktype은 transient', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isTransientNetworkError({ statusCode: status })).toBe(true)
    }
  })

  it('statusCode 400·401·404 등 client error는 non-transient (즉시 throw)', () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isTransientNetworkError({ statusCode: status })).toBe(false)
    }
  })

  it('LlmTimeoutError·LlmSchemaValidationError는 non-transient (별도 분기)', () => {
    expect(isTransientNetworkError(new LlmTimeoutError())).toBe(false)
    expect(isTransientNetworkError(new LlmSchemaValidationError())).toBe(false)
  })

  it('null·undefined·일반 Error는 non-transient (false-safe)', () => {
    expect(isTransientNetworkError(null)).toBe(false)
    expect(isTransientNetworkError(undefined)).toBe(false)
    expect(isTransientNetworkError(new Error('plain'))).toBe(false)
  })
})

describe('detectEmptyResponse — 빈/잘린 응답 감지 (보강 A)', () => {
  it('citations=0 AND summary 공백 → true (truncation 판정)', () => {
    expect(detectEmptyResponse({ citations: [], summary: '' })).toBe(true)
    expect(detectEmptyResponse({ citations: [], summary: '   ' })).toBe(true)
    expect(detectEmptyResponse({ citations: [], summary: '\n\t' })).toBe(true)
  })

  it('citations≥1 이면 false (직접 근거 존재)', () => {
    expect(detectEmptyResponse({ citations: [{ foo: 1 }], summary: '' })).toBe(false)
  })

  it('summary가 1자라도 있으면 false (CLAUDE.md §6.3 빈약 케이스 보호)', () => {
    expect(detectEmptyResponse({ citations: [], summary: '직접 근거를 찾지 못했습니다.' })).toBe(false)
    expect(detectEmptyResponse({ citations: [], summary: 'a' })).toBe(false)
  })
})

describe('getRetryDelay — jitter backoff (보강 B)', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random')
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Math.random()=0 결정화 시 baseMs 그대로 반환', () => {
    vi.mocked(Math.random).mockReturnValue(0)
    expect(getRetryDelay(500)).toBe(500)
  })

  it('Math.random()=1 결정화 시 baseMs + (baseMs/2) 반환 (상한)', () => {
    vi.mocked(Math.random).mockReturnValue(1)
    expect(getRetryDelay(500)).toBe(750)
  })

  it('Math.random()=0.5 결정화 시 baseMs + (baseMs/4) 반환', () => {
    vi.mocked(Math.random).mockReturnValue(0.5)
    expect(getRetryDelay(500)).toBe(625)
  })
})

describe('parseRetryAfter — 429 Retry-After 헤더 파싱 (보강 D)', () => {
  it('초 단위 정수 → 초*1000ms 반환', () => {
    const err = new LlmRateLimitError({ responseHeaders: { 'retry-after': '2' } })
    expect(parseRetryAfter(err)).toBe(2000)
  })

  it('상한 10초 클램프 — 60초 헤더는 10000ms로 클램프', () => {
    const err = new LlmRateLimitError({ responseHeaders: { 'retry-after': '60' } })
    expect(parseRetryAfter(err)).toBe(10_000)
  })

  it('HTTP-date 형식 → 현재 시각과의 차이 ms (10초 클램프)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-07T00:00:00Z'))
    const err = new LlmRateLimitError({
      responseHeaders: { 'retry-after': 'Sun, 07 Jun 2026 00:00:03 GMT' },
    })
    expect(parseRetryAfter(err)).toBe(3000)
    vi.useRealTimers()
  })

  it('과거 HTTP-date → null (이미 지난 시각)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-07T00:00:00Z'))
    const err = new LlmRateLimitError({
      responseHeaders: { 'retry-after': 'Sun, 07 Jun 2026 00:00:00 GMT' },
    })
    expect(parseRetryAfter(err)).toBeNull()
    vi.useRealTimers()
  })

  it('헤더가 없거나 LlmRateLimitError가 아니면 null (jitter fallback)', () => {
    expect(parseRetryAfter(new LlmNetworkError())).toBeNull()
    expect(parseRetryAfter(new LlmRateLimitError())).toBeNull()
    expect(parseRetryAfter(new LlmRateLimitError({ responseHeaders: {} }))).toBeNull()
    expect(parseRetryAfter(null)).toBeNull()
  })

  it('잘못된 헤더 값(빈 문자열·NaN 토큰) → null', () => {
    const err1 = new LlmRateLimitError({ responseHeaders: { 'retry-after': '' } })
    const err2 = new LlmRateLimitError({ responseHeaders: { 'retry-after': 'invalid' } })
    expect(parseRetryAfter(err1)).toBeNull()
    expect(parseRetryAfter(err2)).toBeNull()
  })
})

describe('LlmEmptyResponseError — 보강 C 신규 도메인 에러', () => {
  it('재시도 후에도 빈 응답이면 본 에러로 throw 가능', () => {
    const err = new LlmEmptyResponseError()
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('E-LLM-EMPTY')
    expect(err.message).toMatch(/비어 있거나 잘렸습니다/)
  })
})
