/**
 * @vitest-environment node
 *
 * TAX-6A-10 (1b): V3 라벨 안전망 양방향 보강 — T1·T2 과소부착 라벨 🟢 승격
 *
 * 진단(2026-06-15): LLM이 T1 법령 본문을 🟡유사사례로 과도 하향 → V3 FAIL(G3-05).
 * 보수적 승격 정책(회계사 승인): summary 긍정형일 때만 T1·T2를 🟢로 승격,
 *                                 부정형("찾지 못함")이면 LLM 판단 존중(승격 안 함).
 *
 * generateObject를 모킹해 어댑터 후처리(upgradeT1T2UnderlabeledCitations)만 검증한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
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
import {
  OpenAIAnswerGeneratorAdapter,
  upgradeT1T2UnderlabeledCitations,
} from '@/adapters/llmAnswerGenerator'
import type { Citation } from '@/domain/Citation'

// ─── 공용 픽스처 ──────────────────────────────────────────────────────────────

/** T1 법령 본문 */
const MOCK_T1_LAW: TaxLaw = {
  sourceType: '법령',
  lawName: '소득세법',
  articleNumber: '제47조',
  articleTitle: '근로소득공제',
  content:
    '제47조(근로소득공제) ① 근로소득이 있는 거주자에 대해서는 해당 과세기간에 받는 총급여액에서 다음의 금액을 공제한다.',
  revisionDate: '2026-04-21',
  enforcementDate: '2026-04-21',
  sourceUrl: 'https://www.law.go.kr/lsInfoP.do?lsiSeq=000000',
  trustTier: 'T1',
}

/** T3 심판례 (승격 대상 아님) */
const MOCK_T3_TRIBUNAL: TaxLaw = {
  sourceType: '심판례',
  lawName: '조세심판원 결정례',
  articleNumber: '',
  articleTitle: '근로소득공제 적용 당부',
  content: '조세심판원은 쟁점 근로소득공제 적용이 적법하다고 결정함. '.repeat(10),
  revisionDate: '',
  enforcementDate: '',
  sourceUrl: 'https://example.com/case/조심2020서1111',
  trustTier: 'T3',
  caseNumber: '조심2020서1111',
  issuingBody: '조세심판원',
  decisionDate: '2020-03-10',
}

const MOCK_TEMPORAL: TemporalContext = {
  requestedAt: new Date('2026-06-15'),
  explicit: false,
}

// ─── (A) 순수 함수 단위 검증 — upgradeT1T2UnderlabeledCitations ─────────────────

describe('upgradeT1T2UnderlabeledCitations — 보수적 승격 순수 로직', () => {
  function makeCitation(tier: TaxLaw['trustTier'], label: Citation['label']): Citation {
    return {
      taxLaw: { ...MOCK_T1_LAW, trustTier: tier },
      label,
      excerpt: '발췌',
      temporalLabel: '[현행]',
    }
  }

  it('[긍정형 승격] summary 긍정 + T1 🟡유사사례 → 🟢직접근거로 승격', () => {
    const { citations, upgradedCount } = upgradeT1T2UnderlabeledCitations(
      [makeCitation('T1', '🟡유사사례')],
      '소득세법 제47조에 따라 근로소득공제 한도가 정해집니다.',
    )
    expect(citations[0].label).toBe('🟢직접근거')
    expect(upgradedCount).toBe(1)
  })

  it('[긍정형 ⚪승격] summary 긍정 + T2 ⚪참고자료 → 🟢직접근거로 승격', () => {
    const { citations, upgradedCount } = upgradeT1T2UnderlabeledCitations(
      [makeCitation('T2', '⚪참고자료')],
      '부칙 경과조치에 따라 적용 시점이 정해집니다.',
    )
    expect(citations[0].label).toBe('🟢직접근거')
    expect(upgradedCount).toBe(1)
  })

  it('[부정형 skip] summary "찾지 못했" + T1 🟡 → 라벨 불변(LLM 판단 존중)', () => {
    const { citations, upgradedCount } = upgradeT1T2UnderlabeledCitations(
      [makeCitation('T1', '🟡유사사례')],
      '질문에 해당하는 조항을 찾지 못했습니다. 다만 관련 조문은 다음과 같습니다.',
    )
    expect(citations[0].label).toBe('🟡유사사례')
    expect(upgradedCount).toBe(0)
  })

  it('[T3 미승격] summary 긍정 + T3 🟡 → 승격 대상 아님(불변)', () => {
    const { citations, upgradedCount } = upgradeT1T2UnderlabeledCitations(
      [makeCitation('T3', '🟡유사사례')],
      '유사 사례에서는 근로소득공제가 적용되었습니다.',
    )
    expect(citations[0].label).toBe('🟡유사사례')
    expect(upgradedCount).toBe(0)
  })

  it('[폐지 보존] summary 긍정 + T1 ⚫폐지 → 불변(폐지 사실 유지)', () => {
    const { citations, upgradedCount } = upgradeT1T2UnderlabeledCitations(
      [makeCitation('T1', '⚫폐지')],
      '해당 조문은 폐지되었습니다.',
    )
    expect(citations[0].label).toBe('⚫폐지')
    expect(upgradedCount).toBe(0)
  })

  it('[이미 🟢 무변경] T1 🟢직접근거는 그대로 유지', () => {
    const { citations, upgradedCount } = upgradeT1T2UnderlabeledCitations(
      [makeCitation('T1', '🟢직접근거')],
      '소득세법 제47조에 따라 공제됩니다.',
    )
    expect(citations[0].label).toBe('🟢직접근거')
    expect(upgradedCount).toBe(0)
  })
})

