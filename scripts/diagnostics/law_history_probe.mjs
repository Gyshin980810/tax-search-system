/**
 * 법령 연혁 API 지원 여부 진단 — TAX-6A-9 선행 필수
 *
 * 목적: 국세법령정보시스템 API(www.law.go.kr/DRF/)가
 *   과거 시행본(개정 전 버전) 조문을 조회하는 방법을 지원하는지 실측한다.
 *
 * 진단 가설 3종:
 *   A. lawSearch(display=20)에서 과거 lsiSeq 다수 반환 → 각 lsiSeq로 연혁 조회
 *   B. efYd 파라미터로 특정 시행일자 기준 법령 조회 가능
 *   C. 현행만 반환 → 대체 설계(스냅샷 적재) 필요
 *
 * 판정 기준 — 법인세법 제55조(세율):
 *   2017년 이전: 10%/20%/22% 3구간
 *   2018년~2020년: 10%/20%/22%/25% 4구간
 *   2021년 이후: 10%/20%/22%/25% (과세표준 기준만 변경)
 *
 * 실행: node scripts/diagnostics/law_history_probe.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function loadDotenv(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const key = m[1]
    if (process.env[key] !== undefined) continue
    let value = m[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

loadDotenv(join(process.cwd(), '.env.local'))
const OC = process.env.NATIONAL_TAX_API_KEY
if (!OC) {
  console.error('[오류] NATIONAL_TAX_API_KEY 없음 — .env.local 확인')
  process.exit(1)
}

const BASE = 'https://www.law.go.kr'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; tax-search-system/1.0; +https://www.law.go.kr)',
  Accept: 'application/json,text/plain,*/*',
}

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { __raw: text.slice(0, 500) }
  }
}

/** 제55조 세율 본문 요약 — 4구간(25%) vs 3구간(22%) 판별 */
function extractArticle55Summary(articles) {
  const art = articles.find((a) => Number(a.조문번호) === 55 && a.조문여부 === '조문')
  if (!art) return '제55조 없음'

  // 항내용에서 세율 텍스트 추출
  const parts = []
  if (art.조문내용) parts.push(String(art.조문내용).slice(0, 60))
  const hangs = art.항 ? (Array.isArray(art.항) ? art.항 : [art.항]) : []
  for (const h of hangs) {
    if (h.항내용) {
      if (typeof h.항내용 === 'string') {
        parts.push(h.항내용.slice(0, 120))
      } else if (Array.isArray(h.항내용)) {
        // 세율표 중첩 배열 — 첫 8줄만
        const flat = h.항내용.flat(5).filter((x) => typeof x === 'string').slice(0, 8)
        parts.push(...flat.map(String))
      }
    }
  }
  const text = parts.join(' / ').slice(0, 300)
  // 세율 구간 판별 힌트
  const has25 = text.includes('25') || text.includes('3,000억')
  return `[${has25 ? '4구간(25% 포함)' : '3구간(22%까지)'}] 시행일자=${art.조문시행일자} | ${text}`
}

// ─── 가설 A: display=20으로 과거 lsiSeq 목록이 반환되는지 ─────────────────

async function probeA_multipleVersions() {
  console.log('\n\n══════ 가설 A: lawSearch display=20으로 다수 버전 반환 여부 ══════')
  console.log('URL: /DRF/lawSearch.do?target=law&query=법인세법&display=20')

  const p = new URLSearchParams({
    OC,
    target: 'law',
    type: 'JSON',
    query: '법인세법',
    display: '20',
    page: '1',
  })
  const data = await getJson(`${BASE}/DRF/lawSearch.do?${p}`)
  const ls = data.LawSearch
  if (!ls) {
    console.log('  응답 구조 이상:', JSON.stringify(data).slice(0, 200))
    return []
  }

  const laws = ls.law ? (Array.isArray(ls.law) ? ls.law : [ls.law]) : []
  console.log(`  totalCnt=${ls.totalCnt}  반환 건수=${laws.length}`)

  for (const l of laws) {
    console.log(
      `  lsiSeq=${l.법령일련번호}  ${l.법령명한글}  공포=${l.공포일자}  시행=${l.시행일자}`
    )
  }

  const corpTax = laws.filter(
    (l) => l.법령명한글 === '법인세법' || l.법령명한글.startsWith('법인세법')
  )
  console.log(`\n  → 법인세법 이름 일치 항목: ${corpTax.length}건`)
  if (corpTax.length > 1) {
    console.log('  ✅ 과거 lsiSeq 포함 가능 — 시행일자별 분리 확인 필요')
  } else {
    console.log('  ❌ 현행 1건만 — 연혁 목록은 lawSearch로 불가')
  }

  return corpTax
}

// ─── 가설 A-2: 법령 고유 MST별로 다른 시행일자 조문 반환 여부 ──────────────

