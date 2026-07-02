import { config } from '../config'
import type { ISearchPort } from '../ports/taxLawSearchPort'
import type { SearchQuery } from '../domain/SearchQuery'
import type { SearchResult } from '../domain/SearchResult'
import type { TaxLaw, TrustTier } from '../domain/TaxLaw'
import { ApiTimeoutError, ApiUnavailableError } from '../domain/errors'
import { normalizeLawName, selectBestLaw, splitLegalAxis } from '../domain/lawAliases'
import { normalizeNonLawQuery } from '../domain/nonLawQueryNormalize'
import { extractTerms, scoreRelevance } from '../domain/nonLawRelevance'
import { mergeSearchItems } from '../domain/searchMerge'

// ─── 국세법령정보시스템 API 응답 타입 ──────────────────────────────────────

interface RawLaw {
  법령일련번호: string
  법령명한글: string
  법령약칭명: string
  법령구분명: string
  공포일자: string      // YYYYMMDD
  시행일자: string      // YYYYMMDD
  공포번호: string
}

interface RawLawSearch {
  resultCode: string
  totalCnt: string
  law?: RawLaw | RawLaw[]
}

// 조문 본문 하위노드 — 항·호·목 (TAX-032, JO 진단으로 구조 확정 2026-05-24)
//  ⚠️ 항내용/호내용/목내용은 번호(①·1.·가.)를 이미 포함한다(번호 prepend 금지 — 중복 방지).
//  ⚠️ 항내용은 문자열 또는 (세율표 등) 중첩 배열로 온다 → NestedText로 표현.
type NestedText = string | NestedText[]

interface RawMok {
  목번호?: string
  목내용?: NestedText
}

interface RawHo {
  호번호?: string
  호내용?: NestedText
  목?: RawMok | RawMok[]   // 단일/복수 혼재
}

interface RawHang {
  항번호?: string
  항내용?: NestedText      // 문자열 또는 중첩 배열(세율표)
  호?: RawHo | RawHo[]     // 단일/복수 혼재
}

interface RawArticle {
  조문번호: number
  조문여부: string      // "조문" | "장" | "절" 등
  조문시행일자: string  // YYYYMMDD
  조문내용: string      // "제N조(제목)" — 제목 줄만. 본문은 항·호·목 하위노드에 있음
  조문키: string
  항?: RawHang | RawHang[]   // TAX-032: 조문 본문(항·호·목) — content 조립에 사용
}

// 부칙(附則) 단위 — 법령 본문 응답의 부칙 노드 (TAX-6B-1, FR-17)
//  프로브(scripts/diagnostics/probe_addenda.mjs)로 필드 확정(2026-06-14):
//   부칙공포일자=YYYYMMDD, 부칙내용=문자열 또는 중첩 배열(NestedText), 부칙공포번호.
interface RawBuchik {
  부칙키?: string
  부칙공포일자?: string   // YYYYMMDD
  부칙내용?: NestedText    // 문자열 또는 (경과조치 표 등) 중첩 배열
  부칙공포번호?: string
}

interface RawLawService {
  법령: {
    기본정보: {
      법령명_한글: string
      법종구분: { content: string }
      공포일자: string
      시행일자: string
      법령ID: string
    }
    조문?: { 조문단위: RawArticle | RawArticle[] }
    // TAX-6B-1 FR-17: 부칙·경과조치 — 본문 응답에 이미 포함(추가 호출 불필요)
    부칙?: { 부칙단위: RawBuchik | RawBuchik[] }
  }
}

// 판례 목록 조회(target=prec) 응답 — TAX-015 진단으로 확정 (2026-05-20)
interface RawPrec {
  사건번호: string
  사건명: string
  선고일자: string       // 목록은 "YYYY.MM.DD", 본문은 "YYYYMMDD"
  법원명: string         // 국세 출처 목록은 빈 문자열인 경우 있음
  데이터출처명: string   // "대법원" | "국세법령정보시스템" 등
  판례일련번호: string
  판례상세링크: string   // ⚠️ OC(API키) 포함 — 그대로 쓰지 말 것
  사건종류명: string
}

interface RawPrecSearch {
  resultCode?: string
  prec?: RawPrec | RawPrec[]
}

// 판례 본문 조회(target=prec, ID) 응답 — 법원 출처에서만 제공
interface RawPrecService {
  판시사항?: string
  판결요지?: string
  참조판례?: string
  법원명?: string
  사건번호?: string
  선고일자?: string
  사건명?: string
}

// 법령해석례 목록 조회(target=expc) 응답 — TAX-016A 진단으로 확정 (2026-05-21)
interface RawExpc {
  안건명: string
  안건번호: string         // 예: "12-0368" — V1 식별자
  회신기관명: string       // 해석을 회신한 기관 (예: 법제처)
  질의기관명: string       // 질의한 기관 (예: 기획재정부)
  회신일자: string         // "YYYY.MM.DD"
  법령해석례일련번호: string // 본문 조회 ID·원문 링크 seq
  법령해석례상세링크: string // ⚠️ OC(API키) 포함 — 그대로 쓰지 말 것
}

interface RawExpcSearch {
  resultCode?: string
  expc?: RawExpc | RawExpc[]
}

// (TAX-6B-19) 법령해석례 본문 조회(RawExpcService)는 목록 전용 전환으로 제거됨.

// 국세청 법령해석 목록 조회(target=ntsCgmExpc) 응답 — TAX-016B 실호출로 확정 (2026-05-22)
// ⚠️ 본문(전문) 미제공 — 목록만 제공. 발췌 인용 불가 → 참고 목록(references) 트랙(TAX-015B/D).
interface RawNtsExpc {
  id?: string | number
  안건명: string
  안건번호: string          // 예: "법인22601-2200" — V1 식별자
  해석기관명: string        // "국세청"
  해석기관코드?: string
  질의기관명?: string
  질의기관코드?: string
  해석일자: string          // "YYYY.MM.DD"
  법령해석일련번호: string | number
  법령해석상세링크: string  // taxlaw.nts.go.kr 공개 뷰어 링크 (OC 키 미포함 — 실호출 확인)
  데이터기준일시?: string
}

interface RawNtsExpcSearch {
  resultCode?: string
  totalCnt?: string
  cgmExpc?: RawNtsExpc | RawNtsExpc[]
}

