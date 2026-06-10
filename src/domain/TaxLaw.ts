/**
 * Trust Tier — 출처 신뢰도 등급 (CLAUDE.md §6.2)
 * T1: 법률·시행령·시행규칙 본문 (최우선)
 * T2: 법령 부칙·경과조치
 * T3: 국세청 예규·해석례·기재부 회신
 * T4: 대법원·헌법재판소 판례
 */
export type TrustTier = 'T1' | 'T2' | 'T3' | 'T4'

/**
 * 자료유형 — 법령 외 비법령 자료를 구분 (TAX-015)
 * 같은 TaxLaw 그릇에 모양이 다른 자료를 담기 위한 구분자("통합 서랍" 방식).
 * '법령'은 조문 기반, 그 외('판례'·'해석례'·'심판례')는 사건/문서번호 기반.
 */
export type SourceType = '법령' | '판례' | '해석례' | '심판례'

/**
 * 세법 자료 엔티티 — 원문 변형 금지 (CLAUDE.md §6.1)
 * 모든 텍스트 필드는 외부 API 원문과 문자 단위 일치 필수.
 *
 * 법령(조문) 외에 판례·해석례·심판례를 함께 담는다(TAX-015).
 * 비법령 자료는 조문번호가 없으므로 식별자를 caseNumber에 보관하고,
 * 본문(content)이 제공되지 않는 경우(예: 국세청 출처 판례) 빈 문자열일 수 있다.
 */
export interface TaxLaw {
  /** 자료유형 — 법령/판례/해석례/심판례 구분 (TAX-015) */
  sourceType: SourceType
  /** 법령명 (예: 부가가치세법) / 비법령은 사건명·문서명 등 대표 명칭 */
  lawName: string
  /** 조문 번호 (예: 제26조). 비법령(판례 등)은 빈 문자열일 수 있음 */
  articleNumber: string
  /** 조문 제목 (예: 면세) / 비법령은 사건명·제목 */
  articleTitle: string
  /** 조문 본문 — 원문 그대로, 임의 가공·요약 금지. 본문 미제공 시 빈 문자열 */
  content: string
  /** 최종 개정일 (YYYY-MM-DD) */
  revisionDate: string
  /** 시행일 (YYYY-MM-DD). 비법령은 빈 문자열 또는 동일값 */
  enforcementDate: string
  /** 원문 링크 — 필수. API 키(OC)를 포함하지 말 것 (CLAUDE.md §7) */
  sourceUrl: string
  /** 출처 신뢰도 등급 */
  trustTier: TrustTier

  // ── 비법령 자료 선택 메타 (TAX-015) ────────────────────────────────
  /** (판례) 사건번호 / (해석례·심판례) 문서번호 — 비법령 식별자 */
  caseNumber?: string
  /** 생산기관 — (판례) 법원명 / (해석례) 국세청·기재부 / (심판례) 조세심판원 */
  issuingBody?: string
  /** 선고일 / 결정일 / 회신일 (YYYY-MM-DD) */
  decisionDate?: string
}
