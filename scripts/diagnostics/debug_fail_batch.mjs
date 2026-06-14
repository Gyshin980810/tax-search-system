/**
 * G3 실패 케이스 배치 원인 분석
 * 실행: node --env-file=.env.local --conditions=react-server --import tsx scripts/diagnostics/debug_fail_batch.mjs
 */
import 'server-only'
import { OpenAIQueryRewriterAdapter } from '../../src/adapters/llmQueryRewriter.js'
import { NationalTaxLawAdapter } from '../../src/adapters/nationalTaxLaw.js'
import { OpenAIAnswerGeneratorAdapter } from '../../src/adapters/llmAnswerGenerator.js'
import { LawVerifierAdapter } from '../../src/adapters/lawVerifier.js'
import { config } from '../../src/config.js'
import { FallbackSearchPort } from '../../src/usecases/searchWithFallback.js'
import { OpenAIEmbeddingAdapter } from '../../src/adapters/embedding.js'
import { PgVectorSearchAdapter } from '../../src/adapters/vectorSearch.js'
import { readFileSync } from 'node:fs'

const rewriter = new OpenAIQueryRewriterAdapter()
const directPort = new NationalTaxLawAdapter()
const searchPort = config.databaseUrl
  ? new FallbackSearchPort(directPort, new OpenAIEmbeddingAdapter(config.openaiApiKey), new PgVectorSearchAdapter(config.databaseUrl))
  : directPort
const generator = new OpenAIAnswerGeneratorAdapter()
const verifier = new LawVerifierAdapter()

const golden = JSON.parse(readFileSync('eval/golden_temporal.json', 'utf-8'))
// 실패 케이스 ID
const failIds = ['G3-01', 'G3-05', 'G3-07', 'G3-08', 'G3-10', 'G3-12', 'G3-14', 'G3-15', 'G3-16', 'G3-18', 'G3-19']

async function runCase(tc) {
  const temporal = { requestedAt: new Date(), targetDate: tc.targetDate ? new Date(tc.targetDate) : undefined, explicit: !!tc.targetDate }
  const queries = await rewriter.rewrite(tc.question, temporal)
  const allLaws = []
  for (const q of queries) {
    const r = await searchPort.search(q)
    for (const item of (r?.items ?? [])) {
      if (!allLaws.some(l => l.lawName === item.lawName && l.articleNumber === item.articleNumber && l.caseNumber === item.caseNumber))
        allLaws.push(item)
    }
  }
  const answer = await generator.generate(allLaws, tc.question, temporal)
  const vr = await verifier.verify(answer, allLaws)
  return { answer, vr }
}

for (const id of failIds) {
  const tc = golden.cases.find(c => c.id === id)
  if (!tc) continue

  process.stdout.write(`[${id}] ${tc.question.slice(0, 50)}... `)
  try {
    const { answer, vr } = await runCase(tc)
    process.stdout.write(`${vr.status}\n`)
    if (vr.status === 'FAIL') {
      for (const r of vr.failReasons) console.log(`    - ${r.slice(0, 100)}`)
    }
  } catch (e) {
    console.log(`ERROR: ${e.message.slice(0, 80)}`)
  }
}
