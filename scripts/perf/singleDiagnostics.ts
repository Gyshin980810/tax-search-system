/**
 * 단일 골든셋 케이스 N회 진단 측정 + diagnostics 4종 raw 추출 (TAX-042D-3)
 *
 * 목적:
 *   - SYSTEM_PROMPT 강화 + 보강 E·F·G 효과를 단건 표본으로 정량 검증한다.
 *   - LabeledAnswer.diagnostics(verifyMarker·tierMatchGrade·v3Groups)와
 *     verificationResult.checks(V1~V6)를 raw 로그로 보관한다.
 *
 * 비즈니스 로직 무변경 보장:
 *   src/ 어댑터·usecase·도메인 모두 import만 하고 수정하지 않는다.
 *   기존 scripts/perf/single.ts와 독립된 별도 측정 도구로, 측정 일관성을 보장한다.
 *
 * 실행:
 *   npm run perf:single-diagnostics -- <caseId> [N=1]
 *   예: npm run perf:single-diagnostics -- G-S-소득-03 3
 */

import 'server-only'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { OpenAIQueryRewriterAdapter } from '../../src/adapters/llmQueryRewriter'
import { NationalTaxLawAdapter } from '../../src/adapters/nationalTaxLaw'
import { OpenAIAnswerGeneratorAdapter } from '../../src/adapters/llmAnswerGenerator'
import { LawVerifierAdapter } from '../../src/adapters/lawVerifier'
import { generateAnswer } from '../../src/usecases/generateAnswer'
import type { TemporalContext } from '../../src/domain/TemporalContext'
import type { LabeledAnswer } from '../../src/domain/LabeledAnswer'

interface GoldenCase {
  id: string
  question: string
}

/** raw 로그 1회분 — JSON 누적 저장 */
interface RunRecord {
  caseId: string
  question: string
  iteration: number
  startedAt: string
  elapsedMs: number
  outcome: 'PASS' | 'FAIL'
  errorCode?: string
  errorDetail?: string
  citationCount?: number
  verifyStatus?: string
  v1?: boolean
  v2?: boolean
  v3?: boolean
  v4?: boolean
  v5?: boolean
  v6?: boolean
  verifyMarker?: 'VERIFIED' | 'PARTIAL_VERIFIED' | 'LABEL_MISMATCH'
  tierMatchGrade?: 'exact' | 'loose' | 'mismatch'
  v3LabelEnum?: 'pass' | 'fail'
  v3TierMapping?: 'pass' | 'fail'
  v3Deprecation?: 'pass' | 'fail'
}

function loadCase(caseId: string): GoldenCase {
  const path = join(process.cwd(), 'eval', 'golden_direct.json')
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as { cases: GoldenCase[] }
  const found = raw.cases.find((c) => c.id === caseId)
  if (!found) {
    console.error(`case not found: ${caseId}`)
    process.exit(1)
  }
  return found
}

function getErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code
    if (typeof code === 'string') return code
  }
  if (err instanceof Error) return err.name
  return String(err)
}

function getErrorDetail(err: unknown): string {
  if (!(err instanceof Error)) return ''
  const parts: string[] = [err.message]
  const cause = (err as Error & { cause?: unknown }).cause
  if (cause instanceof Error) {
    parts.push(`cause=${cause.name}: ${cause.message}`)
    const inner = (cause as Error & { cause?: unknown }).cause
    if (inner instanceof Error) parts.push(`cause2=${inner.name}: ${inner.message}`)
  } else if (cause !== undefined) {
    parts.push(`cause=${String(cause)}`)
  }
  return parts.join(' | ')
}

