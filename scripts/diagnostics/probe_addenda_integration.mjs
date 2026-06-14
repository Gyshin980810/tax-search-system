/**
 * FR-17 부칙 통합 프로브 (TAX-6B-1)
 *
 * 목적: 실제 NationalTaxLawAdapter.search()가 부칙을 T2 TaxLaw로 반환하는지 확인.
 *       (1) targetDate 없음 → 최신 부칙 2개  (2) targetDate 지정 → 시점 경계 부칙
 *
 * 실행: node --env-file=.env.local --conditions=react-server --import tsx scripts/diagnostics/probe_addenda_integration.mjs
 */
import 'server-only'
import { NationalTaxLawAdapter } from '../../src/adapters/nationalTaxLaw.ts'

const adapter = new NationalTaxLawAdapter()

async function probe(label, query) {
  const result = await adapter.search(query)
  const items = result?.items ?? []
  const t2 = items.filter((it) => it.trustTier === 'T2')
  console.log(`\n[${label}] 총 ${items.length}건, T2(부칙) ${t2.length}건`)
  for (const it of t2) {
    const head = it.content.split('\n')[0]?.slice(0, 60)
    console.log(`  - ${it.lawName} | ${it.articleNumber} | 공포=${it.revisionDate}`)
    console.log(`      content[0]: ${head}`)
    console.log(`      sourceUrl OC포함=${/OC=/.test(it.sourceUrl)}`)
  }
}

// (1) 현행 — targetDate 없음
await probe('현행 소득세법', { keyword: '소득세법', requestedAt: new Date() })

// (2) 과거 시점 — 2020-01-01 경계
await probe('소득세법 @2020-01-01', {
  keyword: '소득세법',
  requestedAt: new Date(),
  targetDate: new Date('2020-01-01'),
})
