#!/usr/bin/env node
/**
 * 세법 판례 주간 증분 수집기 — TAX-6B-35
 *
 * 국세법령정보시스템 DRF API(target=prec)에서 세법 관련 판례를 두 그물로 병행 수집해
 * 로컬 파일(TaxLaw[])로 저장한다. 임베딩·DB 적재는 하지 않는다(별도 단계 — collectTribunal.ts와 동일).
 *  - Pass A(JO=참조법령): 세법을 참조조문으로 삼는 판례(참조조문이 정리된 건, 주로 대법원).
 *  - Pass B(사건명 세목 키워드 + 사건종류='세무'): 참조조문이 공란이라 JO로는 안 잡히는
 *    하급심 세무 판례 보완(TAX-6B-35 후속, 회계사 결정 2026-07-04).
 *
 * 배경(회계사 결정 2026-07-04):
 *  - 기존 판례 10,075건의 출처(외부 저장소 precedent-kr)는 갱신이 멈춘 정적 스냅샷 —
 *    재실행으로는 신규 판례를 가져올 수 없어 자체 API 수집기가 필요.
 *  - 사건종류명='세무' 분류만으로 거르면(전체의 약 2%) 민사·행정 형식의 실질 세금
 *    사건을 놓친다 → **참조법령(JO) 필터 채택(회계사 제안)**.
 *    실측(2026-07-04): JO=법인세법 1,521건, 민사 부당이득금 사건 포착, sort=ddes 정상.
 *  - JO 목록: 국세 8법 + 지방세 3법, 각 시행령 포함(회계사 확정).
 *
 * 중복 방지(⚠️ 심판례와 다른 점):
 *  - 기존 적재분(precedent-kr)의 본문(주문 포함 완전판)과 이 API의 본문(판시사항+판결요지)이
 *    달라 embed.ts의 content_hash 만으로는 같은 사건을 거르지 못한다.
 *  - 사건번호 표기도 이원적("2025두36013" vs "대법원-2025-두-34754")이라
 *    정규화 토큰(normalizeCaseTokens)으로 DB·원장(ledger)과 대조한다.
 *  - 첫 실행은 자동으로 백필(backfill): DB에 없는 판례(스냅샷 단절 이후 신규 +
 *    민사·행정 형식의 세금 사건)가 전부 신규로 잡힌다. 이후 매주 실행은 소량 증분.
 *
 * ⚠️ 인용 무결성(CLAUDE.md §6.1): content(판시사항+판결요지)는 원문 그대로 보존. 가공·요약 금지.
 * ⚠️ 키 보호(CLAUDE.md §7): OC(API키)를 로그·산출물·sourceUrl에 노출하지 않는다.
 *     sourceUrl은 키 없는 공개 뷰어 링크(precInfoP.do — 어댑터 toPrecSourceUrl와 동일).
 *
 * 실행(키는 --env-file로 주입, 코드/로그 비노출):
 *   npm run collect:precedent                    → 증분 수집(첫 실행은 백필 겸용)
 *   npm run collect:precedent -- --concurrency 5
 *   npm run collect:precedent -- --max 50        → 테스트용 상한(신규 N건까지만)
 *   npm run collect:precedent -- --all           → 검증용 전체 재수집(TAX-6B-35 후속, 회계사 요청
 *                                                    2026-07-04): DB·원장의 "기지" 판정을 완전히
 *                                                    건너뛰고 22개 JO 전부를 처음부터 훑는다.
 *                                                    산출물은 scripts/precedent_full/ 에만 쓰고
 *                                                    원장(list.json)은 갱신하지 않는다(운영 상태 무변경).
 *   npm run embed -- --input scripts/precedent_incremental_<YYYYMMDD>.json  ← 다음 단계(별도 실행)
 *
 * ⚠️ 이 스크립트는 실행 시 실제 외부 API를 호출한다. 착수 승인 전에는 실행하지 말 것.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Pool } from 'pg'
import type { TaxLaw } from '../src/domain/TaxLaw'
import { fetchJsonWithRetry, runPool, scrubOc, toIsoDateLoose } from './collectTribunal'
import { withRetry } from './embed'

// ─── 경로·상수 ────────────────────────────────────────────────────────────────

const BASE_URL = 'https://www.law.go.kr'
const OUT_DIR = join('scripts', 'precedent')
/** 원장(ledger) — 이번까지 확인·수집한 목록 항목 누적(다음 실행의 기지 판정 재료) */
const LEDGER_PATH = join(OUT_DIR, 'list.json')
/** --all(검증용 전체 재수집) 산출물 전용 폴더 — 운영 원장·incremental 산출물과 분리 */
const FULL_OUT_DIR = join('scripts', 'precedent_full')

