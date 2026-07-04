#!/usr/bin/env node
/**
 * 조세심판원 결정례(심판례) 전량 수집기 — TAX-6B-18
 *
 * 국세법령정보시스템 DRF API(target=ttSpecialDecc)에서 심판례 약 139,791건을
 * 수집해 **로컬 파일**(TaxLaw[])로 저장한다. 임베딩·DB 적재는 하지 않는다(별도 단계).
 *
 * ⚠️ 설계 의도(회계사 결정 2026-06-19): "수집"과 "임베딩"을 분리한다.
 *   [이 스크립트]  API → 로컬 파일(scripts/tribunal_full.json)   ← 여기까지
 *   [다음 단계]    npm run embed -- --input scripts/tribunal_full.json  ← 추후, 별도 실행
 *
 *   장점: ① 임베딩 모델/단가가 바뀌어도 재수집 0회(파일만 다시 임베딩)
 *        ② API 의존과 voyage 의존을 분리해 각각 안정적으로 재개 가능
 *        ③ 원문 파일이 §6.1 문자 단위 대조의 "증거"로 남음
 *
 * ⚠️ 인용 무결성(CLAUDE.md §6.1): content(주문+재결요지+이유)는 원문 그대로 보존. 가공·요약 금지.
 * ⚠️ 키 보호(CLAUDE.md §7): OC(API키)를 로그·산출물·sourceUrl에 노출하지 않는다.
 *     - sourceUrl은 키 없는 공개 뷰어 링크(allDeccSc.do)로 생성.
 *     - 에러 로그의 URL은 OC를 마스킹(scrubOc)한다.
 *
 * ── resume(중단·재개) 설계 ──────────────────────────────────────────────
 *   14만 콜 중 네트워크 끊김·일일 한도로 중단돼도 처음부터 다시 받지 않는다.
 *   scripts/tribunal/ 에 중간 산출물을 남기고, 재실행 시 이어받는다:
 *     - list.json      : 1단계 목록(일련번호·청구번호 등). 존재하면 목록 재호출 생략.
 *     - records.jsonl  : 2단계 본문 수집 결과({seq, law}) 한 줄씩 append(재개 안전).
 *     - checkpoint.json : 진행 통계(totalCnt·완료수·갱신시각).
 *   tribunal_full.json : 3단계 finalize 산출물(TaxLaw[]) — embed.ts 입력 포맷.
 *
 * 실행(키는 --env-file로 주입, 코드/로그 비노출):
 *   npm run collect:tribunal                 → 1~3단계 전체(목록→본문→finalize), 이어받기
 *   npm run collect:tribunal -- --list-only  → 1단계 목록만 수집(연결 확인용)
 *   npm run collect:tribunal -- --finalize   → 3단계만(records.jsonl → tribunal_full.json)
 *   npm run collect:tribunal -- --concurrency 5
 *   npm run collect:tribunal -- --max 200    → 테스트용 상한(앞 N건만 본문 수집)
 *   npm run collect:tribunal -- --allow-duplicate-case
 *     → 사건번호 중복 리포트만 남기고 finalize 강행(기본값은 중복 발견 시 중단)
 *
 * ── 증분 수집(--incremental, TAX-6B-34 — 회계사 결정: 수동 실행·매주 1회) ──────
 *   npm run collect:tribunal -- --incremental
 *     → sort=ddes 최신 페이지부터, 원장(list.json)+DB(case_number) 대조로 기지(旣知) 판정.
 *       한 페이지 전체가 기지면 중단(이후는 전부 더 오래된 데이터).
 *     → 신규 건만 scripts/tribunal_incremental_<YYYYMMDD>.json 에 기록.
 *   npm run embed -- --input scripts/tribunal_incremental_<YYYYMMDD>.json  ← 다음 단계(별도 실행)
 *
 * ⚠️ 이 스크립트는 실행 시 실제 외부 API를 호출한다. 착수 승인 전에는 실행하지 말 것.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Pool } from 'pg'
import type { TaxLaw } from '../src/domain/TaxLaw'
import { withRetry } from './embed'

// ─── 경로·상수 ────────────────────────────────────────────────────────────────

const BASE_URL = 'https://www.law.go.kr'
const OUT_DIR = join('scripts', 'tribunal')
const LIST_PATH = join(OUT_DIR, 'list.json')
const RECORDS_PATH = join(OUT_DIR, 'records.jsonl')
const CHECKPOINT_PATH = join(OUT_DIR, 'checkpoint.json')
const DUPLICATE_CASE_REPORT_PATH = join(OUT_DIR, 'duplicate_case_numbers.json')
const FINAL_PATH = join('scripts', 'tribunal_full.json')

/** 목록 1페이지 건수 — API 최대 100 */
const LIST_DISPLAY = 100
/** 본문 동시 조회 수 — 실측상 30까지 throttle 없었으나(§7) 보수적 기본 10 */
const DEFAULT_CONCURRENCY = 10
/** 단건 재시도 횟수(지수 백오프) */
const MAX_RETRY = 4
/** 단건 타임아웃(ms) */
const TIMEOUT_MS = 15000
/** records.jsonl 진행 로그·체크포인트 저장 간격(건) */
const CHECKPOINT_EVERY = 500

