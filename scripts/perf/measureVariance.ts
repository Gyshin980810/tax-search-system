/**
 * LLM citations 변동성 측정 러너 (TAX-042E 보강 H)
 *
 * 목적:
 *   동일 케이스를 5회 반복 호출했을 때 citations 개수가 얼마나 흔들리는지 정량화한다.
 *   computeStats(percentile.ts)를 재사용해 평균·표준편차 산출, korean-law-mcp
 *   risk-rules.ts:333 computeRiskScore 정신을 적응한 4단 등급으로 회계사 결정 부담을 줄인다.
 *
 * 측정 방식:
 *   - 5개 대표 케이스 × 5회 반복 = 25회 batch
 *   - 각 호출은 generateAnswer 전체 파이프라인 (운영 경로 그대로)
 *   - citations 개수만 수집 (시간 측정은 measureP95.ts 담당)
 *   - 케이스별 표준편차 산출 → 전체 평균 표준편차 → 등급 라벨
 *
 * 보호 유지:
 *   src/ 어댑터·usecase·도메인 모두 import만 하고 수정하지 않는다.
 *
 * 실행:
 *   npm run perf:variance
 */

import 'server-only'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

import { OpenAIQueryRewriterAdapter } from '../../src/adapters/llmQueryRewriter'
import { NationalTaxLawAdapter } from '../../src/adapters/nationalTaxLaw'
import { OpenAIAnswerGeneratorAdapter } from '../../src/adapters/llmAnswerGenerator'
import { LawVerifierAdapter } from '../../src/adapters/lawVerifier'
import { generateAnswer } from '../../src/usecases/generateAnswer'

import type { TemporalContext } from '../../src/domain/TemporalContext'
import { AppError, type ErrorCode } from '../../src/domain/errors'

import { computeStats, type Stats } from './percentile'

// ─── 측정 대상 5케이스 (티켓 §3.1 보강 H) ─────────────────────────────
//
// 선정 기준: 골든셋 트랙별 1건씩 + 변동성 큰 후보(법인-06)를 우선 포함
//   - G-1          : 소득세 기본
//   - G-N1         : 비법령 (해석례·심판례 트랙)
//   - G-S-법인-06  : 법인세 — TAX-042B에서 citations 변동성 큰 케이스
//   - G-S-소득-03  : 소득세 추가
//   - G-S-부가-01  : 부가가치세
const TARGET_CASE_IDS = ['G-1', 'G-N1', 'G-S-법인-06', 'G-S-소득-03', 'G-S-부가-01']
const ITERATIONS_PER_CASE = 5

// ─── 등급 라벨 (분석 리포트 §2.3 — risk-rules computeRiskScore 적응) ──
type VarianceGrade = 'stable' | 'acceptable' | 'variable' | 'unstable'
const GRADE_LABELS: Record<VarianceGrade, string> = {
  stable: '🟢 stable (σ ≤ 0.5)',
  acceptable: '🟡 acceptable (0.5 < σ ≤ 1.0)',
  variable: '🟠 variable (1.0 < σ ≤ 2.0)',
  unstable: '🔴 unstable (σ > 2.0)',
}
function gradeOf(stdev: number): VarianceGrade {
  if (stdev <= 0.5) return 'stable'
  if (stdev <= 1.0) return 'acceptable'
  if (stdev <= 2.0) return 'variable'
  return 'unstable'
}

// ─── 골든셋 로더 ─────────────────────────────────────────────────────
interface GoldenCase {
  id: string
  question: string
}
function loadTargetCases(): GoldenCase[] {
  const path = join(process.cwd(), 'eval', 'golden_direct.json')
  const raw = JSON.parse(readFileSync(path, 'utf-8'))
  const all: GoldenCase[] = raw.cases.map((c: { id: string; question: string }) => ({
    id: c.id,
    question: c.question,
  }))
  const found = TARGET_CASE_IDS.map((id) => all.find((c) => c.id === id))
  const missing = TARGET_CASE_IDS.filter((_, i) => !found[i])
  if (missing.length > 0) {
    throw new Error(`[보강 H] 대상 케이스 누락: ${missing.join(', ')}`)
  }
  return found.filter((c): c is GoldenCase => Boolean(c))
}

// ─── 케이스별 측정 결과 ─────────────────────────────────────────────
interface CaseResult {
  caseId: string
  question: string
  citationsPerIter: number[]
  errorsPerIter: Array<ErrorCode | null>
  stats: Stats
  grade: VarianceGrade
  gradeLabel: string
}

