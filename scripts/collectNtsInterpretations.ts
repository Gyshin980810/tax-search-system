#!/usr/bin/env node
/**
 * 국세청 세법해석례(ntsCgmExpc) 본문 코퍼스 수집기 — TAX-6B-20-A
 *
 * 목록은 국세법령정보시스템 DRF API(target=ntsCgmExpc, 운영키 필요·정상 작동)에서,
 * 본문은 taxlaw.nts.go.kr `/action.do` 크롤링(키·쿠키·워밍업 불필요, 프로브 실측 안정)으로
 * 확보해 **로컬 파일**(TaxLaw[])로 저장한다. 임베딩·DB 적재는 하지 않는다(TAX-6B-20-B, 별도 단계).
 *
 * ⚠️ 경로 전환 배경(티켓 §0): 공식 본문 XML API(lawService.do)는 존재·작동하나 운영키 권한이
 *   미신청·신청 자체가 봉쇄돼 있어(회계사 확인 2026-07-08) 사용할 수 없다. taxlaw 크롤링이
 *   유일한 실사용 경로다. 향후 권한이 열리면 [2단계 본문]만 lawService.do(XML)로 교체하면
 *   되도록 fetchTaxlawAction/parseActionBody를 국소 함수로 분리해 두었다(§8).
 *
 * ⚠️ §4.3 저장 형태 결정(방안② 채택 — 평문 + HWP 전문): dcmDVO의 ntstDcmGistCntn(요지)+
 *   ntstDcmCntn(회신)에 더해, HWP 첨부 전문(dcmHwpEditorDVOList의 html 변환본)까지 결합해
 *   저장한다. HWP 전문에는 '○ 사실관계'·'관련 조세법령(조문 원문)'·다른 세법해석례(관련사례)
 *   인용이 함께 담겨 있어(2026-07-09 실측), 이 한 번의 결합으로 사실관계·관련법령·관련사례를
 *   모두 확보한다(회계사 결정 2026-07-09). 본문이 풍부해져 의미 검색에서 관련 해석례가
 *   자연스럽게 함께 노출되는 부수 효과도 있다. 관련사례를 '명시적 엣지'로 잇는 인용 그래프
 *   (판례·심판례 방식, TAX-6B-31/32)는 범위가 커 후속 티켓으로 분리한다.
 *   해석례는 참고 목록(references) 트랙이라 발췌 인용되지 않으므로(§4.3·§6.4) 이 저장은
 *   "문자 단위 인용"이 아니라 "왜곡 없는 저장"의 문제다. HTML→텍스트 변환(htmlToText)은 태그만
 *   제거하고 실제 텍스트·HWP 특수문자(󰡒󰡓·【】)는 원문 그대로 보존한다(§6.1 왜곡 방지).
 *
 * ⚠️ 인용 무결성(CLAUDE.md §6.1): content(요지+회신)는 원문 그대로 보존. 가공·요약 금지.
 * ⚠️ 키 보호(CLAUDE.md §7): OC(API키)는 목록 조회에만 쓰이고 taxlaw 크롤링엔 아예 없다.
 *     sourceUrl은 목록 API가 직접 제공하는 키 없는 공개 뷰어 링크(법령해석상세링크)를 그대로 쓴다.
 *     에러 로그의 목록 URL은 scrubOc로 마스킹한다.
 *
 * ── resume(중단·재개) 설계 (collectTribunal.ts와 동일 골격) ─────────────────────
 *   13만여 건 중 네트워크 끊김으로 중단돼도 처음부터 다시 받지 않는다.
 *   scripts/ntsExpc/ 에 중간 산출물을 남기고, 재실행 시 이어받는다:
 *     - list.json      : 1단계 목록(안건번호·ntstDcmId 등). 존재하면 목록 재호출 생략.
 *     - records.jsonl  : 2단계 본문 수집 결과({ntstDcmId, law}) 한 줄씩 append(재개 안전).
 *     - checkpoint.json : 진행 통계(totalCnt·완료수·갱신시각).
 *   ntsExpc_full.json  : 3단계 finalize 산출물(TaxLaw[]) — embed.ts 입력 포맷.
 *
 * 실행(키는 --env-file로 주입, 코드/로그 비노출 — 목록에만 필요, 본문 크롤링엔 불필요):
 *   npm run collect:nts-interp                 → 1~3단계 전체(목록→본문→finalize), 이어받기
 *   npm run collect:nts-interp -- --list-only  → 1단계 목록만 수집(연결·추출률 확인용)
 *   npm run collect:nts-interp -- --finalize   → 3단계만(records.jsonl → ntsExpc_full.json)
 *   npm run collect:nts-interp -- --concurrency 5
 *   npm run collect:nts-interp -- --max 200    → 테스트용 상한(앞 N건만 본문 수집)
 *   npm run collect:nts-interp -- --allow-duplicate-case
 *     → 안건번호 중복 리포트만 남기고 finalize 강행(기본값은 중복 발견 시 중단)
 *
 * ⚠️ 이 스크립트는 실행 시 실제 외부 API(목록)와 taxlaw.nts.go.kr(본문)를 호출한다.
 *    착수 승인 전에는 실행하지 말 것. 대량 수집 시 §7(매너 크롤링)을 반드시 준수한다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { TaxLaw } from '../src/domain/TaxLaw'
import { fetchJsonWithRetry, runPool, scrubOc, toIsoDateLoose, findDuplicateCaseNumbers } from './collectTribunal'

// ─── 경로·상수 ────────────────────────────────────────────────────────────────

const LAW_BASE_URL = 'https://www.law.go.kr'
const TAXLAW_URL = 'https://taxlaw.nts.go.kr/action.do'
/** action.do 규격 — korean-law-mcp precedents.ts:271 (fetchTaxlawAction) 참고 이식 */
const ACTION_ID = 'ASIQTB002PR01'

