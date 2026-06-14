/**
 * 어댑터 반환 content 전체 출력 + V2 실패 원인 파악
 */
import 'server-only'
import { NationalTaxLawAdapter } from '../../src/adapters/nationalTaxLaw.js'

const adapter = new NationalTaxLawAdapter()
const cases = [
  { keyword: '법인세법', art: '제55조', targetDate: new Date('2025-12-31') },
  { keyword: '소득세법', art: '제55조', targetDate: new Date('2026-06-14') },
  { keyword: '부가가치세법', art: '제61조', targetDate: new Date('2026-06-14') },
  { keyword: '종합부동산세법', art: '제8조', targetDate: new Date('2026-06-14') },
]

for (const c of cases) {
  const r = await adapter.search({ keyword: c.keyword, articleNumberHint: c.art, targetDate: c.targetDate, requestedAt: new Date() })
  const items = r?.items ?? []
  const law = items.find(l => l.sourceType === '법령')
  if (!law) { console.log(`${c.keyword} ${c.art}: 없음\n`); continue }

  const content = law.content || ''
  const imgCount = (content.match(/<img/g) || []).length
  const hasPercent = content.includes('%') || content.includes('퍼센트')
  const hasNumbers = /\d{1,3}(,\d{3})*/.test(content)

  console.log(`${c.keyword} ${c.art}:`)
  console.log(`  content 길이=${content.length}자  img태그수=${imgCount}  %포함=${hasPercent}  숫자포함=${hasNumbers}`)
  console.log(`  content 전체:`)
  console.log(content.replace(/\n{3,}/g, '\n\n'))
  console.log('\n' + '='.repeat(80))
}