// ─── 순수 함수 (단위 테스트 대상 — 파일시스템·네트워크 비의존) ──────────────────
//   ⚠️ 어댑터(nationalTaxLaw.ts)의 동명 함수와 동작이 일치해야 한다(실시간 경로와 같은 데이터 형태).

/** "YYYY.MM.DD" 등 → "YYYY-MM-DD" (어댑터 toIsoDateLoose와 동일) */
export function toIsoDateLoose(raw: string): string {
  if (!raw) return ''
  const digits = raw.replace(/[^0-9]/g, '')
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
  }
  return raw
}

/** 키(OC) 없는 공개 뷰어 링크 생성 (어댑터 toTribunalSourceUrl와 동일, §7) */
export function toTribunalSourceUrl(claimNo: string): string {
  const q = (claimNo ?? '').trim()
  return q ? `${BASE_URL}/allDeccSc.do?query=${encodeURIComponent(q)}` : `${BASE_URL}/allDeccSc.do`
}

/** 로그용: URL에 섞인 OC(키)를 마스킹 (§7) */
export function scrubOc(s: string): string {
  return s.replace(/OC=[^&\s]*/gi, 'OC=***')
}

/** 목록 원본 항목(필요 필드만) */
export interface TribunalListItem {
  seq: string        // 특별행정심판재결례일련번호 — 본문 조회 ID
  caseNumber: string // 청구번호 — 식별자(예: "조심 2020부1558")
  caseName: string   // 사건명
  decidedAt: string  // 의결일자(원본 "YYYY.MM.DD")
  agency: string     // 재결청
}

/** 목록 응답(JSON) → {totalCnt, items}. 래퍼는 `{Decc:{decc:[]|{}}}` */
export function parseListPage(json: unknown): { totalCnt: number; items: TribunalListItem[] } {
  const dc = (json as { Decc?: { totalCnt?: string; decc?: unknown } }).Decc
  if (!dc?.decc) return { totalCnt: Number(dc?.totalCnt ?? 0) || 0, items: [] }
  const raw = Array.isArray(dc.decc) ? dc.decc : [dc.decc]
  const items: TribunalListItem[] = raw.map((d) => {
    const r = d as Record<string, unknown>
    return {
      seq: String(r['특별행정심판재결례일련번호'] ?? '').trim(),
      caseNumber: String(r['청구번호'] ?? '').trim(),
      caseName: String(r['사건명'] ?? '').trim(),
      decidedAt: String(r['의결일자'] ?? '').trim(),
      agency: String(r['재결청'] ?? '').trim(),
    }
  })
  return { totalCnt: Number(dc.totalCnt ?? 0) || 0, items }
}

/**
 * 본문 응답(JSON) → content. 주문+재결요지+이유를 원문 그대로 결합(§6.1, 어댑터 fetchTribunalBody와 동일).
 * 미제공 시 빈 문자열.
 */
export function parseBody(json: unknown): string {
  const s = (json as { SpecialDeccService?: Record<string, unknown> }).SpecialDeccService
  if (!s) return ''
  return [s['주문'], s['재결요지'], s['이유']]
    .filter(Boolean)
    .map((v) => String(v))
    .join('\n')
    .trim()
}

/**
 * 목록 항목 + 본문 → TaxLaw(sourceType='심판례', T3). 어댑터 toTribunalTaxLaw와 동일 매핑.
 * 본문은 §6.1 원문 그대로. sourceUrl은 키 없는 링크.
 */
