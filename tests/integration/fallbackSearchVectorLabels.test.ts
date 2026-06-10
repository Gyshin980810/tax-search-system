/**
 * @vitest-environment node
 *
 * TAX-054: 비법령 의미검색 정합 + 회귀
 *
 * (1) FallbackSearchPort — caseNumber 이중노출 방지 + matchStage 전이
 * (2) OpenAIAnswerGeneratorAdapter — vector/expanded matchStage 라벨 천장 (downgradeVectorLabels)
 * (3) citation/references 트랙 분리 — content 없는 비법령은 references로 (V검증 비대상)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TaxLaw } from '@/domain/TaxLaw'
import type { ISearchPort } from '@/ports/taxLawSearchPort'
import type { IEmbeddingPort } from '@/ports/embeddingPort'
import type { IVectorSearchPort } from '@/ports/vectorSearchPort'
import type { SearchResult } from '@/domain/SearchResult'
import type { TemporalContext } from '@/domain/TemporalContext'
import type { IQueryRewriterPort } from '@/ports/llmQueryRewriterPort'
import type { ILawVerifierPort } from '@/ports/lawVerifierPort'

// generateObject 모킹 — LLM 실제 호출 없이 어댑터 후처리 로직만 검증
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return { ...actual, generateObject: vi.fn() }
})
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => () => 'mock-model'),
}))

import { generateObject } from 'ai'
import { FallbackSearchPort } from '@/usecases/searchWithFallback'
import { OpenAIAnswerGeneratorAdapter } from '@/adapters/llmAnswerGenerator'
import { generateAnswer } from '@/usecases/generateAnswer'

// ─── 공용 픽스처 ──────────────────────────────────────────────────────────────

/** 본문 있는 법령 (T1) */
const MOCK_LAW: TaxLaw = {
  sourceType: '법령',
  lawName: '부가가치세법',
  articleNumber: '제26조',
  articleTitle: '재화 또는 용역의 공급에 대한 면세',
  content:
    '제26조(재화 또는 용역의 공급에 대한 면세) 다음 각 호의 재화 또는 용역의 공급에 대하여는 부가가치세를 면제한다.',
  revisionDate: '2026-01-01',
  enforcementDate: '2026-01-01',
  sourceUrl: 'https://www.law.go.kr/lsInfoP.do?efYd=20260101&lsiSeq=276117',
  trustTier: 'T1',
}

/** 본문 있는 심판례 (T3) */
const MOCK_TRIBUNAL: TaxLaw = {
  sourceType: '심판례',
  lawName: '조세심판원 결정례',
  articleNumber: '',
  articleTitle: '가지급금 인정이자 처분 당부',
  content:
    '조세심판원은 쟁점 가지급금에 대해 인정이자를 계산하여 익금 산입한 처분이 적법하다고 결정함. '.repeat(
      20,
    ),
  revisionDate: '',
  enforcementDate: '',
  sourceUrl: 'https://example.com/case/조심2019서2461',
  trustTier: 'T3',
  caseNumber: '조심2019서2461',
  issuingBody: '조세심판원',
  decisionDate: '2020-01-15',
}

/** 본문 없는 심판례 (국세청 출처 패턴 — references 트랙 대상) */
const MOCK_CONTENTLESS_TRIBUNAL: TaxLaw = {
  ...MOCK_TRIBUNAL,
  caseNumber: '국심2023서9999',
  content: '',
}

const MOCK_TEMPORAL: TemporalContext = {
  requestedAt: new Date('2026-06-10'),
  explicit: false,
}

// ─── (1) FallbackSearchPort — caseNumber 이중노출 방지 + matchStage 전이 ───────