// ─── (B) 어댑터 통합 — generate() 파이프라인 내 동작 ──────────────────────────

describe('OpenAIAnswerGeneratorAdapter — 1b 승격 파이프라인 통합', () => {
  const mockedGenerateObject = vi.mocked(generateObject)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('[direct 승격] summary 긍정 + LLM이 T1을 🟡로 라벨 → 최종 🟢직접근거', async () => {
    mockedGenerateObject.mockResolvedValueOnce({
      object: {
        citations: [
          { lawIndex: 0, label: '🟡유사사례', focusHint: '근로소득공제', temporalLabel: '[현행]' },
        ],
        summary: '소득세법 제47조에 따라 근로소득공제 한도가 정해집니다.',
        temporalLabel: '[현행]',
      },
    } as never)

    const adapter = new OpenAIAnswerGeneratorAdapter()
    const result = await adapter.generate([MOCK_T1_LAW], '근로소득공제 한도는?', MOCK_TEMPORAL, 'direct')

    expect(result.citations[0].label).toBe('🟢직접근거')
  })

  it('[부정형 skip] summary "찾지 못했" + T1 🟡 → 🟡 유지(보수적 — G3-05 의도된 동작)', async () => {
    mockedGenerateObject.mockResolvedValueOnce({
      object: {
        citations: [
          { lawIndex: 0, label: '🟡유사사례', focusHint: '근로소득', temporalLabel: '[현행]' },
        ],
        summary: '질문에서 언급한 근로소득공제 한도에 해당하는 조항을 찾지 못했습니다.',
        temporalLabel: '[현행]',
      },
    } as never)

    const adapter = new OpenAIAnswerGeneratorAdapter()
    const result = await adapter.generate([MOCK_T1_LAW], '근로소득공제 한도는?', MOCK_TEMPORAL, 'direct')

    // 보수적 정책: 부정형 summary면 승격 안 함 → 🟡 유지
    expect(result.citations[0].label).toBe('🟡유사사례')
  })

  it('[vector 천장 우선] summary 긍정 + T1 🟡 + matchStage=vector → 승격됐다가 천장으로 🟡 복귀', async () => {
    mockedGenerateObject.mockResolvedValueOnce({
      object: {
        citations: [
          { lawIndex: 0, label: '🟡유사사례', focusHint: '근로소득공제', temporalLabel: '[현행]' },
        ],
        summary: '소득세법 제47조에 따라 근로소득공제 한도가 정해집니다.',
        temporalLabel: '[현행]',
      },
    } as never)

    const adapter = new OpenAIAnswerGeneratorAdapter()
    const result = await adapter.generate([MOCK_T1_LAW], '근로소득공제 한도는?', MOCK_TEMPORAL, 'vector')

    // 1b가 🟢로 올렸어도 vector 천장(🟡)이 다시 적용 → 벡터 결과는 직접근거 불가
    expect(result.citations[0].label).toBe('🟡유사사례')
  })

  it('[T3 미승격 통합] summary 긍정 + LLM이 T3를 🟡로 라벨 → 🟡 유지', async () => {
    mockedGenerateObject.mockResolvedValueOnce({
      object: {
        citations: [
          { lawIndex: 0, label: '🟡유사사례', focusHint: '근로소득공제', temporalLabel: '[결정: 2020-03-10]' },
        ],
        summary: '유사 심판례에서는 근로소득공제가 적용되었습니다.',
        temporalLabel: '[현행]',
      },
    } as never)

    const adapter = new OpenAIAnswerGeneratorAdapter()
    const result = await adapter.generate([MOCK_T3_TRIBUNAL], '근로소득공제 한도는?', MOCK_TEMPORAL, 'direct')

    // T3는 1b 승격 대상이 아님 (위험 방향이 아니라 올바른 라벨)
    expect(result.citations[0].label).toBe('🟡유사사례')
  })
})
