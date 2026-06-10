import { describe, it, expect, beforeEach } from 'vitest'
import { LawVerifierAdapter } from '@/adapters/lawVerifier'
import type { LabeledAnswer } from '@/domain/LabeledAnswer'
import type { TaxLaw } from '@/domain/TaxLaw'
import type { Citation } from '@/domain/Citation'
import { DISCLAIMER } from '@/domain/disclaimer'

// ─── 테스트용 픽스처 헬퍼 ──────────────────────────────────────────────────

const SAMPLE_CONTENT = '부가가치세법 제26조에 따르면 다음 각 호의 재화 또는 용역의 공급에는 부가가치세를 면제한다.'

function makeTaxLaw(overrides: Partial<TaxLaw> = {}): TaxLaw {
  return {
    sourceType: '법령',
    lawName: '부가가치세법',
    articleNumber: '제26조',
    articleTitle: '면세',
    content: SAMPLE_CONTENT,
    revisionDate: '2024-01-01',
    enforcementDate: '2024-01-01',
    sourceUrl: 'https://www.law.go.kr/test',
    trustTier: 'T1',
    ...overrides,
  }
}

function makeCitation(overrides: Partial<Citation> = {}): Citation {
  return {
    taxLaw: makeTaxLaw(),
    label: '🟢직접근거',
    excerpt: '다음 각 호의 재화 또는 용역의 공급에는 부가가치세를 면제한다.',
    temporalLabel: '[현행]',
    ...overrides,
  }
}

function makeAnswer(overrides: Partial<LabeledAnswer> = {}): LabeledAnswer {
  return {
    rawQuestion: '부가가치세 면세 항목은 무엇인가요?',
    citations: [makeCitation()],
    summary: '부가가치세법 제26조에 따르면 의료 용역 등은 면세 대상입니다.',
    disclaimer: DISCLAIMER,
    temporalLabel: '[현행]',
    verificationResult: { status: 'PENDING', checks: { v1: false, v2: false, v3: false, v4: false, v5: false, v6: false }, failReasons: [] },
    generatedAt: new Date(),
    ...overrides,
  }
}

// ─── 테스트 본문 ──────────────────────────────────────────────────────────

