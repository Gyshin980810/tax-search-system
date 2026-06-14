/**
 * generateAnswer 전체 호출 — E-VERIFY-FAIL 원인 파악
 * 실행: node --env-file=.env.local --conditions=react-server --import tsx scripts/diagnostics/debug_generate.mjs
 */
import 'server-only'
import { OpenAIQueryRewriterAdapter } from '../../src/adapters/llmQueryRewriter.js'
import { NationalTaxLawAdapter } from '../../src/adapters/nationalTaxLaw.js'
import { OpenAIAnswerGeneratorAdapter } from '../../src/adapters/llmAnswerGenerator.js'
import { LawVerifierAdapter } from '../../src/adapters/lawVerifier.js'
import { generateAnswer } from '../../src/usecases/generateAnswer.js'
import { config } from '../../src/config.js'
import { FallbackSearchPort } from '../../src/usecases/searchWithFallback.js'
import { OpenAIEmbeddingAdapter } from '../../src/adapters/embedding.js'
import { PgVectorSearchAdapter } from '../../src/adapters/vectorSearch.js'

const question = '현행 법인세 세율 구간은 어떻게 되나요? 과세표준별 세율을 알려주세요.'
const targetDate = new Date('2025-12-31')
const temporal = { requestedAt: new Date(), targetDate, explicit: true }

const rewriter = new OpenAIQueryRewriterAdapter()
const directPort = new NationalTaxLawAdapter()
const searchPort = config.databaseUrl
  ? new FallbackSearchPort(directPort, new OpenAIEmbeddingAdapter(config.openaiApiKey), new PgVectorSearchAdapter(config.databaseUrl))
  : directPort
const generator = new OpenAIAnswerGeneratorAdapter()
const verifier = new LawVerifierAdapter()

console.log('=== generateAnswer 전체 호출 ===')
console.log(`질문: ${question}`)
console.log(`targetDate: 2025-12-31`)

try {
  const r = await generateAnswer(rewriter, searchPort, generator, verifier, question, temporal)
  console.log('\n결과:')
  console.log('verifyStatus:', r.verificationResult?.status)
  console.log('temporalLabel:', r.temporalLabel)
  console.log('citations 수:', r.citations?.length)
  for (const c of r.citations || []) {
    console.log(`  [${c.label}] ${c.taxLaw.lawName} ${c.taxLaw.articleNumber || ''} | tier=${c.taxLaw.trustTier}`)
    console.log(`    temporalLabel: ${c.temporalLabel}`)
    console.log(`    excerpt(처음 100자): ${c.excerpt?.slice(0, 100)}`)
  }
  console.log('\nsummary(처음 300자):')
  console.log(r.summary?.slice(0, 300))
  console.log('\nverificationResult:')
  console.log(JSON.stringify(r.verificationResult, null, 2))
} catch (err) {
  console.error('\nERROR:', err.message)
  console.error('code:', err.code)
  if (err.verificationResult) {
    console.log('\nverificationResult:', JSON.stringify(err.verificationResult, null, 2))
  }
  // LabeledAnswer가 에러 객체에 붙어있는지 확인
  for (const key of Object.keys(err)) {
    console.log(`err.${key}:`, JSON.stringify(err[key])?.slice(0, 200))
  }
}
