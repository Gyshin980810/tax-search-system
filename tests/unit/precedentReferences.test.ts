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
// TAX-6B-14: pgvector 판례 코퍼스를 참고 목록(references)에 라이브로 합류시키는 경로를 검증한다.
// 보수적 2단 게이트(유사도 바닥 + 상위 N건) + 중복 제거 + graceful degrade가 핵심.

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

// 본문 있는 법령(citable) — 참고 후보가 아니므로 외부 후보 풀을 비워둘 때 사용
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

/** 판례 코퍼스 픽스처 — 사건명·사건번호·선고일·본문을 가진 T4 판례 */
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

/** 임베딩 스텁 — 모든 텍스트를 [1,0]로 임베딩(질문 벡터를 만들어 판례 검색을 활성화). */
function makeEmbedStub(): IEmbeddingPort {
  return {
    embed: vi.fn(async () => [1, 0]),
    embedBatch: vi.fn(async (texts: string[]) => texts.map(() => [1, 0])),
  }
}

/**
 * 벡터 검색 스텁 — 주어진 matches 중 요청된 sourceType과 일치하는 것만 반환한다.
 * 실제 PgVectorSearchAdapter(`WHERE source_type = $3`)와 동일하게 sourceType으로 필터링해야
 * TAX-6B-18 이후 판례·심판례 두 게이트가 같은 스텁을 공유할 때 서로 섞이지 않는다.
 */
function makeVectorStub(matches: VectorMatch[]): IVectorSearchPort {
  return {
    searchSimilar: vi.fn(async (_vec: number[], _topK: number, sourceType?: string) =>
      sourceType ? matches.filter((m) => m.item.sourceType === sourceType) : matches,
    ),
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

// ─── 테스트 ──────────────────────────────────────────────────────────────────

describe('판례 코퍼스 라이브 배선 (TAX-6B-14)', () => {
  it('유사도 바닥(0.5) 이상 판례를 참고 목록에 ⚪T4로 노출한다', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '명의신탁 증여의제')
    const vectorPort = makeVectorStub([
      { item: makePrecedent('2020두32227', '증여세부과처분취소'), similarity: 0.62 },
    ])

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '명의신탁 증여의제 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort,
    )

    expect(result.references?.map((r) => r.caseNumber)).toEqual(['2020두32227'])
    expect(result.references?.[0].trustTier).toBe('T4')
    // 판례 검색은 sourceType '판례'로 한정 호출된다
    expect(vectorPort.searchSimilar).toHaveBeenCalledWith(expect.any(Array), 5, '판례')
  })

  it('유사도 바닥 미만 판례는 제외한다', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '명의신탁')
    const vectorPort = makeVectorStub([
      { item: makePrecedent('low1', '취득세부과처분취소'), similarity: 0.4 }, // 바닥 미만
    ])

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '명의신탁 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort,
    )

    expect(result.references).toEqual([])
  })

  it('게이트 통과 판례가 많아도 PRECEDENT_MAX(2)건으로 제한한다', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '양도')
    const vectorPort = makeVectorStub([
      { item: makePrecedent('p1', '양도소득세부과처분취소'), similarity: 0.9 },
      { item: makePrecedent('p2', '양도소득세경정거부취소'), similarity: 0.8 },
      { item: makePrecedent('p3', '양도소득세가산세취소'), similarity: 0.7 },
      { item: makePrecedent('p4', '양도소득세환급거부취소'), similarity: 0.6 },
    ])

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '양도 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort,
    )

    // 유사도 상위 2건만(0.9, 0.8)
    expect(result.references?.map((r) => r.caseNumber)).toEqual(['p1', 'p2'])
  })

  it('vectorSearchPort 미주입이면 판례 경로가 없다(기존 동작 보존)', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '양도')

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '양도 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), /* vectorSearchPort */ undefined,
    )

    expect(result.references).toEqual([])
  })

  it('embeddingPort 미주입이면(질문 벡터 없음) 판례 검색을 호출하지 않는다', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '양도')
    const vectorPort = makeVectorStub([
      { item: makePrecedent('p1', '양도소득세부과처분취소'), similarity: 0.9 },
    ])

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '양도 질문', MOCK_TEMPORAL, undefined, /* embeddingPort */ undefined, vectorPort,
    )

    expect(result.references).toEqual([])
    expect(vectorPort.searchSimilar).not.toHaveBeenCalled()
  })

  it('판례 검색 실패 시 조용히 건너뛴다 — graceful degrade', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '양도')
    const failingVector: IVectorSearchPort = {
      searchSimilar: vi.fn(async () => { throw new Error('pgvector down') }),
    }

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '양도 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), failingVector,
    )

    // 판례 경로만 비고 파이프라인은 정상 완료(예외 전파 없음)
    expect(result.references).toEqual([])
    expect(result.verificationResult.status).toBe('PASS')
  })

  it('이미 외부 후보에 있는 사건번호 판례는 중복 노출되지 않는다', async () => {
    // 외부 검색이 사건번호 dup1 판례를 반환(본문 없음 → contentlessRefs 후보).
    const externalDup = makePrecedent('dup1', '명의신탁 증여의제 사건')
    const externalDupNoBody: TaxLaw = { ...externalDup, content: '' }
    const { queryRewriter, searchPort, answerGenerator, verifier } =
      makeStubs([LAW_WITH_BODY, externalDupNoBody], '명의신탁')
    // 벡터검색도 같은 dup1 + 새 판례 new1 반환
    const vectorPort = makeVectorStub([
      { item: makePrecedent('dup1', '명의신탁 증여의제 사건'), similarity: 0.9 },
      { item: makePrecedent('new1', '명의신탁 과세 사건'), similarity: 0.85 },
    ])

    const result = await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '명의신탁 질문', MOCK_TEMPORAL, undefined, makeEmbedStub(), vectorPort,
    )

    const caseNumbers = result.references?.map((r) => r.caseNumber) ?? []
    expect(caseNumbers.filter((c) => c === 'dup1')).toHaveLength(1) // 중복 제거
    expect(caseNumbers).toContain('new1')
  })

  it('질문 임베딩은 1회만 호출한다 — 판례 검색과 의미 재정렬이 공유(P95 보호)', async () => {
    const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs([LAW_WITH_BODY], '양도')
    const embed = makeEmbedStub()
    const vectorPort = makeVectorStub([
      { item: makePrecedent('p1', '양도소득세부과처분취소'), similarity: 0.9 },
    ])

    await generateAnswer(
      queryRewriter, searchPort, answerGenerator, verifier,
      '양도 질문', MOCK_TEMPORAL, undefined, embed, vectorPort,
    )

    // embedBatch는 한 번만(질문+후보 배치). 판례 검색은 그 질문 벡터를 재사용한다.
    expect(embed.embedBatch).toHaveBeenCalledTimes(1)
  })
})
