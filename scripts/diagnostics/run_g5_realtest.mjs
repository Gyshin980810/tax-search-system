/**
 * TAX-6B-7 — G-5 폐지 골든셋 10건 실측 + golden_repealed.json 자동 업데이트
 *
 * 목적:
 *   골격만 있는 G-5 케이스 10건을 실제 RAG 파이프라인으로 실행해
 *   sourceLaws·citations·summary·temporalLabel·verificationResult를 채운다.
 *   expectedStatus는 회계사가 직접 확정해야 하므로 "" 유지.
 *
 * 실행:
 *   node --env-file=.env.local --conditions=react-server --import tsx \
 *     scripts/diagnostics/run_g5_realtest.mjs
 *
 * 출력:
 *   - 콘솔에 케이스별 verificationResult.status + summary 첫 100자
 *   - eval/golden_repealed.json 업데이트 (expectedStatus는 비어 있는 채로 유지)
 */
import 'server-only'
import { readFileSync, writeFileSync } from 'node:fs'
import { OpenAIQueryRewriterAdapter } from '../../src/adapters/llmQueryRewriter.js'
import { NationalTaxLawAdapter } from '../../src/adapters/nationalTaxLaw.js'
import { OpenAIAnswerGeneratorAdapter } from '../../src/adapters/llmAnswerGenerator.js'
import { LawVerifierAdapter } from '../../src/adapters/lawVerifier.js'
import { config } from '../../src/config.js'
import { FallbackSearchPort } from '../../src/usecases/searchWithFallback.js'
import { OpenAIEmbeddingAdapter } from '../../src/adapters/embedding.js'
import { PgVectorSearchAdapter } from '../../src/adapters/vectorSearch.js'

const GOLDEN_PATH = 'eval/golden_repealed.json'

const rewriter = new OpenAIQueryRewriterAdapter()
const directPort = new NationalTaxLawAdapter()
const searchPort = config.databaseUrl
  ? new FallbackSearchPort(directPort, new OpenAIEmbeddingAdapter(config.openaiApiKey), new PgVectorSearchAdapter(config.databaseUrl))
  : directPort
const generator = new OpenAIAnswerGeneratorAdapter()
const verifier = new LawVerifierAdapter()

const goldenFile = JSON.parse(readFileSync(GOLDEN_PATH, 'utf-8'))
const cases = goldenFile.cases

/** 케이스 1건 실행 → 실측 결과 반환 */
async function runCase(tc) {
  const temporal = {
    requestedAt: new Date(),
    targetDate: undefined,
    explicit: false,
  }
  try {
    const queries = await rewriter.rewrite(tc.question, temporal)
    const allLaws = []
    for (const q of queries) {
      const r = await searchPort.search(q)
      for (const item of (r?.items ?? [])) {
        const dup = allLaws.some(
          l => l.lawName === item.lawName
            && l.articleNumber === item.articleNumber
            && l.caseNumber === item.caseNumber,
        )
        if (!dup) allLaws.push(item)
      }
    }
    const answer = await generator.generate(allLaws, tc.question, temporal)
    const vr = await verifier.verify(answer, allLaws)
    return {
      ok: true,
      sourceLaws: allLaws,
      answer: { ...answer, verificationResult: vr },
    }
  } catch (e) {
    return { ok: false, error: e.message ?? String(e) }
  }
}

console.log(`G-5 폐지 골든셋 ${cases.length}건 실측 시작\n${'='.repeat(60)}`)

for (const tc of cases) {
  const start = Date.now()
  process.stdout.write(`[${tc.id}] 실행 중...`)
  const result = await runCase(tc)
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  if (!result.ok) {
    console.log(`\r[${tc.id}] ❌ THROW (${elapsed}s) — ${result.error}`)
    continue
  }

  const { sourceLaws, answer } = result
  const status = answer.verificationResult?.status ?? 'UNKNOWN'
  const summarySnippet = (answer.summary ?? '').slice(0, 80).replace(/\n/g, ' ')
  const citCount = answer.citations?.length ?? 0
  const lawCount = sourceLaws.length

  console.log(`\r[${tc.id}] ${status} (${elapsed}s) | 검색=${lawCount}건, 인용=${citCount}건`)
  console.log(`  summary: ${summarySnippet}...`)
  if (answer.verificationResult?.failReasons?.length > 0) {
    console.log(`  FailReasons: ${answer.verificationResult.failReasons.join(', ')}`)
  }
  console.log(`  ⚠️ expectedStatus: "" → 회계사 직접 확정 필요`)
  console.log()

  // golden_repealed.json 업데이트 (expectedStatus 제외)
  const idx = goldenFile.cases.findIndex(c => c.id === tc.id)
  if (idx >= 0) {
    goldenFile.cases[idx].sourceLaws = sourceLaws
    goldenFile.cases[idx].answer = {
      rawQuestion: tc.question,
      citations: answer.citations ?? [],
      summary: answer.summary ?? '',
      temporalLabel: answer.temporalLabel ?? '',
      disclaimer: answer.disclaimer ?? '',
      verificationResult: answer.verificationResult ?? {
        status: 'UNKNOWN',
        checks: {},
        failReasons: [],
      },
      generatedAt: new Date().toISOString(),
    }
    // expectedStatus는 기존값 유지 (회계사 권한)
  }
}

// 파일 저장
writeFileSync(GOLDEN_PATH, JSON.stringify(goldenFile, null, 2), 'utf-8')
console.log(`${'='.repeat(60)}`)
console.log(`✅ ${GOLDEN_PATH} 업데이트 완료`)
console.log(`⚠️  각 케이스의 expectedStatus를 확인 후 "PASS" 또는 "FAIL"로 채워주세요.`)
