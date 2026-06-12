import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
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
  expectedStatus: 'PASS' | 'FAIL' | ''
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

const allCases: GoldenCase[] = [...directSet.cases, ...temporalCases, ...hallucinationCases]

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
