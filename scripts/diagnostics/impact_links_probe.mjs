/**
 * 조문 연계(impact_map) 데이터 가용성 진단 — 추측 금지 스파이크
 *
 * 목적: impact_map("조문 한 줄의 파급효과 그래프")을 우리 시스템에 붙일 때
 *   "화살표(조문↔판례·해석례·법령의 인용/참조 관계)"를 키워드 추정이나 LLM 추론이
 *   아니라 **API가 제공하는 실제 연계 데이터**로 그릴 수 있는지를 실측한다.
 *
 *   확인 3가지:
 *   [그룹1] 법령 본문(target=law)에 '관련판례·관련법령·위임' 등 연계 노드가 있는가
 *   [그룹2] 판례 본문(target=prec, ID)에 '참조조문'이 실제로 오는가 (역방향 화살표의 정답)
 *   [그룹3] 심판례 본문(target=ttSpecialDecc, ID)의 '관련법령' 값 형태 (조문 수준? 법령명 수준?)
 *
 * ⚠️ 읽기 전용 진단 — 런타임 코드(어댑터) 무변경. config(server-only) 비의존. API 키 미출력.
 * 실행: node scripts/diagnostics/impact_links_probe.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// .env.local 직접 로드 (config.ts의 server-only import 회피) — jo_probe.mjs와 동일
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
    return { __raw: text.slice(0, 300) }
  }
}

async function searchLaw(keyword) {
  const p = new URLSearchParams({ OC, target: 'law', type: 'JSON', query: keyword, display: '5', page: '1' })
  const data = await getJson(`${BASE}/DRF/lawSearch.do?${p}`)
  const ls = data.LawSearch
  if (!ls?.law) return []
  return Array.isArray(ls.law) ? ls.law : [ls.law]
}

async function search(target, query) {
  const p = new URLSearchParams({ OC, target, type: 'JSON', query, display: '5', page: '1' })
  return getJson(`${BASE}/DRF/lawSearch.do?${p}`)
}

async function getService(target, id, extra = {}) {
  const p = new URLSearchParams({ OC, target, ID: String(id), type: 'JSON', ...extra })
  return getJson(`${BASE}/DRF/lawService.do?${p}`)
}

async function getLawByMst(mst) {
  const p = new URLSearchParams({ OC, target: 'law', MST: String(mst), type: 'JSON' })
  return getJson(`${BASE}/DRF/lawService.do?${p}`)
}

/** 객체 트리에서 특정 키의 배열을 깊이우선으로 찾는다 (래퍼 키가 target마다 달라 generic 추출) */
function findArray(obj, key) {
  if (!obj || typeof obj !== 'object') return null
  if (obj[key] != null) return Array.isArray(obj[key]) ? obj[key] : [obj[key]]
  for (const v of Object.values(obj)) {
    const found = findArray(v, key)
    if (found) return found
  }
  return null
}

/** 본문 응답의 단일 래퍼(PrecService 등)를 벗겨 실제 필드 객체를 얻는다 */
function unwrap(obj) {
  if (!obj || typeof obj !== 'object') return obj
  const keys = Object.keys(obj)
  if (keys.length === 1) {
    const inner = obj[keys[0]]
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner
  }
  return obj
}

function preview(v, n = 120) {
  if (v == null) return '(null)'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.replace(/\s+/g, ' ').slice(0, n)
}

/** '관련/참조/판례/법령/위임/연계'가 들어간 키를 연계 후보로 강조 */
const LINK_HINT = /관련|참조|판례|위임|연계|준용|상위|하위|개정|소관/
function dumpFieldKeys(objRaw, label) {
  const obj = unwrap(objRaw)
  if (!obj || typeof obj !== 'object') {
    console.log(`  ${label}: (객체 아님) ${preview(objRaw)}`)
    return
  }
  console.log(`  ${label} 키 [${Object.keys(obj).length}개]:`)
  for (const [k, v] of Object.entries(obj)) {
    const hint = LINK_HINT.test(k) ? '  ⬅ 연계후보' : ''
    const type = Array.isArray(v) ? `array[${v.length}]` : typeof v
    console.log(`    · ${k} (${type})${hint}`)
    if (LINK_HINT.test(k)) console.log(`        값: "${preview(v, 200)}"`)
  }
}