export function mapTribunalToTaxLaw(item: TribunalListItem, content: string): TaxLaw {
  const caseNo = item.caseNumber
  const issuingBody = item.agency || '조세심판원'
  const decisionDate = toIsoDateLoose(item.decidedAt)
  const lawName = `${issuingBody} ${caseNo}`.trim()
  return {
    sourceType: '심판례',
    lawName,
    articleNumber: '',
    articleTitle: item.caseName,
    content, // ⚠️ §6.1 원문 그대로
    revisionDate: decisionDate, // 정렬·표시 호환(어댑터 buildNonLawTaxLaw와 동일)
    enforcementDate: '',
    sourceUrl: toTribunalSourceUrl(caseNo),
    trustTier: 'T3',
    caseNumber: caseNo,
    issuingBody,
    decisionDate,
  }
}

export interface DuplicateCaseNumber {
  caseNumber: string
  count: number
  titles: string[]
}

/** 심판례 V1 식별자인 caseNumber 중복을 적재 전에 탐지한다. */
export function findDuplicateCaseNumbers(laws: TaxLaw[]): DuplicateCaseNumber[] {
  const grouped = new Map<string, TaxLaw[]>()
  for (const law of laws) {
    const caseNumber = (law.caseNumber ?? '').trim()
    if (!caseNumber) continue
    const existing = grouped.get(caseNumber) ?? []
    existing.push(law)
    grouped.set(caseNumber, existing)
  }

  return [...grouped.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([caseNumber, items]) => ({
      caseNumber,
      count: items.length,
      titles: [...new Set(items.map((item) => item.articleTitle).filter(Boolean))],
    }))
    .sort((a, b) => a.caseNumber.localeCompare(b.caseNumber))
}

/** 증분 수집의 기지(旣知) 판정 재료 — caseNumber(원장+DB)와 seq(원장) 두 축으로 대조 */
export interface KnownSets {
  caseNumbers: ReadonlySet<string>
  seqs: ReadonlySet<string>
}

/**
 * 증분 수집(--incremental): 목록 페이지 항목을 기지/신규로 분리한다 (TAX-6B-34).
 * 신규 0건(페이지 전체 기지)이면 이후 페이지는 전부 더 오래된 데이터이므로 페이징을 중단한다.
 * - seq 누락 항목은 본문 조회가 불가하므로 기지로 취급(수집 대상 아님).
 * - caseNumber 누락 항목은 seq로만 대조(누락을 이유로 놓치지 않음).
 */
export function splitKnownNew(
  items: TribunalListItem[],
  known: KnownSets,
): { fresh: TribunalListItem[]; knownCount: number } {
  const fresh = items.filter(
    (it) =>
      it.seq &&
      !known.seqs.has(it.seq) &&
      !(it.caseNumber && known.caseNumbers.has(it.caseNumber)),
  )
  return { fresh, knownCount: items.length - fresh.length }
}

// ─── I/O 유틸 (네트워크·파일) ──────────────────────────────────────────────────

function getOc(): string {
  const oc = process.env.NATIONAL_TAX_API_KEY
  if (!oc) {
    console.error('[collectTribunal] NATIONAL_TAX_API_KEY 환경변수가 필요합니다.')
    console.error('해결: npm run collect:tribunal 으로 실행하면 --env-file=.env.local 이 키를 주입합니다.')
    process.exit(1)
  }
  return oc
}

function listUrl(oc: string, page: number): string {
  const p = new URLSearchParams({
    OC: oc,
    target: 'ttSpecialDecc',
    type: 'JSON',
    display: String(LIST_DISPLAY),
    page: String(page),
    sort: 'ddes', // 최신순(결정론·증분 수집 호환) — 실측상 정상 동작
  })
  return `${BASE_URL}/DRF/lawSearch.do?${p}`
}

function bodyUrl(oc: string, seq: string): string {
  const p = new URLSearchParams({ OC: oc, target: 'ttSpecialDecc', ID: seq, type: 'JSON' })
  return `${BASE_URL}/DRF/lawService.do?${p}`
}

/** 타임아웃 + 지수 백오프 재시도. 실패 로그의 URL은 OC 마스킹(§7). collectPrecedent.ts에서 재사용. */
export async function fetchJsonWithRetry(url: string): Promise<unknown> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      try {
        const res = await fetch(url, { signal: controller.signal })
        const text = await res.text()
        if (res.status !== 200 || !text.trim().startsWith('{')) {
          throw new Error(`비정상 응답(status=${res.status}, head=${scrubOc(text.slice(0, 80))})`)
        }
        return JSON.parse(text)
      } finally {
        clearTimeout(timer)
      }
    } catch (e) {
      lastErr = e
      if (attempt < MAX_RETRY) {
        const backoff = 500 * 2 ** attempt // 0.5s, 1s, 2s, 4s
        await new Promise((r) => setTimeout(r, backoff))
      }
    }
  }
  throw new Error(`재시도 ${MAX_RETRY}회 초과: ${scrubOc(String(lastErr))}`)
}