/** 목록 1페이지 건수 — API 최대 100 */
const LIST_DISPLAY = 100
/** 본문 동시 조회 수(collectTribunal과 동일한 보수적 기본값) */
const DEFAULT_CONCURRENCY = 10

/**
 * 참조법령(JO) 대상 세법 — 회계사 확정(2026-07-04): 국세 8법 + 지방세 3법.
 * 각 법률에 시행령을 자동 포함한다(buildJoQueries). 추후 세목 확장은 여기 한 줄 추가.
 */
export const TAX_LAW_JO_BASE = [
  '국세기본법',
  '국세징수법',
  '법인세법',
  '소득세법',
  '부가가치세법',
  '상속세및증여세법',
  '조세특례제한법',
  '종합부동산세법',
  '지방세법',
  '지방세기본법',
  '지방세특례제한법',
] as const

/**
 * 사건명(search=1) 세목 키워드 — JO 필터의 사각지대(참조조문 공란 하급심)를 메우는 보완 그물.
 * 회계사 결정(2026-07-04): JO와 병행. TAX_LAW_JO_BASE(국세 8법+지방세 3법)에 대응하는 세목만
 * 넣고, 제외 세목(관세·개별소비세·주세·증권거래세)의 키워드는 넣지 않는다.
 * 실측 근거(TAX-6B-35 후속): JO가 못 잡은 DB 판례 2,552건의 91%가 하급심이고, 표본은
 * 전부 참조조문 공란·사건종류='세무'였다. 사건명 검색 결과를 '세무'로 좁혀 그 층을 잡는다.
 * (소득세 계열은 '종합소득세'·'양도소득세'·'근로소득세'가 모두 사건명에 명시돼 개별 등재)
 */
export const TAX_ITEM_NAME_QUERIES = [
  '종합소득세',
  '양도소득세',
  '근로소득세',
  '법인세',
  '부가가치세',
  '상속세',
  '증여세',
  '종합부동산세',
  '취득세',
  '재산세',
  '등록면허세',
  '주민세',
  '지방소득세',
  '자동차세',
  '지방세', // 그 외 지방 세목 포괄
] as const

// ─── 순수 함수 (단위 테스트 대상 — 파일시스템·네트워크 비의존) ──────────────────

/** 세법 목록 → JO 질의 목록(법률 + 시행령 쌍). 실측: "법인세법 시행령"도 JO 필터 정상 동작 */
export function buildJoQueries(base: readonly string[] = TAX_LAW_JO_BASE): string[] {
  return base.flatMap((law) => [law, `${law} 시행령`])
}

/** 목록 원본 항목(필요 필드만) */
export interface PrecListItem {
  seq: string        // 판례일련번호 — 본문 조회 ID
  caseNumber: string // 사건번호 (예: "2025두36013", "대법원-2025-두-34754")
  caseName: string   // 사건명
  decidedAt: string  // 선고일자(원본 "YYYY.MM.DD")
  court: string      // 법원명
  dataSource: string // 데이터출처명 — '국세법령정보시스템'이면 본문 미제공
  caseType: string   // 사건종류명 (세무/민사/일반행정 등 — 통계·로그용)
}

