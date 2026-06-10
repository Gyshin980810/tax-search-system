import type { ISearchPort } from '../ports/taxLawSearchPort'
import type { IEmbeddingPort } from '../ports/embeddingPort'
import type { IVectorSearchPort } from '../ports/vectorSearchPort'
import type { SearchQuery } from '../domain/SearchQuery'
import type { SearchResult } from '../domain/SearchResult'
import type { TaxLaw } from '../domain/TaxLaw'

/**
 * 빈약 판정 임계값 — content 보유 항목이 이 수 미만이면 다음 단계로 진입 (회계사 결정 2026-05-23)
 * 보수적(1) ↔ 적극적(5) 사이. 골든셋 30건 분포 기반 3 확정.
 */
const THRESHOLD = 3

/**
 * 벡터 검색 상위 K — cosine 유사도 상위 K개를 가져온다.
 * 너무 크면 노이즈 증가 + 비용 증가. 10이면 빈약 케이스 보완에 충분.
 */
const TOP_K = 10

/** content 보유 항목 수 카운트 */
function contentCount(items: TaxLaw[]): number {
  return items.filter((i) => i.content.trim().length > 0).length
}

/** 자료 식별 키 — 중복 제거용 */
function identityKey(t: TaxLaw): string {
  return t.sourceType === '법령'
    ? `법령|${t.lawName}|${t.articleNumber}`
    : `${t.sourceType}|${t.caseNumber ?? ''}`
}

/**
 * 3단계 Fallback 검색 포트 (TAX-026-F)
 *
 * ISearchPort를 구현해 API Route에서 NationalTaxLawAdapter 대신 주입한다.
 * generateAnswer.ts 무변경 — searchPort 자리에 이 클래스를 넣으면 됨.
 *
 * 흐름:
 *   [1차] directPort.search → content 보유 ≥ THRESHOLD → matchStage='direct' 반환
 *   [2차] 빈약 → 임베딩 → 벡터 유사도 검색 → 직접 결과에 append(중복 제거)
 *         → content 보유 ≥ THRESHOLD → matchStage='vector' 반환
 *   [3차] 여전히 빈약 → matchStage='expanded' 반환 (⚪ 라벨, 답변 생성 시 "직접 근거 없음" 명시)
 *
 * 병합 규칙 (TAX-026 §0.3):
 *   - 직접 결과 항상 앞에 (Trust Tier↑ 정렬 유지)
 *   - 벡터 결과는 중복 제거 후 append
 *   - 직접 결과를 벡터 결과로 대체하지 않음 (FR-19 보존)
 */
export class FallbackSearchPort implements ISearchPort {
  constructor(
    private readonly directPort: ISearchPort,
    private readonly embeddingPort: IEmbeddingPort,
    private readonly vectorPort: IVectorSearchPort,
  ) {}

  async search(query: SearchQuery): Promise<SearchResult> {
    // [1차] 직접 매칭
    const directResult = await this.directPort.search(query)
    if (contentCount(directResult.items) >= THRESHOLD) {
      return { ...directResult, matchStage: 'direct' }
    }

    // [2차] 의미 유사도 (벡터)
    const queryVector = await this.embeddingPort.embed(query.keyword)
    const vectorMatches = await this.vectorPort.searchSimilar(queryVector, TOP_K)

    const directKeys = new Set(directResult.items.map(identityKey))
    const newVectorItems = vectorMatches
      .filter((m) => !directKeys.has(identityKey(m.item)))
      .map((m) => m.item)

    const mergedItems = [...directResult.items, ...newVectorItems]

    if (contentCount(mergedItems) >= THRESHOLD) {
      return { items: mergedItems, totalCount: mergedItems.length, matchStage: 'vector' }
    }

    // [3차] 상위 개념 확장 — 현재는 벡터 병합 결과 그대로 반환 (⚪ 참고자료)
    return { items: mergedItems, totalCount: mergedItems.length, matchStage: 'expanded' }
  }
}
