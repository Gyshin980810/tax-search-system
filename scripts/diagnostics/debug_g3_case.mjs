/**
 * G3 단건 디버그 — E-VERIFY-FAIL 원인 파악
 * 내부 generateAnswer 대신 어댑터를 단계별로 직접 호출
 * 실행: node --env-file=.env.local --conditions=react-server --import tsx scripts/diagnostics/debug_g3_case.mjs
 */
import 'server-only'
import { OpenAIQueryRewriterAdapter } from '../../src/adapters/llmQueryRewriter.js'
import { NationalTaxLawAdapter } from '../../src/adapters/nationalTaxLaw.js'
import { OpenAIAnswerGeneratorAdapter } from '../../src/adapters/llmAnswerGenerator.js'
import { LawVerifierAdapter } from '../../src/adapters/lawVerifier.js'

const question = '현행 법인세 세율 구간은 어떻게 되나요? 과세표준별 세율을 알려주세요.'
const targetDate = new Date('2025-12-31')
const temporal = { requestedAt: new Date(), targetDate, explicit: true }

console.log('=== G3-01 단건 디버그 ===')
console.log(`질문: ${question}`)
console.log(`targetDate: ${targetDate.toISOString().slice(0,10)}`)
console.log()

// [1] 쿼리 변환
const rewriter = new OpenAIQueryRewriterAdapter()
console.log('─── [1] 쿼리 변환 ───')
const queries = await rewriter.rewrite(question, temporal)
console.log('변환된 쿼리:', JSON.stringify(queries, null, 2))

// [2] API 검색
const searcher = new NationalTaxLawAdapter()
console.log('\n─── [2] API 검색 ───')
const laws = await searcher.search(queries, temporal)
console.log(`검색 결과: ${laws.length}건`)
for (const l of laws) {
  console.log(`  ${l.lawName} ${l.articleNumber || l.caseNumber} | tier=${l.trustTier} | revDate=${l.revisionDate} | enfDate=${l.enforcementDate}`)
  console.log(`    본문 길이=${l.content?.length ?? 0}자`)
}

// [3] 답변 생성
const generator = new OpenAIAnswerGeneratorAdapter()
console.log('\n─── [3] 답변 생성 ───')
const answer = await generator.generate(question, laws, temporal)
console.log('verifyStatus:', answer.verificationResult?.status)
console.log('temporalLabel:', answer.temporalLabel)
console.log('citations 수:', answer.citations?.length)
for (const c of answer.citations || []) {
  console.log(`  [${c.label}] ${c.taxLaw.lawName} ${c.taxLaw.articleNumber || ''} | tier=${c.taxLaw.trustTier}`)
  console.log(`    temporalLabel: ${c.temporalLabel}`)
  console.log(`    excerpt: ${c.excerpt?.slice(0, 80)}`)
}
console.log('\nsummary(처음 200자):', answer.summary?.slice(0, 200))

// [4] 검증
const verifier = new LawVerifierAdapter()
console.log('\n─── [4] law-verifier ───')
const vr = await verifier.verify(laws, answer)
console.log('검증 결과:', JSON.stringify(vr, null, 2))