/** 목록 응답(JSON) → {totalCnt, items}. 래퍼는 `{PrecSearch:{prec:[]|{}}}` */
export function parsePrecListPage(json: unknown): { totalCnt: number; items: PrecListItem[] } {
  const ps = (json as { PrecSearch?: { totalCnt?: string; prec?: unknown } }).PrecSearch
  if (!ps?.prec) return { totalCnt: Number(ps?.totalCnt ?? 0) || 0, items: [] }
  const raw = Array.isArray(ps.prec) ? ps.prec : [ps.prec]
  const items: PrecListItem[] = raw.map((p) => {
    const r = p as Record<string, unknown>
    return {
      seq: String(r['판례일련번호'] ?? '').trim(),
      caseNumber: String(r['사건번호'] ?? '').trim(),
      caseName: String(r['사건명'] ?? '').trim(),
      decidedAt: String(r['선고일자'] ?? '').trim(),
      court: String(r['법원명'] ?? '').trim(),
      dataSource: String(r['데이터출처명'] ?? '').trim(),
      caseType: String(r['사건종류명'] ?? '').trim(),
    }
  })
  return { totalCnt: Number(ps.totalCnt ?? 0) || 0, items }
}

/**
 * 사건번호 → 정규화 토큰 배열. 표기 이원성·병합 사건을 흡수하는 대조 키.
 *  "대법원-2025-두-34754"        → ["2025두34754"]
 *  "2013구합59576, 2014구합67529(병합)" → ["2013구합59576", "2014구합67529"]
 * 하이픈·공백 제거 후 "연도+한글부호+일련번호" 패턴만 추출한다.
 */
export function normalizeCaseTokens(raw: string): string[] {
  const compact = (raw ?? '').replace(/[\s-]/g, '')
  return compact.match(/\d{2,4}[가-힣]+\d+/g) ?? []
}

/**
 * 기지(旣知) 판정: 토큰 중 하나라도 기지 집합에 있으면 기지로 본다.
 * (중복 적재 방지 우선 — content_hash 안전망이 판례에선 작동하지 않으므로 보수적으로 판정)
 */
export function isKnownCase(caseNumber: string, knownTokens: ReadonlySet<string>): boolean {
  const tokens = normalizeCaseTokens(caseNumber)
  return tokens.length > 0 && tokens.some((t) => knownTokens.has(t))
}

/** 본문 제공 여부 — 국세법령정보시스템 출처는 본문 미제공(어댑터 searchPrecedents와 동일 판정) */
export function isCourtSource(dataSource: string): boolean {
  return (dataSource ?? '').trim() !== '국세법령정보시스템'
}

/**
 * 사건명(search=1) 보완 그물에서 유지할 사건종류 — '세무'만.
 * JO 그물이 이미 참조조문 태그된 판례(다수의 일반행정 포함)를 잡으므로, 여기선 사각지대인
 * 세무 라벨 하급심만 좁혀 담아 중복·소음을 줄인다.
 */
export function isTargetTaxCaseType(caseType: string): boolean {
  return (caseType ?? '').trim() === '세무'
}

/** 키(OC) 없는 공개 뷰어 링크 (어댑터 toPrecSourceUrl와 동일, §7) */
export function toPrecSourceUrl(precSeq: string): string {
  return `${BASE_URL}/precInfoP.do?precSeq=${precSeq}`
}

/**
 * 본문 응답(JSON) → content. 판시사항+판결요지를 원문 그대로 결합
 * (§6.1, 어댑터 fetchPrecedentBody와 동일 — HTML 태그 포함). 미제공 시 빈 문자열.
 */
export function parsePrecBody(json: unknown): string {
  const p = (json as { PrecService?: Record<string, unknown> }).PrecService
  if (!p) return ''
  return [p['판시사항'], p['판결요지']]
    .filter(Boolean)
    .map((v) => String(v))
    .join('\n')
    .trim()
}

/**
 * 목록 항목 + 본문 → TaxLaw(sourceType='판례', T4). 어댑터 toPrecedentTaxLaw와 동일 매핑.
 * 본문은 §6.1 원문 그대로. sourceUrl은 키 없는 링크.
 */