/** 동시성 제한 풀 — items를 worker로 limit개씩 병렬 처리. collectPrecedent.ts에서 재사용. */
export async function runPool<T>(items: T[], limit: number, worker: (item: T, idx: number) => Promise<void>): Promise<void> {
  let next = 0
  async function loop(): Promise<void> {
    while (next < items.length) {
      const i = next++
      await worker(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, loop))
}

function ensureOutDir(): void {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
}

// ─── 1단계: 목록 전수 수집 ─────────────────────────────────────────────────────

async function collectList(oc: string): Promise<TribunalListItem[]> {
  // 이미 받아둔 목록이 있으면 재호출 생략(resume)
  if (existsSync(LIST_PATH)) {
    const cached = JSON.parse(readFileSync(LIST_PATH, 'utf-8')) as TribunalListItem[]
    console.log(`[1단계] 목록 캐시 재사용: ${cached.length}건 (${LIST_PATH})`)
    return cached
  }

  // 첫 페이지로 totalCnt 확인 → 페이지 수 계산
  const first = parseListPage(await fetchJsonWithRetry(listUrl(oc, 1)))
  const totalPages = Math.ceil(first.totalCnt / LIST_DISPLAY)
  console.log(`[1단계] 전체 ${first.totalCnt}건 / ${totalPages}페이지 수집 시작`)

  const all: TribunalListItem[] = [...first.items]
  for (let page = 2; page <= totalPages; page++) {
    const { items } = parseListPage(await fetchJsonWithRetry(listUrl(oc, page)))
    all.push(...items)
    if (page % 50 === 0 || page === totalPages) {
      console.log(`  목록 진행 ${page}/${totalPages}페이지 (${all.length}건)`)
    }
  }
  // 일련번호 누락 항목 제외(본문 조회 불가)
  const valid = all.filter((it) => it.seq)
  writeFileSync(LIST_PATH, JSON.stringify(valid, null, 2) + '\n', 'utf-8')
  console.log(`[1단계] 완료: ${valid.length}건 저장 (${LIST_PATH})`)
  return valid
}

// ─── 2단계: 본문 수집(resume) ──────────────────────────────────────────────────

/** records.jsonl에서 이미 완료된 seq 집합을 복원(재개 안전) */
function loadDoneSeqs(): Set<string> {
  const done = new Set<string>()
  if (!existsSync(RECORDS_PATH)) return done
  const text = readFileSync(RECORDS_PATH, 'utf-8')
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const rec = JSON.parse(t) as { seq?: string }
      if (rec.seq) done.add(rec.seq)
    } catch {
      // 손상된 마지막 줄 등은 무시(다음 실행에서 재수집)
    }
  }
  return done
}

