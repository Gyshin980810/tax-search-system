/**
 * RAG 5단계 누적 응답시간 P95 측정 러너 (TAX-029)
 *
 * 목적:
 *   PRD §15.2 KPI "응답시간 P95 < 15초 (n=100, RAG 5단계 누적)"의 실측값을 산출하고
 *   Phase 4(TAX-026-B~) 코딩 게이트 해제 판단의 베이스라인을 확보한다.
 *
 * 측정 방식:
 *   - 골든셋(eval/golden_direct.json) 40건을 가중 순회해 총 100회 호출.
 *   - 각 Port를 시간 측정 데코레이터로 감싸 단계별 누적값을 수집(`src/` 무변경).
 *   - performance.now() 기반 ms 단위 측정.
 *   - 단계별·전체 누적 P50/P95/P99/Max/Mean/Stdev 출력 + JSON 백업.
 *
 * 비즈니스 로직 무변경 보장:
 *   src/ 어댑터·usecase·도메인 모두 import만 하고 수정하지 않는다.
 *   측정 hook은 Port 인터페이스 데코레이터 패턴으로만 주입.
 *
 * 실행:
 *   npm run perf:p95
 */

import 'server-only'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { performance } from 'node:perf_hooks'

import { OpenAIQueryRewriterAdapter } from '../../src/adapters/llmQueryRewriter'
import { NationalTaxLawAdapter } from '../../src/adapters/nationalTaxLaw'
import { OpenAIAnswerGeneratorAdapter } from '../../src/adapters/llmAnswerGenerator'
import { LawVerifierAdapter } from '../../src/adapters/lawVerifier'
import { VoyageEmbeddingAdapter } from '../../src/adapters/embedding'
import { PgVectorSearchAdapter } from '../../src/adapters/vectorSearch'
import { generateAnswer } from '../../src/usecases/generateAnswer'
import { AppError, type ErrorCode } from '../../src/domain/errors'
import { config } from '../../src/config'

import type { IQueryRewriterPort } from '../../src/ports/llmQueryRewriterPort'
import type { ISearchPort } from '../../src/ports/taxLawSearchPort'
import type { IAnswerGeneratorPort } from '../../src/ports/llmAnswerGeneratorPort'
import type { ILawVerifierPort } from '../../src/ports/lawVerifierPort'
import type { IEmbeddingPort } from '../../src/ports/embeddingPort'
import type { IVectorSearchPort } from '../../src/ports/vectorSearchPort'
import type { TemporalContext } from '../../src/domain/TemporalContext'
import type { VerificationResult } from '../../src/domain/VerificationResult'

import { printReport } from './percentile'

// ─── 상수 (PRD §15.2 정의) ─────────────────────────────────────────────────

/**
 * 부하 측정 횟수 (PRD §15.2 "부하 100회")
 * 첫 번째 argv 인자로 가변화 — 분석 모드(40회 등)에서 짧게 측정 가능.
 * 사용: `tsx measureP95.ts 40` 또는 `tsx measureP95.ts 40 diagnose`
 */
const ARG_N = process.argv[2] ? Math.max(1, parseInt(process.argv[2], 10)) : null
const ARG_LABEL = process.argv[3] ? `_${process.argv[3]}` : (ARG_N && ARG_N !== 100 ? '_diagnose' : '')
const N_ITERATIONS = ARG_N ?? 100

/** 누적 P95 합격선 — 15초 (PRD §7.1·§15.2) */
const P95_THRESHOLD_MS = 15_000

/** 측정 결과 백업 경로 — 분석 모드면 파일명 분리(기존 baseline 보존) */
const TODAY = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
const BASELINE_PATH = join(
  process.cwd(),
  'docs',
  'reports',
  `TAX-029_p95_baseline_${TODAY}${ARG_LABEL}.json`,
)

// ─── 골든셋 로더 ─────────────────────────────────────────────────────────

