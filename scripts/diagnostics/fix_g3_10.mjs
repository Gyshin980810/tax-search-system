/**
 * G3-10 단일 케이스 교체 스크립트
 * 소득세법 시행령 제155조(미래 시행 2026-07-01) → 소득세법 제104조(양도소득세율)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function loadDotenv(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const key = m[1]
    if (process.env[key] !== undefined) continue
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1)
    process.env[key] = value
  }
}
loadDotenv(join(process.cwd(), '.env.local'))
const OC = process.env.NATIONAL_TAX_API_KEY
const BASE = 'https://www.law.go.kr'
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; tax-search-system/1.0)', Accept: 'application/json,*/*' }

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return { __raw: text.slice(0, 200) } }
}

function toIsoDate(raw) {
  if (!raw || raw.length !== 8) return raw
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
}

// 소득세법 lsiSeq 조회
const p1 = new URLSearchParams({ OC, target: 'law', type: 'JSON', query: '소득세법', display: '5' })
const d1 = await getJson(`${BASE}/DRF/lawSearch.do?${p1}`)
const laws = d1.LawSearch?.law ? (Array.isArray(d1.LawSearch.law) ? d1.LawSearch.law : [d1.LawSearch.law]) : []
const incTaxLaw = laws.find(l => l.법령명한글 === '소득세법')
if (!incTaxLaw) { console.error('소득세법 미검색'); process.exit(1) }

console.log(`소득세법 lsiSeq=${incTaxLaw.법령일련번호}  시행=${incTaxLaw.시행일자}`)

// 소득세법 제104조 조회
const p2 = new URLSearchParams({ OC, target: 'law', MST: incTaxLaw.법령일련번호, type: 'JSON' })
const d2 = await getJson(`${BASE}/DRF/lawService.do?${p2}`)
const unit = d2?.법령?.조문?.조문단위
const all = unit ? (Array.isArray(unit) ? unit : [unit]) : []
const arts = all.filter(a => a.조문여부 === '조문')

const art104 = arts.find(a => Number(a.조문번호) === 104)
if (!art104) { console.error('제104조 없음'); process.exit(1) }

// 조문 본문 조립
function flattenText(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(flattenText).filter(s => s !== '').join('\n')
  return ''
}
const parts = []
if (art104.조문내용) parts.push(String(art104.조문내용))
const hangs = art104.항 ? (Array.isArray(art104.항) ? art104.항 : [art104.항]) : []
for (const h of hangs) {
  const ht = flattenText(h.항내용)
  if (ht) parts.push(ht)
  const hos = h.호 ? (Array.isArray(h.호) ? h.호 : [h.호]) : []
  for (const ho of hos) {
    const hot = flattenText(ho.호내용)
    if (hot) parts.push(hot)
  }
}
const content = parts.join('\n')
const enfDate = toIsoDate(String(art104.조문시행일자 || incTaxLaw.시행일자))

console.log(`제104조 시행일자=${enfDate}  본문 길이=${content.length}자`)
console.log(`본문 미리보기: ${content.slice(0, 150)}`)

// 오늘(2026-06-14) 이전인지 확인
const today = '2026-06-14'
if (enfDate.replace(/-/g, '') > today.replace(/-/g, '')) {
  console.error(`미래 시행일자(${enfDate}) — 교체 불가`)
  process.exit(1)
}

const targetDate = parseInt(enfDate.slice(0, 4)) < 2026 ? `${enfDate.slice(0, 4)}-12-31` : today
const sourceUrl = `${BASE}/lsInfoP.do?efYd=${art104.조문시행일자 || incTaxLaw.시행일자}&lsiSeq=${incTaxLaw.법령일련번호}`

// golden_temporal.json 갱신
const goldenPath = join(process.cwd(), 'eval', 'golden_temporal.json')
const golden = JSON.parse(readFileSync(goldenPath, 'utf-8'))
const idx = golden.cases.findIndex(c => c.id === 'G3-10')
if (idx < 0) { console.error('G3-10 케이스 없음'); process.exit(1) }

golden.cases[idx] = {
  ...golden.cases[idx],
  description: '양도소득세율 — 현행 기준 (G3-10 교체: 시행령 제155조→소득세법 제104조)',
  question: '현행 소득세법상 양도소득세율(기본세율)은 과세표준 구간별로 어떻게 되나요?',
  targetDate,
  sourceLaws: [{
    sourceType: '법령',
    lawName: '소득세법',
    articleNumber: '제104조',
    articleTitle: (String(art104.조문내용 || '').match(/\(([^)]+)\)/) || ['', ''])[1],
    content,
    revisionDate: enfDate,
    enforcementDate: enfDate,
    sourceUrl,
    trustTier: 'T1',
  }],
  answer: {
    ...golden.cases[idx].answer,
    rawQuestion: '현행 소득세법상 양도소득세율(기본세율)은 과세표준 구간별로 어떻게 되나요?',
    citations: [{
      taxLaw: {
        sourceType: '법령', lawName: '소득세법', articleNumber: '제104조',
        content, revisionDate: enfDate, enforcementDate: enfDate, sourceUrl, trustTier: 'T1',
      },
      label: '🟢직접근거',
      excerpt: '(재실측 후 기재)',
      temporalLabel: `[적용 시점: (재실측 후 기재)]`,
    }],
    summary: '',
    temporalLabel: `[적용 시점: (재실측 후 기재)]`,
  },
  expectedStatus: '',
  _rebuildNote: `TAX-6A-9 방안A 재구성(2026-06-14): G3-10 시행령 제155조(미래 시행 2026-07-01) → 소득세법 제104조(양도소득세율)로 교체`,
  _note: `방안A(TAX-6A-9) 재구성. 현행 소득세법 제104조 시행일자=${enfDate}. 재실측 후 회계사 검수·expectedStatus 확정 필요.`,
}

writeFileSync(goldenPath, JSON.stringify(golden, null, 2) + '\n', 'utf-8')
console.log(`\n✅ G3-10 → 소득세법 제104조(양도소득세율)로 교체 완료`)
console.log(`   targetDate: ${targetDate}`)
