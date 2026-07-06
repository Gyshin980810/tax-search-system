import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateAnswer } from '@/usecases/generateAnswer'
import { citationBoost, CITATION_BOOST_WEIGHT } from '@/domain/nonLawRelevance'
import { DISCLAIMER } from '@/domain/disclaimer'
import type { IQueryRewriterPort } from '@/ports/llmQueryRewriterPort'
import type { ISearchPort } from '@/ports/taxLawSearchPort'
import type { IAnswerGeneratorPort } from '@/ports/llmAnswerGeneratorPort'
import type { ILawVerifierPort } from '@/ports/lawVerifierPort'
import type { IEmbeddingPort } from '@/ports/embeddingPort'
import type { IVectorSearchPort, VectorMatch } from '@/ports/vectorSearchPort'
import type { ICitationGraphPort, CitationEdge } from '@/ports/citationGraphPort'
import type { SearchResult } from '@/domain/SearchResult'
import type { LabeledAnswer } from '@/domain/LabeledAnswer'
import type { TemporalContext } from '@/domain/TemporalContext'
import type { VerificationResult } from '@/domain/VerificationResult'
import type { TaxLaw } from '@/domain/TaxLaw'

// ─── 픽스처 ──────────────────────────────────────────────────────────────────
//
// TAX-6B-32: 참고 목록 확정 직전 citation_edges를 반영한다.
//   [4.5] 원문이 지목한 선례 1-hop 확장  [4.6] 피인용수 부스트 정렬
// generateAnswer에 ICitationGraphPort를 선택적으로 주입해 검증한다.

const MOCK_TEMPORAL: TemporalContext = { requestedAt: new Date('2026-05-15'), explicit: false }

const PASS_RESULT: VerificationResult = {
  status: 'PASS',
  checks: { v1: true, v2: true, v3: true, v4: true, v5: true, v6: true },
  failReasons: [],
}

const MOCK_ANSWER: LabeledAnswer = {
  rawQuestion: '질문',
  citations: [],
  summary: '요약입니다.',
  disclaimer: DISCLAIMER,
  temporalLabel: '[현행]',
  verificationResult: { status: 'PENDING', checks: { v1: false, v2: false, v3: false, v4: false, v5: false, v6: false }, failReasons: [] },
  generatedAt: new Date(),
}

const LAW_WITH_BODY: TaxLaw = {
  sourceType: '법령',
  lawName: '소득세법',
  articleNumber: '제89조',
  articleTitle: '비과세 양도소득',
  content: '제89조(비과세 양도소득) 다음 각 호의 소득에 대하여는 양도소득세를 과세하지 아니한다.',
  revisionDate: '2026-01-01',
  enforcementDate: '2026-01-01',
  sourceUrl: 'https://www.law.go.kr/law',
  trustTier: 'T1',
}

function makeTribunal(caseNumber: string, articleTitle: string, decisionDate = '2024-01-01'): TaxLaw {
  return {
    sourceType: '심판례',
    lawName: articleTitle,
    articleNumber: '',
    articleTitle,
    content: `주문\n재결요지 — ${articleTitle} 관련 본문(원문 그대로).`,
    revisionDate: decisionDate,
    enforcementDate: '',
    sourceUrl: `https://www.law.go.kr/allDeccSc.do?query=${caseNumber}`,
    trustTier: 'T3',
    caseNumber,
    issuingBody: '조세심판원',
    decisionDate,
  }
}

function makeEmbedStub(): IEmbeddingPort {
  return {
    embed: vi.fn(async () => [1, 0]),
    embedBatch: vi.fn(async (texts: string[]) => texts.map(() => [1, 0])),
  }
}

function makeVectorStubBySourceType(bySourceType: Record<string, VectorMatch[]>): IVectorSearchPort {
  return {
    searchSimilar: vi.fn(async (_vec: number[], _topK: number, sourceType?: string) => {
      return bySourceType[sourceType ?? ''] ?? []
    }),
  }
}

/** 인용 그래프 스텁 — 엣지·확장 문서·피인용수를 고정 반환 */
function makeGraphStub(opts: {
  edges?: CitationEdge[]
  docs?: TaxLaw[]
  inDegrees?: Record<string, number>
  throwOnOutgoing?: boolean
}): ICitationGraphPort {
  return {
    getOutgoing: vi.fn(async () => {
      if (opts.throwOnOutgoing) throw new Error('citation_edges down')
      return opts.edges ?? []
    }),
    getDocumentsByCaseNumbers: vi.fn(async (ids: string[]) =>
      (opts.docs ?? []).filter((d) => ids.includes(d.caseNumber ?? '')),
    ),
    getInDegrees: vi.fn(async () => new Map(Object.entries(opts.inDegrees ?? {}))),
  }
}