interface GoldenCase {
  id: string
  question: string
  expectedStatus: 'PASS' | 'FAIL'
}

function loadGoldenCases(): GoldenCase[] {
  const path = join(process.cwd(), 'eval', 'golden_direct.json')
  const raw = JSON.parse(readFileSync(path, 'utf-8'))
  return raw.cases.map((c: { id: string; question: string; expectedStatus: 'PASS' | 'FAIL' }) => ({
    id: c.id,
    question: c.question,
    expectedStatus: c.expectedStatus,
  }))
}

// ─── 단계별 시간 측정 데코레이터 ─────────────────────────────────────────
//
// 패턴: 실제 Port 구현체를 감싸 호출 전후로 performance.now() 차이를 기록.
// src/ 어댑터·usecase 무수정. 데코레이터는 본 스크립트 안에서만 살아있다.

interface StageBuckets {
  rewrite: number[]
  search: number[]
  answer: number[]
  verify: number[]
  // TAX-6B-14 — 운영 경로와 동일하게 포트를 주입하면 켜지는 부가 비용 단계.
  // embedding: 참고목록 의미 재정렬용 질의/후보 배치 임베딩(TAX-6B-12).
  // precedent: pgvector 판례 코퍼스 라이브 검색(TAX-6B-14). 각 비용을 분리 관측한다.
  embedding: number[]
  precedent: number[]
}

function makeTimedQueryRewriter(
  inner: IQueryRewriterPort,
  buckets: StageBuckets,
): IQueryRewriterPort {
  return {
    async rewrite(question, temporal) {
      const t0 = performance.now()
      try {
        return await inner.rewrite(question, temporal)
      } finally {
        buckets.rewrite.push(performance.now() - t0)
      }
    },
  }
}

function makeTimedSearchPort(inner: ISearchPort, buckets: StageBuckets): ISearchPort {
  return {
    async search(query) {
      const t0 = performance.now()
      try {
        return await inner.search(query)
      } finally {
        buckets.search.push(performance.now() - t0)
      }
    },
  }
}

function makeTimedAnswerGen(
  inner: IAnswerGeneratorPort,
  buckets: StageBuckets,
): IAnswerGeneratorPort {
  return {
    async generate(laws, question, temporal) {
      const t0 = performance.now()
      try {
        return await inner.generate(laws, question, temporal)
      } finally {
        buckets.answer.push(performance.now() - t0)
      }
    },
  }
}

/**
 * 검증 결과 데코레이터 — verify 호출 시간 측정 + 결과(checks·failReasons) 수집.
 *
 * 재시도 시 verify가 다회 호출되므로 verifyLog에 모두 누적됩니다.
 * TAX-041 분석 모드에서 V1~V6 어느 항목이 가장 많이 실패하는지 분포 파악용.
 */
interface VerifyLogEntry {
  iter: number
  attempt: number
  status: VerificationResult['status']
  checks: VerificationResult['checks']
  failReasons: string[]
}

function makeTimedVerifier(
  inner: ILawVerifierPort,
  buckets: StageBuckets,
  verifyLog: VerifyLogEntry[],
  ctx: { currentIter: number; currentAttempt: number },
): ILawVerifierPort {
  return {
    async verify(answer, sourceLaws) {
      const t0 = performance.now()
      try {
        const result = await inner.verify(answer, sourceLaws)
        verifyLog.push({
          iter: ctx.currentIter,
          attempt: ctx.currentAttempt,
          status: result.status,
          checks: result.checks,
          failReasons: result.failReasons,
        })
        ctx.currentAttempt++
        return result
      } finally {
        buckets.verify.push(performance.now() - t0)
      }
    },
  }
}

/**
 * 임베딩 포트 데코레이터 — embed/embedBatch 호출 시간을 embedding 버킷에 누적.
 * 참고목록 의미 재정렬(TAX-6B-12)에서 [질의, 후보…]를 배치 1콜로 임베딩한다.
 */