describe('FallbackSearchPort — caseNumber 이중노출 방지 + matchStage 전이', () => {
  const mockDirectPort = { search: vi.fn() } as unknown as ISearchPort
  const mockEmbedder = { embed: vi.fn(), embedBatch: vi.fn() } as unknown as IEmbeddingPort
  const mockVectorPort = { searchSimilar: vi.fn() } as unknown as IVectorSearchPort

  beforeEach(() => vi.clearAllMocks())

  it('[이중노출방지] 직접·벡터 양쪽에 같은 caseNumber가 있으면 병합 후 1건만 남는다', async () => {
    // 직접검색: 법령 content 없음 → THRESHOLD(3) 미달
    vi.mocked(mockDirectPort.search).mockResolvedValue({
      items: [MOCK_TRIBUNAL], // content 있는 심판례 1건만 → THRESHOLD 미달
      totalCount: 1,
    } as SearchResult)
    vi.mocked(mockEmbedder.embed).mockResolvedValue([0.1, 0.2])
    // 벡터: 동일 caseNumber + 다른 사건 반환
    vi.mocked(mockVectorPort.searchSimilar).mockResolvedValue([
      { item: MOCK_TRIBUNAL, similarity: 0.88 }, // 동일 caseNumber
      { item: { ...MOCK_TRIBUNAL, caseNumber: '조심2020서1234', articleTitle: '다른사건' }, similarity: 0.80 },
      { item: { ...MOCK_TRIBUNAL, caseNumber: '조심2021서5678', articleTitle: '또다른사건' }, similarity: 0.75 },
    ])

    const fallback = new FallbackSearchPort(mockDirectPort, mockEmbedder, mockVectorPort)
    const result = await fallback.search({ keyword: '가지급금', requestedAt: new Date() })

    // 동일 caseNumber가 직접+벡터 양쪽에 있어도 결과에는 1번만 나와야 함
    const duplicateCount = result.items.filter(
      (i) => i.caseNumber === '조심2019서2461',
    ).length
    expect(duplicateCount).toBe(1)
  })

  it('[matchStage=direct] content 보유 >= THRESHOLD(3)이면 벡터 호출 없이 direct 반환한다', async () => {
    const richLaws = Array.from({ length: 3 }, (_, i) => ({
      ...MOCK_LAW,
      articleNumber: `제${i + 1}조`,
      content: '본문 충분한 법령'.repeat(5),
    }))
    vi.mocked(mockDirectPort.search).mockResolvedValue({
      items: richLaws,
      totalCount: 3,
    } as SearchResult)

    const fallback = new FallbackSearchPort(mockDirectPort, mockEmbedder, mockVectorPort)
    const result = await fallback.search({ keyword: '부가가치세', requestedAt: new Date() })

    expect(result.matchStage).toBe('direct')
    // 직접 단계에서 충분 → 임베딩 호출 없음
    expect(mockEmbedder.embed).not.toHaveBeenCalled()
  })

  it('[matchStage=vector] 직접 content < THRESHOLD(3)이면 벡터 단계 후 vector를 반환한다', async () => {
    vi.mocked(mockDirectPort.search).mockResolvedValue({
      items: [{ ...MOCK_LAW, content: '' }], // content 0건 → THRESHOLD 미달
      totalCount: 1,
    } as SearchResult)
    vi.mocked(mockEmbedder.embed).mockResolvedValue([0.1])
    // 벡터: content 있는 심판례 3건 (THRESHOLD 충족)
    vi.mocked(mockVectorPort.searchSimilar).mockResolvedValue([
      { item: { ...MOCK_TRIBUNAL, caseNumber: 'A1' }, similarity: 0.85 },
      { item: { ...MOCK_TRIBUNAL, caseNumber: 'A2' }, similarity: 0.80 },
      { item: { ...MOCK_TRIBUNAL, caseNumber: 'A3' }, similarity: 0.75 },
    ])

    const fallback = new FallbackSearchPort(mockDirectPort, mockEmbedder, mockVectorPort)
    const result = await fallback.search({ keyword: '가지급금', requestedAt: new Date() })

    expect(result.matchStage).toBe('vector')
    expect(mockEmbedder.embed).toHaveBeenCalledOnce()
  })

  it('[직접결과 보존] 직접 결과를 벡터 결과로 교체하지 않고 직접 결과가 항상 앞에 온다', async () => {
    vi.mocked(mockDirectPort.search).mockResolvedValue({
      items: [MOCK_LAW], // content 1건 → THRESHOLD 미달
      totalCount: 1,
    } as SearchResult)
    vi.mocked(mockEmbedder.embed).mockResolvedValue([0.1])
    vi.mocked(mockVectorPort.searchSimilar).mockResolvedValue([
      { item: { ...MOCK_TRIBUNAL, caseNumber: 'V1' }, similarity: 0.90 },
      { item: { ...MOCK_TRIBUNAL, caseNumber: 'V2' }, similarity: 0.85 },
      { item: { ...MOCK_TRIBUNAL, caseNumber: 'V3' }, similarity: 0.80 },
    ])

    const fallback = new FallbackSearchPort(mockDirectPort, mockEmbedder, mockVectorPort)
    const result = await fallback.search({ keyword: '부가가치세 면세', requestedAt: new Date() })

    // 직접 결과(법령)가 벡터 결과(심판례)보다 앞에 위치
    expect(result.items[0].sourceType).toBe('법령')
    // 직접 결과가 벡터 결과로 대체되지 않았음
    expect(result.items.some((i) => i.sourceType === '법령')).toBe(true)
  })
})

// ─── (2) downgradeVectorLabels — matchStage 라벨 천장 ─────────────────────────

