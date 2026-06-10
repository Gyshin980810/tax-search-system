import { detectPii } from '../utils/piiFilter'
import type { ISearchPort } from '../ports/taxLawSearchPort'
import type { SearchResult } from '../domain/SearchResult'
import type { SearchQuery } from '../domain/SearchQuery'

/**
 * 세법 검색 Usecase (CLAUDE.md §4, SSOT §2)
 *
 * 책임:
 * 1. PII 필터 적용 — 주민번호·사업자번호 포함 시 즉시 거부
 * 2. SearchQuery 생성 — 시점 라벨 부착을 위해 requestedAt 포함
 * 3. Port를 통해 검색 위임 — fetch/HTTP 직접 호출 금지
 *
 * @param port  ISearchPort 구현체 (NationalTaxLawAdapter 등)
 * @param keyword 사용자 입력 검색어
 * @throws {PiiDetectedError} PII 패턴 감지 시
 * @throws {ApiTimeoutError}  API 응답 타임아웃 시
 * @throws {ApiUnavailableError} API 접근 불가 시
 */
export async function searchTaxLaw(
  port: ISearchPort,
  keyword: string,
): Promise<SearchResult> {
  // 1단계: PII 필터 — 감지 시 PiiDetectedError throw
  detectPii(keyword)

  // 2단계: 검색 쿼리 생성
  const query: SearchQuery = {
    keyword: keyword.trim(),
    requestedAt: new Date(),
  }

  // 3단계: Port에 검색 위임 (Adapter가 실제 API 호출 담당)
  return port.search(query)
}
