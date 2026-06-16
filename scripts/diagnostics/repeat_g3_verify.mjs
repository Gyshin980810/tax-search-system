/**
 * TAX-6A-11 — G-3 11건 N회 반복측정 (비결정성 통계 검증)
 *
 * 목적:
 *   처방 D+F 적용 후 V3 안정성을 통계적으로 검증한다.
 *   합격 기준: ≥9/10 회차에서 PASS (≥90% 안정성).
 *
 * 실행:
 *   node --env-file=.env.local --conditions=react-server --import tsx \
 *     scripts/diagnostics/repeat_g3_verify.mjs [N=10]
 */
import 'server-only'
import { readFileSync } from 'node:fs'
import { OpenAIQueryRewriterAdapter } from '../../src/adapters/llmQueryRewriter.js'
import { NationalTaxLawAdapter } from '../../src/adapters/nationalTaxLaw.js'
import { OpenAIAnswerGeneratorAdapter } from '../../src/adapters/llmAnswerGenerator.js'
import { LawVerifierAdapter } from '../../src/adapters/lawVerifier.js'
import { config } from '../../src/config.js'
import { FallbackSearchPort } from '../../src/usecases/searchWithFallback.js'
import { OpenAIEmbeddingAdapter } from '../../src/adapters/embedding.js'
import { PgVectorSearchAdapter } from '../../src/adapters/vectorSearch.js'

const N = parseInt(process.argv[2] ?? '10', 10)
const FAIL_IDS = ['G3-01','G3-03','G3-05','G3-08','G3-10','G3-12','G3-13','G3-15','G3-16','G3-18','G3-19']

const rewriter = new OpenAIQueryRewriterAdapter()
const directPort = new NationalTaxLawAdapter()
const searchPort = config.databaseUrl
  ? new FallbackSearchPort(directPort, new OpenAIEmbeddingAdapter(config.openaiApiKey), new PgVectorSearchAdapter(config.databaseUrl))
  : directPort
const generator = new OpenAIAnswerGeneratorAdapter()
const verifier = new LawVerifierAdapter()

const golden = JSON.parse(readFileSync('eval/golden_temporal.json', 'utf-8'))
const cases = FAIL_IDS.map(id => golden.cases.find(c => c.id === id)).filter(Boolean)

/** 케이스 1건 실행 후 PASS/FAIL 반환 */
async function runCase(tc) {
  const temporal = {
    requestedAt: new Date(),
    targetDate: tc.targetDate ? new Date(tc.targetDate) : undefined,
    explicit: !!tc.targetDate,
  }
  try {
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
    return {
      id: tc.id,
      status: vr.status,
      failReasons: vr.failReasons,
      notFound: (answer.summary ?? '').includes('찾지 못했'),
    }
  } catch (e) {
    return { id: tc.id, status: 'THROW', failReasons: [e.message ?? String(e)], notFound: null }
  }
}

// 케이스별 누적 PASS 횟수 (통계 집계)
const caseStats = Object.fromEntries(FAIL_IDS.map(id => [id, { pass: 0, fail: 0, throw: 0 }]))
const roundResults = []

console.log(`G-3 ${FAIL_IDS.length}건 × ${N}회 반복측정 시작\n${'='.repeat(60)}`)

for (let round = 1; round <= N; round++) {
  const start = Date.now()
  process.stdout.write(`[회차 ${String(round).padStart(2)}/${N}] 실행 중...`)

  const results = []
  for (const tc of cases) {
    const r = await runCase(tc)
    results.push(r)
    if (r.status === 'PASS') caseStats[r.id].pass++
    else if (r.status === 'THROW') caseStats[r.id].throw++
    else caseStats[r.id].fail++
  }

  const passCount = results.filter(r => r.status === 'PASS').length
  const failList = results.filter(r => r.status !== 'PASS')
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  roundResults.push({ round, passCount, total: cases.length })
  const summary = `${passCount}/${cases.length} PASS`
  const failSummary = failList.length
    ? `  FAIL: ${failList.map(r => `${r.id}[${r.failReasons.map(f => f.split(':')[0]).join('+')}]`).join(', ')}`
    : ''
  console.log(`\r[회차 ${String(round).padStart(2)}/${N}] ${summary}  (${elapsed}s)${failSummary}`)
}

// 최종 집계
const totalRounds = N
const perfectRounds = roundResults.filter(r => r.passCount === cases.length).length
const avgPass = (roundResults.reduce((s, r) => s + r.passCount, 0) / N).toFixed(1)

console.log(`\n${'='.repeat(60)}`)
console.log(`최종 결과: ${perfectRounds}/${totalRounds}회 전건 PASS  (평균 ${avgPass}/${cases.length})`)
console.log(`합격 기준: ≥9/10회 전건 PASS → ${perfectRounds >= Math.ceil(N * 0.9) ? '✅ 합격' : '❌ 불합격'}`)

console.log(`\n케이스별 누적 통계 (${N}회)`)
console.log('-'.repeat(52))
for (const id of FAIL_IDS) {
  const s = caseStats[id]
  const total = s.pass + s.fail + s.throw
  const pct = total > 0 ? ((s.pass / total) * 100).toFixed(0) : '-'
  const bar = '█'.repeat(s.pass) + '░'.repeat(s.fail) + '✗'.repeat(s.throw)
  console.log(`${id}  PASS=${String(s.pass).padEnd(3)} FAIL=${String(s.fail).padEnd(3)} THROW=${String(s.throw).padEnd(3)}  ${pct.padStart(3)}%  ${bar}`)
}
