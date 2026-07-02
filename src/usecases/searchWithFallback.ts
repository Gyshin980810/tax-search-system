import type { ISearchPort } from '../ports/taxLawSearchPort'
import type { IEmbeddingPort } from '../ports/embeddingPort'
import type { IVectorSearchPort } from '../ports/vectorSearchPort'
import type { SearchQuery } from '../domain/SearchQuery'
import type { SearchResult } from '../domain/SearchResult'
import type { TaxLaw } from '../domain/TaxLaw'
import { identityKey, mergeSearchItems } from '../domain/searchMerge'

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
 *
 * 다중 쿼리 (TAX-6B-26, 방안 A):
 *   rewrite가 만든 쿼리를 **direct 계층에서 먼저 병합**한 뒤, 그 병합본에 벡터 fallback을
 *   딱 1회만 적용한다. 쿼리별로 이 포트를 반복 호출하지 않으므로 matchStage가 하나로 유지되고
 *   (라벨 하향 정책 안전), 병합으로 direct content가 THRESHOLD를 넘길 확률이 올라
 *   벡터 호출이 오히려 줄어든다(P95 보호). 임베딩은 대표 쿼리 1건만 수행한다.
 */
export class FallbackSearchPort implements ISearchPort {
  constructor(
    private readonly directPort: ISearchPort,
    private readonly embeddingPort: IEmbeddingPort,
    private readonly vectorPort: IVectorSearchPort,
  ) {}

  /** 단일 쿼리 — 다중 쿼리 경로에 [query] 하나로 위임(동작 동일, TAX-6B-26). */
  async search(query: SearchQuery): Promise<SearchResult> {
    return this.searchMany([query])
  }

  async searchMany(queries: SearchQuery[]): Promise<SearchResult> {
    if (queries.length === 0) return { items: [], totalCount: 0, matchStage: 'expanded' }

    // [1차] 직접 매칭 — 모든 쿼리를 direct 계층에서 병합 (방안 A)
    const directResult = await this.directSearchMany(queries)
    if (contentCount(directResult.items) >= THRESHOLD) {
      return { ...directResult, matchStage: 'direct' }
    }

    // [2차] 의미 유사도 (벡터) — 대표 쿼리(queries[0]) 1회만 임베딩 (쿼리 수만큼 증식 금지)
    const queryVector = await this.embeddingPort.embed(queries[0].keyword)
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

  /**
   * direct 계층 다중 쿼리 검색 — matchStage를 붙이지 않은 순수 병합 결과를 만든다.
   * 하위 어댑터가 searchMany를 제공하면 위임(캐시·병합 최적화 활용), 없으면 병렬 search 후 병합.
   */
  private async directSearchMany(queries: SearchQuery[]): Promise<SearchResult> {
    if (this.directPort.searchMany) {
      return this.directPort.searchMany(queries)
    }
    const results = await Promise.all(queries.map((q) => this.directPort.search(q)))
    const items = mergeSearchItems(results.map((r) => r.items))
    return { items, totalCount: items.length }
  }
}