async function collectBodies(oc: string, list: TribunalListItem[], concurrency: number, max: number): Promise<void> {
  ensureOutDir()
  const done = loadDoneSeqs()
  let remaining = list.filter((it) => !done.has(it.seq))
  if (max > 0) remaining = remaining.slice(0, max)

  console.log(
    `[2단계] 본문 수집 — 전체 ${list.length}건 / 완료 ${done.size}건 / 이번 대상 ${remaining.length}건 (동시성 ${concurrency})`,
  )

  let ok = 0
  let empty = 0
  let fail = 0
  let processed = 0
  const startedAt = Date.now()

  await runPool(remaining, concurrency, async (item) => {
    try {
      const content = parseBody(await fetchJsonWithRetry(bodyUrl(oc, item.seq)))
      const law = mapTribunalToTaxLaw(item, content)
      // 한 줄 append(재개 안전). seq를 함께 적어 done-set 복원에 사용.
      appendFileSync(RECORDS_PATH, JSON.stringify({ seq: item.seq, law }) + '\n', 'utf-8')
      if (content) ok++
      else empty++ // 본문 미제공 — 참고 목록 후보로 활용(TAX-015B). 적재는 content 보유분만(embed.ts).
    } catch (e) {
      fail++
      console.error(`  [본문 실패] seq=${item.seq} caseNo=${item.caseNumber}: ${scrubOc(String(e))}`)
    } finally {
      processed++
      if (processed % CHECKPOINT_EVERY === 0) {
        writeCheckpoint(list.length, done.size + processed, { ok, empty, fail })
        const rate = processed / ((Date.now() - startedAt) / 1000)
        console.log(`  진행 ${processed}/${remaining.length} (성공 ${ok}·빈본문 ${empty}·실패 ${fail}, ${rate.toFixed(1)}건/s)`)
      }
    }
  })

  writeCheckpoint(list.length, done.size + processed, { ok, empty, fail })
  console.log(`[2단계] 완료: 성공 ${ok}·빈본문 ${empty}·실패 ${fail} (누적 완료 ${done.size + processed}/${list.length})`)
  if (fail > 0) {
    console.log(`  ⚠️ 실패 ${fail}건 — 재실행하면 미완료 seq만 이어받습니다(records.jsonl 기준).`)
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

// ─── 3단계: finalize (records.jsonl → tribunal_full.json) ──────────────────────

function finalize(allowDuplicateCase = false): void {
  if (!existsSync(RECORDS_PATH)) {
    console.error(`[3단계] records.jsonl 이 없습니다(${RECORDS_PATH}). 먼저 2단계 본문 수집을 실행하세요.`)
    process.exit(1)
  }
  const text = readFileSync(RECORDS_PATH, 'utf-8')
  const laws: TaxLaw[] = []
  const seen = new Set<string>() // seq 중복 제거(append 재개 과정의 잠재 중복 방어)
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const rec = JSON.parse(t) as { seq?: string; law?: TaxLaw }
      if (!rec.law || (rec.seq && seen.has(rec.seq))) continue
      if (rec.seq) seen.add(rec.seq)
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
      `[3단계] 사건번호 품질 이슈: 중복 ${duplicates.length}종, 누락 ${missingCaseNumber}건 ` +
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

// ─── 증분 수집 (--incremental, TAX-6B-34) ─────────────────────────────────────

/** 오늘 날짜 스탬프(YYYYMMDD) — 증분 산출물 파일명용 */
function todayStamp(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}${mm}${dd}`
}

/**
 * 주간 증분 수집: 최신순 목록을 원장(list.json)+DB와 대조해 신규 건만 본문 수집.
 *
 * 기지(旣知) 판정을 DB 단독이 아닌 "원장 ∪ DB"로 하는 이유:
 *  content_hash dedup으로 DB에 전용 행이 없는 병합 사건번호 3,981건(TAX-6B-18 §발견)이
 *  DB 대조만으로는 매주 "신규"로 오인돼, 페이지 전체 기지 시 중단하는 조기 종료가
 *  사실상 무력화되기 때문(전 페이지의 94%에 1건 이상 산재). 원장이 이를 흡수하고,
 *  이번 실행의 성공 항목을 원장에 추가해 다음 실행부터 자가 치유된다.
 */
async function collectIncremental(oc: string, concurrency: number, max: number): Promise<void> {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('[collectTribunal] --incremental 은 DATABASE_URL 환경변수가 필요합니다(.env.local).')
    process.exit(1)
  }
  const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

  const ledger: TribunalListItem[] = existsSync(LIST_PATH)
    ? (JSON.parse(readFileSync(LIST_PATH, 'utf-8')) as TribunalListItem[])
    : []
  const knownCaseNumbers = new Set<string>()
  const knownSeqs = new Set<string>()
  for (const it of ledger) {
    if (it.caseNumber) knownCaseNumbers.add(it.caseNumber)
    if (it.seq) knownSeqs.add(it.seq)
  }
  console.log(`[증분] 원장 ${ledger.length}건 로드 (${LIST_PATH})`)

  // 1) 최신순(sort=ddes) 페이징 — 한 페이지 전체가 기지면 중단
  const fresh: TribunalListItem[] = []
  let page = 1
  let totalPages = Number.POSITIVE_INFINITY
  while (page <= totalPages) {
    const parsed = parseListPage(await fetchJsonWithRetry(listUrl(oc, page)))
    if (!Number.isFinite(totalPages)) {
      totalPages = Math.max(1, Math.ceil(parsed.totalCnt / LIST_DISPLAY))
    }

    // 원장에 없는 caseNumber만 DB(진실 소스)로 2차 대조 — 페이지 단위 ANY 질의
    const toCheck = parsed.items
      .map((it) => it.caseNumber)
      .filter((cn) => cn && !knownCaseNumbers.has(cn))
    if (toCheck.length > 0) {
      const { rows } = await withRetry(() =>
        pool.query<{ case_number: string }>(
          `SELECT case_number FROM taxlaw_embeddings WHERE source_type = '심판례' AND case_number = ANY($1)`,
          [toCheck],
        ),
      )
      for (const r of rows) knownCaseNumbers.add(r.case_number)
    }

    const { fresh: pageFresh, knownCount } = splitKnownNew(parsed.items, {
      caseNumbers: knownCaseNumbers,
      seqs: knownSeqs,
    })
    for (const it of pageFresh) {
      fresh.push(it)
      knownSeqs.add(it.seq) // 페이지 경계 이동으로 인한 중복 수집 방어
    }
    console.log(`[증분] ${page}페이지: 신규 ${pageFresh.length}·기지 ${knownCount} (누적 신규 ${fresh.length})`)
    if (pageFresh.length === 0) break
    if (max > 0 && fresh.length >= max) break
    page++
  }

  if (fresh.length === 0) {
    console.log('[증분] 신규 심판례 없음 — 산출물 없이 종료합니다.')
    await pool.end()
    return
  }

  // 2) 신규 건만 본문 수집
  const target = max > 0 ? fresh.slice(0, max) : fresh
  const laws: TaxLaw[] = []
  const succeeded: TribunalListItem[] = []
  let ok = 0
  let empty = 0
  let fail = 0
  await runPool(target, concurrency, async (item) => {
    try {
      const content = parseBody(await fetchJsonWithRetry(bodyUrl(oc, item.seq)))
      laws.push(mapTribunalToTaxLaw(item, content))
      succeeded.push(item)
      if (content) ok++
      else empty++
    } catch (e) {
      fail++
      console.error(`  [본문 실패] seq=${item.seq} caseNo=${item.caseNumber}: ${scrubOc(String(e))}`)
    }
  })

  // 3) 산출물 기록 (embed.ts 입력 포맷 그대로) — 최신 결정일 우선으로 결정론 정렬
  laws.sort((a, b) => (b.decisionDate ?? '').localeCompare(a.decisionDate ?? '') || (a.caseNumber ?? '').localeCompare(b.caseNumber ?? ''))
  const outPath = join('scripts', `tribunal_incremental_${todayStamp()}.json`)
  writeFileSync(outPath, JSON.stringify(laws, null, 2) + '\n', 'utf-8')

  // 4) 원장 갱신 — 성공 항목만 추가(실패분은 다음 실행에서 자동 재수집).
  //    --max(테스트 상한) 실행은 원장을 갱신하지 않는다 — 산출물을 임베딩하지 않고 버릴 수
  //    있는데 원장에만 기록되면 해당 건이 영구 누락되기 때문.
  if (max === 0) {
    ensureOutDir()
    writeFileSync(LIST_PATH, JSON.stringify([...ledger, ...succeeded], null, 2) + '\n', 'utf-8')
  } else {
    console.log('[증분] --max 테스트 실행 — 원장(list.json)은 갱신하지 않습니다.')
  }

  await pool.end()
  console.log(`[증분] 완료: 신규 ${laws.length}건 → ${outPath} (본문 성공 ${ok}·빈본문 ${empty}·실패 ${fail})`)
  console.log(`다음 단계(별도 실행): npm run embed -- --input ${outPath.replace(/\\/g, '/')}`)
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
  const incremental = process.argv.includes('--incremental')
  const allowDuplicateCase = process.argv.includes('--allow-duplicate-case')
  const concurrency = getNumArg('--concurrency', DEFAULT_CONCURRENCY)
  const max = getNumArg('--max', 0)

  if (incremental) {
    await collectIncremental(getOc(), concurrency, max)
    return
  }

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

  await collectBodies(oc, list, concurrency, max)

  // 모두(또는 --max 없이 전량) 완료되면 finalize 자동 실행
  if (max === 0) {
    finalize(allowDuplicateCase)
  } else {
    console.log('[--max] 일부만 수집했습니다. 전량 완료 후 --finalize 로 tribunal_full.json 을 생성하세요.')
  }
}

// vitest import 시 main() 미실행(순수 함수만 노출) — convertPrecedentMd.ts와 동일 가드
const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  main().catch((e) => {
    console.error(`[collectTribunal] 치명적 오류: ${scrubOc(String(e))}`)
    process.exit(1)
  })
}