const OUT_DIR = join('scripts', 'ntsExpc')
const LIST_PATH = join(OUT_DIR, 'list.json')
const RECORDS_PATH = join(OUT_DIR, 'records.jsonl')
const CHECKPOINT_PATH = join(OUT_DIR, 'checkpoint.json')
const DUPLICATE_CASE_REPORT_PATH = join(OUT_DIR, 'duplicate_case_numbers.json')
const FINAL_PATH = join('scripts', 'ntsExpc_full.json')

/** 목록 1페이지 건수 — API 최대 100 */
const LIST_DISPLAY = 100
/**
 * 본문 동시 조회 수 — 보수적 기본 2(매너 크롤링).
 * taxlaw는 비공식 내부 엔드포인트라 자동화 대량 요청 방어(WAF)가 공격적이다.
 * 실측(--max 200): 동시성 5·무지연으로 약 124건 연속 요청 후 우리 IP가 L7 침묵 차단됨.
 * → 동시성 하향 + 요청 간 랜덤 지터 지연 + User-Agent + 완충 쿨다운·조기 중단으로 재발 방지.
 */
const DEFAULT_CONCURRENCY = 2
/**
 * 요청 사이 지연(ms) — 매너 크롤링. 고정 간격 요청은 봇으로 탐지되기 쉬우므로(참고: 크롤링 IP
 * 차단 예방 자료 — "기계처럼 정확한 타이밍·간격이면 Bot으로 인식") 최소~최대 사이 랜덤 지터를
 * 준다. 각 워커가 1건 처리 후 이 범위에서 무작위 시간만큼 쉰다(jitterDelayMs).
 */
const REQUEST_DELAY_MIN_MS = 500
const REQUEST_DELAY_MAX_MS = 1500
/** 연속 실패 임계 — 이만큼 연속 실패하면 차단(rate-limit) 의심으로 즉시 중단(차단 연장 방지) */
const CONSECUTIVE_FAIL_LIMIT = 10
/**
 * 즉시 중단 전 1차 완충 임계 — 연속 실패가 이 값에 이르면 곧장 포기하지 않고 모든 워커가 잠시
 * 멈춰(COOLDOWN_MS) 서버에 회복 시간을 준다. 일시적 rate-limit이면 스스로 회복하고, 그래도
 * 실패가 이어져 CONSECUTIVE_FAIL_LIMIT에 닿으면 그때 즉시 중단한다(참고: 크롤링 차단 예방 —
 * "일정 시간 대기 후 다시 요청").
 */
const COOLDOWN_FAIL_THRESHOLD = 3
/** 1차 완충 쿨다운(ms) — 이 시간 동안 모든 워커가 새 요청을 보류한다 */
const COOLDOWN_MS = 30_000
/** 봇 오탐 완화용 User-Agent(일반 브라우저 형태) — taxlaw WAF 봇 감지 회피 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
/** 단건 재시도 횟수(지수 백오프) */
const MAX_RETRY = 4
/** 단건 타임아웃(ms) — taxlaw 응답 용량을 감안해 심판례(15s)보다 여유 있게 */
const TIMEOUT_MS = 20000
/** records.jsonl 진행 로그·체크포인트 저장 간격(건) */
const CHECKPOINT_EVERY = 500

