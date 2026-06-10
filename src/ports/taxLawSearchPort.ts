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
}
