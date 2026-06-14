/**
 * 비법령 인용 시 V2 excerpt 빈값 원인 확인
 * 실행: node --env-file=.env.local --conditions=react-server --import tsx scripts/diagnostics/check_nonlaw_content.mjs
 */
import 'server-only'
import { NationalTaxLawAdapter } from '../../src/adapters/nationalTaxLaw.js'

const adapter = new NationalTaxLawAdapter()

// G3-01: 법인세 세율 질의에서 비법령 excerpt 빈값 케이스 직접 조회
// 국세청 재법인22631-1230, 외인1264.37-2245, 서면-2022-국제세원-4574

const queries = [
  { keyword: '법인세 세율', requestedAt: new Date() },
  { keyword: '법인세율', requestedAt: new Date() },
]

for (const q of queries) {
  const r = await adapter.search(q)
  const items = r?.items ?? []
  for (const l of items.slice(0, 10)) {
    if (l.sourceType !== '법령') {
      console.log(`${l.lawName} | tier=${l.trustTier} | content길이=${l.content?.length ?? 0}`)
    }
  }
}