/** 지정 ms만큼 대기(매너 크롤링·백오프 공용 헬퍼) */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ─── 순수 함수 (단위 테스트 대상 — 파일시스템·네트워크 비의존) ──────────────────
//   ⚠️ 어댑터(nationalTaxLaw.ts)의 목록 매핑과 동일한 데이터 형태를 유지한다(실시간 경로와 정합).

/** 목록 원본 항목(필요 필드만) */
export interface NtsExpcListItem {
  /** 법령해석일련번호 — 공식 lawService.do API용(현재 봉쇄, §8 향후 전환 대비 보존) */
  serial: string
  caseNumber: string // 안건번호 — 식별자(예: "법인22601-2200")
  caseName: string   // 안건명
  decidedAt: string  // 해석일자(원본 "YYYY.MM.DD")
  detailLink: string // 법령해석상세링크 — taxlaw 공개 뷰어 링크(ntstDcmId 포함, OC 키 없음)
  ntstDcmId: string  // detailLink에서 추출한 taxlaw 크롤링용 ID(18자리)
}

/**
 * 요청 간 지연 시간을 [min, max] 사이 무작위 정수(ms)로 계산한다(매너 크롤링·봇 오탐 완화).
 * 고정 간격 요청은 자동화 봇으로 탐지되기 쉬우므로(참고: 크롤링 IP 차단 예방 자료 —
 * "기계처럼 정확한 타이밍·간격이면 Bot으로 인식") 사람이 조작하듯 간격을 불규칙하게 둔다.
 * rnd는 [0,1) 난수원(기본 Math.random) — 주입 가능하게 열어 결정적 단위 테스트를 지원한다.
 */
export function jitterDelayMs(
  min: number = REQUEST_DELAY_MIN_MS,
  max: number = REQUEST_DELAY_MAX_MS,
  rnd: () => number = Math.random,
): number {
  const lo = Math.max(0, Math.min(min, max))
  const hi = Math.max(lo, Math.max(min, max))
  return lo + Math.floor(rnd() * (hi - lo + 1))
}

/** 법령해석상세링크에서 taxlaw 크롤링용 ntstDcmId를 추출한다(§2.2, 프로브 실측 확인). */
export function extractNtstDcmId(detailLink: string): string {
  return (String(detailLink ?? '').match(/ntstDcmId=(\w+)/) || [])[1] ?? ''
}

/** 목록 응답(JSON) → {totalCnt, items}. 래퍼는 `{CgmExpc:{cgmExpc:[]|{}}}` */
export function parseListPage(json: unknown): { totalCnt: number; items: NtsExpcListItem[] } {
  const ce = (json as { CgmExpc?: { totalCnt?: string; cgmExpc?: unknown } }).CgmExpc
  if (!ce?.cgmExpc) return { totalCnt: Number(ce?.totalCnt ?? 0) || 0, items: [] }
  const raw = Array.isArray(ce.cgmExpc) ? ce.cgmExpc : [ce.cgmExpc]
  const items: NtsExpcListItem[] = raw.map((e) => {
    const r = e as Record<string, unknown>
    const detailLink = String(r['법령해석상세링크'] ?? '').trim()
    return {
      serial: String(r['법령해석일련번호'] ?? '').trim(),
      caseNumber: String(r['안건번호'] ?? '').trim(),
      caseName: String(r['안건명'] ?? '').trim(),
      decidedAt: String(r['해석일자'] ?? '').trim(),
      detailLink,
      ntstDcmId: extractNtstDcmId(detailLink),
    }
  })
  return { totalCnt: Number(ce.totalCnt ?? 0) || 0, items }
}

/**
 * taxlaw 본문이 실질 내용을 담고 있는지 판정 — korean-law-mcp precedents.ts:206 이식.
 * HTTP 200이어도 알맹이 없는 응답(빈 문서·삭제된 문서)을 본문으로 오적재하지 않기 위한 가드.
 */
export function hasSubstantiveTaxlawBody(text: string): boolean {
  const compact = text.replace(/\s+/g, '')
  if (compact.length < 20) return false
  return !/(내용없음|본문없음|조회된내용이없습니다|자료가없습니다)/.test(compact)
}

