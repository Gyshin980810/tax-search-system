import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { LawVerifierAdapter } from '@/adapters/lawVerifier'
import { checkContent, type ContentSpec } from '@/domain/contentVerify'
import type { LabeledAnswer } from '@/domain/LabeledAnswer'
import type { TaxLaw } from '@/domain/TaxLaw'

// ─── 골든셋 JSON 로드 ────────────────────────────────────────────────────────

interface GoldenCase {
  id: string
  description: string
  question: string
  sourceLaws: TaxLaw[]
  answer: LabeledAnswer
  expectedStatus: 'PASS' | 'FAIL' | ''
  /** TAX-6B-9 내용 검증기(방안 A) — 회계사 작성 기대 명제 (선택) */
  expectedContent?: ContentSpec
}

interface GoldenSet {
  version: string
  cases: GoldenCase[]
}

// G-1·G-2: 법령·비법령 직접 검증 골든셋
const directPath = join(process.cwd(), 'eval', 'golden_direct.json')
const directSet: GoldenSet = JSON.parse(readFileSync(directPath, 'utf-8'))

// G-3: 시점 검색 골든셋 — expectedStatus가 채워진 케이스만 포함(회계사 검수 전 골격 제외)
const temporalPath = join(process.cwd(), 'eval', 'golden_temporal.json')
const temporalCases: GoldenCase[] = existsSync(temporalPath)
  ? (JSON.parse(readFileSync(temporalPath, 'utf-8')) as GoldenSet).cases.filter(
      (c) => c.expectedStatus === 'PASS' || c.expectedStatus === 'FAIL'
    )
  : []

// G-4: 환각 유발 골든셋 — expectedStatus가 채워진 케이스만 포함
const hallucinationPath = join(process.cwd(), 'eval', 'golden_hallucination.json')
const hallucinationCases: GoldenCase[] = existsSync(hallucinationPath)
  ? (JSON.parse(readFileSync(hallucinationPath, 'utf-8')) as GoldenSet).cases.filter(
      (c) => c.expectedStatus === 'PASS' || c.expectedStatus === 'FAIL'
    )
  : []

// G-5: 폐지·일몰 골든셋 — expectedStatus가 채워진 케이스만 포함(TAX-6B-6)
//  expectedStatus='' 인 골격 케이스는 회계사 검수 전이므로 실행에서 제외
const repealedPath = join(process.cwd(), 'eval', 'golden_repealed.json')
const repealedCases: GoldenCase[] = existsSync(repealedPath)
  ? (JSON.parse(readFileSync(repealedPath, 'utf-8')) as GoldenSet).cases.filter(
      (c) => c.expectedStatus === 'PASS' || c.expectedStatus === 'FAIL'
    )
  : []

const allCases: GoldenCase[] = [...directSet.cases, ...temporalCases, ...hallucinationCases, ...repealedCases]

// ─── 테스트 ──────────────────────────────────────────────────────────────────

describe('골든셋 V1~V6 직접 검증 (실제 API 없음)', () => {
  const verifier = new LawVerifierAdapter()

  for (const tc of allCases) {
    it(`[${tc.id}] ${tc.description}`, async () => {
      const result = await verifier.verify(tc.answer, tc.sourceLaws)

      // 기대 status (PASS / FAIL)
      expect(result.status).toBe(tc.expectedStatus)

      // PASS 케이스는 모든 checks가 true여야 함
      if (tc.expectedStatus === 'PASS') {
        expect(result.checks.v1).toBe(true)
        expect(result.checks.v2).toBe(true)
        expect(result.checks.v3).toBe(true)
        expect(result.checks.v4).toBe(true)
        expect(result.checks.v5).toBe(true)
        expect(result.checks.v6).toBe(true)
        expect(result.failReasons).toHaveLength(0)
      }
    })
  }
})

// ─── 내용(도메인 정확도) 검증 — TAX-6B-9 방안 A ───────────────────────────────
//   V1~V6와 완전 분리된 별도 트랙. expectedContent 필드가 있는 케이스만 대상.
//   "인용은 정직하지만 사실은 틀린"(조용한 틀림) 유형 탐지.
//
// ⚠️ 현재 G5-06·G5-10의 expectedContent는 AI 제안값(_expectedContentProposedBy)이며
//    회계사 검수 전이다. 검수 전까지 이 두 케이스는 실제 답변 기준 CONTENT_FAIL이
//    "기대된" 상태이므로(=조용한 틀림을 잡아내야 함), 골든 회귀에서는 검증기가
//    탐지에 성공하는지(=CONTENT_FAIL 산출)를 회귀 기준으로 둔다.
const contentCases = allCases.filter(
  (c): c is GoldenCase & { expectedContent: ContentSpec } => c.expectedContent != null
)

describe('골든셋 내용 검증 (TAX-6B-9 방안 A, expectedContent 있는 케이스만)', () => {
  it('내용 검증 대상 케이스가 1건 이상 존재', () => {
    expect(contentCases.length).toBeGreaterThan(0)
  })

  for (const tc of contentCases) {
    it(`[${tc.id}] 내용 검증기가 "조용한 틀림"을 CONTENT_FAIL로 탐지`, () => {
      const result = checkContent(tc.answer.summary, tc.expectedContent)

      // G5-06·G5-10은 도메인상 틀린 답변(사실 오류·검색 누락)이므로
      // 내용 검증기가 이를 CONTENT_FAIL로 잡아내야 한다 (티켓 합격 기준).
      expect(result.status).toBe('CONTENT_FAIL')
    })
  }
})
