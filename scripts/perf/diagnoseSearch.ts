/**
 * 단일 골든셋 케이스의 검색 결과 크기 진단 (TAX-042F 사전 진단 일회용)
 *
 * 목적:
 *   특정 케이스가 LLM 입력 컨텍스트 윈도우 초과를 일으키는 원인을
 *   "단일 거대 조문" vs "다수 조문 누적"으로 가른다.
 *
 * 동작:
 *   queryRewriter + searchPort만 실행. answerGenerator·verifier 호출 안 함.
 *   결과 TaxLaw[] 개수·각 content 크기·직렬화 후 총 char/추정 토큰 출력.
 *
 * 비즈니스 로직 무변경 보장:
 *   src/ 어댑터·usecase·도메인 모두 import만 한다.
 *
 * 실행:
 *   npm run perf:diagnose-search -- <caseId>
 */

import 'server-only'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { OpenAIQueryRewriterAdapter } from '../../src/adapters/llmQueryRewriter'
import { NationalTaxLawAdapter } from '../../src/adapters/nationalTaxLaw'
import type { TemporalContext } from '../../src/domain/TemporalContext'
import type { TaxLaw } from '../../src/domain/TaxLaw'

interface GoldenCase {
  id: string
  question: string
}

function loadCase(caseId: string): GoldenCase {
  const path = join(process.cwd(), 'eval', 'golden_direct.json')
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as { cases: GoldenCase[] }
  const found = raw.cases.find((c) => c.id === caseId)
  if (!found) {
    console.error(`case not found: ${caseId}`)
    process.exit(1)
  }
  return found
}

/**
 * 간이 한국어 토큰 추정.
 * 한글 1자당 ~2 토큰, 영문/숫자/공백 1자당 ~0.3 토큰 (GPT 계열 근사).
 */
function estimateTokens(s: string): number {
  let hangul = 0
  let other = 0
  for (const ch of s) {
    if (ch >= '가' && ch <= '힣') hangul++
    else other++
  }
  return Math.ceil(hangul * 2 + other * 0.3)
}

function summarizeLaws(laws: TaxLaw[]): void {
  console.log(`\n검색 결과 조문 개수: ${laws.length}`)
  console.log('-'.repeat(60))
  let totalChars = 0
  let totalTokens = 0
  laws.forEach((l, i) => {
    const len = l.content.length
    const tok = estimateTokens(l.content)
    totalChars += len
    totalTokens += tok
    console.log(
      `[${i}] tier=${l.trustTier} ${l.lawName} ${l.articleNumber} ` +
        `content=${len}자 (~${tok}토큰)`,
    )
  })
  console.log('-'.repeat(60))
  console.log(`총 content 합계: ${totalChars}자 (~${totalTokens}토큰)`)
  console.log(`GPT-4o-mini 입력 윈도우: 128,000 토큰`)
  console.log(`초과 여부: ${totalTokens > 128_000 ? '⚠️ 초과' : '✅ 윈도우 내'}`)
  if (totalTokens <= 128_000) {
    console.log(
      `(시스템 프롬프트·질문·메타데이터·출력 16K 예약분 포함 시 안전 마진 = ${(128_000 - totalTokens - 16_000).toLocaleString()} 토큰)`,
    )
  }
}

async function main(): Promise<void> {
  const caseId = process.argv[2]
  if (!caseId) {
    console.error('Usage: npm run perf:diagnose-search -- <caseId>')
    process.exit(1)
  }

  const tc = loadCase(caseId)
  console.log(`\n사전 진단: ${caseId}`)
  console.log(`질문: ${tc.question}`)

  const rewriter = new OpenAIQueryRewriterAdapter()
  const search = new NationalTaxLawAdapter()
  const temporal: TemporalContext = { requestedAt: new Date(), explicit: false }

  console.log('\n[1] queryRewriter 호출 중...')
  const queries = await rewriter.rewrite(tc.question, temporal)
  console.log(`재작성 쿼리 ${queries.length}개:`)
  queries.forEach((q, i) => console.log(`  [${i}] keyword="${q.keyword}"`))

  console.log('\n[2] searchPort 호출 중...')
  const laws: TaxLaw[] = []
  for (const q of queries) {
    const result = await search.search(q)
    console.log(`  쿼리 "${q.keyword}" → items=${result.items.length} totalCount=${result.totalCount}`)
    laws.push(...result.items)
  }

  summarizeLaws(laws)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