/** 코드포인트 → 문자(범위 밖·비정상 값은 빈 문자열로 안전 처리) — htmlToText 숫자 엔티티 복원용 */
function codePointSafe(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return ''
  try {
    return String.fromCodePoint(cp)
  } catch {
    return ''
  }
}

/**
 * HWP 첨부 전문(HTML)을 텍스트로 충실 변환한다(§4.3 방안②).
 * - 블록/줄바꿈 태그(<br>·</p>·</tr>·</li>·</h1~6> 등)는 개행으로 보존해 문단 구조를 유지한다.
 * - 표 셀 경계(</td>·</th>)는 공백으로 보존한다(열이 붙어버리는 것 방지).
 * - 나머지 태그는 제거하고, HTML 엔티티를 복원한다(&amp;는 이중 복원 방지 위해 마지막).
 * - HWP 특수문자(󰡒 󰡓 인용부호·【】 등)는 손대지 않고 원문 그대로 둔다(§6.1 왜곡 방지).
 * - 마크업에서 비롯된 잉여 공백/개행만 정리한다(실제 텍스트 내용은 변형하지 않음).
 * ⚠️ 해석례는 참고 목록(references) 트랙이라 발췌 "인용" 대상이 아니므로(§6.4) 문자 단위 인용이
 *    아닌 "왜곡 없는 저장"의 관점에서 보수적으로 변환한다.
 */
export function htmlToText(html: string): string {
  const raw = String(html ?? '')
  if (!raw.trim()) return ''
  return raw
    .replace(/<\s*br\s*\/?\s*>/gi, '\n') // 줄바꿈 태그 → 개행
    .replace(/<\/\s*(p|div|tr|li|h[1-6]|table|thead|tbody|caption|blockquote)\s*>/gi, '\n') // 블록 종료 → 개행
    .replace(/<\/\s*(td|th)\s*>/gi, ' ') // 표 셀 경계 → 공백
    .replace(/<[^>]+>/g, '') // 나머지 태그 제거
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => codePointSafe(Number(n))) // 10진 숫자 엔티티
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => codePointSafe(parseInt(n, 16))) // 16진 숫자 엔티티
    .replace(/&amp;/gi, '&') // 반드시 마지막(이중 복원 방지)
    .replace(/[ \t ]+/g, ' ') // 연속 공백(nbsp 포함) → 단일 공백
    .split('\n')
    .map((line) => line.trim()) // 각 줄 앞뒤 공백 제거(마크업 들여쓰기 제거)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n') // 3줄 이상 빈 줄 → 2줄
    .trim()
}

/**
 * dcmHwpEditorDVOList에서 HTML 전문 항목만 골라 텍스트로 결합한다(§4.3 방안②).
 * 실측(2026-07-09): 목록에 HWP 원본(dcmFleTy='hwp', 내용 비어 있음)과 변환본(dcmFleTy='html')이
 * 함께 온다. 내용 있는 HTML 항목만 취해 htmlToText로 변환한다(빈 항목·HWP 바이너리 제외).
 */
export function extractHwpFullText(list: unknown): string {
  if (!Array.isArray(list)) return ''
  const texts: string[] = []
  for (const item of list) {
    const it = (item ?? {}) as Record<string, unknown>
    const byte = String(it['dcmFleByte'] ?? '')
    if (!byte.trim()) continue // 빈 항목(HWP 원본은 대개 여기서 걸러짐) 제외
    const ty = String(it['dcmFleTy'] ?? '').toLowerCase()
    const looksHtml = /<\/?[a-z][\s\S]*>/i.test(byte)
    // dcmFleTy가 'html'이거나, 타입 표기가 없어도 HTML 태그가 보이면 채택('hwp' 바이너리는 제외)
    if (ty === 'html' || (ty !== 'hwp' && looksHtml)) {
      const text = htmlToText(byte)
      if (text) texts.push(text)
    }
  }
  return texts.join('\n\n').trim()
}

/**
 * action.do 응답(JSON) → content. §4.3 방안②: 요지(ntstDcmGistCntn)+회신(ntstDcmCntn)에 더해
 * HWP 첨부 전문(사실관계·관련법령·관련사례 포함)까지 원문 그대로 결합한다(§6.1).
 * 요지·회신 두 필드가 완전히 같으면 중복 결합하지 않는다(공식 API의 회답==질의요지 중복 사례가
 * 있어 방어적으로 적용 — memory project_nonlaw_interp_tracks 참고). HWP 전문이 없는 옛 문서는
 * 요지+회신만 저장한다(하위 호환). hasSubstantiveTaxlawBody를 통과하지 못하면 빈 문자열.
 */
