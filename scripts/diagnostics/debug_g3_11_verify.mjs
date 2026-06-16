/**
 * TAX-6A-10 — G-3 항상-FAIL 11건 V1~V6 실패 항목 정밀 진단
 *
 * 목적:
 *   재실측(reviewPhase6a)에서 11건은 generateAnswer가 E-VERIFY-FAIL로 throw하여
 *   V1/V2/V3/V4 중 무엇이 깨지는지 알 수 없었다. 이 스크립트는 generator.generate +
 *   verifier.verify를 직접 호출해 throw 전 raw 검증 결과(failReasons)를 그대로 출력한다.
 *
 * 부수 확인:
 *   - 검색 단계가 T1 법령 본문을 가져오는지(t1Count) → 근본 원인(검색 결함) 확증
 *   - citation tier 분포 / temporalLabel / summary 앞부분
 *
 * 주의(CLAUDE.md §8.1·§6.1):
 *   - 읽기·분석 전용. 골든셋·src 비즈니스 로직을 수정하지 않는다.
 *   - expectedStatus를 기록하지 않는다.
 *
 * 실행:
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/diagnostics/debug_g3_11_verify.mjs
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

const rewriter = new OpenAIQueryRewriterAdapter()
const directPort = new NationalTaxLawAdapter()
const searchPort = config.databaseUrl
  ? new FallbackSearchPort(directPort, new OpenAIEmbeddingAdapter(config.openaiApiKey), new PgVectorSearchAdapter(config.databaseUrl))
  : directPort
const generator = new OpenAIAnswerGeneratorAdapter()
const verifier = new LawVerifierAdapter()

const golden = JSON.parse(readFileSync('eval/golden_temporal.json', 'utf-8'))
// 항상-FAIL 11건 전체 (debug_always_fail.mjs는 G3-03·G3-13 누락이었음)
const failIds = ['G3-01', 'G3-03', 'G3-05', 'G3-08', 'G3-10', 'G3-12', 'G3-13', 'G3-15', 'G3-16', 'G3-18', 'G3-19']

async function runCase(tc) {
  const temporal = {
    requestedAt: new Date(),
    targetDate: tc.targetDate ? new Date(tc.targetDate) : undefined,
    explicit: !!tc.targetDate,
  }
  const queries = await rewriter.rewrite(tc.question, temporal)
  const allLaws = []
  for (const q of queries) {
    const r = await searchPort.search(q)
    for (const item of (r?.items ?? [])) {
      if (!allLaws.some((l) => l.lawName === item.lawName && l.articleNumber === item.articleNumber && l.caseNumber === item.caseNumber))
        allLaws.push(item)
    }
  }
  const answer = await generator.generate(allLaws, tc.question, temporal)
  const vr = await verifier.verify(answer, allLaws)
  return { answer, vr, allLaws, queries }
}

const summaryRows = []

for (const id of failIds) {
  const tc = golden.cases.find((c) => c.id === id)
  if (!tc) {
    console.log(`\n[${id}] (골든셋에서 케이스 못 찾음)`)
    continue
  }

  console.log(`\n[${id}] ${tc.question.slice(0, 50)}`)
  try {
    const { answer, vr, allLaws, queries } = await runCase(tc)
    const t1Law = allLaws.filter((l) => l.trustTier === 'T1' && (l.sourceType ?? '법령') === '법령').length
    const tierDist = allLaws.reduce((acc, l) => {
      const k = `${l.trustTier}/${l.sourceType ?? '법령'}`
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {})
    const citeTiers = answer.citations.map((c) => c.taxLaw.trustTier).join(',') || '-'
    const notFound = (answer.summary || '').includes('찾지 못했')

    console.log(`  검색: 총 ${allLaws.length}건  T1법령=${t1Law}건  분포=${JSON.stringify(tierDist)}`)
    console.log(`  쿼리: ${queries.map((q) => (typeof q === 'string' ? q : q?.query ?? JSON.stringify(q))).join(' | ').slice(0, 120)}`)
    console.log(`  답변: cites=${answer.citations.length}[${citeTiers}]  temporal="${answer.temporalLabel}"  notFound=${notFound}`)
    console.log(`  검증: ${vr.status}`)
    if (vr.status === 'FAIL') {
      for (const reason of vr.failReasons) {
        console.log(`     ✗ ${reason.slice(0, 110)}`)
      }
    }
    console.log(`  summary: ${(answer.summary || '').slice(0, 90)}`)

    // 실패 항목 카테고리 집계
    const cats = new Set(vr.failReasons.map((r) => r.split(':')[0]))
    summaryRows.push({ id, status: vr.status, t1Law, cites: answer.citations.length, fails: [...cats].join('+') || '-', notFound })
  } catch (e) {
    console.log(`  ERROR: ${(e.message || String(e)).slice(0, 100)}`)
    summaryRows.push({ id, status: 'THROW', t1Law: '?', cites: '?', fails: `THROW:${e.name ?? ''}`, notFound: '?' })
  }
}

console.log(`\n${'='.repeat(72)}`)
console.log('요약표 (id | 검증 | T1법령검색 | cites | 실패항목 | notFound)')
console.log('-'.repeat(72))
for (const r of summaryRows) {
  console.log(`${r.id}  ${String(r.status).padEnd(5)}  T1=${String(r.t1Law).padEnd(3)}  cites=${String(r.cites).padEnd(3)}  ${String(r.fails).padEnd(14)}  notFound=${r.notFound}`)
}