// 조세심판원 특별행정심판재결례 목록(target=ttSpecialDecc) — TAX-016C 실호출로 확정 (2026-05-22)
// 래퍼는 일반 decc와 동일(`{Decc:{decc:[]}}`)이나 재결청='조세심판원'. 본문(SpecialDeccService) 제공.
interface RawTtSpecialDecc {
  id?: string | number
  특별행정심판재결례일련번호: string | number  // 본문 조회 ID
  사건명: string
  청구번호: string                              // 예: "조심 2020부1558" — V1 식별자
  처분일자?: string
  의결일자: string                              // "YYYY.MM.DD"
  처분청?: string
  재결청: string                                // "조세심판원"
  재결구분명?: string
  재결구분코드?: string
  행정심판재결례상세링크?: string               // ⚠️ OC(API키) 포함 — 그대로 쓰지 말 것
  데이터기준일시?: string
}

interface RawTtSpecialDeccSearch {
  resultCode?: string
  totalCnt?: string
  decc?: RawTtSpecialDecc | RawTtSpecialDecc[]
}

// 특별행정심판재결례 본문 조회(target=ttSpecialDecc, ID) 응답 — `{ SpecialDeccService: {} }`
interface RawSpecialDeccService {
  재결청?: string
  사건명?: string
  청구번호?: string
  주문?: string
  재결요지?: string
  이유?: string
  세목?: string
  관련법령?: string
  /**
   * 참조결정 — 진단5(2026-05-24) 실호출로 확인된 필드.
   * 형식: 단건("조심2011서1540") 또는 "/" 구분 복수("조심2013중3738 / 국심2004중3046").
   * trailing " /" 있는 경우 있음 (parseReferences에서 정리).
   */
  참조결정?: string
  의결일자?: string
  특별행정심판재결례일련번호?: string | number
}

// ─── 캐시 (TTL 24시간, 최대 500개 LRU — SSOT §7.3) ──────────────────────
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_EMPTY_TTL_MS = 5 * 60 * 1000   // 빈 결과는 5분만 보관
const CACHE_MAX_ENTRIES = 500
const cache = new Map<string, { result: SearchResult; expiresAt: number }>()

function cacheSet(key: string, value: { result: SearchResult; expiresAt: number }): void {
  if (cache.has(key)) cache.delete(key)
  cache.set(key, value)
  if (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

// ─── 유틸 ─────────────────────────────────────────────────────────────────

const BASE_URL = 'https://www.law.go.kr'

// 일부 정부 API는 User-Agent 없는 요청을 봇으로 보고 연결을 끊는다(ECONNRESET).
// TAX-015 진단에서 확인 — 법령·판례 호출 모두 명시적 UA 필요.
const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (compatible; tax-search-system/1.0; +https://www.law.go.kr)',
  Accept: 'application/json,text/plain,*/*',
}

/** YYYYMMDD → YYYY-MM-DD */
function toIsoDate(raw: string): string {
  if (!raw || raw.length !== 8) return raw
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
}

/** "YYYY.MM.DD" 또는 "YYYYMMDD" → "YYYY-MM-DD" (판례 선고일자 형식 혼재 대응) */
function toIsoDateLoose(raw: string): string {
  if (!raw) return ''
  const digits = raw.replace(/[^0-9]/g, '')
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
  }
  return raw
}

/** 법종구분명 → TrustTier (CLAUDE.md §6.2) */
function toTrustTier(lawType: string): TrustTier {
  if (lawType === '법률' || lawType.endsWith('법')) return 'T1'
  if (lawType.includes('대통령령') || lawType.endsWith('령')) return 'T1'
  if (lawType.includes('규칙') || lawType.includes('규정')) return 'T1'
  // T2: 부칙·경과조치 — 시점 분기 시 필수 (SSOT §7.6)
  if (lawType.includes('부칙') || lawType.includes('경과조치')) return 'T2'
  if (lawType.includes('예규') || lawType.includes('훈령') || lawType.includes('고시')) return 'T3'
  // 알 수 없는 법종은 보수적으로 T3 처리 (오분류 방지)
  return 'T3'
}

/**
 * 조문내용 첫 줄에서 조문번호·제목 파싱
 * 예: "제1조(목적) 이 법은..." → { number: "제1조", title: "목적" }
 */
function parseArticleHead(content: string): { number: string; title: string } {
  const match = content.match(/^(제\d+조(?:의\d+)?)\(([^)]+)\)/)
  if (match) return { number: match[1], title: match[2] }
  const numOnly = content.match(/^(제\d+조(?:의\d+)?)/)
  if (numOnly) return { number: numOnly[1], title: '' }
  return { number: '', title: content.slice(0, 20) }
}

/** 단일 객체 | 배열 | undefined → 배열로 정규화 (API의 단수/복수 혼재 대응) */
function toArrayNode<T>(node: T | T[] | undefined): T[] {
  if (node == null) return []
  return Array.isArray(node) ? node : [node]
}

/**
 * 항·호·목 내용 평탄화 (TAX-032).
 *  - 문자열은 그대로 반환한다.
 *  - (세율표 등) 중첩 배열은 원문 줄 순서를 유지한 채 줄바꿈(\n)으로만 결합한다.
 *  원문 텍스트만 순서대로 잇고 요약·의역·재배열은 절대 하지 않는다 (CLAUDE.md §6.1, V2).
 */
function flattenText(value: NestedText | undefined): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map((v) => flattenText(v)).filter((s) => s !== '').join('\n')
  }
  return ''
}

/**
 * 조문 본문 조립 — 조문내용(제목) + 항·호·목 내용을 원문 순서·문자 그대로 결합 (TAX-032).
 *
 * 통증 B 해소: 기존 content엔 조문내용(제목 줄)만 담겨 본문이 누락됐다.
 * 응답에 이미 들어있는 항·호·목 하위노드를 추가 API 호출 없이 조립한다(JO 진단 2026-05-24).
 *
 * ⚠️ 원문 보존(§6.1·V2):
 *   - 항번호(①)/호번호(1.)/목번호(가.)는 각 내용에 이미 포함되므로 번호를 따로 붙이지 않는다(중복 방지).
 *   - 세율표(중첩 배열)는 줄 단위로 결합해 괘선을 보존한다.
 *   - 요약·의역·재배열은 절대 하지 않는다.
 */
