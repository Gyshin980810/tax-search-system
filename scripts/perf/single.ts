/**
 * 단일 골든셋 케이스 N회 진단 측정 (TAX-042B 임시)
 *
 * 목적:
 *   특정 케이스(예: G-S-법인-06)의 결정적 결함 해소·회귀 영향을 빠르게 검증한다.
 *   measureP95.ts는 100회 가중 순회용이라 단건 진단에 부적합하다.
 *
 * 비즈니스 로직 무변경 보장:
 *   src/ 어댑터·usecase·도메인 모두 import만 하고 수정하지 않는다.
 *
 * 실행:
 *   npm run perf:single -- <caseId> [N=1]
 *   예: npm run perf:single -- G-S-법인-06 3
 *   예: npm run perf:single -- G-1 1
 */

import 'server-only'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { OpenAIQueryRewriterAdapter } from '../../src/adapters/llmQueryRewriter'
import { NationalTaxLawAdapter } from '../../src/adapters/nationalTaxLaw'
import { OpenAIAnswerGeneratorAdapter } from '../../src/adapters/llmAnswerGenerator'
import { LawVerifierAdapter } from '../../src/adapters/lawVerifier'
import { generateAnswer } from '../../src/usecases/generateAnswer'
import type { TemporalContext } from '../../src/domain/TemporalContext'

interface GoldenCase {
  id: string
  question: string
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

async function main(): Promise<void> {
  const caseId = process.argv[2]
  const N = process.argv[3] ? Math.max(1, parseInt(process.argv[3], 10)) : 1

  if (!caseId) {
    console.error('Usage: npm run perf:single -- <caseId> [N=1]')
    console.error('예: npm run perf:single -- G-S-법인-06 3')
    process.exit(1)
  }

  const tc = loadCase(caseId)

  console.log(`\n단건 측정: ${caseId} × ${N}`)
  console.log(`질문: ${tc.question}`)
  console.log('-'.repeat(60))

  const rewriter = new OpenAIQueryRewriterAdapter()
  const search = new NationalTaxLawAdapter()
  const gen = new OpenAIAnswerGeneratorAdapter()
  const verifier = new LawVerifierAdapter()
  const temporal: TemporalContext = { requestedAt: new Date(), explicit: false }

  let passCount = 0
  let failCount = 0
  const citationCounts: number[] = []
  const elapsedMs: number[] = []

  for (let i = 1; i <= N; i++) {
    const t0 = performance.now()
    try {
      const r = await generateAnswer(rewriter, search, gen, verifier, tc.question, temporal)
      const t = performance.now() - t0
      const cnt = r.citations.length
      passCount++
      citationCounts.push(cnt)
      elapsedMs.push(t)
      console.log(
        `[${i}/${N}] ${caseId} PASS citations=${cnt} time=${(t / 1000).toFixed(2)}s verify=${r.verificationResult.status}`,
      )
    } catch (err) {
      const t = performance.now() - t0
      failCount++
      elapsedMs.push(t)
      console.log(`[${i}/${N}] ${caseId} FAIL ${getErrorCode(err)} time=${(t / 1000).toFixed(2)}s`)
      const detail = getErrorDetail(err)
      if (detail) console.log(`         detail: ${detail}`)
    }
  }

  const avgCit = citationCounts.length
    ? (citationCounts.reduce((a, b) => a + b, 0) / citationCounts.length).toFixed(2)
    : 'N/A'
  const avgT = elapsedMs.length
    ? (elapsedMs.reduce((a, b) => a + b, 0) / elapsedMs.length / 1000).toFixed(2)
    : 'N/A'

  console.log('-'.repeat(60))
  console.log(
    `Summary: ${passCount}/${N} PASS, ${failCount} FAIL, avg citations=${avgCit}, avg time=${avgT}s`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
