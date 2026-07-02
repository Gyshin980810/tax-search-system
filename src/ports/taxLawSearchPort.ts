import type { SearchQuery } from '../domain/SearchQuery'
import type { SearchResult } from '../domain/SearchResult'

/**
 * 세법 검색 Port 인터페이스 (SSOT §2, CLAUDE.md §4)
 *
 * Usecase는 이 인터페이스만 사용하고, 구체적인 Adapter(국세청 API·벡터 DB 등)는
 * 이 인터페이스를 구현합니다. Adapter 교체 시 Usecase 코드 변경 불필요.
 */
export interface ISearchPort {
  search(query: SearchQuery): Promise<SearchResult>
  /**
   * 다중 쿼리 검색 (TAX-6B-26) — 여러 검색어를 병렬 검색·병합해 하나의 결과로 반환.
   *
   * matchStage(라벨 하향 신호) 일관성을 스스로 보장할 수 있는 포트만 구현한다.
   * 미구현 포트(테스트 더블 등)는 generateAnswer가 search(queries[0])로 안전하게 폴백한다.
   * 이렇게 선택적으로 둔 이유: FallbackSearchPort를 쿼리별로 반복 호출하면 쿼리마다
   * matchStage가 뒤섞여 과대주장 위험이 생기므로(§6.3), 병합은 이를 아는 포트 내부에서만 한다.
   */
  searchMany?(queries: SearchQuery[]): Promise<SearchResult>
}
