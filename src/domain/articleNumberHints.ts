import type { SearchQuery } from './SearchQuery'

/**
 * 조문번호 매핑 사전 항목 (TAX-049)
 *
 * 회계사 자연어 키워드 → 정식 법령명·조문번호의 결정론적 매핑.
 * LLM 쿼리 재작성은 자연어 키워드를 잘 추출하지만 "제70조" 같은 조문번호는
 * 생성하지 못해 외부 API 정확매칭이 실패하는 케이스가 있다(TAX-029 진단).
 * 본 사전은 LLM 결과 앞에 결정론적 조문번호 쿼리를 prepend해
 * T1 검색 정확도를 보강한다.
 *
 * 사전 적용 범위: 회계사 검수(2026-06-09) 통과한 47개 항목.
 * 확장은 회계사 검수 후 PR(CLAUDE.md §9 8 — 임의 추가 금지).
 */
export interface ArticleNumberHint {
  /** 자연어 질문에 등장할 핵심 키워드(부분 문자열 매칭) */
  readonly keywords: readonly string[]
  /** 정식 법령명(소득세법 / 법인세법 시행령 등) */
  readonly lawName: string
  /** 조문번호 — 원문 표기 유지(제70조 / 제59조의2 / 제104조의3) */
  readonly articleNumber: string
  /** 근거 골든셋 ID(추적용, 보강 항목은 미부여) */
  readonly source?: string
}

/**
 * 회계사 검수 완료 사전 (47개, 2026-06-09).
 *
 * 분류: A. 소득세법(14) · B. 법인세법(8) · C. 부가가치세법(7)
 *      · D. 상속세 및 증여세법(6) · E. 종합부동산세법(3)
 *      · F. 지방세법(6) · G. 국세기본법(3)
 *
 * 비법령 트랙(G-S-NL-01~04)은 사건번호 직접 검색(TAX-043) 처리 — 대상 외.
 * G-N3(기본통칙)은 특수 형태 — 사전 부적합 제외.
 */