export function assembleArticleContent(article: RawArticle): string {
  const parts: string[] = []

  const head = typeof article.조문내용 === 'string' ? article.조문내용 : ''
  if (head) parts.push(head)

  // 조문 → 항 → 호 → 목 순서로 원문 텍스트만 결합
  for (const hang of toArrayNode(article.항)) {
    const hangText = flattenText(hang.항내용)
    if (hangText) parts.push(hangText)

    for (const ho of toArrayNode(hang.호)) {
      const hoText = flattenText(ho.호내용)
      if (hoText) parts.push(hoText)

      for (const mok of toArrayNode(ho.목)) {
        const mokText = flattenText(mok.목내용)
        if (mokText) parts.push(mokText)
      }
    }
  }

  return parts.join('\n')
}

/** API 키 없는 퍼블릭 법령 원문 링크 생성 */
function toSourceUrl(lsiSeq: string, efYd: string): string {
  return `${BASE_URL}/lsInfoP.do?efYd=${efYd}&lsiSeq=${lsiSeq}`
}

/**
 * 시점 관련 부칙 선별 (TAX-6B-1, FR-17 — 회계사 결정 2026-06-14).
 *
 * 한 법령에 부칙이 100개 이상일 수 있어(소득세법 116개) 전부 노출하면 노이즈다.
 * 신·구법 적용 경계를 보여줄 시점 관련 부칙만 고른다.
 *  - targetDate 지정: 그 시점 직전 공포 1개(당시 적용된 법) + 직후 공포 1개(다음 개정 경계)
 *  - 미지정: 최신 공포 2개
 */
function selectRelevantAddenda(addenda: RawBuchik[], targetDate?: Date): RawBuchik[] {
  // 공포일자·내용이 있는 부칙만, 공포일자 내림차순 정렬
  const sortedDesc = addenda
    .filter((b) => b.부칙공포일자 && b.부칙내용 != null)
    .sort((a, b) => (b.부칙공포일자 ?? '').localeCompare(a.부칙공포일자 ?? ''))

  if (!targetDate) return sortedDesc.slice(0, 2) // 최신 2개

  const ymd = targetDate.toISOString().slice(0, 10).replace(/-/g, '') // YYYYMMDD
  const before = sortedDesc.filter((b) => (b.부칙공포일자 ?? '') <= ymd) // 내림차순 → [0]=직전 최신
  const after = sortedDesc.filter((b) => (b.부칙공포일자 ?? '') > ymd) // 내림차순 → 마지막=직후 최초

  const picks: RawBuchik[] = []
  if (before[0]) picks.push(before[0]) // targetDate 직전 부칙
  if (after.length > 0) picks.push(after[after.length - 1]) // targetDate 직후 부칙
  return picks
}

/**
 * 부칙 1건 → TaxLaw(T2) 매핑 (TAX-6B-1).
 * content는 원문 그대로 결합(flattenText)하며 의역·요약하지 않는다 (CLAUDE.md §6.1).
 * 식별자(articleNumber)는 부칙내용 첫 줄("부칙 <제○호,날짜>")을 사용한다.
 */
function buchikToTaxLaw(
  buchik: RawBuchik,
  lawName: string,
  lsiSeq: string,
): TaxLaw {
  const content = flattenText(buchik.부칙내용)
  const promulgationDate = toIsoDate(buchik.부칙공포일자 ?? '')
  const firstLine = content.split('\n')[0]?.trim() ?? ''
  const articleNumber = firstLine.startsWith('부칙')
    ? firstLine
    : `부칙 <제${buchik.부칙공포번호 ?? ''}호>`
  return {
    sourceType: '법령',
    lawName: `${lawName} 부칙`,
    articleNumber,
    articleTitle: '부칙',
    content,
    revisionDate: promulgationDate,
    enforcementDate: promulgationDate,
    sourceUrl: toSourceUrl(lsiSeq, buchik.부칙공포일자 ?? ''),
    trustTier: 'T2',
  }
}

/** API 키 없는 퍼블릭 판례 원문 링크 생성 (CLAUDE.md §7 — OC 키 노출 차단) */
function toPrecSourceUrl(precSeq: string): string {
  return `${BASE_URL}/precInfoP.do?precSeq=${precSeq}`
}

/** API 키 없는 퍼블릭 법령해석례 원문 링크 생성 (TAX-016A — 실호출로 패턴 확인) */
function toExpcSourceUrl(expcSeq: string): string {
  return `${BASE_URL}/LSW/expcInfoP.do?expcSeq=${expcSeq}`
}

/**
 * 국세청 법령해석 원문 링크 — API가 taxlaw.nts.go.kr 공개 뷰어 링크를 직접 제공한다 (TAX-016B).
 * expc·판례 상세링크와 달리 OC 키가 포함돼 있지 않아 그대로 사용 가능(실호출 확인).
 * 방어적으로 혹시 키 파라미터가 있으면 제거하고, 유효 URL이 없으면 국세법령정보 홈으로 폴백.
 */
function toNtsExpcSourceUrl(rawLink: string): string {
  const link = (rawLink ?? '').trim()
  if (/^https?:\/\//i.test(link)) {
    // 만일의 키 노출 방어: OC 파라미터 제거 (현재 NTS 링크엔 없음 — CLAUDE.md §7)
    return link.replace(/([?&])OC=[^&]*/gi, '$1').replace(/[?&]+$/, '')
  }
  return 'https://taxlaw.nts.go.kr/'
}

/**
 * 조세심판원 결정례 원문 링크 — 청구번호로 행정심판재결례 검색에 딥링크한다 (TAX-016C).
 *  API 상세링크는 OC(키)를 포함하고(§7 위반), 키 없는 직접 뷰어(deccInfoP)는 일반 decc 전용이라
 *  특별행정심판 일련번호를 해석하지 못함(실호출 확인). 청구번호 검색은 해당 레코드를 노출함(실호출 확인).
 */
function toTribunalSourceUrl(claimNo: string): string {
  const q = (claimNo ?? '').trim()
  return q ? `${BASE_URL}/allDeccSc.do?query=${encodeURIComponent(q)}` : `${BASE_URL}/allDeccSc.do`
}

/**
 * 정렬: 개정일↓ → 시행일↓ → 조문번호↑ (SSOT §7.7, 결정론성 보장)
 * 조문번호는 "제1조" < "제2조" < "제10조" 순서로 숫자 기준 정렬
 */
function sortTaxLaws(items: TaxLaw[]): TaxLaw[] {
  return [...items].sort((a, b) => {
    const byRevision = b.revisionDate.localeCompare(a.revisionDate)
    if (byRevision !== 0) return byRevision

    const byEnforcement = b.enforcementDate.localeCompare(a.enforcementDate)
    if (byEnforcement !== 0) return byEnforcement

    // 조문번호 숫자 기준 오름차순
    const numA = parseInt(a.articleNumber.replace(/[^0-9]/g, '') || '0', 10)
    const numB = parseInt(b.articleNumber.replace(/[^0-9]/g, '') || '0', 10)
    return numA - numB
  })
}

