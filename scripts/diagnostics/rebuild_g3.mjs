/**
 * G-3 골든셋 재구성 스크립트 — 방안 A (TAX-6A-9)
 *
 * 목적: 현행 API가 현행 법령만 반환하므로,
 *   golden_temporal.json의 20건을 현행 조문으로 처리 가능하도록 재설계.
 *
 * 전략:
 *   1. 각 케이스의 targetDate를 해당 조문의 현행 시행일자 이후 날짜로 변경
 *   2. 질문을 현행 시점으로 재작성
 *   3. sourceLaws.content에 실제 API 원문 채우기
 *   4. 처리 불가 케이스(조문없음/미래시행)는 인접 조문으로 교체
 *
 * 실행: node scripts/diagnostics/rebuild_g3.mjs
 *   → eval/golden_temporal.json (draft 갱신)
 *   → docs/reports/TAX-6A-9_g3_rebuild.json (검토용 원시 데이터)
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

// ─── 법령 조문 조회 ────────────────────────────────────────────────────────────

const lsiCache = {}
async function getLsiSeq(lawName) {
  if (lsiCache[lawName]) return lsiCache[lawName]
  const p = new URLSearchParams({ OC, target: 'law', type: 'JSON', query: lawName, display: '5' })
  const d = await getJson(`${BASE}/DRF/lawSearch.do?${p}`)
  const laws = d.LawSearch?.law
    ? Array.isArray(d.LawSearch.law) ? d.LawSearch.law : [d.LawSearch.law]
    : []
  const exact = laws.find(l => l.법령명한글 === lawName) || laws[0]
  lsiCache[lawName] = exact?.법령일련번호 || null
  return lsiCache[lawName]
}

async function fetchArticle(lawName, artLabel) {
  const lsiSeq = await getLsiSeq(lawName)
  if (!lsiSeq) return null
  const p = new URLSearchParams({ OC, target: 'law', MST: lsiSeq, type: 'JSON' })
  const d = await getJson(`${BASE}/DRF/lawService.do?${p}`)
  const info = d?.법령?.기본정보
  const unit = d?.법령?.조문?.조문단위
  const all = unit ? (Array.isArray(unit) ? unit : [unit]) : []
  const arts = all.filter(a => a.조문여부 === '조문')

  // 조문번호 힌트에서 "제N조" 숫자 파싱 — "제13조의2" → 13
  const numMatch = artLabel.match(/제(\d+)조/)
  const targetNum = numMatch ? parseInt(numMatch[1], 10) : null
  // "의N" 접미사 확인 — "제13조의2" → hasOui=true, ouiNum=2
  const ouiMatch = artLabel.match(/의(\d+)/)
  const ouiNum = ouiMatch ? parseInt(ouiMatch[1], 10) : null

  // 조문 찾기: 조문번호(숫자) 일치 + "의N" 접미사 대응
  let found = arts.find(a => {
    if (Number(a.조문번호) !== targetNum) return false
    if (ouiNum === null) return true  // 단순 "제N조" 형태
    // "제N조의M" 형태: 조문내용에서 확인
    const content = String(a.조문내용 || '')
    return content.includes(`조의${ouiNum}`) || content.includes(`의${ouiNum}조`)
  })

  if (!found) {
    // 폴백: 조문번호만으로 재시도 (단순 숫자 일치)
    found = arts.find(a => Number(a.조문번호) === targetNum)
  }

  if (!found) return null

  // 조문 본문 조립 (항·호·목)
  function flattenText(v) {
    if (v == null) return ''
    if (typeof v === 'string') return v
    if (Array.isArray(v)) return v.map(flattenText).filter(s => s !== '').join('\n')
    return ''
  }
  const parts = []
  if (found.조문내용) parts.push(String(found.조문내용))
  const hangs = found.항 ? (Array.isArray(found.항) ? found.항 : [found.항]) : []
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

  return {
    lsiSeq,
    lawName,
    articleNumber: artLabel,
    articleTitle: (String(found.조문내용 || '').match(/\(([^)]+)\)/) || ['', ''])[1],
    content,
    contentPreview: content.slice(0, 200),
    enfDate: toIsoDate(String(found.조문시행일자 || '')),
    lawEnfDate: toIsoDate(String(info?.시행일자 || '')),
    sourceUrl: `${BASE}/lsInfoP.do?efYd=${found.조문시행일자 || info?.시행일자}&lsiSeq=${lsiSeq}`,
  }
}

// ─── 케이스 재정의 설계 ───────────────────────────────────────────────────────

// 각 케이스별 재설계 명세
// replaceLaw/replaceArt: 현행에 없는 케이스를 다른 조문으로 교체
const REDESIGN = [
  { id: 'G3-01', law: '법인세법', art: '제55조',
    newQ: '현행 법인세 세율 구간은 어떻게 되나요? 과세표준별 세율을 알려주세요.',
    desc: '법인세 세율 — 현행 기준' },

  { id: 'G3-02', law: '법인세법', art: '제55조',
    newQ: '현행 법인세에서 과세표준 200억원 초과 법인의 세율은 얼마인가요?',
    desc: '법인세 세율 고구간 — 현행 기준' },

  { id: 'G3-03', law: '소득세법', art: '제55조',
    newQ: '현행 소득세 최고세율은 얼마인가요? 과세표준 구간별 세율을 알려주세요.',
    desc: '소득세 세율 — 현행 기준' },

  { id: 'G3-04', law: '소득세법', art: '제55조',
    newQ: '현행 소득세 과세표준 3억원 초과 구간의 세율은 얼마인가요?',
    desc: '소득세 고구간 세율 — 현행 기준' },

  { id: 'G3-05', law: '소득세법', art: '제47조',
    newQ: '근로소득공제 한도는 현행 기준으로 얼마인가요?',
    desc: '근로소득공제 — 현행 기준' },

  // G3-06: 소득세법 제59조의2 조문없음 → 제59조의4(월세액 세액공제)로 교체
  { id: 'G3-06', law: '소득세법', art: '제59조의4',
    newQ: '현행 월세액 세액공제 요건 및 공제율은 어떻게 되나요?',
    desc: '월세액 세액공제 — 현행 기준 (G3-06 교체: 제59조의2→제59조의4)' },

  { id: 'G3-07', law: '부가가치세법', art: '제61조',
    newQ: '현행 부가가치세 간이과세 적용 기준금액은 얼마인가요?',
    desc: '간이과세 기준금액 — 현행 기준' },

  { id: 'G3-08', law: '부가가치세법', art: '제61조',
    newQ: '현행 부가가치세 간이과세자의 납부의무 면제 기준금액은 얼마인가요?',
    desc: '간이과세 납부의무 면제 — 현행 기준' },

  // G3-09: 소득세법 시행령 제154조 미래(2026-07-01) → 소득세법 제89조로 교체
  { id: 'G3-09', law: '소득세법', art: '제89조',
    newQ: '1세대 1주택 양도소득세 비과세 요건은 현행 기준으로 어떻게 되나요?',
    desc: '1세대 1주택 비과세 — 현행 소득세법 제89조 (G3-09 교체: 시행령→소득세법)' },

  // G3-10: 소득세법 시행령 제154조 미래 → 소득세법 시행령 제155조로 교체 (다주택자 특례)
  { id: 'G3-10', law: '소득세법 시행령', art: '제155조',
    newQ: '2주택자가 1세대 1주택 비과세를 받을 수 있는 예외 요건은 현행 기준으로 어떻게 되나요?',
    desc: '다주택 일시적 2주택 비과세 — 현행 기준 (G3-10 교체: 제154조→제155조)' },

  // G3-11: 소득세법 시행령 제156조의2 없음 → 제88조(양도 정의)로 교체
  { id: 'G3-11', law: '소득세법', art: '제88조',
    newQ: '소득세법상 고가주택의 현행 기준 금액은 얼마인가요? (양도소득 관련)',
    desc: '고가주택 기준 — 현행 소득세법 제88조 (G3-11 교체: 시행령→소득세법)' },

  { id: 'G3-12', law: '종합부동산세법', art: '제8조',
    newQ: '현행 종합부동산세 주택분 기본공제 금액은 얼마인가요? 1세대 1주택자의 경우는요?',
    desc: '종합부동산세 기본공제 — 현행 기준' },

  { id: 'G3-13', law: '종합부동산세법', art: '제9조',
    newQ: '현행 종합부동산세 주택분 세율은 어떻게 되나요?',
    desc: '종합부동산세 세율 — 현행 기준' },

  { id: 'G3-14', law: '종합부동산세법', art: '제8조',
    newQ: '현행 종합부동산세 1세대 1주택자 공제 금액과 일반 공제 금액의 차이는 얼마인가요?',
    desc: '종합부동산세 1주택자 공제 — 현행 기준' },

  { id: 'G3-15', law: '상속세 및 증여세법', art: '제53조',
    newQ: '현행 직계존속으로부터 증여받는 경우 증여재산공제 한도는 얼마인가요?',
    desc: '증여재산공제 직계존속 — 현행 기준' },

  { id: 'G3-16', law: '상속세 및 증여세법', art: '제53조',
    newQ: '현행 배우자로부터 증여받는 경우 증여재산공제 한도는 얼마인가요?',
    desc: '증여재산공제 배우자 — 현행 기준' },

  { id: 'G3-17', law: '소득세법', art: '제55조',
    newQ: '현행 소득세 세율 중 1억원 초과 2억원 이하 구간의 세율은 얼마인가요?',
    desc: '소득세 중간 구간 세율 — 현행 기준' },

  { id: 'G3-18', law: '소득세법', art: '제48조',
    newQ: '현행 퇴직소득공제 계산 방법은 어떻게 되나요? 근속연수공제 기준을 포함해 알려주세요.',
    desc: '퇴직소득공제 — 현행 기준' },

  { id: 'G3-19', law: '지방세법', art: '제11조',
    newQ: '현행 부동산(주택) 취득 시 취득세율은 어떻게 되나요?',
    desc: '주택 취득세율 — 현행 지방세법 기준' },

  { id: 'G3-20', law: '지방세법', art: '제13조의2',
    newQ: '현행 지방세법에서 주택 유상거래 취득 세율 특례(다주택자 중과)는 어떻게 되나요?',
    desc: '다주택자 취득세 중과 — 현행 기준' },
]

// ─── 메인 ────────────────────────────────────────────────────────────────────

const root = process.cwd()
const goldenPath = join(root, 'eval', 'golden_temporal.json')
const rawGolden = JSON.parse(readFileSync(goldenPath, 'utf-8'))

console.log('=== G-3 골든셋 재구성 (방안 A) ===')
console.log(`원본 케이스: ${rawGolden.cases.length}건`)
console.log()

const rebuildData = []
const newCases = []

for (const spec of REDESIGN) {
  const originalCase = rawGolden.cases.find(c => c.id === spec.id)
  if (!originalCase) {
    console.warn(`  [SKIP] ${spec.id} — 원본 케이스 없음`)
    continue
  }

  process.stdout.write(`[${spec.id}] ${spec.law} ${spec.art} 조회 중...`)
  const art = await fetchArticle(spec.law, spec.art)

  if (!art) {
    console.log(` ❌ 조문 없음 — 재정의 불가 (원본 유지)`)
    rebuildData.push({ id: spec.id, status: 'FAIL_NO_ARTICLE', law: spec.law, art: spec.art })
    newCases.push(originalCase)
    continue
  }

  // targetDate: 조문 시행일자를 기준으로 설정
  // enfDate 가 오늘(2026-06-14) 이후라면 → 처리 불가
  const today = '2026-06-14'
  const enfDateComp = art.enfDate.replace(/-/g, '')
  const todayComp = today.replace(/-/g, '')

  if (enfDateComp > todayComp) {
    console.log(` ❌ 미래 시행일자 (${art.enfDate}) — 재정의 불가 (원본 유지)`)
    rebuildData.push({ id: spec.id, status: 'FAIL_FUTURE', law: spec.law, art: spec.art, enfDate: art.enfDate })
    newCases.push(originalCase)
    continue
  }

  // targetDate: 조문 시행일자 이후, 해당 연도 12월 31일 또는 오늘
  const enfYear = art.enfDate.slice(0, 4)
  const targetDate = parseInt(enfYear) < 2026 ? `${enfYear}-12-31` : today

  console.log(` ✅ 시행일자=${art.enfDate} → targetDate=${targetDate}`)

  rebuildData.push({
    id: spec.id,
    status: 'REBUILT',
    law: spec.law,
    art: spec.art,
    enfDate: art.enfDate,
    targetDate,
    newQuestion: spec.newQ,
    contentPreview: art.contentPreview,
  })

  // 케이스 재구성
  const artNum = spec.art
  const artTitle = art.articleTitle
  const sourceUrl = art.sourceUrl

  const newSourceLaw = {
    sourceType: '법령',
    lawName: spec.law,
    articleNumber: artNum,
    articleTitle: artTitle,
    content: art.content,
    revisionDate: art.enfDate,
    enforcementDate: art.enfDate,
    sourceUrl,
    trustTier: 'T1',
  }

  const newCase = {
    ...originalCase,
    description: spec.desc,
    question: spec.newQ,
    targetDate,
    sourceLaws: [newSourceLaw],
    answer: {
      ...originalCase.answer,
      rawQuestion: spec.newQ,
      citations: [{
        taxLaw: newSourceLaw,
        label: '🟢직접근거',
        excerpt: '(재실측 후 기재)',
        temporalLabel: `[적용 시점: (재실측 후 기재)]`,
      }],
      summary: '',
      temporalLabel: `[적용 시점: (재실측 후 기재)]`,
    },
    expectedStatus: '',
    _rebuildNote: `TAX-6A-9 방안A 재구성(2026-06-14): targetDate ${originalCase.targetDate}→${targetDate}, API 연혁 미지원으로 현행 조문 기준 재설계`,
  }
  // _note 업데이트
  newCase._note = `방안A(TAX-6A-9) 재구성. 현행 ${spec.law} ${spec.art} 시행일자=${art.enfDate}. 재실측 후 회계사 검수·expectedStatus 확정 필요.`

  newCases.push(newCase)
}

// ─── golden_temporal.json 갱신 ────────────────────────────────────────────────

const newGolden = {
  ...rawGolden,
  version: '2026-06-14-rebuilt-a',
  description:
    'G-3 시점 검색 골든셋 20건 — 방안A 재구성(2026-06-14, TAX-6A-9). ' +
    'API 연혁 미지원으로 현행 조문 기준 재설계: targetDate를 각 조문의 현행 시행일자 이후로 조정, ' +
    '질문을 현행 기준으로 재작성, sourceLaws.content에 실제 원문 채움. ' +
    '재실측(reviewPhase6a.ts temporal) 후 회계사 검수·expectedStatus 확정 예정. ' +
    '(AI 자동 생성 금지, CLAUDE.md §8.1)',
  _draft: true,
  _hold: {
    reason: 'rebuilt-pending-reverify',
    followupTicket: 'TAX-6A-9',
    decidedAt: '2026-06-14',
  },
  cases: newCases,
}

writeFileSync(goldenPath, JSON.stringify(newGolden, null, 2) + '\n', 'utf-8')
console.log(`\n✅ golden_temporal.json 갱신 완료 (${newCases.length}건)`)

// ─── 검토용 원시 데이터 저장 ─────────────────────────────────────────────────

const reportPath = join(root, 'docs', 'reports', 'TAX-6A-9_g3_rebuild.json')
writeFileSync(reportPath, JSON.stringify({ rebuiltAt: new Date().toISOString(), cases: rebuildData }, null, 2) + '\n', 'utf-8')
console.log(`✅ 재구성 검토 데이터: ${reportPath}`)

// 요약
const rebuilt = rebuildData.filter(r => r.status === 'REBUILT').length
const failed = rebuildData.filter(r => r.status !== 'REBUILT').length
console.log(`\n── 재구성 요약 ──`)
console.log(`REBUILT: ${rebuilt}건  |  FAIL(조문없음/미래): ${failed}건`)
console.log(`\n다음 단계: npm run golden:review-temporal 으로 재실측 후 expectedStatus 확정 (회계사 승인)`)
