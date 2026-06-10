/**
 * 실제 국세법령정보시스템 API 호출 테스트
 *
 * MSW 모킹 없이 실제 law.go.kr 서버에 요청을 보냅니다.
 * ROADMAP Phase 1 검증 기준 4개를 순서대로 확인합니다.
 *
 * 실행 방법:
 *   node scripts/test-real-api.mjs
 * (.env.local 파일의 NATIONAL_TAX_API_KEY를 직접 읽습니다)
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// ─── .env.local 읽기 ────────────────────────────────────────────────────────

function loadEnvLocal() {
  try {
    const envPath = resolve(process.cwd(), '.env.local')
    const content = readFileSync(envPath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx < 0) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim()
      if (key && val && !process.env[key]) {
        process.env[key] = val
      }
    }
  } catch {
    // .env.local 없으면 기존 환경변수 사용
  }
}

loadEnvLocal()

const API_KEY = process.env.NATIONAL_TAX_API_KEY
const BASE_URL = 'https://www.law.go.kr'
const TIMEOUT_MS = 8000

// ─── 유틸 ────────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m'
const GREEN  = '\x1b[32m'
const RED    = '\x1b[31m'
const YELLOW = '\x1b[33m'
const BOLD   = '\x1b[1m'
const CYAN   = '\x1b[36m'
const GRAY   = '\x1b[90m'

let passCount = 0
let failCount = 0

function pass(label) {
  passCount++
  console.log(`  ${GREEN}✓${RESET} ${label}`)
}

function fail(label, reason) {
  failCount++
  console.log(`  ${RED}✗${RESET} ${label}`)
  if (reason) console.log(`    ${GRAY}→ ${reason}${RESET}`)
}

function section(title) {
  console.log(`\n${BOLD}${CYAN}▶ ${title}${RESET}`)
}

function toIsoDate(raw) {
  if (!raw || raw.length !== 8) return raw
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
}

async function fetchWithTimeout(url) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res
  } finally {
    clearTimeout(id)
  }
}

// ─── 실제 API 호출 ─────────────────────────────────────────────────────────

async function searchLaws(keyword) {
  const params = new URLSearchParams({
    OC: API_KEY,
    target: 'law',
    type: 'JSON',
    query: keyword,
    display: '5',
    page: '1',
  })
  const res = await fetchWithTimeout(`${BASE_URL}/DRF/lawSearch.do?${params}`)
  const data = await res.json()
  const ls = data.LawSearch
  if (ls.resultCode !== '00') throw new Error(`resultCode=${ls.resultCode}`)
  if (!ls.law) return []
  return Array.isArray(ls.law) ? ls.law : [ls.law]
}

async function fetchArticles(lsiSeq) {
  const params = new URLSearchParams({
    OC: API_KEY,
    target: 'law',
    MST: lsiSeq,
    type: 'JSON',
  })
  const res = await fetchWithTimeout(`${BASE_URL}/DRF/lawService.do?${params}`)
  const data = await res.json()
  const law = data.법령
  if (!law?.기본정보) throw new Error('법령 기본정보 없음')
  const raw = law.조문?.조문단위
  if (!raw) return { law, articles: [] }
  const all = Array.isArray(raw) ? raw : [raw]
  return { law, articles: all.filter(a => a.조문여부 === '조문') }
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    const byRev = b.revisionDate.localeCompare(a.revisionDate)
    if (byRev !== 0) return byRev
    const byEnf = b.enforcementDate.localeCompare(a.enforcementDate)
    if (byEnf !== 0) return byEnf
    const numA = parseInt(a.articleNumber.replace(/[^0-9]/g, '') || '0', 10)
    const numB = parseInt(b.articleNumber.replace(/[^0-9]/g, '') || '0', 10)
    return numA - numB
  })
}

async function realSearch(keyword) {
  const laws = await searchLaws(keyword)
  if (laws.length === 0) return []

  const topLaw = laws[0]
  const { law: detail, articles } = await fetchArticles(topLaw.법령일련번호)

  const revisionDate    = toIsoDate(detail.기본정보.공포일자)
  const enforcementDate = toIsoDate(detail.기본정보.시행일자)
  const lawName         = detail.기본정보.법령명_한글

  const items = articles.map(a => {
    const match   = (a.조문내용 ?? '').match(/^(제\d+조(?:의\d+)?)/)
    const number  = match ? match[1] : String(a.조문번호)
    const efYd    = a.조문시행일자 || topLaw.시행일자
    return {
      lawName,
      articleNumber:   number,
      content:         a.조문내용 ?? '',
      revisionDate:    a.조문시행일자 ? toIsoDate(a.조문시행일자) : revisionDate,
      enforcementDate,
      sourceUrl:       `${BASE_URL}/lsInfoP.do?efYd=${efYd}&lsiSeq=${topLaw.법령일련번호}`,
    }
  })
  return sortItems(items)
}

// ─── 검증 함수 ───────────────────────────────────────────────────────────────

function toArticleNum(str) {
  return parseInt(str.replace(/[^0-9]/g, '') || '0', 10)
}

// ─── 메인 실행 ───────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}=== 국세법령정보시스템 실제 API 호출 테스트 ===${RESET}`)
  console.log(`${GRAY}대상: ${BASE_URL}${RESET}`)
  console.log(`${GRAY}타임아웃: ${TIMEOUT_MS}ms${RESET}`)

  // ── 사전 조건: API 키 존재 ────────────────────────────────────────────────
  section('사전 조건 — Fail-fast 환경변수 검증')

  if (!API_KEY) {
    fail('NATIONAL_TAX_API_KEY 환경변수 필수', '키가 없으면 이 아래 테스트 전체를 건너뜁니다')
    console.log(`\n${RED}API 키가 없어 테스트를 중단합니다.${RESET}`)
    console.log('.env.local 파일에 NATIONAL_TAX_API_KEY=<값> 을 추가하세요.\n')
    process.exit(1)
  }
  pass(`NATIONAL_TAX_API_KEY 설정됨 (길이: ${API_KEY.length}자)`)

  // ── 검증 1: 부가가치세 검색 → 10건 이상 ─────────────────────────────────
  section('검증 1 — "부가가치세" 검색 시 10건 이상 결과 반환 (ROADMAP Phase1 기준)')
  console.log(`  ${GRAY}실제 API 호출 중...${RESET}`)

  let items
  const t0 = Date.now()
  try {
    items = await realSearch('부가가치세')
    const elapsed = Date.now() - t0
    console.log(`  ${GRAY}응답 시간: ${elapsed}ms${RESET}`)

    if (items.length >= 10) {
      pass(`검색 결과 ${items.length}건 반환 (≥ 10건 조건 충족)`)
    } else {
      fail(`검색 결과 ${items.length}건 — 10건 미만`, '부가가치세법 조문 수가 예상보다 적음')
    }
  } catch (err) {
    fail('API 호출 실패', err.message)
    console.log(`\n${RED}네트워크 오류로 이후 테스트를 건너뜁니다.${RESET}\n`)
    process.exit(1)
  }

  // ── 검증 2: 필수 필드 모두 포함 ──────────────────────────────────────────
  section('검증 2 — 모든 결과에 필수 필드 포함 (법령명·조문번호·개정일·시행일·원문링크)')

  const missingFields = []
  for (const item of items) {
    if (!item.lawName)         missingFields.push(`lawName 누락 (${item.articleNumber})`)
    if (!item.articleNumber)   missingFields.push(`articleNumber 누락`)
    if (!item.revisionDate)    missingFields.push(`revisionDate 누락 (${item.articleNumber})`)
    if (!item.enforcementDate) missingFields.push(`enforcementDate 누락 (${item.articleNumber})`)
    if (!item.sourceUrl)       missingFields.push(`sourceUrl 누락 (${item.articleNumber})`)
    if (item.sourceUrl && item.sourceUrl.includes('OC=')) {
      missingFields.push(`sourceUrl에 API 키 노출 (${item.articleNumber})`)
    }
  }

  if (missingFields.length === 0) {
    pass(`전체 ${items.length}건 모두 5개 필수 필드 보유, API 키 미노출 확인`)
  } else {
    fail(`필수 필드 문제 ${missingFields.length}건`, missingFields.slice(0, 3).join(' / '))
  }

  // 첫 번째 결과 샘플 출력
  if (items.length > 0) {
    const sample = items[0]
    console.log(`\n  ${GRAY}[첫 번째 결과 샘플]`)
    console.log(`  법령명:    ${sample.lawName}`)
    console.log(`  조문번호:  ${sample.articleNumber}`)
    console.log(`  개정일:    ${sample.revisionDate}`)
    console.log(`  시행일:    ${sample.enforcementDate}`)
    console.log(`  원문링크:  ${sample.sourceUrl}`)
    console.log(`  본문(앞50자): ${sample.content.slice(0, 50)}...${RESET}`)
  }

  // ── 검증 3: 정렬 결정론성 ─────────────────────────────────────────────────
  section('검증 3 — 동일 쿼리 2회 호출 시 동일 순서 반환 (결정론성)')
  console.log(`  ${GRAY}2차 API 호출 중...${RESET}`)

  try {
    const items2 = await realSearch('부가가치세')
    const nums1  = items.map(i => i.articleNumber)
    const nums2  = items2.map(i => i.articleNumber)
    const isSame = JSON.stringify(nums1) === JSON.stringify(nums2)

    if (isSame) {
      pass(`1회차 ${nums1.length}건 = 2회차 ${nums2.length}건, 조문 순서 동일`)
    } else {
      fail('조문 순서가 두 호출 간에 다름', `1회:${nums1.join(',')} vs 2회:${nums2.join(',')}`)
    }
  } catch (err) {
    fail('2차 API 호출 실패', err.message)
  }

  // ── 검증 4: 조문번호 오름차순 정렬 ───────────────────────────────────────
  section('검증 4 — 조문번호 숫자 기준 오름차순 정렬 (SSOT §7.7)')

  const nums = items.map(i => toArticleNum(i.articleNumber)).filter(n => n > 0)
  let sortOk = true
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] < nums[i - 1]) { sortOk = false; break }
  }

  if (sortOk) {
    pass(`조문번호 오름차순 정렬 확인 (${nums.slice(0, 5).join('→')}…)`)
  } else {
    fail('조문번호 정렬 순서 불일치', nums.slice(0, 10).join(','))
  }

  // ── 결과 요약 ─────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}━━━ 결과 요약 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`)
  console.log(`  ${GREEN}통과${RESET}: ${passCount}건  |  ${RED}실패${RESET}: ${failCount}건`)

  if (failCount === 0) {
    console.log(`\n  ${GREEN}${BOLD}✅ 모든 검증 통과 — Phase 1 실제 API 연동 정상${RESET}\n`)
  } else {
    console.log(`\n  ${RED}${BOLD}❌ 일부 검증 실패 — 위 항목을 확인하세요${RESET}\n`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error(`\n${RED}예상치 못한 오류:${RESET}`, err)
  process.exit(1)
})
