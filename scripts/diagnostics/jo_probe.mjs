/**
 * JO(조문 코드) 정밀조회 진단 — TAX-032 사전 스파이크
 *
 * 목적: lawService.do에 JO 파라미터(6자리 조문코드)를 주면, 현재 통증(B)인
 *   "조문 본문이 제목만 옴" 문제가 해소되어 항·호 본문이 채워져 오는지를
 *   '추측 없이 실제 호출'로 확인한다 (CLAUDE.md §11).
 *
 * ⚠️ 읽기 전용 진단 — 런타임 코드(어댑터) 무변경. config(server-only) 비의존.
 * 실행: node scripts/diagnostics/jo_probe.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// .env.local 직접 로드 (config.ts의 server-only import 회피)
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

async function getLawService(mst, jo) {
  const params = { OC, target: 'law', MST: mst, type: 'JSON' }
  if (jo) params.JO = jo
  const p = new URLSearchParams(params)
  return getJson(`${BASE}/DRF/lawService.do?${p}`)
}

function articlesOf(data) {
  const unit = data?.법령?.조문?.조문단위
  if (!unit) return []
  return Array.isArray(unit) ? unit : [unit]
}

function contentStr(a) {
  if (!a) return ''
  const c = a.조문내용
  if (typeof c === 'string') return c
  return c == null ? '' : JSON.stringify(c)
}

/** '항' 하위노드 구조를 사람이 읽을 수 있게 덤프 */
function dumpHang(a) {
  if (!a?.항) return '    (항 없음)'
  const hangs = Array.isArray(a.항) ? a.항 : [a.항]
  const lines = [`    항 ${hangs.length}개 — 키: [${Object.keys(hangs[0]).join(', ')}]`]
  hangs.slice(0, 3).forEach((h, i) => {
    const hc = typeof h.항내용 === 'string' ? h.항내용 : JSON.stringify(h.항내용 ?? '')
    const hasHo = h.호 ? `  (호 ${Array.isArray(h.호) ? h.호.length : 1}개)` : ''
    lines.push(`      항[${i}] ${String(hc).slice(0, 90).replace(/\n/g, ' ')}${hasHo}`)
  })
  return lines.join('\n')
}

async function probe(keyword, articleCode, articleLabel) {
  console.log(`\n========== ${keyword} ${articleLabel} (JO=${articleCode}) ==========`)

  // (0) 통증 A 진단: 검색 후보 + 정확매칭 작동 여부
  const laws = await searchLaw(keyword)
  console.log(`검색 후보 ${laws.length}건:`)
  laws.forEach((l, i) =>
    console.log(`  [${i}] ${l.법령명한글}  (${l.법령구분명})  MST=${l.법령일련번호}`),
  )
  const exact = laws.find((l) => l.법령명한글 === keyword)
  const chosen = exact || laws[0]
  if (!chosen) {
    console.log('  → 검색 결과 없음, 중단')
    return
  }
  console.log(
    `→ [0]번째: ${laws[0]?.법령명한글} | 정확매칭: ${exact ? exact.법령명한글 : '(없음)'} | 선택: ${chosen.법령명한글}`,
  )
  if (laws[0] && exact && laws[0].법령명한글 !== exact.법령명한글) {
    console.log(`  ⚠️ 통증A 재현: [0]≠정확매칭 — 현재 어댑터라면 '${laws[0].법령명한글}'를 잘못 가져옴`)
  }
  const mst = chosen.법령일련번호
  const wantNum = parseInt(articleCode.slice(0, 4), 10)

  // (A) JO 없이 전체 조문 묶음에서 해당 조 찾기 (= 현재 어댑터 방식)
  const full = await getLawService(mst)
  const allArts = articlesOf(full).filter((a) => a.조문여부 === '조문')
  const found = allArts.find((a) => Number(a.조문번호) === wantNum)
  const cA = found ? contentStr(found) : '(못 찾음)'
  console.log(`\n[A] JO 없이(전체묶음 ${allArts.length}개 조문) 제${wantNum}조 content: ${cA.length}자`)
  console.log(`    미리보기: ${cA.slice(0, 100).replace(/\n/g, ' ')}`)
  if (found) {
    console.log(`    조문단위 키: [${Object.keys(found).join(', ')}]`)
    console.log(found.항 ? `    ✅ '항' 하위노드 있음(${Array.isArray(found.항) ? found.항.length : 1}개)` : `    ❌ '항' 하위노드 없음`)
    console.log(dumpHang(found))
  }

  // (B) JO 정밀조회
  const one = await getLawService(mst, articleCode)
  const oneArts = articlesOf(one)
  console.log(`\n[B] JO=${articleCode} 정밀조회 → 조문단위 ${oneArts.length}개`)
  if (oneArts.length) {
    const a = oneArts.find((x) => Number(x.조문번호) === wantNum) || oneArts[0]
    const cB = contentStr(a)
    console.log(`    content: ${cB.length}자   조문단위 키: [${Object.keys(a).join(', ')}]`)
    console.log(a.항 ? `    ✅ '항' 하위노드 있음(${Array.isArray(a.항) ? a.항.length : 1}개)` : `    ❌ '항' 하위노드 없음`)
    console.log(dumpHang(a))
    console.log(`    미리보기: ${cB.slice(0, 220).replace(/\n/g, ' ')}`)
    // 결론 신호
    const gain = cB.length - cA.length
    console.log(`\n    ▶ 길이 변화: ${cA.length}자 → ${cB.length}자 (${gain >= 0 ? '+' : ''}${gain})`)
  } else {
    console.log(`    raw 최상위 키: [${Object.keys(one).join(', ')}]`)
    if (one.법령) console.log(`    法令 keys: [${Object.keys(one.법령).join(', ')}]`)
    if (one.__raw) console.log(`    raw: ${one.__raw}`)
  }
}

console.log('=== JO 정밀조회 진단 (TAX-032 스파이크) ===')
await probe('부가가치세법', '002600', '제26조') // 통증B 대표(제목만 25자였던 조문)
await probe('소득세법', '005500', '제55조') // 세율표 조문
await probe('지방세법', '001100', '제11조') // 통증A(지방세법 vs 지방교부세법) 재현
console.log('\n=== 진단 종료 ===')
