/**
 * 각 G3 케이스의 E-VERIFY-FAIL 상세 원인 파악
 * generateAnswer 내에서 verificationResult를 extracte하여 로그로 출력
 * 실행: node --env-file=.env.local --conditions=react-server --import tsx scripts/diagnostics/debug_verifier.mjs
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

const rewriter = new OpenAIQueryRewriterAdapter()
const directPort = new NationalTaxLawAdapter()
const searchPort = config.databaseUrl
  ? new FallbackSearchPort(directPort, new OpenAIEmbeddingAdapter(config.openaiApiKey), new PgVectorSearchAdapter(config.databaseUrl))
  : directPort
const generator = new OpenAIAnswerGeneratorAdapter()
const verifier = new LawVerifierAdapter()

// 대표 실패 케이스 5개 선택
const testCases = [
  { id: 'G3-01', q: '현행 법인세 세율 구간은 어떻게 되나요? 과세표준별 세율을 알려주세요.', d: '2025-12-31' },
  { id: 'G3-07', q: '현행 부가가치세 간이과세 적용 기준금액은 얼마인가요?', d: '2026-06-14' },
  { id: 'G3-08', q: '현행 부가가치세 간이과세자의 납부의무 면제 기준금액은 얼마인가요?', d: '2026-06-14' },
  { id: 'G3-12', q: '현행 종합부동산세 주택분 기본공제 금액은 얼마인가요? 1세대 1주택자의 경우는요?', d: '2026-06-14' },
  { id: 'G3-15', q: '현행 직계존속으로부터 증여받는 경우 증여재산공제 한도는 얼마인가요?', d: '2025-12-31' },
]

// 쿼리 변환 + 검색 + 답변 생성 + 검증을 직접 단계별 실행 (generateAnswer 대신)
async function runWithDetails(caseInfo) {
  const temporal = {
    requestedAt: new Date(),
    targetDate: new Date(caseInfo.d),
    explicit: true,
  }

  // [1] 쿼리 변환
  const queries = await rewriter.rewrite(caseInfo.q, temporal)

  // [2] 검색 (각 쿼리별 개별 호출)
  const allLaws = []
  for (const q of queries) {
    const r = await searchPort.search(q)
    const items = r?.items ?? []
    for (const item of items) {
      if (!allLaws.some(l => l.lawName === item.lawName && l.articleNumber === item.articleNumber && l.caseNumber === item.caseNumber)) {
        allLaws.push(item)
      }
    }
  }

  // [3] 답변 생성
  const answer = await generator.generate(allLaws, caseInfo.q, temporal)

  // [4] 검증
  const vr = await verifier.verify(answer, allLaws)

  return { queries, allLaws, answer, vr }
}

for (const tc of testCases) {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`[${tc.id}] ${tc.q}`)
  console.log(`targetDate: ${tc.d}`)
  console.log('─'.repeat(70))

  try {
    const { queries, allLaws, answer, vr } = await runWithDetails(tc)

    console.log(`검색 결과 (${allLaws.length}건):`)
    for (const l of allLaws) {
      console.log(`  ${l.lawName} ${l.articleNumber || l.caseNumber || ''} | tier=${l.trustTier}`)
    }

    console.log(`\n답변 생성:`)
    console.log(`  temporalLabel: ${answer.temporalLabel}`)
    console.log(`  citations(${answer.citations.length}건):`)
    for (const c of answer.citations) {
      console.log(`    [${c.label}] ${c.taxLaw.lawName} ${c.taxLaw.articleNumber || ''} | tier=${c.taxLaw.trustTier}`)
      console.log(`    excerpt(50자): ${c.excerpt?.slice(0, 50)}`)
    }

    console.log(`\n검증 결과: ${vr.status}`)
    console.log(`  v1=${vr.checks.v1}  v2=${vr.checks.v2}  v3=${vr.checks.v3}  v4=${vr.checks.v4}  v5=${vr.checks.v5}  v6=${vr.checks.v6}`)
    if (vr.failReasons.length > 0) {
      console.log(`  실패 이유:`)
      for (const r of vr.failReasons) console.log(`    - ${r}`)
    }
  } catch (err) {
    console.log(`  오류: ${err.message}`)
  }
}
