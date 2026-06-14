/**
 * 항상 FAIL인 9건 실패 원인 집중 분석
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
const alwaysFailIds = ['G3-01', 'G3-05', 'G3-08', 'G3-10', 'G3-12', 'G3-15', 'G3-16', 'G3-18', 'G3-19']

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
  return { answer, vr, allLaws }
}

for (const id of alwaysFailIds) {
  const tc = golden.cases.find(c => c.id === id)
  if (!tc) continue

  console.log(`\n[${id}] ${tc.question.slice(0, 60)}`)
  try {
    const { answer, vr, allLaws } = await runCase(tc)
    const t1Count = allLaws.filter(l => l.trustTier === 'T1' && l.sourceType === '법령').length
    console.log(`  검색T1=${t1Count}건  temporalLabel=${answer.temporalLabel}  ${vr.status}`)
    if (vr.status === 'FAIL') {
      // 실패 원인 분류
      const v2Fails = vr.failReasons.filter(r => r.startsWith('V2'))
      const v4Fails = vr.failReasons.filter(r => r.startsWith('V4'))
      const v1Fails = vr.failReasons.filter(r => r.startsWith('V1'))
      const otherFails = vr.failReasons.filter(r => !r.startsWith('V2') && !r.startsWith('V4') && !r.startsWith('V1'))
      if (v1Fails.length > 0) console.log(`    V1실패(${v1Fails.length}): ${v1Fails[0].slice(0,80)}`)
      if (v2Fails.length > 0) console.log(`    V2실패(${v2Fails.length}): ${v2Fails[0].slice(0,80)}`)
      if (v4Fails.length > 0) console.log(`    V4실패(${v4Fails.length}): ${v4Fails[0].slice(0,80)}`)
      if (otherFails.length > 0) console.log(`    기타실패(${otherFails.length}): ${otherFails[0].slice(0,80)}`)
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message.slice(0,80)}`)
  }
}