export function mapPrecedentToTaxLaw(item: PrecListItem, content: string): TaxLaw {
  const court = item.court
  const caseNo = item.caseNumber
  const decisionDate = toIsoDateLoose(item.decidedAt)
  const issuingBody = court || item.dataSource
  const lawName = court ? `${court} ${caseNo}`.trim() : caseNo
  return {
    sourceType: '판례',
    lawName,
    articleNumber: '',
    articleTitle: item.caseName,
    content, // ⚠️ §6.1 원문 그대로
    revisionDate: decisionDate, // 정렬·표시 호환(어댑터 buildNonLawTaxLaw와 동일)
    enforcementDate: '',
    sourceUrl: toPrecSourceUrl(item.seq),
    trustTier: 'T4',
    caseNumber: caseNo,
    issuingBody,
    decisionDate,
  }
}

// ─── I/O 유틸 ─────────────────────────────────────────────────────────────────

function getOc(): string {
  const oc = process.env.NATIONAL_TAX_API_KEY
  if (!oc) {
    console.error('[collectPrecedent] NATIONAL_TAX_API_KEY 환경변수가 필요합니다.')
    console.error('해결: npm run collect:precedent 로 실행하면 --env-file=.env.local 이 키를 주입합니다.')
    process.exit(1)
  }
  return oc
}

function listUrl(oc: string, jo: string, page: number): string {
  const p = new URLSearchParams({
    OC: oc,
    target: 'prec',
    type: 'JSON',
    display: String(LIST_DISPLAY),
    page: String(page),
    JO: jo,        // 참조법령 필터 — 실측 확인(2026-07-04): 엉터리 법령명은 0건(실제 필터)
    sort: 'ddes',  // 최신순(선고일자 내림차순) — 증분 조기 종료의 전제
  })
  return `${BASE_URL}/DRF/lawSearch.do?${p}`
}

/** 사건명(search=1) 검색 URL — 세목 키워드 보완 그물. 실측(2026-07-04): search=1 정상 동작 */
function nameSearchUrl(oc: string, term: string, page: number): string {
  const p = new URLSearchParams({
    OC: oc,
    target: 'prec',
    type: 'JSON',
    display: String(LIST_DISPLAY),
    page: String(page),
    search: '1',   // 1=사건명 검색(본문 검색 2는 과다) — 실측 확인
    query: term,
    sort: 'ddes',  // 최신순 — 증분 조기 종료의 전제
  })
  return `${BASE_URL}/DRF/lawSearch.do?${p}`
}

function bodyUrl(oc: string, seq: string): string {
  const p = new URLSearchParams({ OC: oc, target: 'prec', ID: seq, type: 'JSON' })
  return `${BASE_URL}/DRF/lawService.do?${p}`
}

function ensureOutDir(): void {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
}

