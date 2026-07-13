import { describe, it, expect, vi } from 'vitest'
import { generateAnswer } from '@/usecases/generateAnswer'
import { DISCLAIMER } from '@/domain/disclaimer'
import type { IQueryRewriterPort } from '@/ports/llmQueryRewriterPort'
import type { ISearchPort } from '@/ports/taxLawSearchPort'
import type { IAnswerGeneratorPort } from '@/ports/llmAnswerGeneratorPort'
import type { ILawVerifierPort } from '@/ports/lawVerifierPort'
import type { IEmbeddingPort } from '@/ports/embeddingPort'
import type { IVectorSearchPort, VectorMatch } from '@/ports/vectorSearchPort'
import type { SearchResult } from '@/domain/SearchResult'
import type { LabeledAnswer } from '@/domain/LabeledAnswer'
import type { TemporalContext } from '@/domain/TemporalContext'
import type { VerificationResult } from '@/domain/VerificationResult'
import type { TaxLaw } from '@/domain/TaxLaw'

// ─── 픽스처 ──────────────────────────────────────────────────────────────────
//
// TAX-6B-18 [4]: 판례(TAX-6B-14)와 동일한 pgvector 라이브 배선을 심판례에도 일반화한다.
// 실시간 searchTribunal API 경로는 그대로 두고(폴백 보존), 참고 목록(references)에
// 심판례 벡터 검색을 추가로 합류시키는 경로만 검증한다.

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

/** 심판례 코퍼스 픽스처 — 사건번호·선고일·본문을 가진 T3 심판례 */
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

/** 판례 코퍼스 픽스처 — 판례·심판례 교차 검증용 */
function makePrecedent(caseNumber: string, articleTitle: string, decisionDate = '2024-01-01'): TaxLaw {
  return {
    sourceType: '판례',
    lawName: articleTitle,
    articleNumber: '',
    articleTitle,
    content: `주문\n판결요지 — ${articleTitle} 관련 본문(원문 그대로).`,
    revisionDate: decisionDate,
    enforcementDate: '',
    sourceUrl: `https://www.law.go.kr/precInfoP.do?precSeq=${caseNumber}`,
    trustTier: 'T4',
    caseNumber,
    issuingBody: '대법원',
    decisionDate,
  }
}

/** 국세청 해석례 코퍼스 픽스처 — 동일 caseNumber 중복 가능성을 externalId로 구분한다. */
function makeNtsInterpretation(caseNumber: string, externalId: string, articleTitle: string): TaxLaw {
  return {
    sourceType: '해석례',
    lawName: `국세청 ${caseNumber}`,
    articleNumber: '',
    articleTitle,
    content: `세법해석례 원문 — ${articleTitle}`,
    revisionDate: '2024-01-01',
    enforcementDate: '',
    sourceUrl: `https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=${externalId}`,
    trustTier: 'T3',
    caseNumber,
    externalId,
    issuingBody: '국세청',
    decisionDate: '2024-01-01',
  }
}

function makeEmbedStub(): IEmbeddingPort {
  return {
    embed: vi.fn(async () => [1, 0]),
    embedBatch: vi.fn(async (texts: string[]) => texts.map(() => [1, 0])),
  }
}