describe('OpenAIAnswerGeneratorAdapter — matchStage 라벨 천장 (downgradeVectorLabels)', () => {
  let adapter: OpenAIAnswerGeneratorAdapter
  const mockedGenerateObject = vi.mocked(generateObject)

  beforeEach(() => {
    adapter = new OpenAIAnswerGeneratorAdapter()
    vi.clearAllMocks()
  })

  it('[vector 천장] LLM이 🟢직접근거 반환해도 matchStage=vector면 🟡유사사례로 하향된다', async () => {
    mockedGenerateObject.mockResolvedValueOnce({
      object: {
        citations: [
          { lawIndex: 0, label: '🟢직접근거', focusHint: '면제한다', temporalLabel: '[현행]' },
        ],
        summary: '부가가치세법 제26조에 따라 면세 대상에 해당합니다.',
        temporalLabel: '[현행]',
      },
    } as never)

    const result = await adapter.generate([MOCK_LAW], '면세 대상은?', MOCK_TEMPORAL, 'vector')

    expect(result.citations[0].label).toBe('🟡유사사례')
  })

  it('[expanded 천장] matchStage=expanded이면 🟡도 ⚪참고자료로 하향되고 summary에 "직접 근거를 찾지 못했습니다" prefix가 붙는다', async () => {
    mockedGenerateObject.mockResolvedValueOnce({
      object: {
        citations: [
          { lawIndex: 0, label: '🟡유사사례', focusHint: '면제한다', temporalLabel: '[현행]' },
        ],
        summary: '유사 사례에서는 면세 대상에 해당합니다.',
        temporalLabel: '[현행]',
      },
    } as never)

    const result = await adapter.generate([MOCK_LAW], '면세 대상은?', MOCK_TEMPORAL, 'expanded')

    expect(result.citations[0].label).toBe('⚪참고자료')
    expect(result.summary).toMatch(/직접 근거를 찾지 못했습니다/)
  })

  it('[direct 무변경] matchStage=direct이면 🟢직접근거가 그대로 유지된다', async () => {
    mockedGenerateObject.mockResolvedValueOnce({
      object: {
        citations: [
          { lawIndex: 0, label: '🟢직접근거', focusHint: '면제한다', temporalLabel: '[현행]' },
        ],
        summary: '부가가치세법 제26조에 따라 면세 대상에 해당합니다.',
        temporalLabel: '[현행]',
      },
    } as never)

    const result = await adapter.generate([MOCK_LAW], '면세 대상은?', MOCK_TEMPORAL, 'direct')

    expect(result.citations[0].label).toBe('🟢직접근거')
  })

  it('[T3 유지] T3 심판례가 이미 🟡이면 vector 단계에서도 라벨이 변하지 않는다 (🟢 승격 없음)', async () => {
    mockedGenerateObject.mockResolvedValueOnce({
      object: {
        citations: [
          {
            lawIndex: 0,
            label: '🟡유사사례',
            focusHint: '인정이자',
            temporalLabel: '[결정: 2020-01-15]',
          },
        ],
        summary: '유사 심판례에서 인정이자 처분이 적법하다고 결정되었습니다.',
        temporalLabel: '[현행]',
      },
    } as never)

    const result = await adapter.generate([MOCK_TRIBUNAL], '가지급금 인정이자', MOCK_TEMPORAL, 'vector')

    // 이미 🟡이므로 천장(🟡) 이하 → 변화 없음
    expect(result.citations[0].label).toBe('🟡유사사례')
    // 🟢 승격이 없음을 명시적으로 단언
    expect(result.citations[0].label).not.toBe('🟢직접근거')
  })

  it('[폐지 보존] ⚫폐지 라벨은 matchStage=vector여도 변경되지 않는다', async () => {
    mockedGenerateObject.mockResolvedValueOnce({
      object: {
        citations: [
          { lawIndex: 0, label: '⚫폐지', focusHint: '면제한다', temporalLabel: '[폐지: 2024-01-01]' },
        ],
        summary: '해당 조문은 이미 폐지되었습니다.',
        temporalLabel: '[폐지: 2024-01-01]',
      },
    } as never)

    const result = await adapter.generate([MOCK_LAW], '면세 대상은?', MOCK_TEMPORAL, 'vector')

    // ⚫폐지는 폐지 사실 자체를 유지 (downgradeVectorLabels 명세)
    expect(result.citations[0].label).toBe('⚫폐지')
  })
})

// ─── (3) citation/references 트랙 분리 ───────────────────────────────────────

