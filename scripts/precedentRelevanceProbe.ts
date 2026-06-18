#!/usr/bin/env node
/**
 * 판례 코퍼스 PoC 관련도 평가 프로브 — TAX-6B-13
 *
 * 사용법:
 *   npm run probe:precedent
 *
 * 목적(오프라인 평가, 라이브 답변 경로 비호출):
 *   적재된 판례(T4)에 대해 의미(벡터) 검색이 글자(부분문자열) 검색 대비
 *   "표기변이 판례"를 더 잡는지 육안 확인 + 검색 추가 지연 실측.
 *
 * 읽는 법:
 *   각 결과의 [유사도%]와 글자점수 2종(제목/전체)을 함께 출력한다.
 *   - 제목점수: 사건명(짧은 제목)만으로 글자검색했을 때의 점수.
 *   - 전체점수: 제목+본문 전체를 글자검색했을 때의 점수.
 *   제목점수=0 인데 유사도가 높은 판례 = 의미검색이 구제한 표기변이 사례(★).
 *   본문은 6,000자 이상으로 길어 전체점수는 거의 항상 1점 이상이 되므로,
 *   표기변이 효과는 "제목점수 0점" 기준으로 봐야 정확하다(TAX-6B-13 PoC 1차 교훈).
 *   answer LLM·DB 쓰기는 하지 않는다(읽기 전용).
 */
import 'server-only'
import { OpenAIEmbeddingAdapter } from '../src/adapters/embedding'
import { PgVectorSearchAdapter } from '../src/adapters/vectorSearch'
import { extractTerms, scoreRelevance } from '../src/domain/nonLawRelevance'

const DATABASE_URL = process.env.DATABASE_URL
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

if (!DATABASE_URL) {
  console.error('[probe] DATABASE_URL 환경변수가 필요합니다.')
  process.exit(1)
}
if (!OPENAI_API_KEY) {
  console.error('[probe] OPENAI_API_KEY 환경변수가 필요합니다.')
  process.exit(1)
}

/** 상위 몇 건을 살펴볼지 */
const TOP_K = 5

/**
 * 표기변이를 노린 질의 — 정식 명칭(양도소득세)으로 묻지만
 * 판례 본문은 약칭(양도세)을 쓰는 경우가 많아 글자검색이 놓치기 쉽다.
 */
const QUERIES = [
  '1세대 1주택 양도소득세 비과세 요건',
  '명의신탁 증여의제 실질과세 분쟁',
  '가산세 부과 정당한 사유 인정 여부',
  '부가가치세 매입세액 공제 거부 처분',
  '법인세 손금산입 범위 다툼',
]

async function main() {
  const embedder = new OpenAIEmbeddingAdapter(OPENAI_API_KEY!)
  const vectorPort = new PgVectorSearchAdapter(DATABASE_URL!)

  const latencies: number[] = []
  let rescuedTotal = 0

  for (const q of QUERIES) {
    const terms = extractTerms(q)

    const t0 = Date.now()
    const vec = await embedder.embed(q)
    const matches = await vectorPort.searchSimilar(vec, TOP_K)
    latencies.push(Date.now() - t0)

    console.log(`\n질의: "${q}"`)
    console.log(`  핵심어: [${terms.join(', ')}] → 상위 ${matches.length}건`)
    if (matches.length === 0) {
      console.log('  ⚠ 결과 0건 — 적재 비었거나 연결 문제')
      continue
    }

    for (const m of matches) {
      const it = m.item
      // 의미검색 결과에 대해 "글자검색이라면 몇 점이었나"를 역산 (2종)
      const title = `${it.articleTitle} ${it.lawName}`
      // 제목점수: 사건명(짧은 제목)만 대상 — 본문은 비워 표기변이 신호를 분리
      const titleScore = scoreRelevance(title, '', terms)
      // 전체점수: 제목+본문 전체 대상 — 참고용(본문이 길어 거의 항상 1점 이상)
      const fullScore = scoreRelevance(title, it.content, terms)
      const rescued = titleScore === 0 // 사건명만 봤다면 탈락했을 항목 = 의미검색이 구제
      if (rescued) rescuedTotal++
      const id = it.sourceType === '법령'
        ? `${it.lawName} ${it.articleNumber}`
        : `${it.sourceType} ${it.caseNumber ?? it.lawName}`
      const star = rescued ? ' ★표기변이구제' : ''
      console.log(
        `  [유사도 ${(m.similarity * 100).toFixed(1)}% | 제목 ${titleScore}점 | 전체 ${fullScore}점] ${id} — ${it.articleTitle || '(제목없음)'}${star}`,
      )
    }
  }

  // ─── 지연·구제 요약 ───────────────────────────────────────────────────
  const sorted = [...latencies].sort((a, b) => a - b)
  const avg = Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length)
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]
  console.log('\n─── 요약 ───')
  console.log(`질의 ${QUERIES.length}건 / 임베딩+검색 평균 ${avg}ms, 최댓값(≈P95) ${p95}ms`)
  console.log(`★ 표기변이 구제(제목점수 0점인데 의미검색 상위) 누적: ${rescuedTotal}건`)
  console.log('  → 구제 건수가 많을수록, 사건명만 보는 글자검색 대비 의미검색의 이득이 크다.')
  process.exit(0)
}

main().catch((err) => {
  console.error('[probe] 오류:', err)
  process.exit(1)
})