describe('LawVerifierAdapter — V1~V6 검증 단위 테스트', () => {
  let verifier: LawVerifierAdapter
  let sourceLaws: TaxLaw[]

  beforeEach(() => {
    verifier = new LawVerifierAdapter()
    sourceLaws = [makeTaxLaw()]
  })

  // ─── 전체 PASS ────────────────────────────────────────────────────────
  describe('모든 조건 충족 시 PASS', () => {
    it('정상 답변은 PASS를 반환한다', async () => {
      const answer = makeAnswer()
      const result = await verifier.verify(answer, sourceLaws)

      expect(result.status).toBe('PASS')
      expect(result.checks.v1).toBe(true)
      expect(result.checks.v2).toBe(true)
      expect(result.checks.v3).toBe(true)
      expect(result.checks.v4).toBe(true)
      expect(result.checks.v5).toBe(true)
      expect(result.checks.v6).toBe(true)
      expect(result.failReasons).toHaveLength(0)
    })

    it('인용이 없는 답변도 PASS를 반환한다', async () => {
      const answer = makeAnswer({ citations: [] })
      const result = await verifier.verify(answer, sourceLaws)
      expect(result.status).toBe('PASS')
    })
  })

  // ─── V1: 출처 존재 ────────────────────────────────────────────────────
  describe('V1 — 출처 존재 검증', () => {
    it('인용 조문이 sourceLaws에 있으면 v1=true', async () => {
      const result = await verifier.verify(makeAnswer(), sourceLaws)
      expect(result.checks.v1).toBe(true)
    })

    it('인용 조문의 lawName이 sourceLaws에 없으면 v1=false', async () => {
      const citation = makeCitation({ taxLaw: makeTaxLaw({ lawName: '법인세법' }) })
      const answer = makeAnswer({ citations: [citation] })
      const result = await verifier.verify(answer, sourceLaws)

      expect(result.status).toBe('FAIL')
      expect(result.checks.v1).toBe(false)
      expect(result.failReasons.some((r) => r.startsWith('V1:'))).toBe(true)
    })

    it('인용 조문의 articleNumber가 sourceLaws에 없으면 v1=false', async () => {
      const citation = makeCitation({ taxLaw: makeTaxLaw({ articleNumber: '제99조' }) })
      const answer = makeAnswer({ citations: [citation] })
      const result = await verifier.verify(answer, sourceLaws)

      expect(result.checks.v1).toBe(false)
    })

    it('여러 인용 중 하나라도 sourceLaws에 없으면 v1=false', async () => {
      const validCitation = makeCitation()
      const invalidCitation = makeCitation({ taxLaw: makeTaxLaw({ articleNumber: '제999조' }) })
      const answer = makeAnswer({ citations: [validCitation, invalidCitation] })
      const result = await verifier.verify(answer, sourceLaws)

      expect(result.checks.v1).toBe(false)
    })
  })

  // ─── V2: 인용 무결성 ──────────────────────────────────────────────────
  describe('V2 — 인용 무결성 검증', () => {
    it('excerpt가 content의 부분 문자열이면 v2=true', async () => {
      const result = await verifier.verify(makeAnswer(), sourceLaws)
      expect(result.checks.v2).toBe(true)
    })

    it('excerpt가 content에 없으면 v2=false (의역 감지)', async () => {
      const citation = makeCitation({ excerpt: '부가가치세를 내지 않아도 되는 항목이다.' })
      const answer = makeAnswer({ citations: [citation] })
      const result = await verifier.verify(answer, sourceLaws)

      expect(result.status).toBe('FAIL')
      expect(result.checks.v2).toBe(false)
      expect(result.failReasons.some((r) => r.startsWith('V2:'))).toBe(true)
    })

    it('앞뒤 공백만 다른 excerpt는 v2=true (trim 허용)', async () => {
      const citation = makeCitation({ excerpt: '  다음 각 호의 재화 또는 용역의 공급에는 부가가치세를 면제한다.  ' })
      const answer = makeAnswer({ citations: [citation] })
      const result = await verifier.verify(answer, sourceLaws)

      expect(result.checks.v2).toBe(true)
    })

    // ─── BUG-005 (N-2): 빈 발췌 사각지대 차단 ─────────────────────────
    //  기존 동작("빈 excerpt는 v2 검증을 건너뛴다 → v2=true")은 사양 위반이었음.
    //  citation이 존재하면서 발췌가 비어있으면 무결성 위반이므로 v2=false.
    it('citation이 있는데 빈 excerpt면 v2=false (BUG-005 — N-2)', async () => {
      const citation = makeCitation({ excerpt: '' })
      const answer = makeAnswer({ citations: [citation] })
      const result = await verifier.verify(answer, sourceLaws)

      expect(result.status).toBe('FAIL')
      expect(result.checks.v2).toBe(false)
      expect(result.failReasons.some((r) => r.includes('비어 있음'))).toBe(true)
    })

    it('citations:[] (인용 없음)은 V2 영향 없음 — PASS 보존 (BUG-005 회귀 가드)', async () => {
      // "직접 근거를 찾지 못함" 정상 케이스 — V2 루프 자체를 안 도므로 v2=true 유지.
      const answer = makeAnswer({ citations: [] })
      const result = await verifier.verify(answer, sourceLaws)

      expect(result.checks.v2).toBe(true)
      expect(result.status).toBe('PASS')
    })

    // ─── BUG-002: summary 환각 인용 차단 ──────────────────────────────
    it('summary에 sourceLaws에 없는 큰따옴표 인용이 있으면 v2=false (환각 차단)', async () => {
      const answer = makeAnswer({
        summary: '소득세법 제99조는 "전액 비과세"라고 규정합니다.',
      })
      const result = await verifier.verify(answer, sourceLaws)

      expect(result.status).toBe('FAIL')
      expect(result.checks.v2).toBe(false)
      expect(result.failReasons.some((r) => r.includes('summary 인용'))).toBe(true)
    })

    it('summary 큰따옴표 인용이 원문 부분 문자열이면 v2=true', async () => {
      const answer = makeAnswer({
        summary: '부가가치세법에 따르면 "부가가치세를 면제한다"고 명시되어 있습니다.',
      })
      const result = await verifier.verify(answer, sourceLaws)

      expect(result.checks.v2).toBe(true)
    })

    it('따옴표 없는 일반 요약은 summary 검사에 영향받지 않는다', async () => {
      const answer = makeAnswer({
        summary: '의료 용역 등은 부가가치세 면세 대상으로 분류됩니다.',
      })
      const result = await verifier.verify(answer, sourceLaws)

      expect(result.checks.v2).toBe(true)
    })

    it('곡선 큰따옴표(“ ”)로 친 환각 인용도 v2=false', async () => {
      const answer = makeAnswer({
        summary: '소득세법은 “전액 비과세”라고 규정합니다.',
      })
      const result = await verifier.verify(answer, sourceLaws)

      expect(result.status).toBe('FAIL')
      expect(result.checks.v2).toBe(false)
    })
  })

  // ─── V3: 라벨 적정성 ──────────────────────────────────────────────────
  describe('V3 — 라벨 적정성 검증', () => {
    it('T1 출처에 🟢직접근거 라벨이면 v3=true', async () => {
      const result = await verifier.verify(makeAnswer(), sourceLaws)
      expect(result.checks.v3).toBe(true)
    })

    it('T2 출처에 🟢직접근거 라벨이면 v3=true', async () => {
      const citation = makeCitation({ taxLaw: makeTaxLaw({ trustTier: 'T2' }), label: '🟢직접근거' })
      const answer = makeAnswer({ citations: [citation] })
      const result = await verifier.verify(answer, sourceLaws)
      expect(result.checks.v3).toBe(true)
    })

    it('T3 출처에 🟡유사사례 라벨이면 v3=true', async () => {
      const taxLaw = makeTaxLaw({ trustTier: 'T3' })
      const citation = makeCitation({ taxLaw, label: '🟡유사사례' })
      const src = [taxLaw]
      const answer = makeAnswer({ citations: [citation], summary: '유사한 사례를 참고할 수 있습니다.' })
      const result = await verifier.verify(answer, src)
      expect(result.checks.v3).toBe(true)
    })

    it('T4 출처에 ⚪참고자료 라벨이면 v3=true', async () => {
      const taxLaw = makeTaxLaw({ trustTier: 'T4' })
      const citation = makeCitation({ taxLaw, label: '⚪참고자료' })
      const src = [taxLaw]
      const answer = makeAnswer({ citations: [citation] })
      const result = await verifier.verify(answer, src)
      expect(result.checks.v3).toBe(true)
    })

    it('T1 출처에 🟡유사사례 라벨이면 v3=false', async () => {
      const citation = makeCitation({ taxLaw: makeTaxLaw({ trustTier: 'T1' }), label: '🟡유사사례' })
      const answer = makeAnswer({ citations: [citation] })
      const result = await verifier.verify(answer, sourceLaws)

      expect(result.status).toBe('FAIL')
      expect(result.checks.v3).toBe(false)
      expect(result.failReasons.some((r) => r.startsWith('V3:'))).toBe(true)
    })

    it('T3 출처에 🟢직접근거 라벨이면 v3=false', async () => {
      const taxLaw = makeTaxLaw({ trustTier: 'T3' })
      const citation = makeCitation({ taxLaw, label: '🟢직접근거' })
      const src = [taxLaw]
      const answer = makeAnswer({ citations: [citation] })
      const result = await verifier.verify(answer, src)

      expect(result.checks.v3).toBe(false)
    })

    it('모든 Tier에서 ⚫폐지 라벨은 v3=true', async () => {
      for (const tier of ['T1', 'T2', 'T3', 'T4'] as const) {
        const taxLaw = makeTaxLaw({ trustTier: tier })
        const citation = makeCitation({ taxLaw, label: '⚫폐지' })
        const src = [taxLaw]
        const answer = makeAnswer({ citations: [citation] })
        const result = await verifier.verify(answer, src)
        expect(result.checks.v3).toBe(true)
      }
    })
  })

  // ─── V4: 시점 표기 ────────────────────────────────────────────────────
  describe('V4 — 시점 라벨 검증', () => {
    it('temporalLabel이 있으면 v4=true', async () => {
      const result = await verifier.verify(makeAnswer(), sourceLaws)
      expect(result.checks.v4).toBe(true)
    })

    it('temporalLabel이 빈 문자열이면 v4=false', async () => {
      const answer = makeAnswer({ temporalLabel: '' })
      const result = await verifier.verify(answer, sourceLaws)

      expect(result.status).toBe('FAIL')
      expect(result.checks.v4).toBe(false)
      expect(result.failReasons.some((r) => r.startsWith('V4:'))).toBe(true)
    })

    it('[현행], [적용 시점: ...], [폐지: ...] 형식 모두 v4=true', async () => {
      for (const label of ['[현행]', '[적용 시점: 2023.01.01~2023.12.31]', '[폐지: 2020.01.01]']) {
        const answer = makeAnswer({ temporalLabel: label })
        const result = await verifier.verify(answer, sourceLaws)
        expect(result.checks.v4).toBe(true)
      }
    })

    // ─── BUG-003 (M-1): 시점 라벨 3종 형식 검증 강화 ──────────────────
    it('형식에 맞지 않는 시점 라벨은 v4=false (BUG-003 — M-1)', async () => {
      const invalid = [
        '옛날 법',
        '2020년쯤',
        '현행',                              // 대괄호 없음
        '[적용 시점: 2020]',                  // 날짜 형식 불완전
        '[폐지: 2020]',                       // 날짜 형식 불완전
        '[적용 시점: 2023.01.01 ~ 2023.12.31]', // 사양 표기(~ 양옆 공백) — 현행 코드 기준에선 불일치(옵션 A)
      ]
      for (const label of invalid) {
        const answer = makeAnswer({ temporalLabel: label })
        const result = await verifier.verify(answer, sourceLaws)
        expect(result.checks.v4, `"${label}" 는 V4 FAIL이어야 함`).toBe(false)
        expect(result.failReasons.some((r) => r.includes('형식 불일치'))).toBe(true)
      }
    })

    it('형식 적합 라벨은 앞뒤 공백이 있어도 trim 후 v4=true (BUG-003)', async () => {
      const answer = makeAnswer({ temporalLabel: '  [현행]  ' })
      const result = await verifier.verify(answer, sourceLaws)
      expect(result.checks.v4).toBe(true)
    })
  })

  // ─── V5: 면책 고지 ────────────────────────────────────────────────────
  describe('V5 — 면책 고지 검증', () => {
    it('disclaimer가 있으면 v5=true', async () => {
      const result = await verifier.verify(makeAnswer(), sourceLaws)
      expect(result.checks.v5).toBe(true)
    })

    it('disclaimer가 빈 문자열이면 v5=false', async () => {
      const answer = makeAnswer({ disclaimer: '' })
      const result = await verifier.verify(answer, sourceLaws)

      expect(result.status).toBe('FAIL')
      expect(result.checks.v5).toBe(false)
      expect(result.failReasons.some((r) => r.startsWith('V5:'))).toBe(true)
    })

    // ─── BUG-003 (M-2): 면책 표준 문구(DISCLAIMER) 일치 검증 강화 ──────
    it('disclaimer가 DISCLAIMER 상수와 정확히 일치하면 v5=true (BUG-003 — M-2)', async () => {
      const answer = makeAnswer({ disclaimer: DISCLAIMER })
      const result = await verifier.verify(answer, sourceLaws)
      expect(result.checks.v5).toBe(true)
    })

    it('축약·왜곡된 면책은 v5=false (BUG-003 — M-2)', async () => {
      const distorted = [
        '참고용입니다',
        DISCLAIMER.slice(0, 50),        // 앞부분만 축약
        `${DISCLAIMER} (임의 추가 문구)`, // 임의 덧붙임
        '본 검색 결과는 참고 자료입니다.',
      ]
      for (const bad of distorted) {
        const answer = makeAnswer({ disclaimer: bad })
        const result = await verifier.verify(answer, sourceLaws)
        expect(result.checks.v5, `"${bad.slice(0, 20)}…" 는 V5 FAIL이어야 함`).toBe(false)
        expect(result.failReasons.some((r) => r.includes('표준 문구'))).toBe(true)
      }
    })

    it('앞뒤 공백만 다른 정상 면책은 trim 후 v5=true (BUG-003)', async () => {
      const answer = makeAnswer({ disclaimer: `  ${DISCLAIMER}  ` })
      const result = await verifier.verify(answer, sourceLaws)
      expect(result.checks.v5).toBe(true)
    })
  })

  // ─── V6: 단정 금지 ────────────────────────────────────────────────────
  describe('V6 — 단정형 표현 검증', () => {
    it('🟢직접근거만 있으면 단정형 표현이 있어도 v6=true', async () => {
      const answer = makeAnswer({
        citations: [makeCitation({ label: '🟢직접근거' })],
        summary: '이 경우 과세됩니다.',
      })
      const result = await verifier.verify(answer, sourceLaws)
      expect(result.checks.v6).toBe(true)
    })

    it('🟡유사사례가 있고 summary에 단정형 없으면 v6=true', async () => {
      const taxLaw = makeTaxLaw({ trustTier: 'T3' })
      const citation = makeCitation({ taxLaw, label: '🟡유사사례' })
      const answer = makeAnswer({
        citations: [citation],
        summary: '유사한 사례를 참고할 수 있으나, 사실관계에 따라 달라질 수 있습니다.',
      })
      const src = [taxLaw]
      const result = await verifier.verify(answer, src)
      expect(result.checks.v6).toBe(true)
    })

    it('🟡유사사례가 있고 "이 경우 ~입니다" 패턴이면 v6=false', async () => {
      const taxLaw = makeTaxLaw({ trustTier: 'T3' })
      const citation = makeCitation({ taxLaw, label: '🟡유사사례' })
      const answer = makeAnswer({
        citations: [citation],
        summary: '이 경우 과세됩니다.',
      })
      const src = [taxLaw]
      const result = await verifier.verify(answer, src)

      expect(result.status).toBe('FAIL')
      expect(result.checks.v6).toBe(false)
      expect(result.failReasons.some((r) => r.startsWith('V6:'))).toBe(true)
    })

    it('🟡유사사례가 있고 "따라서 ~됩니다" 패턴이면 v6=false', async () => {
      const taxLaw = makeTaxLaw({ trustTier: 'T3' })
      const citation = makeCitation({ taxLaw, label: '🟡유사사례' })
      const answer = makeAnswer({
        citations: [citation],
        summary: '따라서 세금을 납부해야됩니다.',
      })
      const src = [taxLaw]
      const result = await verifier.verify(answer, src)
      expect(result.checks.v6).toBe(false)
    })

    it('🟡유사사례가 있고 "반드시 ~해야 합니다" 패턴이면 v6=false', async () => {
      const taxLaw = makeTaxLaw({ trustTier: 'T3' })
      const citation = makeCitation({ taxLaw, label: '🟡유사사례' })
      const answer = makeAnswer({
        citations: [citation],
        summary: '반드시 신고해야 합니다.',
      })
      const src = [taxLaw]
      const result = await verifier.verify(answer, src)
      expect(result.checks.v6).toBe(false)
    })

    it('🟡유사사례가 없으면 summary에 단정형이 있어도 v6=true', async () => {
      const answer = makeAnswer({
        citations: [makeCitation({ label: '⚪참고자료' })],
        summary: '이 경우 과세됩니다.',
      })
      const result = await verifier.verify(answer, sourceLaws)
      expect(result.checks.v6).toBe(true)
    })
  })

  // ─── 복합 FAIL ────────────────────────────────────────────────────────
  describe('복합 실패 케이스', () => {
    it('V4·V5 동시 실패 시 둘 다 false이고 failReasons에 2건 기록된다', async () => {
      const answer = makeAnswer({ temporalLabel: '', disclaimer: '' })
      const result = await verifier.verify(answer, sourceLaws)

      expect(result.status).toBe('FAIL')
      expect(result.checks.v4).toBe(false)
      expect(result.checks.v5).toBe(false)
      expect(result.failReasons.filter((r) => r.startsWith('V4:'))).toHaveLength(1)
      expect(result.failReasons.filter((r) => r.startsWith('V5:'))).toHaveLength(1)
    })
  })

  // ─── 판례(비법령) 자료 검증 — TAX-015 ──────────────────────────────────
  describe('판례(비법령) 자료 검증 — TAX-015', () => {
    const PREC_CONTENT =
      '판결요지: 손해배상청구권의 성립 시기는 현실적으로 손해가 발생한 때이다.'
    const PREC_EXCERPT = '손해배상청구권의 성립 시기는 현실적으로 손해가 발생한 때이다.'

    function makePrecedent(overrides: Partial<TaxLaw> = {}): TaxLaw {
      return makeTaxLaw({
        sourceType: '판례',
        lawName: '대법원 2020다288436',
        articleNumber: '',          // 판례는 조문번호 없음
        caseNumber: '2020다288436',
        trustTier: 'T4',
        content: PREC_CONTENT,
        issuingBody: '대법원',
        decisionDate: '2026-03-12',
        ...overrides,
      })
    }

    it('판례 인용이 사건번호로 검색 결과에 있으면 V1 통과 (PASS)', async () => {
      const prec = makePrecedent()
      const citation = makeCitation({
        taxLaw: prec,
        label: '🟡유사사례',
        excerpt: PREC_EXCERPT,
      })
      const answer = makeAnswer({
        citations: [citation],
        summary: '유사한 사례를 참고할 수 있습니다.',
      })
      const result = await verifier.verify(answer, [prec])

      expect(result.checks.v1).toBe(true)
      expect(result.checks.v2).toBe(true)
      expect(result.status).toBe('PASS')
    })

    it('판례 사건번호가 검색 결과에 없으면 V1 FAIL (환각 차단)', async () => {
      const source = makePrecedent()
      const hallucinated = makePrecedent({
        lawName: '대법원 9999두9999',
        caseNumber: '9999두9999',
      })
      const citation = makeCitation({
        taxLaw: hallucinated,
        label: '🟡유사사례',
        excerpt: PREC_EXCERPT,
      })
      const answer = makeAnswer({
        citations: [citation],
        summary: '유사한 사례를 참고할 수 있습니다.',
      })
      const result = await verifier.verify(answer, [source])

      expect(result.checks.v1).toBe(false)
      expect(result.status).toBe('FAIL')
      expect(result.failReasons.some((r) => r.startsWith('V1:'))).toBe(true)
    })

    it('판례 발췌가 본문에 없으면 V2 FAIL (의역 차단)', async () => {
      const prec = makePrecedent()
      const citation = makeCitation({
        taxLaw: prec,
        label: '🟡유사사례',
        excerpt: '손해가 발생하지 않아도 청구권이 성립한다.', // 원문에 없는 의역
      })
      const answer = makeAnswer({
        citations: [citation],
        summary: '유사한 사례를 참고할 수 있습니다.',
      })
      const result = await verifier.verify(answer, [prec])

      expect(result.checks.v2).toBe(false)
      expect(result.status).toBe('FAIL')
    })

    it('판례(T4)에 🟢직접근거 라벨이면 V3 FAIL (단독 직접근거 금지)', async () => {
      const prec = makePrecedent()
      const citation = makeCitation({
        taxLaw: prec,
        label: '🟢직접근거',
        excerpt: PREC_EXCERPT,
      })
      const answer = makeAnswer({ citations: [citation] })
      const result = await verifier.verify(answer, [prec])

      expect(result.checks.v3).toBe(false)
    })

    it('법령과 판례가 섞인 검색 결과에서 각각 올바르게 매칭된다', async () => {
      const law = makeTaxLaw() // 법령(부가가치세법 제26조)
      const prec = makePrecedent()
      const lawCitation = makeCitation() // 기본 법령 인용
      const precCitation = makeCitation({
        taxLaw: prec,
        label: '🟡유사사례',
        excerpt: PREC_EXCERPT,
      })
      const answer = makeAnswer({
        citations: [lawCitation, precCitation],
        summary: '직접 근거 조문과 유사한 판례를 함께 참고할 수 있습니다.',
      })
      const result = await verifier.verify(answer, [law, prec])

      expect(result.checks.v1).toBe(true)
      expect(result.status).toBe('PASS')
    })
  })

  // ─── 법령해석례(비법령) 자료 검증 — TAX-016A ───────────────────────────
  describe('법령해석례(비법령) 자료 검증 — TAX-016A', () => {
    const EXPC_CONTENT =
      '양도소득세 비과세 대상에 해당하는지 여부\n비과세 대상에 해당한다.\n관련 법령 규정에 따르면 해당 자산은 비과세 요건을 충족한다.'
    const EXPC_EXCERPT = '관련 법령 규정에 따르면 해당 자산은 비과세 요건을 충족한다.'

    function makeInterpretation(overrides: Partial<TaxLaw> = {}): TaxLaw {
      return makeTaxLaw({
        sourceType: '해석례',
        lawName: '법제처 12-0368',
        articleNumber: '',          // 해석례는 조문번호 없음 — 식별자는 안건번호
        caseNumber: '12-0368',
        trustTier: 'T3',
        content: EXPC_CONTENT,
        issuingBody: '법제처',
        decisionDate: '2026-02-20',
        ...overrides,
      })
    }

    it('해석례 인용이 안건번호로 검색 결과에 있으면 V1·V2 통과 (PASS)', async () => {
      const expc = makeInterpretation()
      const citation = makeCitation({
        taxLaw: expc,
        label: '🟡유사사례',
        excerpt: EXPC_EXCERPT,
      })
      const answer = makeAnswer({
        citations: [citation],
        summary: '유사한 해석 사례를 참고할 수 있습니다.',
      })
      const result = await verifier.verify(answer, [expc])

      expect(result.checks.v1).toBe(true)
      expect(result.checks.v2).toBe(true)
      expect(result.status).toBe('PASS')
    })

    it('해석례 안건번호가 검색 결과에 없으면 V1 FAIL (환각 차단)', async () => {
      const source = makeInterpretation()
      const hallucinated = makeInterpretation({
        lawName: '법제처 99-9999',
        caseNumber: '99-9999',
      })
      const citation = makeCitation({
        taxLaw: hallucinated,
        label: '🟡유사사례',
        excerpt: EXPC_EXCERPT,
      })
      const answer = makeAnswer({
        citations: [citation],
        summary: '유사한 해석 사례를 참고할 수 있습니다.',
      })
      const result = await verifier.verify(answer, [source])

      expect(result.checks.v1).toBe(false)
      expect(result.status).toBe('FAIL')
      expect(result.failReasons.some((r) => r.startsWith('V1:'))).toBe(true)
    })

    it('해석례 발췌가 본문에 없으면 V2 FAIL (의역 차단)', async () => {
      const expc = makeInterpretation()
      const citation = makeCitation({
        taxLaw: expc,
        label: '🟡유사사례',
        excerpt: '요건을 충족하지 않아도 비과세된다.', // 원문에 없는 의역
      })
      const answer = makeAnswer({
        citations: [citation],
        summary: '유사한 해석 사례를 참고할 수 있습니다.',
      })
      const result = await verifier.verify(answer, [expc])

      expect(result.checks.v2).toBe(false)
      expect(result.status).toBe('FAIL')
    })

    it('해석례(T3)에 🟢직접근거 라벨이면 V3 FAIL (단독 직접근거 금지)', async () => {
      const expc = makeInterpretation()
      const citation = makeCitation({
        taxLaw: expc,
        label: '🟢직접근거',
        excerpt: EXPC_EXCERPT,
      })
      const answer = makeAnswer({ citations: [citation] })
      const result = await verifier.verify(answer, [expc])

      expect(result.checks.v3).toBe(false)
    })
  })

  // ─── 조세심판원 결정례(심판례·비법령) 자료 검증 — TAX-016C ──────────────────
  describe('조세심판원 결정례(심판례) 자료 검증 — TAX-016C', () => {
    const TT_CONTENT =
      '심판청구를 기각한다.\n조특법 제69조 제1항 단서에 따라 비과세 대상에 해당하지 않는다.\n청구인은 쟁점농지를 양도하고 양도소득세를 신고하였다.'
    const TT_EXCERPT = '조특법 제69조 제1항 단서에 따라 비과세 대상에 해당하지 않는다.'

    function makeTribunal(overrides: Partial<TaxLaw> = {}): TaxLaw {
      return makeTaxLaw({
        sourceType: '심판례',
        lawName: '조세심판원 조심 2020부1558',
        articleNumber: '',          // 심판례는 조문번호 없음 — 식별자는 청구번호
        caseNumber: '조심 2020부1558',
        trustTier: 'T3',
        content: TT_CONTENT,
        issuingBody: '조세심판원',
        decisionDate: '2020-06-16',
        ...overrides,
      })
    }

    it('심판례 인용이 청구번호로 검색 결과에 있으면 V1·V2 통과 (PASS)', async () => {
      const tt = makeTribunal()
      const citation = makeCitation({
        taxLaw: tt,
        label: '🟡유사사례',
        excerpt: TT_EXCERPT,
      })
      const answer = makeAnswer({
        citations: [citation],
        summary: '유사한 심판 사례를 참고할 수 있습니다.',
      })
      const result = await verifier.verify(answer, [tt])

      expect(result.checks.v1).toBe(true)
      expect(result.checks.v2).toBe(true)
      expect(result.status).toBe('PASS')
    })

    it('심판례 청구번호가 검색 결과에 없으면 V1 FAIL (환각 차단)', async () => {
      const source = makeTribunal()
      const hallucinated = makeTribunal({
        lawName: '조세심판원 조심 9999부9999',
        caseNumber: '조심 9999부9999',
      })
      const citation = makeCitation({
        taxLaw: hallucinated,
        label: '🟡유사사례',
        excerpt: TT_EXCERPT,
      })
      const answer = makeAnswer({
        citations: [citation],
        summary: '유사한 심판 사례를 참고할 수 있습니다.',
      })
      const result = await verifier.verify(answer, [source])

      expect(result.checks.v1).toBe(false)
      expect(result.status).toBe('FAIL')
      expect(result.failReasons.some((r) => r.startsWith('V1:'))).toBe(true)
    })

    it('심판례 발췌가 본문에 없으면 V2 FAIL (의역 차단)', async () => {
      const tt = makeTribunal()
      const citation = makeCitation({
        taxLaw: tt,
        label: '🟡유사사례',
        excerpt: '쟁점농지는 비과세 대상에 해당한다.', // 원문에 없는 의역
      })
      const answer = makeAnswer({
        citations: [citation],
        summary: '유사한 심판 사례를 참고할 수 있습니다.',
      })
      const result = await verifier.verify(answer, [tt])

      expect(result.checks.v2).toBe(false)
      expect(result.status).toBe('FAIL')
    })

    it('심판례(T3)에 🟢직접근거 라벨이면 V3 FAIL (단독 직접근거 금지)', async () => {
      const tt = makeTribunal()
      const citation = makeCitation({
        taxLaw: tt,
        label: '🟢직접근거',
        excerpt: TT_EXCERPT,
      })
      const answer = makeAnswer({ citations: [citation] })
      const result = await verifier.verify(answer, [tt])

      expect(result.checks.v3).toBe(false)
    })
  })
})
