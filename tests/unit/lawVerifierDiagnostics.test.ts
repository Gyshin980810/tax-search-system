/**
 * @vitest-environment node
 *
 * TAX-042D-1 단위 테스트 — computeVerifyDiagnostics (풀세트 보강 E·F·G)
 *
 * V3 라벨 적정성 진단 마커 분류 + lawVerifier.checkV3와의 일치성 회귀 검증.
 *
 * 보호 대상 (CLAUDE.md §6.4):
 *   - V3·V6 PASS/FAIL 판정 로직 절대 무변경
 *   - 본 단위는 진단 마커(verifyMarker·tierMatchGrade·v3Groups)만 검증한다.
 */
import { describe, it, expect } from 'vitest'
import { computeVerifyDiagnostics } from '@/adapters/verifyDiagnostics'
import { LawVerifierAdapter } from '@/adapters/lawVerifier'
import type { LabeledAnswer } from '@/domain/LabeledAnswer'
import type { TaxLaw, TrustTier } from '@/domain/TaxLaw'
import type { Citation, CitationLabel } from '@/domain/Citation'
import { pendingVerification } from '@/domain/VerificationResult'
import { DISCLAIMER } from '@/domain/disclaimer'

// ─── 픽스처 헬퍼 ────────────────────────────────────────────────────────────

function makeTaxLaw(tier: TrustTier, overrides: Partial<TaxLaw> = {}): TaxLaw {
  const isLaw = tier === 'T1' || tier === 'T2'
  return {
    sourceType: isLaw ? '법령' : '심판례',
    lawName: isLaw ? '부가가치세법' : '조세심판원 결정례',
    articleNumber: isLaw ? '제26조' : '',
    articleTitle: '면세',
    content:
      '제26조 다음 각 호의 재화 또는 용역의 공급에 대하여는 부가가치세를 면제한다.',
    revisionDate: '2026-01-01',
    enforcementDate: '2026-01-01',
    sourceUrl: 'https://www.law.go.kr/test',
    trustTier: tier,
    ...overrides,
  }
}

function makeCitation(taxLaw: TaxLaw, label: CitationLabel): Citation {
  return {
    taxLaw,
    label,
    excerpt: '부가가치세를 면제한다',
    temporalLabel: taxLaw.sourceType === '법령' ? '[현행]' : '[결정: 2025.03.15]',
  }
}

function makeAnswer(citations: Citation[]): LabeledAnswer {
  return {
    rawQuestion: '면세 대상 재화',
    citations,
    summary: '면세 대상 재화·용역에는 부가가치세가 면제됩니다.',
    disclaimer: DISCLAIMER,
    temporalLabel: '[현행]',
    verificationResult: pendingVerification(),
    generatedAt: new Date('2026-06-08'),
  }
}

// ─── 단위 테스트 ────────────────────────────────────────────────────────────

describe('computeVerifyDiagnostics — TAX-042D-1 풀세트 보강 E·F·G', () => {
  it('(a) T3+🟡유사사례 → VERIFIED/exact, v3Groups 모두 pass', () => {
    const t3 = makeTaxLaw('T3', {
      sourceType: '심판례',
      caseNumber: '조심2024국1234',
      decisionDate: '2025-03-15',
    })
    const answer = makeAnswer([makeCitation(t3, '🟡유사사례')])

    const diagnostics = computeVerifyDiagnostics(answer)

    expect(diagnostics.verifyMarker).toBe('VERIFIED')
    expect(diagnostics.tierMatchGrade).toBe('exact')
    expect(diagnostics.v3Groups.labelEnum).toBe('pass')
    expect(diagnostics.v3Groups.tierMapping).toBe('pass')
    expect(diagnostics.v3Groups.deprecation).toBe('pass')
  })

  it('(b) T3+🟢직접근거 → LABEL_MISMATCH/mismatch, v3Groups.tierMapping=fail (위험 방향)', () => {
    const t3 = makeTaxLaw('T3', {
      sourceType: '심판례',
      caseNumber: '조심2024국5678',
      decisionDate: '2025-04-20',
    })
    const answer = makeAnswer([makeCitation(t3, '🟢직접근거')])

    const diagnostics = computeVerifyDiagnostics(answer)

    expect(diagnostics.verifyMarker).toBe('LABEL_MISMATCH')
    expect(diagnostics.tierMatchGrade).toBe('mismatch')
    // 🟢는 CitationLabel enum 안에 있으므로 labelEnum은 pass
    expect(diagnostics.v3Groups.labelEnum).toBe('pass')
    // T3에는 🟢 허용 안 됨 — tierMapping fail
    expect(diagnostics.v3Groups.tierMapping).toBe('fail')
    expect(diagnostics.v3Groups.deprecation).toBe('pass')
  })

  it('(c) T1+⚪참고자료 → PARTIAL_VERIFIED/loose (안전 방향, over-cautious)', () => {
    const t1 = makeTaxLaw('T1')
    const answer = makeAnswer([makeCitation(t1, '⚪참고자료')])

    const diagnostics = computeVerifyDiagnostics(answer)

    expect(diagnostics.verifyMarker).toBe('PARTIAL_VERIFIED')
    expect(diagnostics.tierMatchGrade).toBe('loose')
    // ⚪는 CitationLabel enum 안에 있으므로 labelEnum은 pass
    expect(diagnostics.v3Groups.labelEnum).toBe('pass')
    // T1에는 ⚪ 허용 안 됨 — tierMapping fail
    expect(diagnostics.v3Groups.tierMapping).toBe('fail')
    expect(diagnostics.v3Groups.deprecation).toBe('pass')
  })

  it('(d) [회귀] checkV3 PASS 답변은 v3Groups.tierMapping도 pass — 일치성 보장', async () => {
    // T1·T2·T3·T4 각 Tier 정상 라벨 4건 — V3 PASS 케이스
    const citations: Citation[] = [
      makeCitation(makeTaxLaw('T1'), '🟢직접근거'),
      makeCitation(makeTaxLaw('T2'), '🟢직접근거'),
      makeCitation(
        makeTaxLaw('T3', {
          sourceType: '심판례',
          caseNumber: '조심2024국1111',
          decisionDate: '2025-01-10',
        }),
        '🟡유사사례',
      ),
      makeCitation(
        makeTaxLaw('T4', {
          sourceType: '판례',
          caseNumber: '대법2024두1234',
          decisionDate: '2024-12-15',
        }),
        '⚪참고자료',
      ),
    ]
    const answer = makeAnswer(citations)
    const verifier = new LawVerifierAdapter()
    // V1 통과용 — citation의 taxLaw를 sourceLaws에 그대로 주입
    const sourceLaws = citations.map((c) => c.taxLaw)

    const verifyResult = await verifier.verify(answer, sourceLaws)
    const diagnostics = computeVerifyDiagnostics(answer)

    // 일치성: V3 PASS ⇔ tierMapping=pass ⇔ verifyMarker=VERIFIED
    expect(verifyResult.checks.v3).toBe(true)
    expect(diagnostics.v3Groups.tierMapping).toBe('pass')
    expect(diagnostics.verifyMarker).toBe('VERIFIED')
    expect(diagnostics.tierMatchGrade).toBe('exact')
  })
})
