/**
 * @vitest-environment node
 *
 * TAX-042B Stage 2 — answerSchema citations.max(5) + SYSTEM_PROMPT 우선순위 가이드 검증.
 *
 * 단위 1: citations 5개 정상 응답 → adapter.generate() 정상 종료 + citations.length === 5
 * 단위 2: SDK가 NoObjectGeneratedError 던지면 LlmSchemaValidationError 변환 (Stage 1 통합 동작)
 * 단위 3: answerSchema.safeParse({citations: [6개]}) → success === false (Zod 제약 직접 검증)
 *
 * Stage 1의 vi.mock('ai') importActual 패턴을 그대로 사용한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LlmSchemaValidationError } from '@/domain/errors'
import type { TaxLaw } from '@/domain/TaxLaw'
import type { TemporalContext } from '@/domain/TemporalContext'

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

import { generateObject, NoObjectGeneratedError } from 'ai'
import {
  OpenAIAnswerGeneratorAdapter,
  answerSchema,
  citationItemSchema,
} from '@/adapters/llmAnswerGenerator'

// ─── 픽스처 ─────────────────────────────────────────────────────────────────

// 5개 짧은 TaxLaw. focusHint를 content의 명확한 substring으로 설정해 extractExcerpt가 안정 추출하도록 한다.
const LAWS: TaxLaw[] = Array.from({ length: 5 }, (_, i) => ({
  sourceType: '법령',
  lawName: '테스트법',
  articleNumber: `제${i + 1}조`,
  articleTitle: `테스트조문${i + 1}`,
  content: `제${i + 1}조 테스트 조문 본문 내용입니다.`,
  revisionDate: '2026-01-01',
  enforcementDate: '2026-01-01',
  sourceUrl: `https://www.law.go.kr/test/${i + 1}`,
  trustTier: 'T1',
}))

const TEMPORAL: TemporalContext = {
  requestedAt: new Date('2026-06-07'),
  explicit: false,
}

const VALID_CITATION = {
  lawIndex: 0,
  label: '🟢직접근거' as const,
  focusHint: '테스트',
  temporalLabel: '[현행]',
}

// ─── 테스트 ─────────────────────────────────────────────────────────────────

describe('OpenAIAnswerGeneratorAdapter — citations.max(5) (TAX-042B)', () => {
  let adapter: OpenAIAnswerGeneratorAdapter
  const mockedGenerateObject = vi.mocked(generateObject)

  beforeEach(() => {
    adapter = new OpenAIAnswerGeneratorAdapter()
    vi.clearAllMocks()
  })

  it('단위 1: citations 5개 정상 응답 → adapter.generate() 정상 종료, citations.length === 5', async () => {
    const fiveCitations = LAWS.map((_, i) => ({
      lawIndex: i,
      label: '🟢직접근거' as const,
      focusHint: '테스트',
      temporalLabel: '[현행]',
    }))
    mockedGenerateObject.mockResolvedValueOnce({
      object: {
        citations: fiveCitations,
        summary: '테스트 요약입니다.',
        temporalLabel: '[현행]',
      },
    } as never)

    const result = await adapter.generate(LAWS, '테스트 질문', TEMPORAL)

    expect(result.citations).toHaveLength(5)
    expect(result.summary).toBe('테스트 요약입니다.')
    expect(result.temporalLabel).toBe('[현행]')
  })

  it('단위 2: NoObjectGeneratedError → LlmSchemaValidationError + code E-LLM-SCHEMA', async () => {
    const wrap = new NoObjectGeneratedError({
      message: 'citations exceed max',
      cause: new Error('zod-too-big'),
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
      await adapter.generate(LAWS, '테스트 질문', TEMPORAL)
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(LlmSchemaValidationError)
    expect((caught as LlmSchemaValidationError).code).toBe('E-LLM-SCHEMA')
  })

  it('단위 3: answerSchema.safeParse 6개 citations → success === false (Zod 제약 직접 검증)', () => {
    const sixCitations = Array.from({ length: 6 }, () => VALID_CITATION)
    const result = answerSchema.safeParse({
      citations: sixCitations,
      summary: 'x',
      temporalLabel: '[현행]',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      const citationIssue = result.error.issues.find(
        (iss) => iss.path[0] === 'citations',
      )
      expect(citationIssue).toBeDefined()
    }
  })

  it('단위 3 보강: 5개는 통과, 0개도 통과 (.max는 상한만 강제)', () => {
    const fivePass = answerSchema.safeParse({
      citations: Array.from({ length: 5 }, () => VALID_CITATION),
      summary: 'x',
      temporalLabel: '[현행]',
    })
    const zeroPass = answerSchema.safeParse({
      citations: [],
      summary: 'x',
      temporalLabel: '[현행]',
    })
    expect(fivePass.success).toBe(true)
    expect(zeroPass.success).toBe(true)
  })

  it('단위 3 보강 2: citationItemSchema도 export되어 외부에서 valid citation 형식 검증 가능', () => {
    expect(citationItemSchema.safeParse(VALID_CITATION).success).toBe(true)
    expect(citationItemSchema.safeParse({ lawIndex: -1, label: '🟢직접근거', focusHint: 'x', temporalLabel: '[현행]' }).success).toBe(false)
  })
})