async function probeA2_fetchLawService(lsiSeq, label) {
  console.log(`\n── lawService.do?MST=${lsiSeq} (${label}) ──`)
  const p = new URLSearchParams({ OC, target: 'law', MST: lsiSeq, type: 'JSON' })
  const data = await getJson(`${BASE}/DRF/lawService.do?${p}`)
  const law = data?.법령
  if (!law?.기본정보) {
    console.log('  응답 없음 또는 구조 이상')
    return null
  }
  const info = law.기본정보
  console.log(
    `  법령명=${info.법령명_한글}  공포일자=${info.공포일자}  시행일자=${info.시행일자}  lsiSeq=${info.법령ID ?? lsiSeq}`
  )

  const unit = law.조문?.조문단위
  const articles = unit ? (Array.isArray(unit) ? unit : [unit]) : []
  const art55 = extractArticle55Summary(articles.filter((a) => a.조문여부 === '조문'))
  console.log(`  제55조(세율): ${art55}`)
  return { lsiSeq, 시행일자: info.시행일자, 제55조: art55 }
}

// ─── 가설 B: efYd 파라미터로 시행일자 지정 조회 ──────────────────────────────

async function probeB_efYdParam(efYd) {
  console.log(`\n\n══════ 가설 B: lawSearch efYd=${efYd} 파라미터 지원 여부 ══════`)
  // efYd는 효력일자 — 해당 날짜에 시행 중인 법령 조회 (API 문서 미확인, 실측)
  const p = new URLSearchParams({
    OC,
    target: 'law',
    type: 'JSON',
    query: '법인세법',
    display: '5',
    efYd,
  })
  const url = `${BASE}/DRF/lawSearch.do?${p}`
  console.log(`  URL: ${url.replace(OC, '***')}`)
  const data = await getJson(url)
  const ls = data.LawSearch
  if (!ls) {
    console.log('  응답 구조 이상:', JSON.stringify(data).slice(0, 200))
    return
  }
  const laws = ls.law ? (Array.isArray(ls.law) ? ls.law : [ls.law]) : []
  console.log(`  totalCnt=${ls.totalCnt}  반환 건수=${laws.length}`)
  for (const l of laws) {
    console.log(
      `  lsiSeq=${l.법령일련번호}  ${l.법령명한글}  공포=${l.공포일자}  시행=${l.시행일자}`
    )
  }
  return laws
}

// ─── 가설 C: lawService efYd 파라미터로 과거 조문 조회 ────────────────────────

async function probeC_serviceEfYd(lsiSeq, efYd) {
  console.log(`\n\n══════ 가설 C: lawService.do?MST=${lsiSeq}&efYd=${efYd} ══════`)
  const p = new URLSearchParams({ OC, target: 'law', MST: lsiSeq, type: 'JSON', efYd })
  const url = `${BASE}/DRF/lawService.do?${p}`
  console.log(`  URL: ${url.replace(OC, '***')}`)
  const data = await getJson(url)
  const law = data?.법령
  if (!law?.기본정보) {
    console.log('  응답 없음 또는 구조 이상:', JSON.stringify(data).slice(0, 200))
    return
  }
  const info = law.기본정보
  console.log(
    `  법령명=${info.법령명_한글}  공포일자=${info.공포일자}  시행일자=${info.시행일자}`
  )
  const unit = law.조문?.조문단위
  const articles = unit ? (Array.isArray(unit) ? unit : [unit]) : []
  const art55 = extractArticle55Summary(articles.filter((a) => a.조문여부 === '조문'))
  console.log(`  제55조(세율): ${art55}`)
}

// ─── 메인 ────────────────────────────────────────────────────────────────────

console.log('=== TAX-6A-9 법령 연혁 API 진단 ===')
console.log('목표: 법인세법 제55조 2017년 시행본(3구간) 조회 가능 여부 확인')
console.log('기준: 2018-01-01 개정으로 25%(3,000억 초과) 구간 신설')

// 가설 A
const versionsA = await probeA_multipleVersions()

// 가설 A-2: 반환된 lsiSeq 각각에 대해 lawService 호출
if (versionsA.length > 0) {
  console.log('\n\n══════ 가설 A-2: 각 lsiSeq 법령본문 상세 조회 ══════')
  for (const l of versionsA) {
    await probeA2_fetchLawService(l.법령일련번호, `${l.법령명한글} ${l.시행일자}`)
  }
}

// 가설 B: efYd=20171231 파라미터
const lawsB = await probeB_efYdParam('20171231')

// 가설 B-2: efYd=20181231 (2018년 — 개정 후)
await probeB_efYdParam('20181231')

// 가설 C: 현행 lsiSeq + efYd 조합 (만약 lawSearch에서 lsiSeq를 얻었다면)
if (versionsA.length > 0) {
  const currentLsiSeq = versionsA[0].법령일련번호
  await probeC_serviceEfYd(currentLsiSeq, '20171231')
  await probeC_serviceEfYd(currentLsiSeq, '20181231')
}

// 가설 B에서 얻은 과거 lsiSeq가 있다면 추가 조회
if (lawsB && lawsB.length > 0) {
  const old = lawsB.find((l) => l.법령명한글.includes('법인세법'))
  if (old) {
    console.log('\n\n══════ 가설 B 추가: efYd=20171231 에서 얻은 lsiSeq 상세 조회 ══════')
    await probeA2_fetchLawService(old.법령일련번호, `efYd=20171231 결과`)
  }
}

console.log('\n\n=== 진단 종료 ===')
console.log('결론 판정: 위 결과에서')
console.log('  ✅ 연혁 지원: 2018년 이전 lsiSeq가 별도 존재하며 제55조가 3구간(22%까지) 반환')
console.log('  ❌ 현행 전용: 모든 경로에서 4구간(25% 포함) 현행만 반환')