/**
 * 비법령(판례·해석례) 정렬: 날짜↓ → 식별자↑ (결정론성 보장)
 * 판례=선고일/사건번호, 해석례=회신일/안건번호 모두 동일 규칙 (TAX-015, TAX-016A).
 */
function sortByDecisionDate(items: TaxLaw[]): TaxLaw[] {
  return [...items].sort((a, b) => {
    const byDate = (b.decisionDate ?? '').localeCompare(a.decisionDate ?? '')
    if (byDate !== 0) return byDate
    return (a.caseNumber ?? '').localeCompare(b.caseNumber ?? '')
  })
}

// ─── TAX-6B-11: 비법령 후보 확대 + 관련도 기반 본문 선별 ──────────────────────
//
// 회계사 피드백("심판례 관련성 너무 낮음") 후속. 두 결함을 해소한다:
//   ① 유실 — display=5로 좁아 관련 자료가 6위면 아예 못 가져옴.
//   ② P95 — 심판례·해석례는 후보 전수 본문 조회(N+1)라 후보를 함부로 못 늘림.
//
// 해법: 목록은 넓게(NONLAW_LIST_DISPLAY) 가져오되, 사건명 관련도 상위 K건(NONLAW_BODY_FETCH_LIMIT)만
//       본문 조회한다. 본문 조회 건수는 기존(5)과 동일 → P95 영향 최소. 나머지는 content=''(참고 목록 후보).
// 결정론성(SSOT §7.7): 외부 API 순서를 신뢰하지 않고, 우리 관련도 점수 + 보조키(날짜↓·식별자↑)로 정렬한다.

/** 비법령 목록 조회 폭 — 관련 자료 유실 방지 (회계사 결정 2026-06-17) */
const NONLAW_LIST_DISPLAY = '12'
/** 본문 조회 상한 — 관련도 상위 N건만 본문 조회(P95 현 수준 유지, 회계사 결정 2026-06-17) */
const NONLAW_BODY_FETCH_LIMIT = 5

/**
 * 목록을 사건명 관련도 내림차순으로 정렬한다 (결정론적 보조키 포함).
 * 본문은 아직 미조회이므로 제목(사건명·명칭)만으로 점수화한다(scoreRelevance body='').
 * 동점 시 날짜↓ → 식별자↑로 수렴해 같은 질문에 같은 순서를 보장한다 (SSOT §7.7).
 */
function rankByRelevance<T>(
  list: T[],
  terms: string[],
  getTitle: (x: T) => string,
  getDate: (x: T) => string,
  getId: (x: T) => string,
): T[] {
  return [...list].sort((a, b) => {
    const byScore = scoreRelevance(getTitle(b), '', terms) - scoreRelevance(getTitle(a), '', terms)
    if (byScore !== 0) return byScore
    const byDate = getDate(b).localeCompare(getDate(a))
    if (byDate !== 0) return byDate
    return getId(a).localeCompare(getId(b))
  })
}

/** fetch 래퍼 — 5초 타임아웃, 에러 변환 */
async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: REQUEST_HEADERS })
    if (!res.ok) throw new ApiUnavailableError()
    return res
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new ApiTimeoutError()
    if (err instanceof ApiTimeoutError || err instanceof ApiUnavailableError) throw err
    throw new ApiUnavailableError()
  } finally {
    clearTimeout(id)
  }
}

// ─── 비법령 4트랙 공통 빌더 ─────────────────────────────────────────────────

interface NonLawBase {
  sourceType: TaxLaw['sourceType']
  trustTier: TrustTier
  lawName: string
  caseNumber: string
  issuingBody: string
  articleTitle: string
  content: string
  decisionDate: string
  sourceUrl: string
}

function buildNonLawTaxLaw(base: NonLawBase): TaxLaw {
  return {
    sourceType: base.sourceType,
    lawName: base.lawName,
    articleNumber: '',
    articleTitle: base.articleTitle,
    content: base.content,
    revisionDate: base.decisionDate,  // 정렬·표시 호환을 위해 결정일로 채움
    enforcementDate: '',
    sourceUrl: base.sourceUrl,
    trustTier: base.trustTier,
    caseNumber: base.caseNumber,
    issuingBody: base.issuingBody,
    decisionDate: base.decisionDate,
  }
}

// ─── Adapter ──────────────────────────────────────────────────────────────

/**
 * 국세법령정보시스템 API Adapter — 법령 + 해석례(법제처·국세청) + 심판례 + 판례 검색
 *  (Phase 1, TAX-015/016A/016B/016C)
 *
 * [법령]      lawSearch.do(target=law)          → lawService.do → 조문(article)
 * [법제처해석] lawSearch.do(target=expc)         → (목록만, 본문 미조회) → 참고 목록             [TAX-6B-19]
 * [국세청해석] lawSearch.do(target=ntsCgmExpc)   → (목록만, 본문 API 없음) → 참고 목록           [TAX-016B]
 * [심판례]    lawSearch.do(target=ttSpecialDecc) → lawService.do → 본문(주문·재결요지·이유)  [TAX-016C]
 * [판례]      lawSearch.do(target=prec)         → (법원 출처만) lawService.do → 본문
 *
 * 다섯 자료를 병렬 검색해 Trust Tier 순(법령→해석례→심판례→판례)으로 병합한다.
 * 비법령(해석례·심판례·판례) 검색이 실패해도 법령 결과는 반환한다(부분 실패 허용).
 * TAX-6B-19: 해석례(expc·ntsCgmExpc)는 목록·참고 링크로 통일 — 본문 미조회, 발췌 인용·V검증 비대상.
 *   본문은 sourceUrl(키 없는 공개 뷰어)로 회계사가 직접 확인한다.
 * 조세심판원 결정례는 본문이 있어 발췌 인용(citable)·V검증 대상이다(TAX-016C).
 * Phase 4(벡터 DB) 이후 의미 유사도 검색으로 확장 예정.
 */
export class NationalTaxLawAdapter implements ISearchPort {
  private readonly apiKey = config.nationalTaxApiKey