function makeStubs(items: TaxLaw[], keyword: string) {
  const queryRewriter: IQueryRewriterPort = {
    rewrite: vi.fn().mockResolvedValue([{ keyword, requestedAt: new Date() }]),
  }
  const searchResult: SearchResult = { items, totalCount: items.length }
  const searchPort: ISearchPort = { search: vi.fn().mockResolvedValue(searchResult) }
  const answerGenerator: IAnswerGeneratorPort = { generate: vi.fn().mockResolvedValue(MOCK_ANSWER) }
  const verifier: ILawVerifierPort = { verify: vi.fn().mockResolvedValue(PASS_RESULT) }
  return { queryRewriter, searchPort, answerGenerator, verifier }
}

// ─── [4.5] 1-hop 확장 ─────────────────────────────────────────────────────────

describe('인용 그래프 1-hop 확장 (TAX-6B-32 [4.5])', () => {
  it('참고 목록에 오른 심판례가 지목한 선례를 코퍼스에서 가져와 참고 목록에 추가한다', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '증여')
    const vectorPort = makeVectorStubBySourceType({
      심판례: [{ item: makeTribunal('조심2020서0001', '증여세부과처분취소'), similarity: 0.7 }],
    })
    const graphPort = makeGraphStub({
      edges: [{ fromId: '조심2020서0001', toId: '조심2015서0100', toType: '심판례', edgeType: 'FOLLOWS' }],
      docs: [makeTribunal('조심2015서0100', '증여세 원조 선례')],
    })

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '증여 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort, graphPort,
    )

    const caseNumbers = result.references?.map((r) => r.caseNumber) ?? []
    expect(caseNumbers).toContain('조심2020서0001') // 원 후보
    expect(caseNumbers).toContain('조심2015서0100') // 지목된 선례(확장)
  })

  it('이미 참고 목록에 있는 문서는 확장으로 중복 추가하지 않는다', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '증여')
    const vectorPort = makeVectorStubBySourceType({
      심판례: [{ item: makeTribunal('조심2020서0001', '증여세부과처분취소'), similarity: 0.7 }],
    })
    // 엣지가 자기 자신(이미 노출됨)을 지목 → 확장 대상 없음
    const graphPort = makeGraphStub({
      edges: [{ fromId: '조심2020서0001', toId: '조심2020서0001', toType: '심판례', edgeType: 'REFERS' }],
      docs: [makeTribunal('조심2020서0001', '증여세부과처분취소')],
    })

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '증여 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort, graphPort,
    )

    expect(result.references?.map((r) => r.caseNumber)).toEqual(['조심2020서0001'])
  })

  it('확장 대상이 많아도 MAX_CITATION_EXPANSION(3)건으로 제한한다 — 피인용수 상위 순', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '증여')
    const vectorPort = makeVectorStubBySourceType({
      심판례: [{ item: makeTribunal('조심2020서0001', '증여세부과처분취소'), similarity: 0.7 }],
    })
    const graphPort = makeGraphStub({
      edges: ['e1', 'e2', 'e3', 'e4', 'e5'].map((n) => ({
        fromId: '조심2020서0001', toId: `조심2015서010${n.slice(1)}`, toType: '심판례', edgeType: 'FOLLOWS',
      })),
      docs: [1, 2, 3, 4, 5].map((i) => makeTribunal(`조심2015서010${i}`, `선례${i}`)),
      inDegrees: { '조심2015서0101': 1, '조심2015서0102': 2, '조심2015서0103': 3, '조심2015서0104': 4, '조심2015서0105': 5 },
    })

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '증여 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort, graphPort,
    )

    const expanded = result.references?.map((r) => r.caseNumber).filter((c) => c !== '조심2020서0001') ?? []
    expect(expanded).toEqual(['조심2015서0105', '조심2015서0104', '조심2015서0103']) // 피인용 5·4·3
  })
})

// ─── [4.6] 피인용 부스트 정렬 ─────────────────────────────────────────────────

describe('피인용 부스트 정렬 (TAX-6B-32 [4.6])', () => {
  it('같은 관련도면 피인용수가 높은 문서가 앞선다(기본 사건번호 정렬을 역전)', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '증여')
    // 같은 유사도(0.7) 두 심판례 — 그래프 없으면 사건번호 오름차순으로 0001이 먼저
    const vectorPort = makeVectorStubBySourceType({
      심판례: [
        { item: makeTribunal('조심2020서0001', '증여세부과처분취소'), similarity: 0.7 },
        { item: makeTribunal('조심2020서0002', '증여세경정거부취소'), similarity: 0.7 },
      ],
    })
    // 0002가 훨씬 많이 인용됨 → 부스트로 0002가 앞으로 역전
    const graphPort = makeGraphStub({
      inDegrees: { '조심2020서0002': 50, '조심2020서0001': 0 },
    })

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '증여 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort, graphPort,
    )

    expect(result.references?.map((r) => r.caseNumber)).toEqual(['조심2020서0002', '조심2020서0001'])
  })
})

