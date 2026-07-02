/**
 * FallbackSearchPort 다중 쿼리 검색 단위 테스트 (TAX-6B-26, 방안 A)
 *
 * 핵심 검증:
 *   (1) 여러 쿼리를 direct 계층에서 병합해 THRESHOLD를 넘기면 벡터 호출 없이 direct 반환
 *   (2) 임베딩은 쿼리 수와 무관하게 1회만 (P95 보호)
 *   (3) direct 어댑터가 searchMany를 제공하면 위임한다
 *   (4) 병합 결과는 identityKey 기준 중복 없이 구성된다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FallbackSearchPort } from '@/usecases/searchWithFallback'
import type { ISearchPort } from '@/ports/taxLawSearchPort'
import type { IEmbeddingPort } from '@/ports/embeddingPort'
import type { IVectorSearchPort } from '@/ports/vectorSearchPort'
import type { SearchQuery } from '@/domain/SearchQuery'
import type { SearchResult } from '@/domain/SearchResult'
import type { TaxLaw } from '@/domain/TaxLaw'

function makeLaw(overrides: Partial<TaxLaw> = {}): TaxLaw {
  return {
    sourceType: '법령',
    lawName: '법인세법',
    articleNumber: '제1조',
    articleTitle: '목적',
    content: '본문 충분한 법령 조문',
    revisionDate: '2026-01-01',
    enforcementDate: '2026-01-01',
    sourceUrl: 'https://example.com',
    trustTier: 'T1',
    ...overrides,
  }
}

const Q = (keyword: string): SearchQuery => ({ keyword, requestedAt: new Date() })

describe('FallbackSearchPort.searchMany — 방안 A (direct 병합 후 벡터 fallback 1회)', () => {
  const mockDirectPort = { search: vi.fn() } as unknown as ISearchPort
  const mockEmbedder = { embed: vi.fn(), embedBatch: vi.fn() } as unknown as IEmbeddingPort
  const mockVectorPort = { searchSimilar: vi.fn() } as unknown as IVectorSearchPort

  beforeEach(() => vi.clearAllMocks())

  it('(1) 쿼리별 direct 결과를 병합해 THRESHOLD를 넘기면 벡터 호출 없이 direct 반환', async () => {
    // 각 쿼리는 content 2건씩 → 단일이면 THRESHOLD(3) 미달이지만 병합하면 4건 → 충족
    vi.mocked(mockDirectPort.search)
      .mockResolvedValueOnce({
        items: [makeLaw({ articleNumber: '제1조' }), makeLaw({ articleNumber: '제2조' })],
        totalCount: 2,
      } as SearchResult)
      .mockResolvedValueOnce({
        items: [makeLaw({ articleNumber: '제3조' }), makeLaw({ articleNumber: '제4조' })],
        totalCount: 2,
      } as SearchResult)

    const fallback = new FallbackSearchPort(mockDirectPort, mockEmbedder, mockVectorPort)
    const result = await fallback.searchMany([Q('접대비'), Q('기업업무추진비')])

    expect(result.matchStage).toBe('direct')
    expect(result.items).toHaveLength(4)
    // 병합으로 direct가 충족 → 임베딩·벡터 미호출 (P95 보호, 방안 A 핵심 이득)
    expect(mockEmbedder.embed).not.toHaveBeenCalled()
    expect(mockVectorPort.searchSimilar).not.toHaveBeenCalled()
  })

  it('(2) direct 병합이 여전히 빈약해도 임베딩은 쿼리 수와 무관하게 1회만', async () => {
    // 3개 쿼리 모두 content 0건 → 병합해도 THRESHOLD 미달 → 벡터 fallback
    vi.mocked(mockDirectPort.search).mockResolvedValue({
      items: [makeLaw({ content: '' })],
      totalCount: 1,
    } as SearchResult)
    vi.mocked(mockEmbedder.embed).mockResolvedValue([0.1, 0.2])
    vi.mocked(mockVectorPort.searchSimilar).mockResolvedValue([
      { item: makeLaw({ sourceType: '심판례', caseNumber: 'A1', lawName: '조세심판원 결정례' }), similarity: 0.9 },
      { item: makeLaw({ sourceType: '심판례', caseNumber: 'A2', lawName: '조세심판원 결정례' }), similarity: 0.8 },
      { item: makeLaw({ sourceType: '심판례', caseNumber: 'A3', lawName: '조세심판원 결정례' }), similarity: 0.7 },
    ])

    const fallback = new FallbackSearchPort(mockDirectPort, mockEmbedder, mockVectorPort)
    const result = await fallback.searchMany([Q('가지급금'), Q('인정이자'), Q('업무무관')])

    expect(result.matchStage).toBe('vector')
    // 쿼리 3개여도 임베딩은 대표 쿼리 1건만 (쿼리 수만큼 증식 금지)
    expect(mockEmbedder.embed).toHaveBeenCalledOnce()
    expect(mockEmbedder.embed).toHaveBeenCalledWith('가지급금')
  })

  it('(3) direct 어댑터가 searchMany를 제공하면 위임하고 개별 search를 반복 호출하지 않는다', async () => {
    const smartDirect = {
      search: vi.fn(),
      searchMany: vi.fn().mockResolvedValue({
        items: [
          makeLaw({ articleNumber: '제1조' }),
          makeLaw({ articleNumber: '제2조' }),
          makeLaw({ articleNumber: '제3조' }),
        ],
        totalCount: 3,
      } as SearchResult),
    } as unknown as ISearchPort

    const fallback = new FallbackSearchPort(smartDirect, mockEmbedder, mockVectorPort)
    const result = await fallback.searchMany([Q('a'), Q('b')])

    expect(smartDirect.searchMany).toHaveBeenCalledOnce()
    expect(smartDirect.search).not.toHaveBeenCalled()
    expect(result.matchStage).toBe('direct')
    expect(result.items).toHaveLength(3)
  })

  it('(4) 서로 다른 쿼리가 같은 조문을 반환하면 병합 시 1건만 남는다', async () => {
    const shared = makeLaw({ articleNumber: '제25조' })
    vi.mocked(mockDirectPort.search)
      .mockResolvedValueOnce({ items: [shared, makeLaw({ articleNumber: '제1조' })], totalCount: 2 } as SearchResult)
      .mockResolvedValueOnce({ items: [shared, makeLaw({ articleNumber: '제2조' })], totalCount: 2 } as SearchResult)

    const fallback = new FallbackSearchPort(mockDirectPort, mockEmbedder, mockVectorPort)
    const result = await fallback.searchMany([Q('x'), Q('y')])

    const article25 = result.items.filter((i) => i.articleNumber === '제25조')
    expect(article25).toHaveLength(1)
    expect(result.items).toHaveLength(3) // 제25조 + 제1조 + 제2조
  })

  it('(5) search(query)는 searchMany([query])로 위임돼 단일 쿼리 동작이 동일하다', async () => {
    const richLaws = Array.from({ length: 3 }, (_, i) =>
      makeLaw({ articleNumber: `제${i + 1}조` }),
    )
    vi.mocked(mockDirectPort.search).mockResolvedValue({
      items: richLaws,
      totalCount: 3,
    } as SearchResult)

    const fallback = new FallbackSearchPort(mockDirectPort, mockEmbedder, mockVectorPort)
    const result = await fallback.search(Q('부가가치세'))

    expect(result.matchStage).toBe('direct')
    expect(mockEmbedder.embed).not.toHaveBeenCalled()
    expect(mockDirectPort.search).toHaveBeenCalledOnce()
  })
})