  async search(query: SearchQuery): Promise<SearchResult> {
    // TAX-049: articleNumberHint를 캐시 키에 포함 — 같은 법령의 다른 조문 힌트는 다른 결과
    // TAX-6A-4: targetDate를 캐시 키에 포함 — 같은 법령의 다른 시점은 다른 결과
    const targetDateKey = query.targetDate ? query.targetDate.toISOString().slice(0, 10) : ''
    const cacheKey = `${query.keyword.trim().toLowerCase()}|${query.articleNumberHint ?? ''}|${targetDateKey}`

    const cached = cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result
    }

    // TAX-049: 조문번호 힌트가 있으면 법령 본문(T1·T2)만 정확 추출.
    //   - 사전 매칭 쿼리는 "법령명 + 제N조" 형태로 들어와 비법령 키워드 검색에 부적합
    //     (예: "소득세법"로 prec/expc 검색하면 무관한 결과 폭증 → LLM 입력 윈도우 초과 위험)
    //   - 비법령 자료는 다른 LLM rewrite 쿼리에서 자연 fallback으로 검색됨(중복 회피)
    //   - 외부 API 호출 수 감소(5→1) → P95 부담 완화
    let items: TaxLaw[]
    if (query.articleNumberHint) {
      const lawResult = await this.fetchArticles(query.keyword, query.articleNumberHint, query.targetDate)
      items = lawResult.items
    } else {
      // 법령 + 법제처 해석례 + 국세청 해석 + 조세심판원 결정례 + 판례 병렬 검색
      //  비법령 검색 실패 시 빈 배열 폴백(부분 실패 허용)
      const [lawResult, interpItems, ntsItems, tribunalItems, precItems] = await Promise.all([
        this.fetchArticles(query.keyword, undefined, query.targetDate),
        this.searchInterpretations(query.keyword).catch(() => [] as TaxLaw[]),
        this.searchNtsInterpretations(query.keyword).catch(() => [] as TaxLaw[]),
        this.searchTribunal(query.keyword).catch(() => [] as TaxLaw[]),
        this.searchPrecedents(query.keyword).catch(() => [] as TaxLaw[]),
      ])

      // Trust Tier 순 병합: 법령(T1·T2) → 해석례(T3) → 심판례(T3) → 판례(T4) — 직접 근거 우선 (CLAUDE.md §6.2)
      //  법제처 해석례(본문 있음·발췌 인용 가능)를 국세청 해석(본문 없음·참고 목록)보다 앞에 둔다.
      //  TAX-6B-11: 해석례(expc)·심판례는 어댑터가 이미 관련도순으로 정렬해 반환하므로 여기서 재정렬하지 않는다
      //   (날짜순으로 덮으면 관련도 순서가 사라짐). 관련도 정렬이 없는 NTS해석·판례만 sortByDecisionDate 유지.
      items = [
        ...lawResult.items,
        ...interpItems,
        ...sortByDecisionDate(ntsItems),
        ...tribunalItems,
        ...sortByDecisionDate(precItems),
      ]
    }
    const result: SearchResult = { items, totalCount: items.length }