export function parseActionBody(json: unknown): string {
  const payload = (json as { data?: Record<string, unknown> }).data?.[ACTION_ID] as
    | { dcmDVO?: Record<string, unknown>; dcmHwpEditorDVOList?: unknown }
    | undefined
  const dcm = payload?.dcmDVO
  if (!dcm) return ''
  // ⚠️ §6.1 원문 그대로: 중복 판정에만 trim 비교를 쓰고, 결합 자체는 필드 원문(내부 공백 포함)을
  //   그대로 두고 마지막에만 전체 trim한다(collectTribunal.parseBody와 동일 관례).
  const gist = String(dcm['ntstDcmGistCntn'] ?? '')
  const cntn = String(dcm['ntstDcmCntn'] ?? '')
  const isDuplicate = cntn.trim() !== '' && cntn.trim() === gist.trim()
  const head = (isDuplicate ? [gist] : [gist, cntn]).filter(Boolean).join('\n') // 기존 요지+회신 결합 관례 유지
  const hwpText = extractHwpFullText(payload?.dcmHwpEditorDVOList) // 방안②: HWP 전문 추가
  const combined = [head, hwpText].filter((s) => s.trim()).join('\n\n').trim()
  return hasSubstantiveTaxlawBody(combined) ? combined : ''
}

/**
 * 국세청 해석례 원문 링크 — 목록 API가 taxlaw 공개 뷰어 링크를 직접 제공한다(어댑터
 * toNtsExpcSourceUrl과 동일 로직, nationalTaxLaw.ts:416). OC 키가 섞여 있을 가능성에
 * 방어적으로 대비해 제거한다(§7).
 */
export function toNtsExpcSourceUrl(rawLink: string): string {
  const link = (rawLink ?? '').trim()
  if (/^https?:\/\//i.test(link)) {
    return link.replace(/([?&])OC=[^&]*/gi, '$1').replace(/[?&]+$/, '')
  }
  return 'https://taxlaw.nts.go.kr/'
}

/**
 * 목록 항목 + 본문 → TaxLaw(sourceType='해석례', T3, issuingBody='국세청').
 * 어댑터 toNtsInterpretationTaxLaw와 동일 매핑이되 content가 채워진다는 점만 다르다(§4.4).
 */
export function mapNtsExpcToTaxLaw(item: NtsExpcListItem, content: string): TaxLaw {
  const caseNo = item.caseNumber
  const issuingBody = '국세청'
  const decisionDate = toIsoDateLoose(item.decidedAt)
  const lawName = `${issuingBody} ${caseNo}`.trim()
  return {
    sourceType: '해석례',
    lawName,
    articleNumber: '',
    articleTitle: item.caseName,
    content, // ⚠️ §6.1 원문 그대로(요지+회신)
    revisionDate: decisionDate, // 정렬·표시 호환(어댑터 buildNonLawTaxLaw와 동일)
    enforcementDate: '',
    sourceUrl: toNtsExpcSourceUrl(item.detailLink),
    trustTier: 'T3',
    caseNumber: caseNo,
    issuingBody,
    decisionDate,
  }
}

// ─── I/O 유틸 (네트워크·파일) ──────────────────────────────────────────────────

function getOc(): string {
  const oc = process.env.NATIONAL_TAX_API_KEY
  if (!oc) {
    console.error('[collectNtsInterpretations] NATIONAL_TAX_API_KEY 환경변수가 필요합니다.')
    console.error('해결: npm run collect:nts-interp 으로 실행하면 --env-file=.env.local 이 키를 주입합니다.')
    process.exit(1)
  }
  return oc
}

function listUrl(oc: string, page: number): string {
  const p = new URLSearchParams({
    OC: oc,
    target: 'ntsCgmExpc',
    type: 'JSON',
    display: String(LIST_DISPLAY),
    page: String(page),
  })
  return `${LAW_BASE_URL}/DRF/lawSearch.do?${p}`
}

/** taxlaw 상세 페이지 URL — action.do 호출의 referer로 사용(프로브 실측: 워밍업 GET 불필요) */
function taxlawReferer(ntstDcmId: string): string {
  return `https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=${ntstDcmId}`
}

