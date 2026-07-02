/**
 * FallbackSearchPort 빈약 판정 관련도 게이트 단위 테스트 (TAX-6B-30, 방안 A)
 *
 * 배경(P3): 기존 게이트는 content 보유 여부만 봐서, 질문과 무관한 조문 3개만 있어도
 *   direct로 조기 확정 → 벡터 fallback이 발동하지 못했다. 관련도(점수 > 0)를 게이트에
 *   반영해 "무관한 본문"이 THRESHOLD를 채우지 못하게 한다.
 *
 * 핵심 검증:
 *   (1) 무관하지만 본문 있는 항목 3개 → direct로 확정되지 않고 벡터 fallback 진입
 *   (2) 관련 있는 본문 항목 3개 → 기존처럼 direct 확정
 *   (3) 쿼리 term이 전부 불용어·1글자면 옛 contentCount로 폴백(회귀 0)
 *   (4) 무관한 direct + 관련 있는 벡터 → vector 단계로 확정
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
    content: '조문 본문',
    revisionDate: '2026-01-01',
    enforcementDate: '2026-01-01',
    sourceUrl: 'https://example.com',
    trustTier: 'T1',
    ...overrides,
  }
}

const Q = (keyword: string): SearchQuery => ({ keyword, requestedAt: new Date() })

describe('FallbackSearchPort — 빈약 판정 관련도 게이트 (TAX-6B-30)', () => {
  const mockDirectPort = { search: vi.fn() } as unknown as ISearchPort
  const mockEmbedder = { embed: vi.fn(), embedBatch: vi.fn() } as unknown as IEmbeddingPort
  const mockVectorPort = { searchSimilar: vi.fn() } as unknown as IVectorSearchPort

  beforeEach(() => vi.clearAllMocks())

  it('(1) 무관하지만 본문 있는 항목 3개 → direct 조기 확정하지 않고 벡터 fallback 진입', async () => {
    // 질문은 "가산세"인데 direct 결과는 "목적/총칙" 등 무관 조문(본문은 있음)
    vi.mocked(mockDirectPort.search).mockResolvedValue({
      items: [
        makeLaw({ articleNumber: '제1조', articleTitle: '목적', content: '이 법은 …을 규정함' }),
        makeLaw({ articleNumber: '제2조', articleTitle: '정의', content: '용어의 뜻은 다음과 같다' }),
        makeLaw({ articleNumber: '제3조', articleTitle: '적용범위', content: '이 법의 적용 대상' }),
      ],
      totalCount: 3,
    } as SearchResult)
    vi.mocked(mockEmbedder.embed).mockResolvedValue([0.1, 0.2])
    vi.mocked(mockVectorPort.searchSimilar).mockResolvedValue([])

    const fallback = new FallbackSearchPort(mockDirectPort, mockEmbedder, mockVectorPort)
    const result = await fallback.search(Q('가산세'))

    // 옛 게이트라면 content 3건 → direct. 새 게이트는 관련도 0 → 벡터 진입
    expect(result.matchStage).not.toBe('direct')
    expect(mockEmbedder.embed).toHaveBeenCalledOnce()
  })

  it('(2) 관련 있는 본문 항목 3개 → 기존처럼 direct 확정(정상 케이스 유지)', async () => {
    vi.mocked(mockDirectPort.search).mockResolvedValue({
      items: [
        makeLaw({ articleNumber: '제47조', articleTitle: '가산세', content: '가산세를 부과한다' }),
        makeLaw({ articleNumber: '제48조', articleTitle: '가산세 감면', content: '가산세를 감면한다' }),
        makeLaw({ articleNumber: '제49조', articleTitle: '한도', content: '가산세 한도' }),
      ],
      totalCount: 3,
    } as SearchResult)

    const fallback = new FallbackSearchPort(mockDirectPort, mockEmbedder, mockVectorPort)
    const result = await fallback.search(Q('가산세'))

    expect(result.matchStage).toBe('direct')
    // 관련 있는 direct가 충족 → 임베딩·벡터 미호출
    expect(mockEmbedder.embed).not.toHaveBeenCalled()
    expect(mockVectorPort.searchSimilar).not.toHaveBeenCalled()
  })

  it('(3) 쿼리 term이 전부 불용어·1글자면 옛 contentCount로 폴백(회귀 0)', async () => {
    // extractTerms가 빈 배열이 되는 쿼리(1글자) → 관련도 채점 불가 → content 개수만으로 판정
    vi.mocked(mockDirectPort.search).mockResolvedValue({
      items: [
        makeLaw({ articleNumber: '제1조', content: '내용 A' }),
        makeLaw({ articleNumber: '제2조', content: '내용 B' }),
        makeLaw({ articleNumber: '제3조', content: '내용 C' }),
      ],
      totalCount: 3,
    } as SearchResult)

    const fallback = new FallbackSearchPort(mockDirectPort, mockEmbedder, mockVectorPort)
    const result = await fallback.search(Q('가')) // 1글자 → term 없음

    expect(result.matchStage).toBe('direct')
    expect(mockEmbedder.embed).not.toHaveBeenCalled()
  })

  it('(4) 무관한 direct + 관련 있는 벡터 3건 → vector 단계로 확정', async () => {
    vi.mocked(mockDirectPort.search).mockResolvedValue({
      items: [makeLaw({ articleNumber: '제1조', articleTitle: '목적', content: '무관한 총칙' })],
      totalCount: 1,
    } as SearchResult)
    vi.mocked(mockEmbedder.embed).mockResolvedValue([0.1, 0.2])
    vi.mocked(mockVectorPort.searchSimilar).mockResolvedValue([
      { item: makeLaw({ sourceType: '심판례', caseNumber: 'B1', lawName: '조세심판원 결정례', content: '가산세 부과 쟁점' }), similarity: 0.9 },
      { item: makeLaw({ sourceType: '심판례', caseNumber: 'B2', lawName: '조세심판원 결정례', content: '가산세 감면 여부' }), similarity: 0.8 },
      { item: makeLaw({ sourceType: '심판례', caseNumber: 'B3', lawName: '조세심판원 결정례', content: '가산세 한도 판단' }), similarity: 0.7 },
    ])

    const fallback = new FallbackSearchPort(mockDirectPort, mockEmbedder, mockVectorPort)
    const result = await fallback.search(Q('가산세'))

    expect(result.matchStage).toBe('vector')
    // direct 무관 1건은 세지 않고, 관련 있는 벡터 3건으로 충족
    expect(result.items.length).toBeGreaterThanOrEqual(3)
  })

  it('(5) 다중 쿼리의 term을 union으로 판정한다 — 쿼리B에만 맞는 조문도 관련으로 인정', async () => {
    const smartDirect = {
      search: vi.fn(),
      searchMany: vi.fn().mockResolvedValue({
        items: [
          makeLaw({ articleNumber: '제1조', content: '접대비 손금' }), // 쿼리A 관련
          makeLaw({ articleNumber: '제2조', content: '기업업무추진비 한도' }), // 쿼리B 관련
          makeLaw({ articleNumber: '제3조', content: '접대비 범위' }), // 쿼리A 관련
        ],
        totalCount: 3,
      } as SearchResult),
    } as unknown as ISearchPort

    const fallback = new FallbackSearchPort(smartDirect, mockEmbedder, mockVectorPort)
    const result = await fallback.searchMany([Q('접대비'), Q('기업업무추진비')])

    // 세 조문 모두 두 쿼리 중 하나와 관련 → union 기준으로 관련도 > 0 → direct
    expect(result.matchStage).toBe('direct')
    expect(mockEmbedder.embed).not.toHaveBeenCalled()
  })
})