/** raw 로그 누적 디렉토리 — docs/reports/_data/TAX-042D/ 자동 생성 */
function rawLogDir(): string {
  const dir = join(process.cwd(), 'docs', 'reports', '_data', 'TAX-042D')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** 안전한 파일명 — 한글·하이픈은 그대로, 공백·콜론·슬래시만 변환 */
function safeName(s: string): string {
  return s.replace(/[\s:/\\]/g, '_')
}

function extractDiagnostics(record: RunRecord, answer: LabeledAnswer): void {
  record.citationCount = answer.citations.length
  record.verifyStatus = answer.verificationResult.status
  const checks = answer.verificationResult.checks
  record.v1 = checks.v1
  record.v2 = checks.v2
  record.v3 = checks.v3
  record.v4 = checks.v4
  record.v5 = checks.v5
  record.v6 = checks.v6
  const d = answer.diagnostics
  if (d) {
    record.verifyMarker = d.verifyMarker
    record.tierMatchGrade = d.tierMatchGrade
    record.v3LabelEnum = d.v3Groups.labelEnum
    record.v3TierMapping = d.v3Groups.tierMapping
    record.v3Deprecation = d.v3Groups.deprecation
  }
}

async function main(): Promise<void> {
  const caseId = process.argv[2]
  const N = process.argv[3] ? Math.max(1, parseInt(process.argv[3], 10)) : 1

  if (!caseId) {
    console.error('Usage: npm run perf:single-diagnostics -- <caseId> [N=1]')
    console.error('예: npm run perf:single-diagnostics -- G-S-소득-03 3')
    process.exit(1)
  }

  const tc = loadCase(caseId)

  console.log(`\n단건 측정 + diagnostics: ${caseId} × ${N}`)
  console.log(`질문: ${tc.question}`)
  console.log('-'.repeat(72))

  const rewriter = new OpenAIQueryRewriterAdapter()
  const search = new NationalTaxLawAdapter()
  const gen = new OpenAIAnswerGeneratorAdapter()
  const verifier = new LawVerifierAdapter()
  const temporal: TemporalContext = { requestedAt: new Date(), explicit: false }

  const records: RunRecord[] = []

  for (let i = 1; i <= N; i++) {
    const startedAt = new Date().toISOString()
    const t0 = performance.now()
    const record: RunRecord = {
      caseId,
      question: tc.question,
      iteration: i,
      startedAt,
      elapsedMs: 0,
      outcome: 'FAIL',
    }
    try {
      const r = await generateAnswer(rewriter, search, gen, verifier, tc.question, temporal)
      const t = performance.now() - t0
      record.elapsedMs = Math.round(t)
      record.outcome = 'PASS'
      extractDiagnostics(record, r)
      const v3Str = record.v3 === undefined ? '-' : record.v3 ? '✓' : '✗'
      console.log(
        `[${i}/${N}] PASS ${(t / 1000).toFixed(2)}s ` +
          `cit=${record.citationCount} verify=${record.verifyStatus} V3=${v3Str} ` +
          `marker=${record.verifyMarker ?? '-'} grade=${record.tierMatchGrade ?? '-'}`,
      )
    } catch (err) {
      const t = performance.now() - t0
      record.elapsedMs = Math.round(t)
      record.outcome = 'FAIL'
      record.errorCode = getErrorCode(err)
      const detail = getErrorDetail(err)
      if (detail) record.errorDetail = detail
      console.log(
        `[${i}/${N}] FAIL ${(t / 1000).toFixed(2)}s code=${record.errorCode}`,
      )
      if (detail) console.log(`         detail: ${detail}`)
    }
    records.push(record)
  }

  console.log('-'.repeat(72))
  const passCount = records.filter((r) => r.outcome === 'PASS').length
  const v3PassCount = records.filter((r) => r.v3 === true).length
  console.log(
    `Summary: PASS ${passCount}/${N}, V3 PASS ${v3PassCount}/${N}, ` +
      `markers=[${records.map((r) => r.verifyMarker ?? '-').join(',')}]`,
  )

  // raw 로그 JSON 저장
  const outFile = join(rawLogDir(), `${safeName(caseId)}_${Date.now()}.json`)
  writeFileSync(outFile, JSON.stringify({ caseId, N, records }, null, 2), 'utf-8')
  console.log(`raw log: ${outFile}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