function makeTimedEmbedding(inner: IEmbeddingPort, buckets: StageBuckets): IEmbeddingPort {
  return {
    async embed(text) {
      const t0 = performance.now()
      try {
        return await inner.embed(text)
      } finally {
        buckets.embedding.push(performance.now() - t0)
      }
    },
    async embedBatch(texts) {
      const t0 = performance.now()
      try {
        return await inner.embedBatch(texts)
      } finally {
        buckets.embedding.push(performance.now() - t0)
      }
    },
  }
}

/**
 * 벡터 검색 포트 데코레이터 — searchSimilar 호출 시간을 precedent 버킷에 누적.
 * 옵션 A(판례 경로만 추가)에서 검색 단계는 직접 매칭이므로, 이 데코레이터가 재는 값은
 * 오롯이 판례 코퍼스 라이브 검색(TAX-6B-14)의 DB 1콜 비용이다.
 */
function makeTimedVectorSearch(inner: IVectorSearchPort, buckets: StageBuckets): IVectorSearchPort {
  return {
    async searchSimilar(queryVector, topK, sourceType) {
      const t0 = performance.now()
      try {
        return await inner.searchSimilar(queryVector, topK, sourceType)
      } finally {
        buckets.precedent.push(performance.now() - t0)
      }
    },
  }
}

// ─── 메인 측정 루프 ─────────────────────────────────────────────────────

interface IterationLog {
  iter: number
  caseId: string
  totalMs: number
  status: 'ok' | 'error'
  error?: string
  /** 보강 J — AppError.code (도메인 에러일 때만), 그 외 'INTERNAL_ERROR' */
  errorCode?: ErrorCode
}