// ─── graceful degrade & 승격 금지 ─────────────────────────────────────────────

describe('인용 그래프 degrade·승격 금지 (TAX-6B-32)', () => {
  async function runBaseline() {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '증여')
    const vectorPort = makeVectorStubBySourceType({
      심판례: [{ item: makeTribunal('조심2020서0001', '증여세부과처분취소'), similarity: 0.7 }],
    })
    return generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '증여 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort, // citationGraphPort 미주입
    )
  }

  it('citationGraphPort 미주입 시 기존 참고 목록과 동일하다', async () => {
    const result = await runBaseline()
    expect(result.references?.map((r) => r.caseNumber)).toEqual(['조심2020서0001'])
  })

  it('그래프 조회가 실패하면 기존 참고 목록으로 복귀한다(graceful degrade)', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '증여')
    const vectorPort = makeVectorStubBySourceType({
      심판례: [{ item: makeTribunal('조심2020서0001', '증여세부과처분취소'), similarity: 0.7 }],
    })
    const graphPort = makeGraphStub({ throwOnOutgoing: true })

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '증여 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort, graphPort,
    )

    const baseline = await runBaseline()
    expect(result.references?.map((r) => r.caseNumber)).toEqual(baseline.references?.map((r) => r.caseNumber))
    expect(result.verificationResult.status).toBe('PASS')
  })

  it('확장 문서는 references에만 들어가고 citations로 승격되지 않는다', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '증여')
    const vectorPort = makeVectorStubBySourceType({
      심판례: [{ item: makeTribunal('조심2020서0001', '증여세부과처분취소'), similarity: 0.7 }],
    })
    const graphPort = makeGraphStub({
      edges: [{ fromId: '조심2020서0001', toId: '조심2015서0100', toType: '심판례', edgeType: 'FOLLOWS' }],
      docs: [makeTribunal('조심2015서0100', '증여세 원조 선례')],
    })

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '증여 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort, graphPort,
    )

    // 참고 목록엔 있으나 인용(citations)엔 없다
    expect(result.references?.map((r) => r.caseNumber)).toContain('조심2015서0100')
    expect(result.citations.map((c) => c.taxLaw.caseNumber)).not.toContain('조심2015서0100')
  })
})

// ─── domain: citationBoost 순수함수 ──────────────────────────────────────────

describe('citationBoost (TAX-6B-32)', () => {
  it('피인용 0회는 부스트 0', () => {
    expect(citationBoost(0)).toBe(0)
  })
  it('log 스케일 — 189회 허브도 약 2.65점으로 완만', () => {
    expect(citationBoost(189)).toBeCloseTo(CITATION_BOOST_WEIGHT * Math.log(190), 5)
    expect(citationBoost(189)).toBeLessThan(3)
  })
  it('음수 입력은 0으로 방어', () => {
    expect(citationBoost(-5)).toBe(0)
  })
})

// ─── adapter: SQL 계약 (pg 목킹) ─────────────────────────────────────────────

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))
vi.mock('pg', () => ({
  // new Pool()이 생성자로 호출되므로 화살표 함수가 아닌 class로 목킹한다
  Pool: class {
    query = queryMock
  },
}))

describe('PgCitationGraphAdapter SQL 계약 (TAX-6B-32)', () => {
  beforeEach(() => {
    queryMock.mockReset()
    queryMock.mockResolvedValue({ rows: [] })
  })

  it('getOutgoing은 FOLLOWS/REFERS·in_corpus만 조회하고 APPEAL을 제외한다', async () => {
    const { PgCitationGraphAdapter } = await import('@/adapters/citationGraph')
    const adapter = new PgCitationGraphAdapter('postgres://x')
    await adapter.getOutgoing(['조심2020서0001'])

    const sql = queryMock.mock.calls[0][0] as string
    expect(sql).toContain("edge_type IN ('FOLLOWS','REFERS')")
    expect(sql).toContain('in_corpus = true')
    expect(sql).not.toContain('APPEAL')
  })

  it('빈 입력이면 DB를 조회하지 않는다(불필요한 왕복 방지)', async () => {
    const { PgCitationGraphAdapter } = await import('@/adapters/citationGraph')
    const adapter = new PgCitationGraphAdapter('postgres://x')
    expect(await adapter.getOutgoing([])).toEqual([])
    expect(await adapter.getInDegrees([])).toEqual(new Map())
    expect(await adapter.getDocumentsByCaseNumbers([])).toEqual([])
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('getInDegrees는 to_id별 count를 Map으로 반환한다', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ to_id: '조심2017서0991', n: '189' }] })
    const { PgCitationGraphAdapter } = await import('@/adapters/citationGraph')
    const adapter = new PgCitationGraphAdapter('postgres://x')
    const map = await adapter.getInDegrees(['조심2017서0991'])
    expect(map.get('조심2017서0991')).toBe(189)
  })
})
