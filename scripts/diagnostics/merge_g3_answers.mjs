/**
 * G-3 재실측 결과 → golden_temporal.json 병합 스크립트
 *
 * phase6a_review_temporal.json에서 PASS 케이스의 실제 answer 데이터를 추출해서
 * golden_temporal.json의 sourceLaws·answer 필드에 채운다.
 * 정적 run_golden 테스트 편입을 위한 사전 작업.
 *
 * 실행: node scripts/diagnostics/merge_g3_answers.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const reviewPath = join(root, 'docs', 'reports', 'phase6a_review_temporal.json')
const goldenPath = join(root, 'eval', 'golden_temporal.json')

const reviews = JSON.parse(readFileSync(reviewPath, 'utf-8'))
const golden = JSON.parse(readFileSync(goldenPath, 'utf-8'))

// src/domain/disclaimer.ts의 DISCLAIMER 상수와 문자 단위 일치 (V5 검증 통과 필수)
const DISCLAIMER =
  '본 검색 결과는 국세법령정보시스템 공식 API에서 조회한 법령 원문을 그대로 인용한 것입니다. ' +
  '법령의 적용 여부 및 세무상 판단은 반드시 담당 세무사·회계사와 함께 확인하시기 바랍니다. ' +
  '본 시스템은 법적 조언을 제공하지 않으며, 검색 결과를 세무 신고·법적 주장의 직접 근거로 사용하는 것은 사용자의 책임입니다.'

let mergedCount = 0

for (const rev of reviews) {
  if (rev.outcome !== 'ANSWERED' || rev.verifyStatus !== 'PASS') continue
  if (!rev.citations || rev.citations.length === 0) continue

  const idx = golden.cases.findIndex(c => c.id === rev.id)
  if (idx < 0) { console.warn(`[SKIP] ${rev.id} 케이스 없음`); continue }

  // sourceLaws 재구성 — citations.contentFull 활용 (V1 통과 위해 모든 인용 포함)
  const sourceLaws = rev.citations.map(c => ({
    sourceType: c.sourceType || '법령',
    lawName: c.lawName,
    articleNumber: c.articleNumber || undefined,
    articleTitle: c.articleTitle || undefined,
    caseNumber: c.caseNumber || undefined,
    content: c.contentFull || '',
    revisionDate: c.revisionDate || undefined,
    enforcementDate: c.enforcementDate || undefined,
    sourceUrl: c.sourceUrl || undefined,
    trustTier: c.trustTier,
    issuingBody: c.issuingBody || undefined,
    decisionDate: c.decisionDate || undefined,
  }))

  if (sourceLaws.length === 0) {
    console.warn(`[SKIP] ${rev.id} — citations 없음`)
    continue
  }

  // answer 재구성 — run_golden V1~V6 검증 통과에 필요한 최소 필드
  const citations = rev.citations.map(c => ({
    taxLaw: {
      sourceType: c.sourceType || '법령',
      lawName: c.lawName,
      articleNumber: c.articleNumber || undefined,
      articleTitle: c.articleTitle || undefined,
      caseNumber: c.caseNumber || undefined,
      content: c.contentFull || '',
      revisionDate: c.revisionDate || undefined,
      enforcementDate: c.enforcementDate || undefined,
      sourceUrl: c.sourceUrl || undefined,
      trustTier: c.trustTier,
    },
    label: c.label,
    excerpt: c.excerpt || '',
    temporalLabel: c.temporalLabel || rev.temporalLabel || '[현행]',
  }))

  const answer = {
    rawQuestion: rev.question,
    summary: rev.summary || '',
    citations,
    references: [],
    temporalLabel: rev.temporalLabel || '[현행]',
    disclaimer: DISCLAIMER,
    verificationResult: { status: 'PASS', checks: { v1: true, v2: true, v3: true, v4: true, v5: true, v6: true }, failReasons: [] },
  }

  golden.cases[idx] = {
    ...golden.cases[idx],
    sourceLaws,
    answer,
    expectedStatus: 'PASS',
    _mergedAt: rev.id + '@' + new Date().toISOString().slice(0, 10),
  }

  console.log(`✅ ${rev.id} 병합 완료 | temporalLabel=${rev.temporalLabel} | citations=${rev.citations.length}건`)
  mergedCount++
}

writeFileSync(goldenPath, JSON.stringify(golden, null, 2) + '\n', 'utf-8')
console.log(`\n총 ${mergedCount}건 병합 완료`)
console.log('다음: npx vitest run tests/golden/run_golden.test.ts')
