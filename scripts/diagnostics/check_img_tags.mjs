/**
 * 이미지 태그 조문 확인 — V2 실패 원인 파악
 * 실행: node scripts/diagnostics/check_img_tags.mjs
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

// G-3 케이스 중 이미지 태그가 있는 조문들 확인
const cases = [
  { law: '법인세법', lsiSeq: null, art: 55 },
  { law: '소득세법', lsiSeq: null, art: 55 },
  { law: '부가가치세법', lsiSeq: null, art: 61 },
  { law: '소득세법', lsiSeq: null, art: 104 },
  { law: '소득세법', lsiSeq: null, art: 47 },
  { law: '소득세법', lsiSeq: null, art: 48 },
]

const lawCache = {}
async function getLsiSeq(lawName) {
  if (lawCache[lawName]) return lawCache[lawName]
  const p = new URLSearchParams({ OC, target: 'law', type: 'JSON', query: lawName, display: '5' })
  const d = await getJson(`${BASE}/DRF/lawSearch.do?${p}`)
  const laws = d.LawSearch?.law ? (Array.isArray(d.LawSearch.law) ? d.LawSearch.law : [d.LawSearch.law]) : []
  const exact = laws.find(l => l.법령명한글 === lawName) || laws[0]
  lawCache[lawName] = exact?.법령일련번호 || null
  return lawCache[lawName]
}

function flattenText(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(flattenText).filter(s => s !== '').join('\n')
  return ''
}

for (const c of cases) {
  const lsiSeq = await getLsiSeq(c.law)
  const p = new URLSearchParams({ OC, target: 'law', MST: lsiSeq, type: 'JSON' })
  const d = await getJson(`${BASE}/DRF/lawService.do?${p}`)
  const unit = d?.법령?.조문?.조문단위
  const all = unit ? (Array.isArray(unit) ? unit : [unit]) : []
  const art = all.find(a => a.조문여부 === '조문' && Number(a.조문번호) === c.art)
  if (!art) { console.log(`${c.law} 제${c.art}조: 없음\n`); continue }

  const parts = []
  if (art.조문내용) parts.push(String(art.조문내용))
  const hangs = art.항 ? (Array.isArray(art.항) ? art.항 : [art.항]) : []
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
  const imgCount = (content.match(/<img/g) || []).length
  const hasTable = content.includes('┌') || content.includes('│') || content.includes('─')
  const digits = (content.match(/\d+/g) || []).length

  console.log(`${c.law} 제${c.art}조:`)
  console.log(`  길이=${content.length}자  img태그수=${imgCount}  테이블문자=${hasTable}  숫자토큰수=${digits}`)
  if (imgCount > 0) {
    const imgMatches = content.match(/<img[^>]*>/g) || []
    console.log(`  img태그: ${imgMatches.slice(0, 2).join(' | ')}`)
  }
  // 처음 500자 출력
  console.log(`  본문(처음 300자): ${content.slice(0, 300).replace(/\n/g, '↵')}`)
  console.log()
}
