/**
 * 골든셋 진행 현황 리포트 (TAX-028)
 *
 * eval/golden_direct.json (확정) + eval/golden_direct.draft.json (초안, 있으면)을 읽어
 *   - 30건 목표 대비 진행률
 *   - PASS/FAIL 분포, 세목별 분포
 *   - 초안/확정, 회계사 summary 작성 대기(__TODO__) 수
 *   - 각 케이스 V1~V6 사전 점검(LawVerifierAdapter.verify 재사용)
 * 을 한 번에 출력한다.
 *
 * lawVerifier는 순수 규칙 기반(외부 호출 없음)이라 환경변수 없이 실행된다.
 * 실행: npm run golden:status
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LawVerifierAdapter } from '../../src/adapters/lawVerifier'
import type { LabeledAnswer } from '../../src/domain/LabeledAnswer'
import type { TaxLaw } from '../../src/domain/TaxLaw'

const TARGET_COUNT = 30
const TODO_FRAGMENT = '__TODO'

interface GoldenCase {
  id: string
  description: string
  question: string
  sourceLaws: TaxLaw[]
  answer: LabeledAnswer
  expectedStatus: 'PASS' | 'FAIL'
}

interface GoldenSet {
  version?: string
  cases?: GoldenCase[]
}

/** 파일을 골든셋으로 로드(없으면 빈 셋) */
function loadSet(path: string): GoldenCase[] {
  if (!existsSync(path)) return []
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as GoldenSet
  return parsed.cases ?? []
}

/** lawName → 세목 분류(집계용). 매칭 안 되면 lawName 그대로 */
function classifyCategory(lawName: string): string {
  const name = lawName ?? ''
  if (name.includes('부가가치세')) return '부가가치세'
  if (name.includes('법인세')) return '법인세'
  if (name.includes('상속세') || name.includes('증여세')) return '상속증여세'
  if (name.includes('종합부동산세')) return '종합부동산세'
  if (name.includes('지방세')) return '지방세'
  if (name.includes('소득세')) return '소득세' // 양도세도 소득세법 → 소득세로 집계
  return name || '(미분류)'
}

/** 케이스가 회계사 검수 대기(초안)인지 — description 또는 summary __TODO__ */
function isDraftCase(c: GoldenCase): boolean {
  return c.description?.includes('[초안') || (c.answer?.summary ?? '').includes(TODO_FRAGMENT)
}

function bar(filled: number, total: number, width = 24): string {
  const n = total > 0 ? Math.round((filled / total) * width) : 0
  return '█'.repeat(Math.min(n, width)) + '░'.repeat(Math.max(width - n, 0))
}

async function main(): Promise<void> {
  const root = process.cwd()
  const mainCases = loadSet(join(root, 'eval', 'golden_direct.json'))
  const draftPath = join(root, 'eval', 'golden_direct.draft.json')
  const draftCases = loadSet(draftPath)
  const hasDraft = existsSync(draftPath)

  // 비법령 draft도 함께 로드(TAX-036 보강): 동일한 V1~V6 적용
  const nonlawDraftPath = join(root, 'eval', 'golden_direct_nonlaw.draft.json')
  const nonlawDraftCases = loadSet(nonlawDraftPath)
  const hasNonlawDraft = existsSync(nonlawDraftPath)

  const allCases = [...mainCases, ...draftCases, ...nonlawDraftCases]

  // ─── 집계 ───
  const confirmed = mainCases.length
  const passCount = allCases.filter((c) => c.expectedStatus === 'PASS').length
  const failCount = allCases.filter((c) => c.expectedStatus === 'FAIL').length
  const todoCount = allCases.filter((c) => (c.answer?.summary ?? '').includes(TODO_FRAGMENT)).length
  const draftCount = allCases.filter(isDraftCase).length

  const byCategory = new Map<string, number>()
  for (const c of allCases) {
    const cat = classifyCategory(c.sourceLaws?.[0]?.lawName ?? '')
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1)
  }

  // ─── 출력: 진행률 ───
  console.log('\n═══ 골든셋 진행 현황 (TAX-028) ═══\n')
  console.log(`확정(golden_direct.json): ${confirmed} / ${TARGET_COUNT}  [${bar(confirmed, TARGET_COUNT)}]`)
  if (hasDraft) {
    console.log(`초안(draft, 검수 대기):   ${draftCases.length}건`)
  }
  if (hasNonlawDraft) {
    console.log(`비법령 초안(별도 draft):  ${nonlawDraftCases.length}건`)
  }
  console.log(`전체(확정+초안):          ${allCases.length}건`)
  console.log(`  · PASS 기대: ${passCount}  ·  FAIL 기대: ${failCount}`)
  console.log(`  · 회계사 summary 작성 대기(__TODO__): ${todoCount}`)
  console.log(`  · 초안 상태(검수 대기): ${draftCount}`)

  // ─── 출력: 세목 분포 ───
  console.log('\n─── 세목 분포 ───')
  for (const [cat, n] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(10)} ${n}건`)
  }

  // ─── 출력: V1~V6 사전 점검 ───
  console.log('\n─── V1~V6 사전 점검 (verify 재사용) ───')
  console.log('  ID            기대   결과   판정 V1 V2 V3 V4 V5 V6  비고')
  const verifier = new LawVerifierAdapter()
  let mismatch = 0
  for (const c of allCases) {
    let line: string
    try {
      const r = await verifier.verify(c.answer, c.sourceLaws)
      const ok = r.status === c.expectedStatus
      if (!ok) mismatch += 1
      const flag = (b: boolean) => (b ? '✔' : '✘')
      const checks = `${flag(r.checks.v1)} ${flag(r.checks.v2)} ${flag(r.checks.v3)} ${flag(r.checks.v4)} ${flag(r.checks.v5)} ${flag(r.checks.v6)}`
      const todo = (c.answer?.summary ?? '').includes(TODO_FRAGMENT) ? ' summary 작성 대기' : ''
      line = `  ${c.id.padEnd(13)} ${c.expectedStatus.padEnd(5)}  ${r.status.padEnd(5)} ${ok ? '✔' : '⚠'} ${checks}${todo}`
    } catch (err) {
      mismatch += 1
      line = `  ${c.id.padEnd(13)} ${c.expectedStatus.padEnd(5)}  ERROR — ${err instanceof Error ? err.message : String(err)}`
    }
    console.log(line)
  }

  // ─── 출력: 종합 ───
  console.log('\n─── 종합 ───')
  const remaining = Math.max(TARGET_COUNT - confirmed, 0)
  console.log(`확정까지 남은 수: ${remaining}건 (목표 ${TARGET_COUNT})`)
  console.log(`사전 점검 불일치(기대≠실제): ${mismatch}건`)
  if (todoCount > 0) console.log(`회계사 작업 필요: summary ${todoCount}건 작성 후 golden_direct.json 머지`)
  console.log('')
}

main().catch((err) => {
  console.error('[실패]', err)
  process.exit(1)
})