/**
 * taxlaw action.do POST — 타임아웃 + 지수 백오프 재시도(collectTribunal.fetchJsonWithRetry와
 * 동일한 재시도 정책, GET이 아닌 POST라 별도 구현). 키·쿠키 불필요(프로브 실측 15/15 안정).
 */
export async function fetchTaxlawAction(ntstDcmId: string): Promise<unknown> {
  const body = new URLSearchParams({
    actionId: ACTION_ID,
    paramData: JSON.stringify({ dcmDVO: { ntstDcmId } }),
  })
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      try {
        const res = await fetch(TAXLAW_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            origin: 'https://taxlaw.nts.go.kr',
            referer: taxlawReferer(ntstDcmId),
            'x-requested-with': 'XMLHttpRequest',
            'user-agent': USER_AGENT, // 봇 오탐 완화(§7 매너 크롤링)
          },
          body: body.toString(),
          signal: controller.signal,
        })
        const text = await res.text()
        if (res.status !== 200 || !text.trim().startsWith('{')) {
          throw new Error(`비정상 응답(status=${res.status}, head=${text.slice(0, 80)})`)
        }
        return JSON.parse(text)
      } finally {
        clearTimeout(timer)
      }
    } catch (e) {
      lastErr = e
      if (attempt < MAX_RETRY) {
        // 지수 백오프 + 지터(동시 재시도가 한꺼번에 몰리지 않도록 분산 — 참고: 크롤링 차단 예방)
        await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 500))
      }
    }
  }
  throw new Error(`재시도 ${MAX_RETRY}회 초과: ${String(lastErr)}`)
}

function ensureOutDir(): void {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
}

// ─── 1단계: 목록 전수 수집 ─────────────────────────────────────────────────────

async function collectList(oc: string): Promise<NtsExpcListItem[]> {
  if (existsSync(LIST_PATH)) {
    const cached = JSON.parse(readFileSync(LIST_PATH, 'utf-8')) as NtsExpcListItem[]
    console.log(`[1단계] 목록 캐시 재사용: ${cached.length}건 (${LIST_PATH})`)
    return cached
  }

  const first = parseListPage(await fetchJsonWithRetry(listUrl(oc, 1)))
  const totalPages = Math.ceil(first.totalCnt / LIST_DISPLAY)
  console.log(`[1단계] 전체 ${first.totalCnt}건 / ${totalPages}페이지 수집 시작`)

  const all: NtsExpcListItem[] = [...first.items]
  for (let page = 2; page <= totalPages; page++) {
    const { items } = parseListPage(await fetchJsonWithRetry(listUrl(oc, page)))
    all.push(...items)
    if (page % 50 === 0 || page === totalPages) {
      console.log(`  목록 진행 ${page}/${totalPages}페이지 (${all.length}건)`)
    }
  }
  // ntstDcmId 추출 실패 항목 제외(본문 크롤링 불가) — 스킵 집계 로깅
  const valid = all.filter((it) => it.ntstDcmId)
  const skipped = all.length - valid.length
  if (skipped > 0) {
    console.log(`  ⚠️ ntstDcmId 추출 실패로 스킵: ${skipped}건`)
  }
  writeFileSync(LIST_PATH, JSON.stringify(valid, null, 2) + '\n', 'utf-8')
  console.log(`[1단계] 완료: ${valid.length}건 저장 (${LIST_PATH})`)
  return valid
}

// ─── 2단계: 본문 수집(resume) ──────────────────────────────────────────────────

/** records.jsonl에서 이미 완료된 ntstDcmId 집합을 복원(재개 안전) */
function loadDoneIds(): Set<string> {
  const done = new Set<string>()
  if (!existsSync(RECORDS_PATH)) return done
  const text = readFileSync(RECORDS_PATH, 'utf-8')
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const rec = JSON.parse(t) as { ntstDcmId?: string }
      if (rec.ntstDcmId) done.add(rec.ntstDcmId)
    } catch {
      // 손상된 마지막 줄 등은 무시(다음 실행에서 재수집)
    }
  }
  return done
}

