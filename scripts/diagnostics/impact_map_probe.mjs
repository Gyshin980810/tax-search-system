/**
 * impact_map 실현가능성 진단 — 조문 파급효과 그래프 사전 스파이크
 *
 * 목적(추측 금지·실측 먼저 — CLAUDE.md §11):
 *   korean-law-mcp의 impact_map은 역방향("조문→인용 판례")을 "법령명 + 조문번호"
 *   키워드 검색으로 '근사'한다(소스 확인 2026-05-24). 키워드 근사는 우리 정확성
 *   원칙(§2 "틀린 답은 없는 답보다 나쁘다")과 충돌한다.
 *   그래서 우리 API가 "진짜 연계 데이터"를 주는지를 실제 호출로 가린다:
 *     [진단 1] 정방향 — 조문 content(TAX-032로 이미 확보)에서 「OO법」 인용을 정규식으로 뽑을 수 있는가?
 *     [진단 2] 역방향(근사) — "법령명 + 조문번호" 키워드 검색의 결과 품질(건수·관련성)
 *     [진단 3] 역방향(정밀) — 판례 참조판례, 심판례 관련법령 등 API가 주는 명시적 연계 필드 실재 여부
 *
 * 결론 신호: [진단 3]이 풍부하면 '🟢 원문 명시 연계' 기반 그래프 가능,
 *           빈약하면 [진단 1·2] 기반 '🟡/⚪ 추정 연계'만 가능(라벨 강등 필요).
 *
 * ⚠️ 읽기 전용 진단 — 런타임 코드(어댑터) 무변경. config(server-only) 비의존. API 키 미포함.
 * 실행: node scripts/diagnostics/impact_map_probe.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// .env.local 직접 로드 (config.ts의 server-only import 회피) — jo_probe.mjs와 동일 패턴
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

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x])

// ── 조문 content 조립 (어댑터 assembleArticleContent 축약판 — 진단용) ──────────
function flattenText(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(flattenText).filter((s) => s !== '').join('\n')
  return ''
}
function assembleContent(article) {
  const parts = []
  if (typeof article.조문내용 === 'string' && article.조문내용) parts.push(article.조문내용)
  for (const hang of arr(article.항)) {
    const ht = flattenText(hang.항내용)
    if (ht) parts.push(ht)
    for (const ho of arr(hang.호)) {
      const hot = flattenText(ho.호내용)
      if (hot) parts.push(hot)
      for (const mok of arr(ho.목)) {
        const mt = flattenText(mok.목내용)
        if (mt) parts.push(mt)
      }
    }
  }
  return parts.join('\n')
}

// ── 공통 호출 ────────────────────────────────────────────────────────────────
async function searchLaw(keyword) {
  const p = new URLSearchParams({ OC, target: 'law', type: 'JSON', query: keyword, display: '5', page: '1' })
  const data = await getJson(`${BASE}/DRF/lawSearch.do?${p}`)
  return arr(data.LawSearch?.law)
}
async function getLawArticles(mst) {
  const p = new URLSearchParams({ OC, target: 'law', MST: mst, type: 'JSON' })
  const data = await getJson(`${BASE}/DRF/lawService.do?${p}`)
  return arr(data?.법령?.조문?.조문단위).filter((a) => a.조문여부 === '조문')
}

// ════════════════════════════════════════════════════════════════════════════
// [진단 1] 정방향 — 조문 content에서 「OO법」 인용 추출 가능성
//   korean-law-mcp의 extractCitedLaws 정규식을 그대로 적용해 우리 데이터에서 검증한다.
// ════════════════════════════════════════════════════════════════════════════
const CITED_LAW_RE = /「([^」]{2,40}?(?:법|법률|시행령|시행규칙|규칙|규정))」/g

async function diag1(keyword, wantArticleNum) {
  console.log(`\n────────── [진단1·정방향] ${keyword} 제${wantArticleNum}조 인용법령 파싱 ──────────`)
  const laws = await searchLaw(keyword)
  const exact = laws.find((l) => l.법령명한글 === keyword) || laws[0]
  if (!exact) return console.log('  (법령 검색 실패)')
  const arts = await getLawArticles(exact.법령일련번호)
  const target = arts.find((a) => Number(a.조문번호) === wantArticleNum)
  if (!target) return console.log(`  (제${wantArticleNum}조 못 찾음)`)

  const content = assembleContent(target)
  const hits = [...content.matchAll(CITED_LAW_RE)].map((m) => m[1])
  const uniq = [...new Set(hits)]
  console.log(`  content 길이: ${content.length}자`)
  console.log(`  「OO법」 인용 추출: 총 ${hits.length}회 / 고유 ${uniq.length}종`)
  uniq.slice(0, 12).forEach((u) => console.log(`     · ${u}`))
  console.log(`  ▶ 신호: ${uniq.length > 0 ? '✅ 정방향 인용 파싱 가능(원문 명시)' : '⚠️ 이 조문엔 명시 인용 없음'}`)
}

// ════════════════════════════════════════════════════════════════════════════
// [진단 2] 역방향(근사) — "법령명 + 조문번호" 키워드 검색 품질
//   korean-law-mcp 방식. "조문번호 포함" vs "법령명만"의 결과 차이를 본다.
//   ⚠️ 결과 판례가 '진짜 그 조문을 인용'했는지는 이 방식으론 보장 못함(근사임을 실증).
// ════════════════════════════════════════════════════════════════════════════
async function searchTarget(target, wrapperKey, listKey, query, titleKeys) {
  const p = new URLSearchParams({ OC, target, type: 'JSON', query, display: '5', page: '1' })
  const data = await getJson(`${BASE}/DRF/lawSearch.do?${p}`)
  const list = arr(data?.[wrapperKey]?.[listKey])
  return list.map((it) => titleKeys.map((k) => it[k]).find(Boolean) ?? '(제목없음)')
}

async function diag2(lawName, jo) {
  console.log(`\n────────── [진단2·역방향근사] "${lawName} ${jo}" vs "${lawName}" 키워드 검색 ──────────`)
  const sets = [
    ['판례', 'prec', 'PrecSearch', 'prec', ['사건명', '사건번호']],
    ['심판례', 'ttSpecialDecc', 'Decc', 'decc', ['사건명', '청구번호']],
    ['법제처해석', 'expc', 'Expc', 'expc', ['안건명', '안건번호']],
  ]
  for (const [label, target, wk, lk, tk] of sets) {
    const withJo = await searchTarget(target, wk, lk, `${lawName} ${jo}`, tk)
    const lawOnly = await searchTarget(target, wk, lk, lawName, tk)
    console.log(`  [${label}] "${lawName} ${jo}" → ${withJo.length}건 / "${lawName}" → ${lawOnly.length}건`)
    withJo.slice(0, 3).forEach((t) => console.log(`       · ${String(t).slice(0, 60)}`))
  }
  console.log('  ▶ 신호: 조문번호 유무로 결과가 크게 다르지 않으면 = 키워드 근사(연계 보장 아님)')
}

// ════════════════════════════════════════════════════════════════════════════
// [진단 3] 역방향(정밀) — API가 주는 명시적 연계 필드 실재 여부
//   판례 본문(PrecService): 참조판례·참조조문
//   심판례 본문(SpecialDeccService): 관련법령
//   법령해석례 본문(ExpcService): 관련 필드 전수 키 덤프
//   → 값이 채워져 오면 '🟢 원문 명시 연계'로 정확한 그래프 가능.
// ════════════════════════════════════════════════════════════════════════════
async function getBodyKeys(target, wrapperKey, serviceKey, query, idKey) {
  const ps = new URLSearchParams({ OC, target, type: 'JSON', query, display: '3', page: '1' })
  const listData = await getJson(`${BASE}/DRF/lawSearch.do?${ps}`)
  const list = arr(listData?.[wrapperKey === 'Decc' ? 'Decc' : wrapperKey]?.[serviceKey.listKey])
  if (!list.length) return console.log(`  [${target}] 목록 0건 (query=${query})`)

  for (const item of list.slice(0, 2)) {
    const id = item[idKey]
    if (!id) { console.log(`  [${target}] id 필드(${idKey}) 없음 — 키: [${Object.keys(item).join(', ')}]`); continue }
    const pb = new URLSearchParams({ OC, target, ID: String(id), type: 'JSON' })
    const body = await getJson(`${BASE}/DRF/lawService.do?${pb}`)
    const svc = body?.[serviceKey.bodyKey]
    if (!svc) { console.log(`  [${target}] 본문 미제공 (ID=${id})`); continue }
    const keys = Object.keys(svc)
    console.log(`  [${target}] 본문 키: [${keys.join(', ')}]`)
    // 연계 후보 필드만 골라 값 미리보기
    for (const f of ['참조판례', '참조조문', '관련법령', '관계법령', '세목', '판시사항']) {
      if (svc[f] != null && String(svc[f]).trim() !== '') {
        console.log(`       ✅ ${f}: ${String(svc[f]).slice(0, 120).replace(/\n/g, ' ')}`)
      }
    }
  }
}

async function diag3() {
  console.log(`\n────────── [진단3·역방향정밀] API 명시 연계 필드 실재 여부 ──────────`)
  // 판례: 참조판례·참조조문이 본문에 오는지 (법원 출처 판례가 본문 제공)
  await getBodyKeys('prec', 'PrecSearch', { listKey: 'prec', bodyKey: 'PrecService' }, '양도소득세', '판례일련번호')
  // 심판례: 관련법령 필드
  await getBodyKeys('ttSpecialDecc', 'Decc', { listKey: 'decc', bodyKey: 'SpecialDeccService' }, '양도소득세', '특별행정심판재결례일련번호')
  // 법령해석례: 전수 키 덤프(연계 필드 탐색)
  await getBodyKeys('expc', 'Expc', { listKey: 'expc', bodyKey: 'ExpcService' }, '양도소득세', '법령해석례일련번호')
  console.log('  ▶ 신호: ✅ 표시된 연계 필드가 풍부하면 원문 명시 그래프 가능, 없으면 키워드 근사만 가능')
}

// ════════════════════════════════════════════════════════════════════════════
// [진단 4] 심판례 중심 뷰 — "심판례 → 관련 조문" (회계사 제안 방향, 2026-05-24)
//   심판례가 직접 명시한 `관련법령`을 그대로 따라가므로 추정 0 · 전부 원문 명시(🟢).
//   조문 중심(역방향)과 달리 키워드 근사·검증 필터가 필요 없다(심판례가 명단을 직접 가짐).
// ════════════════════════════════════════════════════════════════════════════
async function diag4(keyword) {
  console.log(`\n────────── [진단4·심판례중심] "${keyword}" 심판례 → 관련조문 ──────────`)
  const ps = new URLSearchParams({ OC, target: 'ttSpecialDecc', type: 'JSON', query: keyword, display: '3', page: '1' })
  const listData = await getJson(`${BASE}/DRF/lawSearch.do?${ps}`)
  const list = arr(listData?.Decc?.decc)
  for (const item of list.slice(0, 3)) {
    const id = item.특별행정심판재결례일련번호
    const pb = new URLSearchParams({ OC, target: 'ttSpecialDecc', ID: String(id), type: 'JSON' })
    const body = await getJson(`${BASE}/DRF/lawService.do?${pb}`)
    const s = body?.SpecialDeccService
    if (!s) continue
    const claimNo = String(s.청구번호 ?? '').trim()
    const caseName = String(s.사건명 ?? '').trim()
    const related = String(s.관련법령 ?? '').trim()
    const refDecc = String(s.참조결정 ?? '').trim()
    const tax = String(s.세목 ?? '').trim()
    console.log(`\n  ◆ ${claimNo}  (세목: ${tax})`)
    console.log(`    사건명: ${caseName.slice(0, 70)}`)
    console.log(`    관련법령(원문 명시): ${related || '(없음)'}`)
    console.log(`    참조결정: ${refDecc || '(없음)'}`)
    // 관련법령 텍스트에서 「법령명」+뒤따르는 조문 표기를 분해(미리보기용)
    const laws = [...related.matchAll(/「([^」]+)」\s*([^,「]*)/g)].map((m) => `${m[1]} ${m[2]}`.trim())
    console.log(`    └ 심판례 중심 그래프(미리보기):`)
    console.log(`         graph LR`)
    console.log(`           T["⚖️ ${claimNo}"]`)
    laws.forEach((l, i) => console.log(`           T -->|관련법령| L${i}["📖 ${l}"]`))
  }
  console.log('\n  ▶ 신호: 관련법령이 채워진 심판례는 추정 0으로 조문 연결 가능(전부 🟢)')
}

// ════════════════════════════════════════════════════════════════════════════
// [진단 5] 표기 변이 수집 (TAX-033 코딩 전 — 분해 규칙 확정용)
//   여러 세목 심판례에서 `관련법령`·`참조결정`·`청구번호`(목록 vs 본문)의 형식 변이를
//   원문 그대로 수집한다. 복수 조문·항호·구분자·약칭 등을 확인해 파서 규칙을 확정한다.
// ════════════════════════════════════════════════════════════════════════════
async function diag5() {
  console.log(`\n══════════ [진단5·표기변이] 관련법령·참조결정·청구번호 형식 수집 ══════════`)
  const keywords = ['양도소득세', '가지급금', '상속세', '부가가치세', '종합부동산세']
  const relatedSamples = []
  const refSamples = []
  for (const kw of keywords) {
    const ps = new URLSearchParams({ OC, target: 'ttSpecialDecc', type: 'JSON', query: kw, display: '4', page: '1' })
    const listData = await getJson(`${BASE}/DRF/lawSearch.do?${ps}`)
    const list = arr(listData?.Decc?.decc)
    console.log(`\n  ===== 키워드 "${kw}" (${list.length}건) =====`)
    for (const item of list) {
      const listClaim = String(item.청구번호 ?? '').trim()
      const id = item.특별행정심판재결례일련번호
      const pb = new URLSearchParams({ OC, target: 'ttSpecialDecc', ID: String(id), type: 'JSON' })
      const body = await getJson(`${BASE}/DRF/lawService.do?${pb}`)
      const s = body?.SpecialDeccService
      if (!s) { console.log(`   - [본문없음] 목록청구번호=${listClaim}`); continue }
      const bodyClaim = String(s.청구번호 ?? '').trim()
      const related = String(s.관련법령 ?? '').trim()
      const refDecc = String(s.참조결정 ?? '').trim()
      const lawCount = (related.match(/「[^」]+」/g) ?? []).length
      console.log(`   - 청구번호 목록[${listClaim}] 본문[${bodyClaim || '∅빈값'}] ${listClaim && bodyClaim ? (listClaim === bodyClaim ? '일치' : '불일치') : ''}`)
      console.log(`     관련법령(「」 ${lawCount}개): ${related || '(없음)'}`)
      if (refDecc) console.log(`     참조결정: ${refDecc}`)
      if (related) relatedSamples.push(related)
      if (refDecc) refSamples.push(refDecc)
    }
  }
  // 변이 요약
  console.log(`\n  ── 변이 요약 ──`)
  console.log(`  관련법령 샘플 ${relatedSamples.length}건 / 참조결정 샘플 ${refSamples.length}건`)
  console.log(`  관련법령에 항(제N항) 포함 사례: ${relatedSamples.filter((r) => /제\d+항/.test(r)).length}건`)
  console.log(`  관련법령에 호(제N호) 포함 사례: ${relatedSamples.filter((r) => /제\d+호/.test(r)).length}건`)
  console.log(`  관련법령에 「」 복수(2+) 사례: ${relatedSamples.filter((r) => (r.match(/「[^」]+」/g) ?? []).length >= 2).length}건`)
  console.log(`  참조결정에 복수(쉼표/공백 다건) 사례: ${refSamples.filter((r) => /[,，]/.test(r) || r.split(/\s+/).length >= 2).length}건`)
}

// ── 실행 ─────────────────────────────────────────────────────────────────────
console.log('=== impact_map 실현가능성 진단 (사전 스파이크) ===')
// diag1~4는 1차 실현가능성 확인 완료(2026-05-24) — 이번 실행은 분해 규칙 확정용 diag5에 집중.
// await diag1('소득세법', 104)
// await diag1('부가가치세법', 26)
// await diag2('소득세법', '제104조')
// await diag3()
// await diag4('양도소득세')
await diag5()
console.log('\n=== 진단 종료 ===')
