/**
 * fetchArticles 직접 호출 — targetDate 필터 통과 여부 확인
 * 실행: node --env-file=.env.local --conditions=react-server --import tsx scripts/diagnostics/debug_fetch.mjs
 */
import 'server-only'
import { NationalTaxLawAdapter } from '../../src/adapters/nationalTaxLaw.js'

const adapter = new NationalTaxLawAdapter()

// fetchArticles는 private이지만 JS에서는 직접 호출 가능
const targetDate = new Date('2025-12-31')

console.log('=== fetchArticles 직접 호출 테스트 ===')
console.log('법인세법 제55조, targetDate=2025-12-31')

// 법인세법 제55조 직접 검색
const result = await adapter.search({
  keyword: '법인세법',
  articleNumberHint: '제55조',
  targetDate,
  requestedAt: new Date(),
})

console.log('\n검색 결과 raw:', JSON.stringify(result).slice(0, 500))
const items = result?.items ?? result?.laws ?? []
console.log(`items: ${items.length}건`)
for (const l of items) {
  console.log(`  ${l.lawName} ${l.articleNumber || ''} | tier=${l.trustTier} | revDate=${l.revisionDate} | enfDate=${l.enforcementDate} | 본문길이=${l.content?.length ?? 0}`)
}

// 추가: targetDate 없이 조회
console.log('\n=== targetDate 없이 조회 (현행) ===')
const result2 = await adapter.search({
  keyword: '법인세법',
  articleNumberHint: '제55조',
  requestedAt: new Date(),
})
console.log('검색 결과 raw:', JSON.stringify(result2).slice(0, 500))
const items2 = result2?.items ?? result2?.laws ?? []
console.log(`items: ${items2.length}건`)
for (const l of items2) {
  console.log(`  ${l.lawName} ${l.articleNumber || ''} | tier=${l.trustTier} | revDate=${l.revisionDate} | enfDate=${l.enforcementDate} | 본문길이=${l.content?.length ?? 0}`)
}