async function main(): Promise<void> {
  const cases = loadGoldenCases()
  if (cases.length === 0) {
    console.error('[TAX-029] 골든셋이 비어 있습니다.')
    process.exit(1)
  }

  console.log(`\n[TAX-029] RAG 5단계 누적 P95 측정 시작`)
  console.log(`골든셋 케이스: ${cases.length}건`)
  console.log(`측정 횟수: n=${N_ITERATIONS}`)
  console.log(`합격선: 누적 P95 < ${P95_THRESHOLD_MS}ms`)
  // TAX-6B-14 — 측정값이 어떤 조건인지 명확히. 판례 경로는 DATABASE_URL 유무로 갈린다.
  console.log(`의미 재정렬(임베딩): 활성 (TAX-6B-12)`)
  console.log(`판례 라이브 검색: ${config.databaseUrl ? '활성 (TAX-6B-14)' : '비활성 — DATABASE_URL 없음, 판례 경로 우회'}`)
  console.log('-'.repeat(60))

  // 실 어댑터 인스턴스화 (운영 경로 그대로 — §9-① 옵션 A)
  const realQueryRewriter = new OpenAIQueryRewriterAdapter()
  const realSearchPort = new NationalTaxLawAdapter()
  const realAnswerGen = new OpenAIAnswerGeneratorAdapter()
  const realVerifier = new LawVerifierAdapter()

  // TAX-6B-14 — 운영 진입점(app/api/answer/route.ts)과 동일한 부가 포트 주입.
  //  embeddingPort: VOYAGE_API_KEY만 있으면 항상 활성(의미 재정렬, TAX-6B-12 / voyage-4 전환 TAX-6B-15).
  //  vectorSearchPort: DATABASE_URL 있을 때만 활성(판례 라이브 검색, TAX-6B-14). 없으면 판례 경로는 우회.
  const realEmbeddingPort = new VoyageEmbeddingAdapter(config.voyageApiKey)
  const realVectorSearchPort = config.databaseUrl
    ? new PgVectorSearchAdapter(config.databaseUrl)
    : undefined

  const buckets: StageBuckets = { rewrite: [], search: [], answer: [], verify: [], embedding: [], precedent: [] }
  const verifyLog: VerifyLogEntry[] = []
  const ctx = { currentIter: 0, currentAttempt: 0 }
  const timedQueryRewriter = makeTimedQueryRewriter(realQueryRewriter, buckets)
  const timedSearchPort = makeTimedSearchPort(realSearchPort, buckets)
  const timedAnswerGen = makeTimedAnswerGen(realAnswerGen, buckets)
  const timedVerifier = makeTimedVerifier(realVerifier, buckets, verifyLog, ctx)
  const timedEmbeddingPort = makeTimedEmbedding(realEmbeddingPort, buckets)
  const timedVectorSearchPort = realVectorSearchPort
    ? makeTimedVectorSearch(realVectorSearchPort, buckets)
    : undefined

  const totals: number[] = []
  const logs: IterationLog[] = []
  let errorCount = 0

  // 시점 컨텍스트 — 기본값(현행 기준, 명시 시점 없음)
  const temporal: TemporalContext = { requestedAt: new Date(), explicit: false }

  const overallStart = performance.now()
  for (let i = 0; i < N_ITERATIONS; i++) {
    const c = cases[i % cases.length] // 40건 가중 순회 (40·40·20건)
    ctx.currentIter = i + 1
    ctx.currentAttempt = 1
    const t0 = performance.now()
    try {
      await generateAnswer(
        timedQueryRewriter,
        timedSearchPort,
        timedAnswerGen,
        timedVerifier,
        c.question,
        temporal,
        undefined,                // opsLog — 측정에선 운영 로그 적재 생략
        timedEmbeddingPort,       // (8) 의미 재정렬용 임베딩 — TAX-6B-12
        timedVectorSearchPort,    // (9) 판례 라이브 검색 — TAX-6B-14 (DB 없으면 undefined → 우회)
      )
      const elapsed = performance.now() - t0
      totals.push(elapsed)
      logs.push({ iter: i + 1, caseId: c.id, totalMs: elapsed, status: 'ok' })
      process.stdout.write(`\r[${i + 1}/${N_ITERATIONS}] ${c.id} ${(elapsed / 1000).toFixed(2)}s`)
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      // 보강 J — 도메인 에러 분류. 재시도 wrapper가 외부로 던진 시점 기준
      // (wrapper 내부 1차 실패 → 2차 성공한 경우는 측정 불가)
      const errorCode: ErrorCode = err instanceof AppError ? err.code : 'INTERNAL_ERROR'
      errorCount++
      logs.push({
        iter: i + 1,
        caseId: c.id,
        totalMs: performance.now() - t0,
        status: 'error',
        error: msg,
        errorCode,
      })
      process.stdout.write(`\r[${i + 1}/${N_ITERATIONS}] ${c.id} ERROR(${errorCode}): ${msg.slice(0, 60)}\n`)
    }
  }
  const overallElapsedMs = performance.now() - overallStart
  process.stdout.write('\n')

  // ─── 통계 출력 + 합격선 판정 ──────────────────────────────────────────
  const result = printReport(
    {
      rewrite: buckets.rewrite,
      search: buckets.search,
      answer: buckets.answer,
      verify: buckets.verify,
      // 부가 단계 — 각 비용을 분리 관측(누적 P95 영향 진단·튜닝용)
      embedding: buckets.embedding,
      precedent: buckets.precedent,
    },
    totals,
    P95_THRESHOLD_MS,
  )

  console.log('-'.repeat(60))
  console.log(`정상 응답: ${totals.length}/${N_ITERATIONS}`)
  console.log(`에러: ${errorCount}/${N_ITERATIONS}`)
  console.log(`측정 전체 소요: ${(overallElapsedMs / 1000).toFixed(1)}s`)

  // 보강 J — errorCode 분포
  const errorCodeCount: Partial<Record<ErrorCode, number>> = {}
  for (const e of logs) {
    if (e.status !== 'error' || !e.errorCode) continue
    errorCodeCount[e.errorCode] = (errorCodeCount[e.errorCode] ?? 0) + 1
  }
  if (errorCount > 0) {
    console.log(`\n=== 에러 코드 분포 (보강 J) ===`)
    for (const [code, cnt] of Object.entries(errorCodeCount).sort((a, b) => b[1]! - a[1]!)) {
      const pct = ((cnt! / N_ITERATIONS) * 100).toFixed(1)
      console.log(`  ${code}: ${cnt}건 (${pct}%)`)
    }
  }

  // ─── V1~V6 실패 항목 분포 (TAX-041 분석) ──────────────────────────────
  const checkFailCount: Record<string, number> = { v1: 0, v2: 0, v3: 0, v4: 0, v5: 0, v6: 0 }
  const reasonCount: Record<string, number> = {}
  for (const entry of verifyLog) {
    if (entry.status === 'PASS') continue
    for (const k of ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'] as const) {
      if (!entry.checks[k]) checkFailCount[k]++
    }
    for (const r of entry.failReasons) {
      const prefix = r.split(' — ')[0].slice(0, 50) // 'V2: 발췌가 원문과 불일치' 같은 형태
      reasonCount[prefix] = (reasonCount[prefix] || 0) + 1
    }
  }
  const verifyAttempts = verifyLog.length
  const verifyPass = verifyLog.filter((e) => e.status === 'PASS').length
  console.log('-'.repeat(60))
  console.log(`\n=== V1~V6 검증 분석 (TAX-041) ===`)
  console.log(`검증 호출 수: ${verifyAttempts} (PASS ${verifyPass} / FAIL ${verifyAttempts - verifyPass})`)
  console.log(`항목별 실패 카운트 (FAIL 검증당):`)
  for (const k of ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'] as const) {
    const cnt = checkFailCount[k]
    const pct = verifyAttempts > 0 ? ((cnt / verifyAttempts) * 100).toFixed(1) : '0.0'
    console.log(`  ${k.toUpperCase()}: ${cnt}건 (${pct}% of 검증호출)`)
  }
  console.log(`\n실패 사유 상위 (메시지 prefix 50자):`)
  const sortedReasons = Object.entries(reasonCount).sort((a, b) => b[1] - a[1]).slice(0, 10)
  for (const [reason, cnt] of sortedReasons) {
    console.log(`  ${cnt}× ${reason}`)
  }

  // ─── JSON 백업 ─────────────────────────────────────────────────────
  const baseline = {
    ticket: 'TAX-029',
    measuredAt: new Date().toISOString(),
    label: ARG_LABEL ? ARG_LABEL.slice(1) : null,
    config: {
      nIterations: N_ITERATIONS,
      p95ThresholdMs: P95_THRESHOLD_MS,
      goldenSetSize: cases.length,
      mode: 'real-api',
      caseDistribution: 'golden-weighted-cyclic',
      model: 'gpt-4o-mini',
    },
    summary: {
      stages: result.stages,
      total: result.total,
      pass: result.pass,
      okCount: totals.length,
      errorCount,
      overallElapsedMs,
      // 보강 J — 에러 코드 분포 (옵션 필드, 누락 시 호환 유지)
      errorCodeCount,
    },
    verification: {
      attempts: verifyAttempts,
      pass: verifyPass,
      checkFailCount,
      reasonCount,
    },
    iterations: logs,
    rawStages: buckets,
    verifyLog,
  }

  if (!existsSync(dirname(BASELINE_PATH))) {
    mkdirSync(dirname(BASELINE_PATH), { recursive: true })
  }
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2), 'utf-8')
  console.log(`\n결과 백업: ${BASELINE_PATH}`)

  process.exit(result.pass && errorCount === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\n[TAX-029] 측정 실패:', err)
  process.exit(1)
})