/** sourceType별로 다른 결과를 반환하는 벡터 검색 스텁 */
function makeVectorStubBySourceType(bySourceType: Record<string, VectorMatch[]>): IVectorSearchPort {
  return {
    searchSimilar: vi.fn(async (_vec: number[], _topK: number, sourceType?: string) => {
      return bySourceType[sourceType ?? ''] ?? []
    }),
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

describe('심판례 코퍼스 라이브 배선 (TAX-6B-18 [4])', () => {
  it('유사도 바닥(0.5) 이상 심판례를 참고 목록에 T3로 노출한다', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '양도소득세 부당행위')
    const vectorPort = makeVectorStubBySourceType({
      심판례: [{ item: makeTribunal('조심2024서1234', '양도소득세부과처분취소'), similarity: 0.62 }],
    })

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '양도소득세 부당행위 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort,
    )

    expect(result.references?.map((r) => r.caseNumber)).toEqual(['조심2024서1234'])
    expect(result.references?.[0].trustTier).toBe('T3')
    expect(vectorPort.searchSimilar).toHaveBeenCalledWith(expect.any(Array), 5, '판례')
    expect(vectorPort.searchSimilar).toHaveBeenCalledWith(expect.any(Array), 5, '심판례')
  })

  it('유사도 바닥 미만 심판례는 제외한다', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '양도소득세')
    const vectorPort = makeVectorStubBySourceType({
      심판례: [{ item: makeTribunal('low1', '취득세부과처분취소'), similarity: 0.4 }],
    })

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '양도소득세 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort,
    )

    expect(result.references).toEqual([])
  })

  it('게이트 통과 심판례가 많아도 max(2)건으로 제한한다', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '양도')
    const vectorPort = makeVectorStubBySourceType({
      심판례: [
        { item: makeTribunal('t1', '양도소득세부과처분취소'), similarity: 0.9 },
        { item: makeTribunal('t2', '양도소득세경정거부취소'), similarity: 0.8 },
        { item: makeTribunal('t3', '양도소득세가산세취소'), similarity: 0.7 },
        { item: makeTribunal('t4', '양도소득세환급거부취소'), similarity: 0.6 },
      ],
    })

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '양도 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort,
    )

    expect(result.references?.map((r) => r.caseNumber)).toEqual(['t1', 't2'])
  })

  it('판례와 심판례가 함께 게이트를 통과하면 둘 다 노출되고 관련도순으로 병합된다', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '증여')
    const vectorPort = makeVectorStubBySourceType({
      판례: [{ item: makePrecedent('prec1', '증여세부과처분취소'), similarity: 0.7 }],
      심판례: [{ item: makeTribunal('trib1', '증여세경정거부취소'), similarity: 0.85 }],
    })

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '증여 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort,
    )

    // 유사도 높은 심판례(0.85)가 판례(0.7)보다 앞선다
    expect(result.references?.map((r) => r.caseNumber)).toEqual(['trib1', 'prec1'])
  })

  it('심판례 검색만 실패해도 판례 경로는 그대로 유지된다 — graceful degrade', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '증여')
    const vectorPort: IVectorSearchPort = {
      searchSimilar: vi.fn(async (_vec: number[], _topK: number, sourceType?: string) => {
        if (sourceType === '심판례') throw new Error('pgvector down')
        if (sourceType === '판례') return [{ item: makePrecedent('prec1', '증여세부과처분취소'), similarity: 0.7 }]
        return []
      }),
    }

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '증여 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort,
    )

    expect(result.references?.map((r) => r.caseNumber)).toEqual(['prec1'])
    expect(result.verificationResult.status).toBe('PASS')
  })

  it('이미 판례 후보로 뽑힌 사건번호와 겹치지 않는 한 심판례도 정상 노출된다(교차 중복 없음 확인)', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '상속')
    const vectorPort = makeVectorStubBySourceType({
      판례: [{ item: makePrecedent('같은번호', '상속세부과처분취소'), similarity: 0.9 }],
      심판례: [{ item: makeTribunal('같은번호', '상속세경정거부취소'), similarity: 0.8 }],
    })

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '상속 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort,
    )

    // sourceType이 identityKey에 포함되므로 사건번호가 같아도 서로 다른 자료로 취급된다
    const sourceTypes = result.references?.map((r) => r.sourceType) ?? []
    expect(sourceTypes.sort()).toEqual(['심판례', '판례'])
  })
})

describe('국세청 세법해석례 코퍼스 라이브 배선 (TAX-6B-20-C)', () => {
  it('유사도 바닥 이상 해석례를 참고 목록에 T3로 노출한다', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '가지급금')
    const vectorPort = makeVectorStubBySourceType({
      해석례: [{ item: makeNtsInterpretation('법인22601-2200', 'NTS-1', '가지급금 인정이자 계산'), similarity: 0.62 }],
    })

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '가지급금 인정이자 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort,
    )

    expect(result.references?.map((r) => r.externalId)).toEqual(['NTS-1'])
    expect(result.references?.[0].trustTier).toBe('T3')
    expect(vectorPort.searchSimilar).toHaveBeenCalledWith(expect.any(Array), 5, '해석례')
  })

  it('유사도 바닥 미만 해석례는 제외한다', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '가지급금')
    const vectorPort = makeVectorStubBySourceType({
      해석례: [{ item: makeNtsInterpretation('법인22601-2200', 'NTS-1', '가지급금 인정이자 계산'), similarity: 0.4 }],
    })

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '가지급금 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort,
    )

    expect(result.references).toEqual([])
  })

  it('실시간 결과와 같은 externalId의 벡터 해석례는 중복 노출하지 않는다', async () => {
    const realtime = { ...makeNtsInterpretation('재산', 'NTS-1', '실시간 해석례'), content: '' }
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY, realtime], '재산')
    const vectorPort = makeVectorStubBySourceType({
      해석례: [{ item: makeNtsInterpretation('재산', 'NTS-1', '벡터 해석례'), similarity: 0.8 }],
    })

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '재산 관련 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort,
    )

    expect(result.references?.filter((r) => r.externalId === 'NTS-1')).toHaveLength(1)
  })

  it('caseNumber가 같아도 externalId가 다르면 서로 다른 해석례를 유지한다', async () => {
    const realtime = { ...makeNtsInterpretation('재산', 'NTS-1', '실시간 해석례'), content: '' }
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY, realtime], '재산')
    const vectorPort = makeVectorStubBySourceType({
      해석례: [{ item: makeNtsInterpretation('재산', 'NTS-2', '벡터 해석례'), similarity: 0.8 }],
    })

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '재산 관련 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort,
    )

    expect(result.references?.filter((r) => r.sourceType === '해석례').map((r) => r.externalId).sort())
      .toEqual(['NTS-1', 'NTS-2'])
  })

  it('해석례 벡터 검색 실패는 다른 참고 목록 경로에 영향을 주지 않는다', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '증여')
    const vectorPort: IVectorSearchPort = {
      searchSimilar: vi.fn(async (_vec: number[], _topK: number, sourceType?: string) => {
        if (sourceType === '해석례') throw new Error('pgvector down')
        if (sourceType === '판례') return [{ item: makePrecedent('prec1', '증여세부과처분취소'), similarity: 0.7 }]
        return []
      }),
    }

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '증여 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort,
    )

    expect(result.references?.map((r) => r.caseNumber)).toEqual(['prec1'])
  })
})
