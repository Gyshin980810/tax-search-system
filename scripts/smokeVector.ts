#!/usr/bin/env node
/**
 * Phase 4 벡터 검색 스모크 테스트 — TAX-026-H
 *
 * 사용법:
 *   npm run smoke:vector
 *
 * 목적:
 *   운영 경로(app/api/answer)가 쓰는 PgVectorSearchAdapter + FallbackSearchPort가
 *   실제 Neon DB에 연결돼 의미 유사도 검색을 수행하는지 확인한다(답변 생성 LLM은 호출하지 않음).
 *
 * 검증 항목:
 *   [A] 벡터 검색 직접 동작 — 임베딩 쿼리로 Neon에서 관련 조문이 상위에 반환되는가
 *   [B] FallbackSearchPort 단계 — 직접 매칭이 빈약할 때 matchStage가 'vector'/'expanded'로 전이하는가
 */

import 'server-only'
import { OpenAIEmbeddingAdapter } from '../src/adapters/embedding'
import { PgVectorSearchAdapter } from '../src/adapters/vectorSearch'
import { NationalTaxLawAdapter } from '../src/adapters/nationalTaxLaw'
import { FallbackSearchPort } from '../src/usecases/searchWithFallback'

const DATABASE_URL = process.env.DATABASE_URL
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

if (!DATABASE_URL) {
  console.error('[smoke] DATABASE_URL 환경변수가 필요합니다.')
  process.exit(1)
}
if (!OPENAI_API_KEY) {
  console.error('[smoke] OPENAI_API_KEY 환경변수가 필요합니다.')
  process.exit(1)
}

// 적재된 골든셋 조문과 의미적으로 맞닿는 질의들
const QUERIES = [
  '거주자 본인 기본공제 금액',
  '1세대 1주택 양도소득세 비과세 요건',
  '법인 접대비 손금불산입 한도',
]

// TAX-053: 비법령 전용 질의 — 법령으로는 안 잡히고 심판례·해석례로만 발굴되는 쟁점
// matchStage=vector 발동 + 비법령(심판례·해석례) 상위 반환 확인용
const NONLAW_QUERIES = [
  '가지급금 인정이자 계산 관련 세무 불복 사례',        // 법인세 심판례: 법령 직접검색 빈약
  '명의신탁 증여의제 실질과세 분쟁 심판 결정',        // 상속증여세 심판례: 구체적 사실관계 다툼
  '비상장주식 할인 평가 보충적 평가방법 적용 여부',  // 상속증여세 해석례·심판례
]

async function main() {
  const embedder = new OpenAIEmbeddingAdapter(OPENAI_API_KEY!)
  const vectorPort = new PgVectorSearchAdapter(DATABASE_URL!)

  // ─── [A] 벡터 검색 직접 동작 ──────────────────────────────────────────
  console.log('\n=== [A] 벡터 검색 직접 동작 (PgVectorSearchAdapter) ===')
  console.log('--- [A-1] 법령 기존 질의 ---')
  for (const q of QUERIES) {
    const vec = await embedder.embed(q)
    const matches = await vectorPort.searchSimilar(vec, 3)
    console.log(`\n질의: "${q}" → 상위 ${matches.length}건`)
    if (matches.length === 0) {
      console.log('  ⚠ 결과 0건 — 적재가 비어있거나 연결 문제')
      continue
    }
    for (const m of matches) {
      const id = m.item.sourceType === '법령'
        ? `${m.item.lawName} ${m.item.articleNumber}`
        : `${m.item.sourceType} ${m.item.caseNumber ?? m.item.lawName}`
      console.log(`  [${(m.similarity * 100).toFixed(1)}%] ${id} — ${m.item.articleTitle || '(제목없음)'}`)
    }
  }

  // TAX-053: 비법령 전용 질의 — 심판례·해석례가 상위에 오는지 확인
  console.log('\n--- [A-2] 비법령 전용 질의 (TAX-053) ---')
  for (const q of NONLAW_QUERIES) {
    const vec = await embedder.embed(q)
    const matches = await vectorPort.searchSimilar(vec, 5)
    console.log(`\n질의: "${q}" → 상위 ${matches.length}건`)
    if (matches.length === 0) {
      console.log('  ⚠ 결과 0건')
      continue
    }
    let nonlawCount = 0
    for (const m of matches) {
      const id = m.item.sourceType === '법령'
        ? `${m.item.lawName} ${m.item.articleNumber}`
        : `${m.item.sourceType} ${m.item.caseNumber ?? m.item.lawName}`
      console.log(`  [${(m.similarity * 100).toFixed(1)}%] ${id} — ${m.item.articleTitle || '(제목없음)'}`)
      if (m.item.sourceType !== '법령') nonlawCount++
    }
    const mark = nonlawCount > 0 ? '✅ 비법령 발굴' : '⚠ 비법령 미발굴'
    console.log(`  → ${mark} (비법령 ${nonlawCount}/${matches.length}건)`)
  }

  // ─── [B] FallbackSearchPort 단계 전이 ────────────────────────────────
  console.log('\n\n=== [B] FallbackSearchPort 3단계 전이 ===')
  const fallback = new FallbackSearchPort(
    new NationalTaxLawAdapter(),
    embedder,
    vectorPort,
  )
  console.log('--- [B-1] 법령 기존 질의 ---')
  for (const q of QUERIES) {
    const result = await fallback.search({ keyword: q, requestedAt: new Date() })
    const contentItems = result.items.filter((i) => i.content.trim().length > 0).length
    console.log(`\n질의: "${q}"`)
    console.log(`  matchStage=${result.matchStage} | 전체 ${result.items.length}건 (content 보유 ${contentItems}건)`)
  }

  // TAX-053: 비법령 전용 질의 — matchStage=vector 발동 확인
  console.log('\n--- [B-2] 비법령 전용 질의 matchStage 확인 (TAX-053) ---')
  for (const q of NONLAW_QUERIES) {
    const result = await fallback.search({ keyword: q, requestedAt: new Date() })
    const contentItems = result.items.filter((i) => i.content.trim().length > 0).length
    const nonlawItems = result.items.filter((i) => i.content.trim().length > 0 && i.sourceType !== '법령').length
    const mark = result.matchStage === 'vector' || result.matchStage === 'expanded' ? '✅ 벡터 단계 발동' : 'ℹ direct'
    console.log(`\n질의: "${q}"`)
    console.log(`  matchStage=${result.matchStage} ${mark} | 전체 ${result.items.length}건 (content 보유 ${contentItems}건, 비법령 ${nonlawItems}건)`)
  }

  console.log('\n[smoke] 완료 — 위 결과에서')
  console.log('  [A-2] 비법령 질의에 심판례·해석례가 상위에 반환되고')
  console.log('  [B-2] matchStage가 vector/expanded로 전이하면 TAX-053 PASS.')
  process.exit(0)
}

main().catch((err) => {
  console.error('[smoke] 오류:', err)
  process.exit(1)
})
