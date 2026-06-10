/**
 * Impact Map Port 인터페이스 (TAX-033)
 *
 * Usecase(buildImpactMap)가 어댑터를 이 인터페이스만 통해서 사용하도록 분리한다.
 * 어댑터 교체(국세청 API → 벡터 DB 등) 시 Usecase 코드 변경 불필요 (CLAUDE.md §4).
 */

/**
 * 심판례 본문에서 추출한 관계 원문 데이터 (파서 적용 전)
 *
 * 주의:
 *   - caseNumber는 반드시 목록 응답 값 사용 (본문 청구번호는 항상 빈값 — 진단5 확인)
 *   - relatedLawsRaw·referencesRaw는 parseRelatedLaws/parseReferences의 입력이 됨
 *   - 모든 원문 필드는 API 반환값 그대로 — 의역·요약 금지 (§6.1)
 */
export interface TribunalRelationsRaw {
  /** 청구번호 — 목록 응답 값 (본문 청구번호 빈값 보완) */
  caseNumber: string
  /** 특별행정심판재결례일련번호 — 본문 조회·링크 생성에 사용 */
  serialNo: string
  /** 사건명 */
  caseName: string
  /** 세목 (예: 양도소득세, 법인세) */
  taxType: string
  /** 결정일 ISO (YYYY-MM-DD) */
  decisionDate: string
  /** 재결청 (예: 조세심판원) */
  agency: string
  /**
   * 관련법령 필드 원문 — parseRelatedLaws()의 입력
   * 없으면 빈 문자열. 예: "「조세특례제한법」 제69조 / 「소득세법」 제104조"
   */
  relatedLawsRaw: string
  /**
   * 참조결정 필드 원문 — parseReferences()의 입력
   * 없으면 빈 문자열. 예: "조심2013중3738 / 국심2004중3046"
   */
  referencesRaw: string
  /** 원문 링크 (API 키 미포함) */
  sourceUrl: string
}

/**
 * Impact Map Port — 심판례 관계 데이터 조회 인터페이스
 */
export interface IImpactMapPort {
  /**
   * 청구번호로 심판례 관계 원문 데이터를 조회한다.
   *
   * 내부 흐름:
   *   1. 청구번호를 query로 목록 검색 → 일련번호·목록 청구번호 확보
   *   2. 일련번호로 본문 조회 → 관련법령·참조결정·세목 추출
   *
   * @param caseNumber 조회할 심판례 청구번호 (예: "조심2011서1540")
   * @returns TribunalRelationsRaw 또는 null (해당 심판례를 찾지 못한 경우)
   */
  fetchTribunalRelations(caseNumber: string): Promise<TribunalRelationsRaw | null>
}