// ════════════════════════════════════════════════════════════════════
// [그룹1] 법령 본문에 연계 노드가 있는가 (정방향·역방향 직접 데이터 탐색)
// ════════════════════════════════════════════════════════════════════
async function probeLawLinks(keyword, articleNum) {
  console.log(`\n\n████ [그룹1] 법령 본문 연계 노드 — ${keyword} 제${articleNum}조 ████`)
  const laws = await searchLaw(keyword)
  const chosen = laws.find((l) => l.법령명한글 === keyword) || laws[0]
  if (!chosen) return console.log('  검색 결과 없음, 중단')
  console.log(`선택 법령: ${chosen.법령명한글}  MST=${chosen.법령일련번호}`)

  const full = await getLawByMst(chosen.법령일련번호)
  const law = full?.법령
  if (!law) return console.log('  법령 본문 없음, 중단')

  // (a) 법령 최상위(법령 전체)에 연계 노드가 있는가
  console.log(`\n── (a) 법령 최상위 키 검사`)
  dumpFieldKeys({ 법령: law }, '법령')

  // (b) 조문단위(제N조)에 조문별 연계 노드가 있는가
  const unit = law?.조문?.조문단위
  const arts = unit ? (Array.isArray(unit) ? unit : [unit]) : []
  const art = arts.find((a) => Number(a.조문번호) === articleNum)
  console.log(`\n── (b) 제${articleNum}조 조문단위 키 검사`)
  if (!art) console.log(`  제${articleNum}조 못 찾음 (전체 ${arts.length}개)`)
  else dumpFieldKeys(art, `제${articleNum}조`)
}

// ════════════════════════════════════════════════════════════════════
// [그룹2] 판례 본문에 '참조조문'이 실제로 오는가 (역방향 화살표 정답 데이터)
// ════════════════════════════════════════════════════════════════════
async function probePrecRefs(query) {
  console.log(`\n\n████ [그룹2] 판례 본문 참조조문/참조판례 — 검색어 "${query}" ████`)
  const sr = await search('prec', query)
  const list = findArray(sr, 'prec') || []
  console.log(`판례 검색 ${list.length}건`)
  // 본문(참조조문)은 법원 출처에서만 제공 → 데이터출처명 '대법원' 우선
  const target = list.find((p) => /법원/.test(p.데이터출처명 || p.법원명 || '')) || list[0]
  if (!target) return console.log('  판례 없음, 중단')
  console.log(`대상 판례: ${target.사건번호} ${target.사건명}  출처=${target.데이터출처명}  일련번호=${target.판례일련번호}`)

  const body = await getService('prec', target.판례일련번호)
  console.log(`\n── 판례 본문 전체 키 (참조조문 존재 여부가 핵심)`)
  dumpFieldKeys(body, '판례본문')

  const fields = unwrap(body)
  console.log(`\n  ▶ 참조조문 필드: ${fields?.참조조문 != null ? `있음 → "${preview(fields.참조조문, 300)}"` : '❌ 없음'}`)
  console.log(`  ▶ 참조판례 필드: ${fields?.참조판례 != null ? `있음 → "${preview(fields.참조판례, 200)}"` : '❌ 없음'}`)
}

// ════════════════════════════════════════════════════════════════════
// [그룹3] 심판례 본문 '관련법령' 값 형태 (조문 수준인가 법령명 수준인가)
// ════════════════════════════════════════════════════════════════════
async function probeTribunalRefs(query) {
  console.log(`\n\n████ [그룹3] 심판례 본문 관련법령 — 검색어 "${query}" ████`)
  const sr = await search('ttSpecialDecc', query)
  const list = findArray(sr, 'decc') || []
  console.log(`심판례 검색 ${list.length}건`)
  const target = list[0]
  if (!target) return console.log('  심판례 없음, 중단')
  const id = target.특별행정심판재결례일련번호
  console.log(`대상 심판례: ${target.청구번호} ${target.사건명}  일련번호=${id}`)

  const body = await getService('ttSpecialDecc', id)
  console.log(`\n── 심판례 본문 전체 키`)
  dumpFieldKeys(body, '심판례본문')

  const fields = unwrap(body)
  console.log(`\n  ▶ 관련법령 필드: ${fields?.관련법령 != null ? `있음 → "${preview(fields.관련법령, 400)}"` : '❌ 없음'}`)
}

// ════════════════════════════════════════════════════════════════════
console.log('=== impact_map 연계 데이터 가용성 진단 ===')
console.log('판정 기준: "안전한 화살표" = 키워드 추정/LLM 추론이 아닌 API 제공 실제 참조 데이터')
await probeLawLinks('부가가치세법', 26)
await probePrecRefs('부가가치세 면세')
await probeTribunalRefs('부가가치세 면세')
console.log('\n=== 진단 종료 ===')
