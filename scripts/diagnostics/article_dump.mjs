/**
 * 조문 항·호 구조 정밀 덤프 — TAX-032 구현 1순위(추측 금지) 스파이크
 *
 * 목적: JO 없이 전체 조문 묶음을 받아, 통증 B(content가 제목만) 해소를 위해
 *   조립해야 할 `항`·`호` 하위노드의 "정확한 모양"을 눈으로 확정한다.
 *   특히 소득세 제55조 세율표의 `항내용` 중첩 배열 깊이/요소 타입을
 *   추측 없이 실측한다 (CLAUDE.md §11, TAX-032 §3.3).
 *
 * ⚠️ 읽기 전용 진단 — 런타임 코드(어댑터) 무변경. config(server-only) 비의존.
 * 실행: node scripts/diagnostics/article_dump.mjs
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

async function getLawService(mst) {
  const p = new URLSearchParams({ OC, target: 'law', MST: mst, type: 'JSON' })
  return getJson(`${BASE}/DRF/lawService.do?${p}`)
}

function articlesOf(data) {
  const unit = data?.법령?.조문?.조문단위
  if (!unit) return []
  return Array.isArray(unit) ? unit : [unit]
}

/** 값의 모양을 한 줄 신호로 요약 (타입·배열깊이·길이) */
function shape(v) {
  if (v == null) return 'null'
  if (typeof v === 'string') return `string(${v.length})`
  if (typeof v === 'number') return `number`
  if (Array.isArray(v)) {
    const inner = v.length ? shape(v[0]) : 'empty'
    return `array[${v.length}]<${inner}>`
  }
  if (typeof v === 'object') return `object{${Object.keys(v).join(',')}}`
  return typeof v
}

/** 중첩 값을 들여쓰기하며 원문 텍스트까지 통째로 출력 (평탄화 규칙 확정용) */
function dumpValue(v, indent) {
  const pad = '  '.repeat(indent)
  if (v == null) {
    console.log(`${pad}· (null)`)
    return
  }
  if (typeof v === 'string') {
    console.log(`${pad}· "${v.replace(/\n/g, '\\n')}"`)
    return
  }
  if (typeof v === 'number') {
    console.log(`${pad}· ${v}`)
    return
  }
  if (Array.isArray(v)) {
    console.log(`${pad}[배열 ${v.length}개]`)
    v.forEach((item, i) => {
      console.log(`${pad}  ─ [${i}] ${shape(item)}`)
      dumpValue(item, indent + 2)
    })
    return
  }
  if (typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) {
      console.log(`${pad}{${k}} ${shape(val)}`)
      dumpValue(val, indent + 1)
    }
  }
}

async function probe(keyword, articleNum, label) {
  console.log(`\n\n############ ${keyword} ${label} (제${articleNum}조) ############`)
  const laws = await searchLaw(keyword)
  const exact = laws.find((l) => l.법령명한글 === keyword)
  const chosen = exact || laws[0]
  if (!chosen) {
    console.log('  검색 결과 없음, 중단')
    return
  }
  console.log(`선택 법령: ${chosen.법령명한글}  MST=${chosen.법령일련번호}`)

  const full = await getLawService(chosen.법령일련번호)
  const arts = articlesOf(full).filter((a) => a.조문여부 === '조문')
  const art = arts.find((a) => Number(a.조문번호) === articleNum)
  if (!art) {
    console.log(`  제${articleNum}조 못 찾음 (전체 ${arts.length}개 조문)`)
    return
  }

  console.log(`\n── 조문단위 최상위 키: [${Object.keys(art).join(', ')}]`)
  console.log(`── 조문내용(현재 content로 쓰이는 값): ${shape(art.조문내용)}`)
  console.log(`     "${String(art.조문내용 ?? '').replace(/\n/g, '\\n')}"`)

  if (!art.항) {
    console.log(`\n── '항' 노드 없음 (이 조문은 조문내용만으로 완결)`)
    return
  }
  const hangs = Array.isArray(art.항) ? art.항 : [art.항]
  console.log(`\n── '항' ${hangs.length}개  (각 항 키: [${Object.keys(hangs[0]).join(', ')}])`)

  hangs.forEach((h, i) => {
    console.log(`\n  ▼ 항[${i}]  키:[${Object.keys(h).join(', ')}]`)
    console.log(`     항번호: ${shape(h.항번호)}  → ${JSON.stringify(h.항번호 ?? null)}`)
    console.log(`     항내용: ${shape(h.항내용)}`)
    dumpValue(h.항내용, 4)
    if (h.호) {
      const hos = Array.isArray(h.호) ? h.호 : [h.호]
      console.log(`     호 ${hos.length}개  (각 호 키: [${Object.keys(hos[0]).join(', ')}])`)
      hos.slice(0, 3).forEach((ho, j) => {
        console.log(`       호[${j}] 키:[${Object.keys(ho).join(', ')}] 호번호=${JSON.stringify(ho.호번호 ?? null)} 호내용=${shape(ho.호내용)}`)
        dumpValue(ho.호내용, 5)
        if (ho.목) {
          const moks = Array.isArray(ho.목) ? ho.목 : [ho.목]
          console.log(`         '목' ${moks.length}개  (각 목 키: [${Object.keys(moks[0]).join(', ')}])`)
          moks.forEach((mok, k) => {
            console.log(`           목[${k}] 목내용=${shape(mok.목내용)}`)
            dumpValue(mok.목내용, 7)
          })
        }
      })
      if (hos.length > 3) console.log(`       … (호 ${hos.length - 3}개 생략)`)
    }
  })
}

console.log('=== 조문 항·호 구조 정밀 덤프 (TAX-032 §3.3 구현 1순위) ===')
await probe('부가가치세법', 26, '재화·용역 공급 면세 — 호 다수') // 항내용=문자열 + 호 20개
await probe('소득세법', 55, '세율 — 항내용 중첩 배열(세율표)')      // ⚠️ 핵심 난관
await probe('지방세법', 11, '취득세 세율 — 호 포함')                // 호 8개 + 개정 메타
console.log('\n=== 덤프 종료 ===')
