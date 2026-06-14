/**
 * FR-17 부칙·경과조치 프로브 (TAX-6B-1)
 *
 * 목적: 국세법령정보 API(lawService.do, target=law)가 본문 응답에서
 *       부칙(附則)·경과조치를 어떤 노드·필드명으로 반환하는지 추측 없이 실호출로 확인.
 *
 * 실행: node --env-file=.env.local scripts/diagnostics/probe_addenda.mjs
 */
const BASE_URL = 'https://www.law.go.kr'
const OC = process.env.NATIONAL_TAX_API_KEY
if (!OC) { console.error('NATIONAL_TAX_API_KEY 없음'); process.exit(1) }

// 1) 소득세법 검색 → 법령일련번호(MST) 획득
const searchParams = new URLSearchParams({ OC, target: 'law', type: 'JSON', query: '소득세법', display: '5' })
const sres = await fetch(`${BASE_URL}/DRF/lawSearch.do?${searchParams}`)
const sdata = await sres.json()
const lawNode = sdata?.LawSearch?.law ?? sdata?.law
const laws = Array.isArray(lawNode) ? lawNode : [lawNode].filter(Boolean)
console.log('검색 결과 상위 법령:')
for (const l of laws.slice(0, 5)) {
  console.log(`  - ${l?.['법령명한글'] ?? l?.['법령명']} | MST=${l?.['법령일련번호']} | 구분=${l?.['법령구분명']}`)
}
const mst = laws[0]?.['법령일련번호']
if (!mst) { console.error('MST 추출 실패. 응답 키:', Object.keys(sdata)); process.exit(1) }

// 2) 본문 조회 → 최상위 키 + 부칙 노드 형태 확인
const svcParams = new URLSearchParams({ OC, target: 'law', MST: mst, type: 'JSON' })
const res = await fetch(`${BASE_URL}/DRF/lawService.do?${svcParams}`)
const data = await res.json()
const law = data?.['법령']
console.log('\n법령 본문 응답 최상위 키:', law ? Object.keys(law) : '(법령 노드 없음)')

const buchik = law?.['부칙']
console.log('\n부칙 노드 존재:', buchik != null)
if (buchik) {
  console.log('부칙 키:', Object.keys(buchik))
  const unit = buchik['부칙단위'] ?? buchik
  const units = Array.isArray(unit) ? unit : [unit]
  console.log(`부칙단위 개수: ${units.length}`)
  const first = units[0]
  if (first) {
    console.log('부칙단위[0] 키:', Object.keys(first))
    const dump = JSON.stringify(first, null, 2)
    console.log('부칙단위[0] 내용(앞 1200자):\n' + dump.slice(0, 1200))
  }
}
