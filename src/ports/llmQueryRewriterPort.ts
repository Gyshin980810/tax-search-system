import type { SearchQuery } from '../domain/SearchQuery'
import type { TemporalContext } from '../domain/TemporalContext'

/**
 * LLM 쿼리 변환 Port 인터페이스 (SSOT §3.3 [1]단계)
 *
 * 회계사의 자연어 질문을 국세법령 API 검색에 적합한 SearchQuery 배열로 변환합니다.
 * Adapter 교체 시 Usecase 코드 변경 불필요 (Port·Adapter 패턴).
 */
export interface IQueryRewriterPort {
  /**
   * 자연어 질문 → SearchQuery 배열 변환
   * @param question 회계사 자연어 질문
   * @param temporal 시점 컨텍스트
   * @returns 검색 쿼리 배열 (최대 3개)
   */
  rewrite(question: string, temporal: TemporalContext): Promise<SearchQuery[]>
}
