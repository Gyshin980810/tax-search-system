/**
 * Phase 6A 골든셋(G-3·G-4) 1차 검수용 배치 실행 스크립트 (임시)
 *
 * 목적:
 *   eval/golden_temporal.json(G-3)·eval/golden_hallucination.json(G-4)의 질문을
 *   실제 RAG 파이프라인(generateAnswer)에 투입하고, 시스템의 실제 응답을
 *   docs/reports/phase6a_review_<set>.json 에 기록한다.
 *
 * 주의:
 *   - 이 스크립트는 expectedStatus를 절대 기록하지 않는다 — 골든셋 정답 확정은
 *     회계사 권한(CLAUDE.md §8.1). 여기서는 시스템 실응답 수집만 수행한다.
 *   - src/ 비즈니스 로직을 import만 하고 수정하지 않는다.
 *   - 어댑터 구성은 app/api/answer/route.ts와 동일(벡터 fallback 포함).
 *
 * 실행:
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/golden/reviewPhase6a.ts temporal
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/golden/reviewPhase6a.ts hallucination
 */

import 'server-only'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { OpenAIQueryRewriterAdapter } from '../../src/adapters/llmQueryRewriter'
import { NationalTaxLawAdapter } from '../../src/adapters/nationalTaxLaw'
import { OpenAIAnswerGeneratorAdapter } from '../../src/adapters/llmAnswerGenerator'
import { OpenAIEmbeddingAdapter } from '../../src/adapters/embedding'
import { PgVectorSearchAdapter } from '../../src/adapters/vectorSearch'
import { LawVerifierAdapter } from '../../src/adapters/lawVerifier'
import { FallbackSearchPort } from '../../src/usecases/searchWithFallback'
import { generateAnswer } from '../../src/usecases/generateAnswer'
import { config } from '../../src/config'
import type { ISearchPort } from '../../src/ports/taxLawSearchPort'
import type { TemporalContext } from '../../src/domain/TemporalContext'

interface SkeletonCase {
  id: string
  description: string
  question: string
  targetDate?: string
  _note?: string
  _hallucinationTrap?: string
}

interface CaseResult {
  id: string
  question: string
  targetDate?: string
  outcome: 'ANSWERED' | 'ERROR'
  errorCode?: string
  errorMessage?: string
  verifyStatus?: string
  summary?: string
  temporalLabel?: string
  citations?: Array<{
    sourceType: string
    lawName: string
    articleNumber?: string
    articleTitle?: string
    caseNumber?: string
    trustTier: string
    label: string
    temporalLabel?: string
    excerpt: string
    revisionDate?: string
    enforcementDate?: string
    sourceUrl?: string
    contentFull?: string
  }>
  referenceCount?: number
  elapsedSec: number
}

function getErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code
    if (typeof code === 'string') return code
  }
  if (err instanceof Error) return err.name
  return String(err)
}

async function main(): Promise<void> {
  const setName = process.argv[2]
  if (setName !== 'temporal' && setName !== 'hallucination') {
    console.error('Usage: ... reviewPhase6a.ts <temporal|hallucination>')
    process.exit(1)
  }

  const fileName = setName === 'temporal' ? 'golden_temporal.json' : 'golden_hallucination.json'
  const goldenPath = join(process.cwd(), 'eval', fileName)
  const goldenSet = JSON.parse(readFileSync(goldenPath, 'utf-8')) as { cases: SkeletonCase[] }

  const outPath = join(process.cwd(), 'docs', 'reports', `phase6a_review_${setName}.json`)
  // 중단 후 재실행 시 이미 수집된 케이스는 건너뛴다
  const results: CaseResult[] = existsSync(outPath)
    ? (JSON.parse(readFileSync(outPath, 'utf-8')) as CaseResult[])
    : []
  const doneIds = new Set(results.map((r) => r.id))

  // 운영 라우트(app/api/answer/route.ts)와 동일한 어댑터 구성
  const rewriter = new OpenAIQueryRewriterAdapter()
  const directPort = new NationalTaxLawAdapter()
  const searchPort: ISearchPort = config.databaseUrl
    ? new FallbackSearchPort(
        directPort,
        new OpenAIEmbeddingAdapter(config.openaiApiKey),
        new PgVectorSearchAdapter(config.databaseUrl),
      )
    : directPort
  const generator = new OpenAIAnswerGeneratorAdapter()
  const verifier = new LawVerifierAdapter()

  console.log(`\nPhase 6A 1차 검수 실행: ${setName} (${goldenSet.cases.length}건)`)
  console.log('='.repeat(70))

  for (const tc of goldenSet.cases) {
    if (doneIds.has(tc.id)) {
      console.log(`[skip] ${tc.id} — 기존 결과 있음`)
      continue
    }

    const now = new Date()
    const temporal: TemporalContext = tc.targetDate
      ? { requestedAt: now, targetDate: new Date(tc.targetDate), explicit: true }
      : { requestedAt: now, explicit: false }

    const t0 = performance.now()
    let result: CaseResult
    try {
      const r = await generateAnswer(rewriter, searchPort, generator, verifier, tc.question, temporal)
      const elapsed = (performance.now() - t0) / 1000
      result = {
        id: tc.id,
        question: tc.question,
        targetDate: tc.targetDate,
        outcome: 'ANSWERED',
        verifyStatus: r.verificationResult.status,
        summary: r.summary,
        temporalLabel: r.temporalLabel,
        citations: r.citations.map((c) => ({
          sourceType: c.taxLaw.sourceType,
          lawName: c.taxLaw.lawName,
          articleNumber: c.taxLaw.articleNumber,
          articleTitle: c.taxLaw.articleTitle,
          caseNumber: c.taxLaw.caseNumber,
          trustTier: c.taxLaw.trustTier,
          label: c.label,
          temporalLabel: c.temporalLabel,
          excerpt: c.excerpt,
          revisionDate: c.taxLaw.revisionDate,
          enforcementDate: c.taxLaw.enforcementDate,
          sourceUrl: c.taxLaw.sourceUrl,
          contentFull: c.taxLaw.content,
        })),
        referenceCount: r.references?.length ?? 0,
        elapsedSec: Math.round(elapsed * 100) / 100,
      }
      console.log(
        `[${tc.id}] ANSWERED verify=${r.verificationResult.status} citations=${r.citations.length} ` +
          `temporal=${r.temporalLabel ?? '-'} time=${elapsed.toFixed(1)}s`,
      )
    } catch (err) {
      const elapsed = (performance.now() - t0) / 1000
      result = {
        id: tc.id,
        question: tc.question,
        targetDate: tc.targetDate,
        outcome: 'ERROR',
        errorCode: getErrorCode(err),
        errorMessage: err instanceof Error ? err.message : String(err),
        elapsedSec: Math.round(elapsed * 100) / 100,
      }
      console.log(`[${tc.id}] ERROR ${result.errorCode} time=${elapsed.toFixed(1)}s`)
    }

    results.push(result)
    // 케이스마다 즉시 저장 — 중단돼도 수집분 보존
    writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8')
  }

  console.log('='.repeat(70))
  const answered = results.filter((r) => r.outcome === 'ANSWERED').length
  console.log(`완료: ${answered}/${results.length} ANSWERED → ${outPath}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