async function measureCase(
  c: GoldenCase,
  adapters: ReturnType<typeof makeAdapters>,
): Promise<CaseResult> {
  const citations: number[] = []
  const errors: Array<ErrorCode | null> = []
  const temporal: TemporalContext = { requestedAt: new Date(), explicit: false }

  for (let i = 0; i < ITERATIONS_PER_CASE; i++) {
    try {
      const result = await generateAnswer(
        adapters.rewriter,
        adapters.search,
        adapters.answer,
        adapters.verifier,
        c.question,
        temporal,
      )
      citations.push(result.citations.length)
      errors.push(null)
      process.stdout.write(`  [${c.id} #${i + 1}/${ITERATIONS_PER_CASE}] citations=${result.citations.length}\n`)
    } catch (err) {
      const errorCode: ErrorCode = err instanceof AppError ? err.code : 'INTERNAL_ERROR'
      errors.push(errorCode)
      process.stdout.write(`  [${c.id} #${i + 1}/${ITERATIONS_PER_CASE}] ERROR(${errorCode})\n`)
    }
  }

  // 실패 표본은 통계에서 제외 (citations 변동성만 분석)
  const stats = computeStats(citations)
  return {
    caseId: c.id,
    question: c.question,
    citationsPerIter: citations,
    errorsPerIter: errors,
    stats,
    grade: gradeOf(stats.stdev),
    gradeLabel: GRADE_LABELS[gradeOf(stats.stdev)],
  }
}

function makeAdapters() {
  return {
    rewriter: new OpenAIQueryRewriterAdapter(),
    search: new NationalTaxLawAdapter(),
    answer: new OpenAIAnswerGeneratorAdapter(),
    verifier: new LawVerifierAdapter(),
  }
}

// ─── 메인 ───────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const cases = loadTargetCases()
  const adapters = makeAdapters()

  console.log(`\n[TAX-042E 보강 H] citations 변동성 측정 시작`)
  console.log(`대상 케이스: ${cases.length}건 × ${ITERATIONS_PER_CASE}회 = ${cases.length * ITERATIONS_PER_CASE}회 batch`)
  console.log('-'.repeat(60))

  const results: CaseResult[] = []
  for (const c of cases) {
    console.log(`\n▶ ${c.id} — ${c.question.slice(0, 50)}...`)
    results.push(await measureCase(c, adapters))
  }

  // ─── 케이스별 요약 ────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60))
  console.log('=== 케이스별 변동성 요약 ===')
  const header = ['케이스'.padEnd(14), 'n', '평균', 'σ', 'min', 'max', '등급']
    .map((h, i) => (i === 0 ? h : h.padStart(8)))
    .join(' ')
  console.log(header)
  console.log('-'.repeat(header.length))
  for (const r of results) {
    const row = [
      r.caseId.padEnd(14),
      String(r.stats.n).padStart(8),
      r.stats.mean.toFixed(2).padStart(8),
      r.stats.stdev.toFixed(2).padStart(8),
      String(Math.min(...r.citationsPerIter, Infinity) === Infinity ? '-' : Math.min(...r.citationsPerIter)).padStart(8),
      String(r.stats.max).padStart(8),
      r.gradeLabel.padStart(8),
    ].join(' ')
    console.log(row)
  }
  console.log('-'.repeat(header.length))

  // ─── 전체 평균 표준편차 + 합격 판정 ──────────────────────────────
  const validStdevs = results.filter((r) => r.stats.n > 0).map((r) => r.stats.stdev)
  const avgStdev = validStdevs.length > 0
    ? validStdevs.reduce((s, v) => s + v, 0) / validStdevs.length
    : 0
  const overallGrade = gradeOf(avgStdev)
  const pass = avgStdev <= 1.0 // 합격 조건 12번
  console.log(`\n평균 표준편차: ${avgStdev.toFixed(3)} → ${GRADE_LABELS[overallGrade]}`)
  console.log(
    pass
      ? `✅ PASS — 평균 σ ${avgStdev.toFixed(3)} ≤ 합격선 1.0`
      : `❌ FAIL — 평균 σ ${avgStdev.toFixed(3)} > 합격선 1.0`,
  )

  // ─── JSON 백업 ────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10)
  const backupPath = join(
    process.cwd(),
    'docs',
    'reports',
    `TAX-042E_variance_${today}.json`,
  )
  const backup = {
    ticket: 'TAX-042E',
    augmentation: 'H',
    measuredAt: new Date().toISOString(),
    config: {
      targetCaseIds: TARGET_CASE_IDS,
      iterationsPerCase: ITERATIONS_PER_CASE,
      model: 'gpt-4o-mini',
    },
    summary: {
      avgStdev,
      overallGrade,
      gradeLabel: GRADE_LABELS[overallGrade],
      pass,
      threshold: 1.0,
    },
    results: results.map((r) => ({
      caseId: r.caseId,
      citationsPerIter: r.citationsPerIter,
      errorsPerIter: r.errorsPerIter,
      stats: r.stats,
      grade: r.grade,
    })),
  }
  if (!existsSync(dirname(backupPath))) mkdirSync(dirname(backupPath), { recursive: true })
  writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf-8')
  console.log(`\n결과 백업: ${backupPath}`)

  process.exit(pass ? 0 : 1)
}

main().catch((err) => {
  console.error('\n[TAX-042E 보강 H] 측정 실패:', err)
  process.exit(1)
})