function todayStamp(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}${mm}${dd}`
}

function getNumArg(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag)
  if (i === -1 || i + 1 >= process.argv.length) return fallback
  const n = Number(process.argv[i + 1])
  return Number.isFinite(n) ? n : fallback
}

// ─── 메인 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const concurrency = getNumArg('--concurrency', DEFAULT_CONCURRENCY)
  const max = getNumArg('--max', 0)
  const all = process.argv.includes('--all')
  const oc = getOc()

  // --all: 검증용 전체 재수집 — DB·원장 기지 판정을 완전히 건너뛴다(운영 상태 무변경, DB 불필요).
  let pool: Pool | null = null
  const knownTokens = new Set<string>()
  const knownSeqs = new Set<string>()
  let ledgerSize = 0
  if (!all) {
    const dbUrl = process.env.DATABASE_URL
    if (!dbUrl) {
      console.error('[collectPrecedent] DATABASE_URL 환경변수가 필요합니다(.env.local).')
      process.exit(1)
    }
    pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

    // 기지(旣知) 집합 = DB(precedent-kr 스냅샷 포함, 진실 소스) ∪ 원장(이전 실행 누적)
    const ledger: PrecListItem[] = existsSync(LEDGER_PATH)
      ? (JSON.parse(readFileSync(LEDGER_PATH, 'utf-8')) as PrecListItem[])
      : []
    ledgerSize = ledger.length
    for (const it of ledger) {
      for (const t of normalizeCaseTokens(it.caseNumber)) knownTokens.add(t)
      if (it.seq) knownSeqs.add(it.seq)
    }
    const { rows } = await withRetry(() =>
      pool!.query<{ case_number: string }>(
        `SELECT DISTINCT case_number FROM taxlaw_embeddings WHERE source_type = '판례'`,
      ),
    )
    for (const r of rows) {
      for (const t of normalizeCaseTokens(r.case_number)) knownTokens.add(t)
    }
    console.log(`[증분] 기지 판례: DB ${rows.length}건 + 원장 ${ledgerSize}건`)
  } else {
    console.log('[전체 재수집] --all — DB·원장 기지 판정을 건너뛰고 22개 JO 전부를 처음부터 훑습니다.')
  }
  ensureOutDir()
  if (all && !existsSync(FULL_OUT_DIR)) mkdirSync(FULL_OUT_DIR, { recursive: true })

  // 1) 두 그물을 병행해 수집(회계사 결정 2026-07-04):
  //    Pass A(JO=참조법령): 참조조문이 정리된 판례(주로 대법원·태그된 일반행정)를 잡는다.
  //    Pass B(사건명 세목 키워드 + 사건종류='세무'): 참조조문이 공란이라 JO로는 안 잡히는
  //           하급심 세무 판례를 보완한다(TAX-6B-35 후속 실측: JO가 못 잡은 DB 판례 2,552건 중
  //           91%가 하급심, 표본 전부 참조조문 공란·사건종류='세무').
  const fresh: PrecListItem[] = []
  const byCaseType = new Map<string, number>() // 사건종류 분포(통계 로그)

  // 한 그물(질의 목록)을 최신순 페이징하며 기지/신규를 분리한다.
  // keepCaseType: 유지할 사건종류 필터(null이면 전부 유지). 조기 종료 판정은 필터와 무관하게
  //   "페이지 전체가 기지인가(pageUnknown 0건)"로만 한다 — 필터로 걸러진 신규가 조기 종료를
  //   잘못 유발하지 않도록. 반환값 true = --max 상한 도달(바깥 패스까지 중단).
  async function pageThrough(
    label: string,
    queries: readonly string[],
    urlOf: (q: string, page: number) => string,
    keepCaseType: ((caseType: string) => boolean) | null,
  ): Promise<boolean> {
    for (const q of queries) {
      let page = 1
      let totalPages = Number.POSITIVE_INFINITY
      let qNew = 0
      while (page <= totalPages) {
        const parsed = parsePrecListPage(await fetchJsonWithRetry(urlOf(q, page)))
        if (!Number.isFinite(totalPages)) {
          totalPages = Math.max(1, Math.ceil(parsed.totalCnt / LIST_DISPLAY))
        }
        const pageUnknown = parsed.items.filter(
          (it) => it.seq && !knownSeqs.has(it.seq) && !isKnownCase(it.caseNumber, knownTokens),
        )
        const pageKeep = keepCaseType ? pageUnknown.filter((it) => keepCaseType(it.caseType)) : pageUnknown
        for (const it of pageKeep) {
          fresh.push(it)
          qNew++
          knownSeqs.add(it.seq) // 질의 간·페이지 간 교차 중복 방어
          for (const t of normalizeCaseTokens(it.caseNumber)) knownTokens.add(t)
          byCaseType.set(it.caseType || '(미상)', (byCaseType.get(it.caseType || '(미상)') ?? 0) + 1)
        }
        if (pageUnknown.length === 0) break // 페이지 전체가 기지 — 이후는 더 오래된 데이터
        if (max > 0 && fresh.length >= max) return true
        page++
      }
      console.log(`[${label}] "${q}": 신규 ${qNew}건 (누적 ${fresh.length})`)
    }
    return false
  }

  const capped = await pageThrough('JO', buildJoQueries(), (q, p) => listUrl(oc, q, p), null)
  if (!capped) {
    await pageThrough('사건명', TAX_ITEM_NAME_QUERIES, (q, p) => nameSearchUrl(oc, q, p), isTargetTaxCaseType)
  }

  if (fresh.length === 0) {
    console.log('[증분] 신규 판례 없음 — 산출물 없이 종료합니다.')
    if (pool) await pool.end()
    return
  }
  const typeStat = [...byCaseType.entries()].map(([k, v]) => `${k} ${v}`).join(' · ')
  console.log(`[증분] 신규 ${fresh.length}건 사건종류 분포: ${typeStat}`)

  // 2) 본문 수집 — 법원 출처만(국세법령정보시스템 출처는 본문 미제공 → 메타만 보존)
  const target = max > 0 ? fresh.slice(0, max) : fresh
  const laws: TaxLaw[] = []
  const succeeded: PrecListItem[] = []
  let ok = 0
  let empty = 0
  let fail = 0
  await runPool(target, concurrency, async (item) => {
    try {
      const content = isCourtSource(item.dataSource)
        ? parsePrecBody(await fetchJsonWithRetry(bodyUrl(oc, item.seq)))
        : ''
      laws.push(mapPrecedentToTaxLaw(item, content))
      succeeded.push(item)
      if (content) ok++
      else empty++
    } catch (e) {
      fail++
      console.error(`  [본문 실패] seq=${item.seq} caseNo=${item.caseNumber}: ${scrubOc(String(e))}`)
    }
  })

  // 3) 산출물 기록 (embed.ts 입력 포맷 그대로 — content 빈 건은 embed가 자동 스킵)
  laws.sort(
    (a, b) =>
      (b.decisionDate ?? '').localeCompare(a.decisionDate ?? '') ||
      (a.caseNumber ?? '').localeCompare(b.caseNumber ?? ''),
  )
  const outPath = all
    ? join(FULL_OUT_DIR, `precedent_full_${todayStamp()}.json`)
    : join('scripts', `precedent_incremental_${todayStamp()}.json`)
  writeFileSync(outPath, JSON.stringify(laws, null, 2) + '\n', 'utf-8')

  // 4) 원장 갱신 — 성공 항목만 추가(실패분은 다음 실행에서 자동 재수집).
  //    --all(검증용 전체 재수집)·--max(테스트 상한) 실행은 원장을 갱신하지 않는다.
  //    --all은 운영 상태를 건드리지 않기 위함, --max는 임베딩하지 않고 버릴 산출물이
  //    원장에만 기록되면 해당 건이 영구 누락되기 때문.
  if (!all && pool) {
    if (max === 0) {
      const ledger: PrecListItem[] = existsSync(LEDGER_PATH)
        ? (JSON.parse(readFileSync(LEDGER_PATH, 'utf-8')) as PrecListItem[])
        : []
      writeFileSync(LEDGER_PATH, JSON.stringify([...ledger, ...succeeded], null, 2) + '\n', 'utf-8')
    } else {
      console.log('[증분] --max 테스트 실행 — 원장(list.json)은 갱신하지 않습니다.')
    }
  } else if (all) {
    console.log('[전체 재수집] --all — 원장(list.json)은 갱신하지 않습니다(운영 상태 무변경).')
  }

  if (pool) await pool.end()
  console.log(`[증분] 완료: 신규 ${laws.length}건 → ${outPath} (본문 성공 ${ok}·빈본문 ${empty}·실패 ${fail})`)
  if (!all) {
    console.log(`다음 단계(별도 실행): npm run embed -- --input ${outPath.replace(/\\/g, '/')}`)
  }
}

// vitest import 시 main() 미실행(순수 함수만 노출) — collectTribunal.ts와 동일 가드
const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  main().catch((e) => {
    console.error(`[collectPrecedent] 치명적 오류: ${scrubOc(String(e))}`)
    process.exit(1)
  })
}