describe('citation/references 트랙 분리 — content 없는 비법령은 references로 (V검증 비대상)', () => {
  const mockedGenerateObject = vi.mocked(generateObject)

  beforeEach(() => vi.clearAllMocks())

  it('[트랙분리] content 없는 비법령은 references에 들어가고 citations에는 포함되지 않는다', async () => {
    // generateAnswer 전체 파이프라인을 포트 모킹으로 검증
    const mockQueryRewriter: IQueryRewriterPort = {
      rewrite: vi.fn().mockResolvedValue([{ keyword: '가지급금', requestedAt: new Date() }]),
    }
    const mockSearchPort: ISearchPort = {
      search: vi.fn().mockResolvedValue({
        items: [
          MOCK_LAW,            // content 있는 법령 → citable
          MOCK_CONTENTLESS_TRIBUNAL, // content 없는 심판례 → contentlessRefs
        ],
        totalCount: 2,
        matchStage: 'direct',
      } as SearchResult),
    }
    const mockVerifier: ILawVerifierPort = {
      verify: vi.fn().mockResolvedValue({
        status: 'PASS',
        checks: { v1: true, v2: true, v3: true, v4: true, v5: true, v6: true },
      }),
    }

    // LLM은 법령만 인용 (content 없는 심판례는 citable로 전달되지 않음)
    mockedGenerateObject.mockResolvedValueOnce({
      object: {
        citations: [
          { lawIndex: 0, label: '🟢직접근거', focusHint: '면제한다', temporalLabel: '[현행]' },
        ],
        summary: '부가가치세법 제26조에 따라 면세 대상에 해당합니다.',
        temporalLabel: '[현행]',
      },
    } as never)

    const adapter = new OpenAIAnswerGeneratorAdapter()
    const result = await generateAnswer(
      mockQueryRewriter,
      mockSearchPort,
      adapter,
      mockVerifier,
      '면세 대상이 무엇인가요?',
      MOCK_TEMPORAL,
    )

    // citations에 content 없는 심판례가 없음
    const citedCaseNumbers = result.citations.map((c) => c.taxLaw.caseNumber ?? '')
    expect(citedCaseNumbers).not.toContain('국심2023서9999')

    // references에 content 없는 심판례가 포함됨
    const refCaseNumbers = (result.references ?? []).map((r) => r.caseNumber ?? '')
    expect(refCaseNumbers).toContain('국심2023서9999')
  })

  it('[V검증 비대상] references 항목은 TaxLaw[] 타입 — excerpt 필드 없음 (citation 승격 금지)', () => {
    // references는 TaxLaw[] (Citation이 아님) → excerpt·label 필드 없음
    // SSOT §7.4: citation으로 승격 불가 (V2 우회 금지)
    const ref: TaxLaw = MOCK_CONTENTLESS_TRIBUNAL
    expect('excerpt' in ref).toBe(false)
    expect('label' in ref).toBe(false)
    // caseNumber로 식별 가능
    expect(ref.caseNumber).toBe('국심2023서9999')
  })

  it('[법령 content없음 드롭] content 없는 법령은 citations도 references도 아닌 드롭된다', async () => {
    const mockQueryRewriter: IQueryRewriterPort = {
      rewrite: vi.fn().mockResolvedValue([{ keyword: '부가가치세', requestedAt: new Date() }]),
    }
    const contentlessLaw: TaxLaw = { ...MOCK_LAW, content: '' }
    const mockSearchPort: ISearchPort = {
      search: vi.fn().mockResolvedValue({
        items: [MOCK_LAW, contentlessLaw],
        totalCount: 2,
        matchStage: 'direct',
      } as SearchResult),
    }
    const mockVerifier: ILawVerifierPort = {
      verify: vi.fn().mockResolvedValue({
        status: 'PASS',
        checks: { v1: true, v2: true, v3: true, v4: true, v5: true, v6: true },
      }),
    }
    mockedGenerateObject.mockResolvedValueOnce({
      object: {
        citations: [
          { lawIndex: 0, label: '🟢직접근거', focusHint: '면제한다', temporalLabel: '[현행]' },
        ],
        summary: '면세 대상입니다.',
        temporalLabel: '[현행]',
      },
    } as never)

    const adapter = new OpenAIAnswerGeneratorAdapter()
    const result = await generateAnswer(
      mockQueryRewriter,
      mockSearchPort,
      adapter,
      mockVerifier,
      '면세 대상?',
      MOCK_TEMPORAL,
    )

    // content 없는 법령은 references에도 포함되지 않음 (generateAnswer.ts splitResults 명세)
    const allItems = [
      ...result.citations.map((c) => c.taxLaw),
      ...(result.references ?? []),
    ]
    const contentlessLawInResult = allItems.filter(
      (i) => i.sourceType === '법령' && i.content === '',
    )
    expect(contentlessLawInResult).toHaveLength(0)
  })
})