    const ttl = items.length === 0 ? CACHE_EMPTY_TTL_MS : CACHE_TTL_MS
    cacheSet(cacheKey, { result, expiresAt: Date.now() + ttl })
    return result
  }

  /**
   * 다중 쿼리 검색 (TAX-6B-26) — rewrite가 만든 여러 검색어를 병렬 검색 후 병합.
   *
   * 각 쿼리는 기존 search()를 그대로 재사용하므로 캐시(keyword|hint|targetDate)가 적용된다.
   * identityKey 기준 순서 보존 병합으로, 대체 표현·조문 힌트·다른 쟁점축의 근거가 모두 반영된다
   * (기존엔 queries[0]만 검색해 나머지가 버려지던 재현율 손실 해소).
   * matchStage는 붙이지 않는다(direct 어댑터 책임 밖) — FallbackSearchPort가 병합본에 부여한다.
   */
  async searchMany(queries: SearchQuery[]): Promise<SearchResult> {
    const results = await Promise.all(queries.map((q) => this.search(q)))
    const items = mergeSearchItems(results.map((r) => r.items))
    return { items, totalCount: items.length }
  }

  /** Step 1: 법령 목록 검색 */
  private async searchLaws(keyword: string): Promise<RawLaw[]> {
    const params = new URLSearchParams({
      OC: this.apiKey,
      target: 'law',
      type: 'JSON',
      query: keyword,
      display: '5',
      page: '1',
    })
    const res = await fetchWithTimeout(`${BASE_URL}/DRF/lawSearch.do?${params}`)
    const data = await res.json() as { LawSearch: RawLawSearch }
    const ls = data.LawSearch

    if (ls.resultCode !== '00') throw new ApiUnavailableError()
    if (!ls.law) return []

    return Array.isArray(ls.law) ? ls.law : [ls.law]
  }

  /** Step 2: 특정 법령의 조문 목록 조회 */
  private async fetchLawArticles(lsiSeq: string): Promise<{ law: RawLawService['법령']; articles: RawArticle[]; addenda: RawBuchik[] }> {
    const params = new URLSearchParams({
      OC: this.apiKey,
      target: 'law',
      MST: lsiSeq,
      type: 'JSON',
    })
    const res = await fetchWithTimeout(`${BASE_URL}/DRF/lawService.do?${params}`)
    const data = await res.json() as RawLawService

    const law = data.법령
    if (!law?.기본정보) throw new ApiUnavailableError()

    // TAX-6B-1 FR-17: 부칙은 본문 응답에 이미 포함 — 단수/복수 혼재 정규화
    const addenda = law.부칙?.부칙단위 ? toArrayNode(law.부칙.부칙단위) : []

    if (!law?.조문?.조문단위) return { law, articles: [], addenda }

    const raw = law.조문.조문단위
    const all = Array.isArray(raw) ? raw : [raw]

    // 실제 조문만 필터 (장·절·관 헤더 제외)
    const articles = all.filter(a => a.조문여부 === '조문')
    return { law, articles, addenda }
  }

  /**
   * Step 1+2 조합: 법령 검색 → 상위 법령 조문 수집 → TaxLaw[]
   *
   * @param keyword             정식 법령명(예: "소득세법") — 약칭은 정규화됨
   * @param articleNumberHint   (TAX-049) 부여 시 해당 조문번호와 일치하는 조문만 반환
   * @param targetDate          (TAX-6A-4) 과거 시점 기준 날짜 — 조문시행일자 ≤ targetDate 필터
   */
  private async fetchArticles(keyword: string, articleNumberHint?: string, targetDate?: Date): Promise<SearchResult> {
    // TAX-6B-24: 결합 키워드에서 법리축(법령명)만 분리해 법령명 매칭에 사용한다.
    //  TAX-042G가 "법인세법" → "법인세법 손비"처럼 사실축을 붙이는데, 이 결합 키워드가
    //  그대로 searchLaws·selectBestLaw에 들어가면 매칭되는 법령명이 없어 0건 또는 fallback으로
    //  추락한다(TAX-031 정확매칭 무력화). 사실축은 조문 선별용(TAX-6B-25)이라 여기선 미사용.
    const { legalAxis } = splitLegalAxis(keyword)
    // TAX-031: 약칭을 정식 법령명으로 정규화한 뒤 검색 (예: "상증세법" → "상속세 및 증여세법")
    const normalized = normalizeLawName(legalAxis)
    const laws = await this.searchLaws(normalized)
    if (laws.length === 0) return { items: [], totalCount: 0 }

    // TAX-031: 법령명 정확매칭 우선 선택(완전 > 접두 > 부분 > 폴백).
    //  검색 API 랭킹 1위가 동음이의 법령일 수 있어(실측: "지방세법" → 1위 "지방교부세법")
    //  무조건 laws[0]을 채택하면 오매칭된다. 정식 법령명과 가장 정확히 일치하는 법령을 고른다.
    //  (Phase 4에서 다수 법령·벡터 검색으로 확장)
    const topLaw = selectBestLaw(laws, normalized)!.law // laws.length>0 이므로 non-null
    const { law: lawDetail, articles, addenda } = await this.fetchLawArticles(topLaw.법령일련번호)

    const lawType = lawDetail.기본정보.법종구분.content
    const revisionDate = toIsoDate(lawDetail.기본정보.공포일자)
    const enforcementDate = toIsoDate(lawDetail.기본정보.시행일자)
    const lawName = lawDetail.기본정보.법령명_한글
    const trustTier = toTrustTier(lawType)

    const items: TaxLaw[] = articles.map(article => {
      const { number, title } = parseArticleHead(
        typeof article.조문내용 === 'string' ? article.조문내용 : ''
      )
      return {
        sourceType: '법령',
        lawName,
        articleNumber: number || String(article.조문번호),
        articleTitle: title,
        // TAX-032: 조문내용(제목)뿐 아니라 응답에 이미 온 항·호·목 본문을 원문 그대로 조립.
        //  원문 변형 금지 — 번호 prepend·요약·재배열 없이 텍스트만 순서대로 결합 (CLAUDE.md §6.1)
        content: assembleArticleContent(article),
        revisionDate: article.조문시행일자
          ? toIsoDate(article.조문시행일자)
          : revisionDate,
        enforcementDate,
        sourceUrl: toSourceUrl(topLaw.법령일련번호, article.조문시행일자 || topLaw.시행일자),
        trustTier,
      }
    })

    // TAX-049: 조문번호 힌트가 주어지면 해당 조문만 필터(예: "제70조").
    //   회계사 사전(`articleNumberHints.ts`)이 제공하는 결정론적 힌트로 T1 정확 추출.
    //   힌트가 없으면 기존 동작(법령 전체 조문 반환) 유지 — 무영향.
    const hinted = articleNumberHint
      ? items.filter((it) => it.articleNumber === articleNumberHint)
      : items

    // FR-15 시점 필터 (TAX-6A-4): targetDate 지정 시 해당 날짜 이전에 시행된 조문만 반환.
    //   조문시행일자 ≤ targetDate — 클라이언트 필터(Gate B, TAX-6A-1 진단: API 미지원 확정).
    //   미지정 시 기존 동작(현행 전체 조문 반환) 유지 — 회귀 무영향.
    const targetYmd = targetDate
      ? targetDate.toISOString().slice(0, 10).replace(/-/g, '')  // "YYYY-MM-DD" → "YYYYMMDD"
      : null
    const filtered = targetYmd
      ? hinted.filter((it) => !it.revisionDate || it.revisionDate.replace(/-/g, '') <= targetYmd)
      : hinted

    // TAX-6B-1 FR-17: 시점 관련 부칙·경과조치를 T2로 병합 (신·구법 적용 경계 명시).
    //   법령 단위 맥락이므로 조문번호 힌트 필터와 무관하게 첨부하고, 시점 선별만 적용한다.
    //   sortTaxLaws가 T1 조문 → T2 부칙 순으로 정렬하여 직접 근거를 우선 노출한다.
    const addendaItems = selectRelevantAddenda(addenda, targetDate).map((b) =>
      buchikToTaxLaw(b, lawName, topLaw.법령일련번호),
    )

    const merged = sortTaxLaws([...filtered, ...addendaItems])
    return {
      items: merged,
      totalCount: merged.length,
    }
  }

  /**
   * 판례 검색 (target=prec) — 목록 조회 후 법원 출처만 본문 조회
   *
   * 국세법령정보시스템 출처 판례는 본문이 제공되지 않으므로(TAX-015 진단)
   * 메타데이터(사건명·선고일·링크)만 담고 content는 빈 문자열로 둔다.
   *
   * TAX-015B: 본문 있는 판례(발췌 인용 대상)와 본문 없는 판례(⚪참고 목록 대상)를
   *  모두 반환한다. 둘의 분리는 상위 계층(generateAnswer)이 content 유무로 수행한다.
   *  본문 없는 판례를 여기서 제외하지 않는다(과거 TAX-015 정책에서 변경).
   */
  private async searchPrecedents(keyword: string): Promise<TaxLaw[]> {
    // TAX-043: 비법령 입력 정규화 — 사건번호 정확매칭 우선, 그 외 불용어 제거
    const n = normalizeNonLawQuery(keyword)
    const effectiveKeyword = n.caseNumber ?? n.keyword
    const params = new URLSearchParams({
      OC: this.apiKey,
      target: 'prec',
      type: 'JSON',
      query: effectiveKeyword,
      // TAX-015B: 세법 판례 대부분이 국세 출처(본문 미제공)라, 본문 있는 판례를
      //  충분히 확보하고 참고 목록도 풍부하게 만들기 위해 조회 건수를 확대(3→10).
      display: '10',
      page: '1',
    })
    const res = await fetchWithTimeout(`${BASE_URL}/DRF/lawSearch.do?${params}`)
    const data = await res.json() as { PrecSearch?: RawPrecSearch }
    const ps = data.PrecSearch
    if (!ps?.prec) return []

    const list = Array.isArray(ps.prec) ? ps.prec : [ps.prec]

    // 법원 출처만 본문 조회 (병렬). 국세청 출처는 본문 미제공 → 메타만.
    const all = await Promise.all(
      list.map(async (p) => {
        const isCourtSource = (p.데이터출처명 ?? '').trim() !== '국세법령정보시스템'
        const content = isCourtSource
          ? await this.fetchPrecedentBody(p.판례일련번호)
          : ''
        return this.toPrecedentTaxLaw(p, content)
      }),
    )

    // TAX-015B: 본문 있는 판례(발췌 인용)와 본문 없는 판례(참고 목록) 모두 반환.
    //  generateAnswer가 content 유무로 citable/references를 분리한다.
    return all
  }

  /** 판례 본문 조회 (법원 출처). 미제공·실패 시 빈 문자열 반환(부분 실패 허용) */
  private async fetchPrecedentBody(precSeq: string): Promise<string> {
    try {
      const params = new URLSearchParams({
        OC: this.apiKey,
        target: 'prec',
        ID: precSeq,
        type: 'JSON',
      })
      const res = await fetchWithTimeout(`${BASE_URL}/DRF/lawService.do?${params}`)
      const data = await res.json() as { PrecService?: RawPrecService }
      const p = data.PrecService
      if (!p) return '' // 본문 미제공 시 {"Law":"일치하는 판례가 없습니다."}
      // 판시사항 + 판결요지를 원문 그대로 결합 (HTML 태그 포함 — CLAUDE.md §6.1)
      return [p.판시사항, p.판결요지].filter(Boolean).join('\n').trim()
    } catch {
      return ''
    }
  }

  /** 판례 목록 항목 + 본문 → TaxLaw (sourceType='판례', T4) */
  private toPrecedentTaxLaw(p: RawPrec, content: string): TaxLaw {
    const court = (p.법원명 ?? '').trim()
    const caseNo = (p.사건번호 ?? '').trim()
    const decisionDate = toIsoDateLoose(p.선고일자 ?? '')
    const issuingBody = court || (p.데이터출처명 ?? '').trim()
    const lawName = court ? `${court} ${caseNo}`.trim() : caseNo

    return buildNonLawTaxLaw({
      sourceType: '판례',
      trustTier: 'T4',
      lawName,
      caseNumber: caseNo,
      issuingBody,
      articleTitle: (p.사건명 ?? '').trim(),
      content,
      decisionDate,
      sourceUrl: toPrecSourceUrl(p.판례일련번호),
    })
  }

  /**
   * 법령해석례 검색 (target=expc) — 목록만 조회 (TAX-6B-19)
   *
   * TAX-6B-19: 본문 조회(lawService.do, N+1)를 제거하고 목록만 사용한다.
   *  해석례(expc·ntsCgmExpc)를 모두 목록·참고 링크 트랙으로 통일하기 위함(발췌 인용·V검증 비대상).
   *  본문(질의요지·회답·이유)은 sourceUrl(키 없는 공개 뷰어 링크)로 회계사가 직접 확인한다.
   *  관련도 정렬은 유지 — 참고 목록도 관련순 노출이 유의미.
   *  기재부 질의 법령해석도 expc에 포함됨(질의기관명=기획재정부).
   */
  private async searchInterpretations(keyword: string): Promise<TaxLaw[]> {
    // TAX-043: 비법령 입력 정규화 — 해석례는 사건번호 정확매칭 미지원이므로 keyword만 사용
    const n = normalizeNonLawQuery(keyword)
    const params = new URLSearchParams({
      OC: this.apiKey,
      target: 'expc',
      type: 'JSON',
      query: n.keyword,
      // TAX-6B-11: 목록은 넓게 가져와 관련 자료 유실을 막는다.
      display: NONLAW_LIST_DISPLAY,
      page: '1',
    })
    const res = await fetchWithTimeout(`${BASE_URL}/DRF/lawSearch.do?${params}`)
    const data = await res.json() as { Expc?: RawExpcSearch }
    const ex = data.Expc
    if (!ex?.expc) return []

    const list = Array.isArray(ex.expc) ? ex.expc : [ex.expc]

    // 안건명 관련도로 정렬(결정론성: 날짜↓·식별자↑ 보조키). 본문은 조회하지 않고 content=''.
    const terms = extractTerms(n.keyword)
    const ranked = rankByRelevance(
      list,
      terms,
      (e) => String(e.안건명 ?? ''),
      (e) => String(e.회신일자 ?? ''),
      (e) => String(e.안건번호 ?? ''),
    )
    return ranked.map((e) => this.toInterpretationTaxLaw(e, ''))
  }

  /** 법령해석례 목록 항목 → TaxLaw (sourceType='해석례', T3, 목록만·content='') */
  private toInterpretationTaxLaw(e: RawExpc, content: string): TaxLaw {
    const caseNo = (e.안건번호 ?? '').trim()
    const issuingBody = (e.회신기관명 ?? '').trim()  // 해석을 회신한 기관(예: 법제처)
    const decisionDate = toIsoDateLoose(e.회신일자 ?? '')
    const lawName = issuingBody ? `${issuingBody} ${caseNo}`.trim() : caseNo

    return buildNonLawTaxLaw({
      sourceType: '해석례',
      trustTier: 'T3',
      lawName,
      caseNumber: caseNo,
      issuingBody,
      articleTitle: (e.안건명 ?? '').trim(),
      content,
      decisionDate,
      sourceUrl: toExpcSourceUrl(e.법령해석례일련번호),
    })
  }

  /**
   * 국세청 법령해석 검색 (target=ntsCgmExpc) — 목록만 조회 (TAX-016B)
   *
   * 국세청 해석은 목록(메타)만 제공되고 본문(전문)이 없다(실호출 확정 2026-05-22).
   * 따라서 본문 조회 단계 없이 content=''인 TaxLaw로 정규화한다.
   * 상위 generateAnswer가 본문 없는 비법령을 참고 목록(references)으로 처리한다(TAX-015B/D).
   * 발췌 인용·law-verifier V검증 대상이 아니다(citation 승격 금지).
   * 법제처 해석례(expc)와 같은 sourceType='해석례'이며, issuingBody='국세청'으로 구분된다.
   */
  private async searchNtsInterpretations(keyword: string): Promise<TaxLaw[]> {
    // TAX-043: 비법령 입력 정규화 — NTS 해석은 사건번호 정확매칭 미지원이므로 keyword만 사용
    const n = normalizeNonLawQuery(keyword)
    const params = new URLSearchParams({
      OC: this.apiKey,
      target: 'ntsCgmExpc',
      type: 'JSON',
      query: n.keyword,
      // 본문 조회(N+1)가 없어 호출이 가벼우므로 관련도 정렬 후보를 넉넉히 확보(10건).
      //  법인세 실무 쟁점(가지급금 등) 핵심 공백을 메우는 자료원이다 (TAX-016B).
      display: '10',
      page: '1',
    })
    const res = await fetchWithTimeout(`${BASE_URL}/DRF/lawSearch.do?${params}`)
    const data = await res.json() as { CgmExpc?: RawNtsExpcSearch }
    const ce = data.CgmExpc
    if (!ce?.cgmExpc) return []

    const list = Array.isArray(ce.cgmExpc) ? ce.cgmExpc : [ce.cgmExpc]
    return list.map((e) => this.toNtsInterpretationTaxLaw(e))
  }

  /** 국세청 법령해석 목록 항목 → TaxLaw (sourceType='해석례', T3, 본문 없음) */
  private toNtsInterpretationTaxLaw(e: RawNtsExpc): TaxLaw {
    const caseNo = String(e.안건번호 ?? '').trim()
    const issuingBody = String(e.해석기관명 ?? '').trim() || '국세청'  // 해석기관(국세청)
    const decisionDate = toIsoDateLoose(String(e.해석일자 ?? ''))
    const lawName = `${issuingBody} ${caseNo}`.trim()

    return buildNonLawTaxLaw({
      sourceType: '해석례',
      trustTier: 'T3',
      lawName,
      caseNumber: caseNo,
      issuingBody,
      articleTitle: String(e.안건명 ?? '').trim(),
      content: '',                       // 국세청 해석은 본문 미제공 → 참고 목록(TAX-015B/D)
      decisionDate,
      sourceUrl: toNtsExpcSourceUrl(e.법령해석상세링크),
    })
  }

  /**
   * 조세심판원 결정례 검색 (target=ttSpecialDecc) — 목록 조회 후 각 본문 조회 (TAX-016C)
   *
   * 판례와 동일한 2단계(목록→본문). 본문(주문·재결요지·이유)이 제공되므로 발췌 인용 가능
   *  → generateAnswer의 citable로 흘러 law-verifier V1~V6 검증을 받는다.
   * 본문 조회 실패 시 content는 빈 문자열 → 참고 목록으로 처리(TAX-015B).
   * sourceType='심판례', trustTier='T3'(회계사 결정), issuingBody='조세심판원'.
   */
  private async searchTribunal(keyword: string): Promise<TaxLaw[]> {
    // TAX-043: 비법령 입력 정규화 — 심판례는 청구번호 정확매칭 지원(접두 "조심")
    const n = normalizeNonLawQuery(keyword)
    const effectiveKeyword = n.caseNumber ?? n.keyword
    const params = new URLSearchParams({
      OC: this.apiKey,
      target: 'ttSpecialDecc',
      type: 'JSON',
      query: effectiveKeyword,
      // TAX-6B-11: 목록은 넓게 가져와 관련 자료 유실을 막는다(본문 조회는 상위 K건으로 제한).
      display: NONLAW_LIST_DISPLAY,
      page: '1',
    })
    const res = await fetchWithTimeout(`${BASE_URL}/DRF/lawSearch.do?${params}`)
    // 목록 래퍼는 일반 decc와 동일한 `{ Decc: { decc: [] } }` (재결청='조세심판원')
    const data = await res.json() as { Decc?: RawTtSpecialDeccSearch }
    const dc = data.Decc
    if (!dc?.decc) return []

    const list = Array.isArray(dc.decc) ? dc.decc : [dc.decc]

    // TAX-6B-11: 사건명 관련도로 정렬한 뒤 상위 K건만 본문 조회(N+1 제어), 나머지는 content=''.
    //  본문 없는 항목은 상위 generateAnswer가 참고 목록 후보로 처리한다(관련도 컷오프는 거기서 — TAX-6B-10).
    const terms = extractTerms(n.keyword)
    const ranked = rankByRelevance(
      list,
      terms,
      (d) => String(d.사건명 ?? ''),
      (d) => String(d.의결일자 ?? ''),
      (d) => String(d.청구번호 ?? ''),
    )
    const all = await Promise.all(
      ranked.map(async (d, i) => {
        const content = i < NONLAW_BODY_FETCH_LIMIT
          ? await this.fetchTribunalBody(d.특별행정심판재결례일련번호)
          : ''
        return this.toTribunalTaxLaw(d, content)
      }),
    )
    return all
  }

  /** 조세심판원 결정례 본문 조회. 미제공·실패 시 빈 문자열 반환(부분 실패 허용) */
  private async fetchTribunalBody(seq: string | number): Promise<string> {
    try {
      const params = new URLSearchParams({
        OC: this.apiKey,
        target: 'ttSpecialDecc',
        ID: String(seq),
        type: 'JSON',
      })
      const res = await fetchWithTimeout(`${BASE_URL}/DRF/lawService.do?${params}`)
      const data = await res.json() as { SpecialDeccService?: RawSpecialDeccService }
      const s = data.SpecialDeccService
      if (!s) return ''
      // 주문 + 재결요지 + 이유를 원문 그대로 결합 (CLAUDE.md §6.1)
      return [s.주문, s.재결요지, s.이유].filter(Boolean).join('\n').trim()
    } catch {
      return ''
    }
  }

  /** 조세심판원 결정례 목록 항목 + 본문 → TaxLaw (sourceType='심판례', T3) */
  private toTribunalTaxLaw(d: RawTtSpecialDecc, content: string): TaxLaw {
    const caseNo = String(d.청구번호 ?? '').trim()
    const issuingBody = String(d.재결청 ?? '').trim() || '조세심판원'
    const decisionDate = toIsoDateLoose(String(d.의결일자 ?? ''))
    const lawName = issuingBody ? `${issuingBody} ${caseNo}`.trim() : caseNo

    return buildNonLawTaxLaw({
      sourceType: '심판례',
      trustTier: 'T3',
      lawName,
      caseNumber: caseNo,
      issuingBody,
      articleTitle: String(d.사건명 ?? '').trim(),
      content,
      decisionDate,
      sourceUrl: toTribunalSourceUrl(caseNo),
    })
  }
}