export const ARTICLE_NUMBER_HINTS: readonly ArticleNumberHint[] = [
  // A. 소득세법 (14)
  { keywords: ['본인 기본공제', '인적공제'], lawName: '소득세법', articleNumber: '제50조', source: 'G-1·G-N1·G-N2·G-N4' },
  { keywords: ['1세대 1주택 비과세', '1세대1주택 비과세'], lawName: '소득세법', articleNumber: '제89조', source: 'G-2' },
  { keywords: ['근로소득 범위', '근로소득에 포함'], lawName: '소득세법', articleNumber: '제20조', source: 'G-S-소득-04' },
  { keywords: ['종합소득 과세표준 세율', '종합소득 기본세율', '기본 세율'], lawName: '소득세법', articleNumber: '제55조', source: 'G-S-소득-01' },
  { keywords: ['자녀세액공제', '자녀공제'], lawName: '소득세법', articleNumber: '제59조의2', source: 'G-S-소득-02' },
  // TAX-049 운영 보강(2026-06-09): 회계사 검수의 "기한" 강조 의도 보존 +
  // 골든셋 G-S-소득-03("…확정신고는 언제까지…") 매칭 보장을 위해 짧은 형태도 포함.
  { keywords: ['종합소득세 확정신고', '종합소득세 확정신고기한', '종합소득 확정신고', '종합소득 확정신고기한'], lawName: '소득세법', articleNumber: '제70조', source: 'G-S-소득-03' },
  { keywords: ['양도소득세 과세 대상', '양도소득세 과세대상'], lawName: '소득세법', articleNumber: '제94조', source: 'G-S-양도-01' },
  { keywords: ['양도소득금액 계산방법', '양도소득금액 계산'], lawName: '소득세법', articleNumber: '제95조', source: 'G-S-양도-02' },
  { keywords: ['양도소득세 세율', '양도소득세율'], lawName: '소득세법', articleNumber: '제104조', source: 'G-S-양도-03' },
  { keywords: ['일시적 2주택', '1세대1주택 특례', '종전주택 양도 비과세'], lawName: '소득세법 시행령', articleNumber: '제155조', source: 'G-S-양도-04' },
  { keywords: ['이자소득'], lawName: '소득세법', articleNumber: '제16조' },
  { keywords: ['사업소득'], lawName: '소득세법', articleNumber: '제19조' },
  { keywords: ['퇴직소득'], lawName: '소득세법', articleNumber: '제22조' },
  { keywords: ['비사업용 토지'], lawName: '소득세법', articleNumber: '제104조의3' },

  // B. 법인세법 (8)
  { keywords: ['법인세 과세표준 세율', '법인세 세율 구간', '법인세 과세표준 구간'], lawName: '법인세법', articleNumber: '제55조', source: 'G-S-법인-01' },
  { keywords: ['감가상각비 손금', '감가비 손금 산입', '감가비 손금산입 한도'], lawName: '법인세법', articleNumber: '제23조', source: 'G-S-법인-02' },
  { keywords: ['법인세 과세표준 신고', '법인세 신고 기한'], lawName: '법인세법', articleNumber: '제60조', source: 'G-S-법인-03' },
  { keywords: ['기업업무추진비', '접대비 손금불산입한도', '접대비 한도', '기업업무추진비 한도'], lawName: '법인세법', articleNumber: '제25조', source: 'G-S-법인-05' },
  { keywords: ['법인세법 시행령 손비', '법인세 손비의 범위', '법인세 손비 범위'], lawName: '법인세법 시행령', articleNumber: '제19조', source: 'G-S-법인-06' },
  { keywords: ['업무무관 지출', '업무 무관 지출', '업무무관 지출 손금 인정'], lawName: '법인세법', articleNumber: '제19조', source: 'G-3' },
  { keywords: ['법인세 중간예납'], lawName: '법인세법', articleNumber: '제63조' },
  { keywords: ['익금산입'], lawName: '법인세법', articleNumber: '제15조' },

  // C. 부가가치세법 (7)
  { keywords: ['면세 재화', '면세 용역', '부가가치세 면세'], lawName: '부가가치세법', articleNumber: '제26조', source: 'G-S-부가-01' },
  { keywords: ['재화 수출 영세율', '수출 영세율'], lawName: '부가가치세법', articleNumber: '제21조', source: 'G-S-부가-02' },
  { keywords: ['부가가치세 확정신고', '부가가치세 확정신고기한', '부가가치세 납부기한'], lawName: '부가가치세법', articleNumber: '제49조', source: 'G-S-부가-03' },
  { keywords: ['매입세액 공제 요건', '공제 매입세액'], lawName: '부가가치세법', articleNumber: '제38조', source: 'G-S-부가-04' },
  { keywords: ['매입세액 불공제', '불공제 매입세액', '매입세액 불공제 요건'], lawName: '부가가치세법', articleNumber: '제39조', source: 'G-S-부가-05' },
  { keywords: ['재화의 공급'], lawName: '부가가치세법', articleNumber: '제9조' },
  { keywords: ['부가가치세 납세의무자'], lawName: '부가가치세법', articleNumber: '제3조' },

  // D. 상속세 및 증여세법 (6)
  { keywords: ['상속세 기초공제'], lawName: '상속세 및 증여세법', articleNumber: '제18조', source: 'G-4A·G-4B' },
  { keywords: ['배우자 상속공제 한도', '배우자 상속공제'], lawName: '상속세 및 증여세법', articleNumber: '제19조', source: 'G-S-상증-01' },
  { keywords: ['증여재산공제', '증여재산 공제', '증여재산 공제한도'], lawName: '상속세 및 증여세법', articleNumber: '제53조', source: 'G-S-상증-02' },
  { keywords: ['증여세 세율', '증여세율'], lawName: '상속세 및 증여세법', articleNumber: '제56조', source: 'G-S-상증-03' },
  { keywords: ['상속세 세율', '상속세율'], lawName: '상속세 및 증여세법', articleNumber: '제26조' },
  { keywords: ['그 밖의 인적공제'], lawName: '상속세 및 증여세법', articleNumber: '제20조' },

  // E. 종합부동산세법 (3)
  { keywords: ['주택분 종합부동산세 과세표준', '종부세 과세표준'], lawName: '종합부동산세법', articleNumber: '제8조', source: 'G-S-종부-01' },
  { keywords: ['주택분 종합부동산세 세율', '종부세 세율'], lawName: '종합부동산세법', articleNumber: '제9조', source: 'G-S-종부-02' },
  { keywords: ['토지분 종합부동산세'], lawName: '종합부동산세법', articleNumber: '제13조' },

  // F. 지방세법 (6)
  { keywords: ['부동산 취득세율', '취득세율'], lawName: '지방세법', articleNumber: '제11조', source: 'G-S-지방-01' },
  { keywords: ['재산세 세율'], lawName: '지방세법', articleNumber: '제111조', source: 'G-S-지방-02' },
  { keywords: ['재산세 납부 기한', '재산세 납기'], lawName: '지방세법', articleNumber: '제115조', source: 'G-5' },
  { keywords: ['상속 취득세 세율 특례', '1세대1주택 취득세 특례'], lawName: '지방세법', articleNumber: '제15조', source: 'G-S-지방-03' },
  { keywords: ['재산세 과세 대상', '재산세 과세대상'], lawName: '지방세법', articleNumber: '제105조' },
  { keywords: ['취득세 과세표준'], lawName: '지방세법', articleNumber: '제10조' },

  // G. 국세기본법 (3)
  { keywords: ['수정신고'], lawName: '국세기본법', articleNumber: '제45조' },
  { keywords: ['경정청구', '경정 청구'], lawName: '국세기본법', articleNumber: '제45조의2' },
  { keywords: ['가산세'], lawName: '국세기본법', articleNumber: '제47조' },
] as const

/**
 * 질문에서 매칭되는 조문 힌트를 SearchQuery 배열로 반환한다.
 *
 * 정책 (TAX-049 옵션 A — 어댑터 articleNumber 통합):
 * - 부분 문자열 매칭(`String.includes`) — 자연어 유연성 우선.
 * - 한 질문이 여러 항목과 매칭되면 모두 반환(`lawName + articleNumber` 기준 중복 제거).
 * - 미매칭(빈 결과)이면 빈 배열 반환 — 호출자가 LLM rewrite로 자연 fallback.
 * - 반환 SearchQuery는 `keyword` = 정식 법령명, `articleNumberHint` = 조문번호로 분리.
 *   → 어댑터 `selectBestLaw`가 법령명 완전매칭에 성공하고, `fetchArticles`가
 *      articleNumberHint로 해당 조문만 필터링하여 T1 정확 추출.
 *
 * @param question     회계사 자연어 질문
 * @param requestedAt  쿼리 생성 시각(시점 라벨용)
 */
export function lookupArticleHints(
  question: string,
  requestedAt: Date,
): SearchQuery[] {
  if (!question) return []
  const matched: SearchQuery[] = []
  const seen = new Set<string>()
  for (const hint of ARTICLE_NUMBER_HINTS) {
    const hit = hint.keywords.some((kw) => question.includes(kw))
    if (!hit) continue
    const seenKey = `${hint.lawName} ${hint.articleNumber}`
    if (seen.has(seenKey)) continue
    seen.add(seenKey)
    matched.push({
      keyword: hint.lawName,
      requestedAt,
      articleNumberHint: hint.articleNumber,
    })
  }
  return matched
}