async function collectBodies(list: NtsExpcListItem[], concurrency: number, max: number): Promise<void> {
  ensureOutDir()
  const done = loadDoneIds()
  let remaining = list.filter((it) => !done.has(it.ntstDcmId))
  if (max > 0) remaining = remaining.slice(0, max)

  console.log(
    `[2단계] 본문 수집 — 전체 ${list.length}건 / 완료 ${done.size}건 / 이번 대상 ${remaining.length}건 (동시성 ${concurrency})`,
  )

  let ok = 0
  let empty = 0
  let fail = 0
  let processed = 0
  let consecutiveFail = 0 // 연속 실패 카운터(성공하면 0으로 리셋) — 차단 조기 감지용
  let aborted = false // 조기 중단(circuit breaker) 발동 여부
  let cooldownUntil = 0 // 이 시각(epoch ms)까지 모든 워커가 새 요청을 보류(공유 완충 쿨다운)
  const startedAt = Date.now()

  await runPool(remaining, concurrency, async (item) => {
    if (aborted) return // 조기 중단 발동 후 남은 작업은 즉시 스킵(요청 없이 빠르게 소진)
    // 공유 완충 쿨다운: rate-limit 완충 시간 동안 모든 워커가 새 요청을 멈춘다
    const cooldownWait = cooldownUntil - Date.now()
    if (cooldownWait > 0) await sleep(cooldownWait)
    try {
      const content = parseActionBody(await fetchTaxlawAction(item.ntstDcmId))
      const law = mapNtsExpcToTaxLaw(item, content)
      appendFileSync(RECORDS_PATH, JSON.stringify({ ntstDcmId: item.ntstDcmId, law }) + '\n', 'utf-8')
      if (content) ok++
      else empty++ // 본문 미제공/빈 문서 — 참고 목록 후보로 활용. 적재는 content 보유분만(embed.ts).
      consecutiveFail = 0 // 성공하면 연속 실패 리셋
    } catch (e) {
      fail++
      consecutiveFail++
      console.error(`  [본문 실패] ntstDcmId=${item.ntstDcmId} caseNo=${item.caseNumber}: ${scrubOc(String(e))}`)
      // 1차 완충: 연속 실패가 임계에 닿으면 곧장 포기하지 않고 모든 워커가 잠시 쉰다(일시적 rate-limit 회복 유도)
      if (
        consecutiveFail >= COOLDOWN_FAIL_THRESHOLD &&
        consecutiveFail < CONSECUTIVE_FAIL_LIMIT &&
        Date.now() >= cooldownUntil
      ) {
        cooldownUntil = Date.now() + COOLDOWN_MS
        console.error(
          `  ⏸ 연속 ${consecutiveFail}건 실패 — ${COOLDOWN_MS / 1000}s 쿨다운 후 재개합니다(일시적 rate-limit 완충).`,
        )
      }
      // circuit breaker: 연속 N건 실패면 차단(rate-limit) 의심 → 즉시 중단(차단 연장·헛수고 방지)
      if (consecutiveFail >= CONSECUTIVE_FAIL_LIMIT && !aborted) {
        aborted = true
        console.error(
          `  ⛔ 연속 ${CONSECUTIVE_FAIL_LIMIT}건 실패 — 서버 차단(rate-limit) 의심으로 즉시 중단합니다. ` +
          `잠시(수십 분~수 시간) 뒤 재실행하면 records.jsonl 기준으로 이어받습니다.`,
        )
      }
    } finally {
      processed++
      if (processed % CHECKPOINT_EVERY === 0) {
        writeCheckpoint(list.length, done.size + processed, { ok, empty, fail })
        const rate = processed / ((Date.now() - startedAt) / 1000)
        console.log(`  진행 ${processed}/${remaining.length} (성공 ${ok}·빈본문 ${empty}·실패 ${fail}, ${rate.toFixed(1)}건/s)`)
      }
      // 매너 크롤링: 각 요청 후 랜덤 지터 지연(중단 상태면 생략해 남은 워커를 빠르게 소진)
      if (!aborted) await sleep(jitterDelayMs())
    }
  })

  writeCheckpoint(list.length, done.size + processed, { ok, empty, fail })
  console.log(`[2단계] 완료: 성공 ${ok}·빈본문 ${empty}·실패 ${fail} (누적 완료 ${done.size + processed}/${list.length})`)
  if (aborted) {
    console.log('  ⛔ 연속 실패로 조기 중단되었습니다. 서버 차단(rate-limit) 해제 후 재실행하세요(이어받기 지원).')
  } else if (fail > 0) {
    console.log(`  ⚠️ 실패 ${fail}건 — 재실행하면 미완료 ntstDcmId만 이어받습니다(records.jsonl 기준).`)
  }
}

