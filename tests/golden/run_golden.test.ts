import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { LawVerifierAdapter } from '@/adapters/lawVerifier'
import type { LabeledAnswer } from '@/domain/LabeledAnswer'
import type { TaxLaw } from '@/domain/TaxLaw'

// ─── 골든셋 JSON 로드 ────────────────────────────────────────────────────────

interface GoldenCase {
  id: string
  description: string
  question: string
  sourceLaws: TaxLaw[]
  answer: LabeledAnswer
  expectedStatus: 'PASS' | 'FAIL'
}

interface GoldenSet {
  version: string
  cases: GoldenCase[]
}

const goldenPath = join(process.cwd(), 'eval', 'golden_direct.json')
const goldenSet: GoldenSet = JSON.parse(readFileSync(goldenPath, 'utf-8'))

// ─── 테스트 ──────────────────────────────────────────────────────────────────

describe('골든셋 V1~V6 직접 검증 (실제 API 없음)', () => {
  const verifier = new LawVerifierAdapter()

  for (const tc of goldenSet.cases) {
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