function writeCheckpoint(total: number, completed: number, stat: { ok: number; empty: number; fail: number }): void {
  ensureOutDir()
  writeFileSync(
    CHECKPOINT_PATH,
    JSON.stringify({ total, completed, ...stat, updatedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf-8',
  )
}

// ─── 3단계: finalize (records.jsonl → ntsExpc_full.json) ───────────────────────

function finalize(allowDuplicateCase = false): void {
  if (!existsSync(RECORDS_PATH)) {
    console.error(`[3단계] records.jsonl 이 없습니다(${RECORDS_PATH}). 먼저 2단계 본문 수집을 실행하세요.`)
    process.exit(1)
  }
  const text = readFileSync(RECORDS_PATH, 'utf-8')
  const laws: TaxLaw[] = []
  const seen = new Set<string>() // ntstDcmId 중복 제거(append 재개 과정의 잠재 중복 방어)
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const rec = JSON.parse(t) as { ntstDcmId?: string; law?: TaxLaw }
      if (!rec.law || (rec.ntstDcmId && seen.has(rec.ntstDcmId))) continue
      if (rec.ntstDcmId) seen.add(rec.ntstDcmId)
      laws.push(rec.law)
    } catch {
      // 손상 줄 무시
    }
  }
  const duplicates = findDuplicateCaseNumbers(laws)
  const missingCaseNumber = laws.filter((law) => !(law.caseNumber ?? '').trim()).length
  if (duplicates.length > 0 || missingCaseNumber > 0) {
    const report = {
      duplicateCount: duplicates.length,
      missingCaseNumber,
      duplicates,
      generatedAt: new Date().toISOString(),
    }
    writeFileSync(DUPLICATE_CASE_REPORT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf-8')
    console.error(
      `[3단계] 안건번호 품질 이슈: 중복 ${duplicates.length}종, 누락 ${missingCaseNumber}건 ` +
      `(${DUPLICATE_CASE_REPORT_PATH})`,
    )
    if (!allowDuplicateCase) {
      console.error('[3단계] 기본값은 적재 전 중단입니다. 검토 후 강행하려면 --allow-duplicate-case 를 사용하세요.')
      process.exit(1)
    }
  }
  // ⚠️ embed.ts는 content 보유분만 적재하지만, 파일에는 빈 본문도 보존(참고 목록 후보·재현성).
  writeFileSync(FINAL_PATH, JSON.stringify(laws, null, 2) + '\n', 'utf-8')
  const withBody = laws.filter((l) => l.content.length > 0).length
  console.log(`[3단계] 완료: ${laws.length}건 → ${FINAL_PATH} (본문 보유 ${withBody}건)`)
  console.log(`다음 단계(추후, 별도 실행): npm run embed -- --input ${FINAL_PATH.replace(/\\/g, '/')}`)
}

// ─── 메인 ───────────────────────────────────────────────────────────────────

function getNumArg(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag)
  if (i === -1 || i + 1 >= process.argv.length) return fallback
  const n = Number(process.argv[i + 1])
  return Number.isFinite(n) ? n : fallback
}

async function main(): Promise<void> {
  ensureOutDir()
  const listOnly = process.argv.includes('--list-only')
  const finalizeOnly = process.argv.includes('--finalize')
  const allowDuplicateCase = process.argv.includes('--allow-duplicate-case')
  const concurrency = getNumArg('--concurrency', DEFAULT_CONCURRENCY)
  const max = getNumArg('--max', 0)

  if (finalizeOnly) {
    finalize(allowDuplicateCase)
    return
  }

  const oc = getOc()
  const list = await collectList(oc)
  if (listOnly) {
    console.log('[--list-only] 목록만 수집했습니다. 본문 수집은 --list-only 없이 다시 실행하세요.')
    return
  }

  await collectBodies(list, concurrency, max)

  if (max === 0) {
    finalize(allowDuplicateCase)
  } else {
    console.log('[--max] 일부만 수집했습니다. 전량 완료 후 --finalize 로 ntsExpc_full.json 을 생성하세요.')
  }
}

// vitest import 시 main() 미실행(순수 함수만 노출) — collectTribunal.ts와 동일 가드
const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  main().catch((e) => {
    console.error(`[collectNtsInterpretations] 치명적 오류: ${scrubOc(String(e))}`)
    process.exit(1)
  })
}
