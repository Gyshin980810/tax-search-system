/**
 * @vitest-environment node
 *
 * OpenAIAnswerGeneratorAdapter 통합 테스트
 * vi.mock으로 Vercel AI SDK generateObject를 모킹합니다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DISCLAIMER } from '@/domain/disclaimer'
import { LlmTimeoutError, LlmUnavailableError, LlmNetworkError } from '@/domain/errors'
import type { TaxLaw } from '@/domain/TaxLaw'
import type { TemporalContext } from '@/domain/TemporalContext'

// generateObject 모킹 — 실제 OpenAI API를 호출하지 않습니다.
// TAX-042A: 어댑터가 NoObjectGeneratedError·APICallError의 isInstance를 호출하므로
// importActual로 실제 클래스를 보존하고 generateObject만 mock으로 교체한다.
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    generateObject: vi.fn(),
  }
})

// @ai-sdk/openai 모킹
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => () => 'mock-model'),
}))

import { generateObject } from 'ai'
import { OpenAIAnswerGeneratorAdapter } from '@/adapters/llmAnswerGenerator'

// ─── 테스트용 픽스처 ─────────────────────────────────────────────────────────

const MOCK_LAW: TaxLaw = {
  sourceType: '법령',
  lawName: '부가가치세법',
  articleNumber: '제26조',
  articleTitle: '재화 또는 용역의 공급에 대한 면세',
  content: '제26조(재화 또는 용역의 공급에 대한 면세) 다음 각 호의 재화 또는 용역의 공급에 대하여는 부가가치세를 면제한다.',
  revisionDate: '2026-01-01',
  enforcementDate: '2026-01-01',
  sourceUrl: 'https://www.law.go.kr/lsInfoP.do?efYd=20260101&lsiSeq=276117',
  trustTier: 'T1',
}

const MOCK_TEMPORAL: TemporalContext = {
  requestedAt: new Date('2026-05-15'),
  explicit: false,
}

// TAX-041 옵션 A: LLM은 excerpt 대신 focusHint만 출력하고 어댑터가 content에서 substring 추출.
const MOCK_OPENAI_RESPONSE = {
  object: {
    citations: [
      {
        lawIndex: 0,
        label: '🟢직접근거',
        focusHint: '부가가치세를 면제한다',
        temporalLabel: '[현행]',
      },
    ],
    summary: '부가가치세법 제26조에 따라 면세 대상 재화·용역에는 부가가치세가 면제됩니다.',
    temporalLabel: '[현행]',
  },
}

// ─── 테스트 ──────────────────────────────────────────────────────────────────

describe('OpenAIAnswerGeneratorAdapter', () => {
  let adapter: OpenAIAnswerGeneratorAdapter
  const mockedGenerateObject = vi.mocked(generateObject)

  beforeEach(() => {
    adapter = new OpenAIAnswerGeneratorAdapter()
    vi.clearAllMocks()
  })

  describe('정상 응답', () => {
    it('LabeledAnswer를 반환하고 citations 배열이 존재한다', async () => {
      mockedGenerateObject.mockResolvedValueOnce(MOCK_OPENAI_RESPONSE as never)

      const result = await adapter.generate([MOCK_LAW], '부가가치세 면세 대상이 무엇인가요?', MOCK_TEMPORAL)

      expect(result.citations).toHaveLength(1)
      expect(result.citations[0].label).toBe('🟢직접근거')
      expect(result.citations[0].taxLaw).toBe(MOCK_LAW)
    })

    // TAX-041 옵션 A: 어댑터가 추출한 excerpt는 반드시 content의 정확한 substring이어야 한다 (V2 보장).
    it('excerpt는 항상 content의 정확한 substring이다 (V2 보장)', async () => {
      mockedGenerateObject.mockResolvedValueOnce(MOCK_OPENAI_RESPONSE as never)

      const result = await adapter.generate([MOCK_LAW], '부가가치세 면세 대상', MOCK_TEMPORAL)

      expect(MOCK_LAW.content.includes(result.citations[0].excerpt)).toBe(true)
    })

    it('disclaimer는 DISCLAIMER 상수 그대로다', async () => {
      mockedGenerateObject.mockResolvedValueOnce(MOCK_OPENAI_RESPONSE as never)

      const result = await adapter.generate([MOCK_LAW], '부가가치세 면세 대상', MOCK_TEMPORAL)

      expect(result.disclaimer).toBe(DISCLAIMER)
    })

    it('verificationResult.status는 PENDING이다 (M2)', async () => {
      mockedGenerateObject.mockResolvedValueOnce(MOCK_OPENAI_RESPONSE as never)

      const result = await adapter.generate([MOCK_LAW], '부가가치세 면세 대상', MOCK_TEMPORAL)

      expect(result.verificationResult.status).toBe('PENDING')
    })

    it('rawQuestion은 원본 질문을 그대로 보존한다', async () => {
      mockedGenerateObject.mockResolvedValueOnce(MOCK_OPENAI_RESPONSE as never)
      const question = '부가가치세 면세 대상이 무엇인가요?'

      const result = await adapter.generate([MOCK_LAW], question, MOCK_TEMPORAL)

      expect(result.rawQuestion).toBe(question)
    })

    it('법령 목록이 비어있을 때 빈 citations를 반환한다', async () => {
      mockedGenerateObject.mockResolvedValueOnce({
        object: { citations: [], summary: '직접 근거를 찾지 못했습니다.', temporalLabel: '[현행]' },
      } as never)

      const result = await adapter.generate([], '부가가치세 면세 대상', MOCK_TEMPORAL)

      expect(result.citations).toHaveLength(0)
    })

    it('lawIndex 범위 초과인 citation은 필터링된다', async () => {
      mockedGenerateObject.mockResolvedValueOnce({
        object: {
          citations: [
            { lawIndex: 0, label: '🟢직접근거', focusHint: '면제한다', temporalLabel: '[현행]' },
            { lawIndex: 99, label: '🟡유사사례', focusHint: '면제한다', temporalLabel: '[현행]' }, // 범위 초과
          ],
          summary: '요약',
          temporalLabel: '[현행]',
        },
      } as never)

      const result = await adapter.generate([MOCK_LAW], '질문', MOCK_TEMPORAL)

      expect(result.citations).toHaveLength(1)
    })
  })

  describe('에러 처리', () => {
    it('AbortError 발생 시 LlmTimeoutError를 던진다', async () => {
      const abortErr = new Error('aborted')
      abortErr.name = 'AbortError'
      mockedGenerateObject.mockRejectedValueOnce(abortErr)

      await expect(adapter.generate([MOCK_LAW], '질문', MOCK_TEMPORAL))
        .rejects.toBeInstanceOf(LlmTimeoutError)
    })

    it('네트워크 오류 발생 시 LlmNetworkError를 던진다 (TAX-042A 분기 세분화)', async () => {
      // 'Network error' 메시지는 isNetworkLikeError의 /network/i에 매칭되어
      // LlmNetworkError로 분류된다. TAX-042C: transient 1회 재시도가 추가되어
      // 모든 호출에 같은 에러 반환 → 2차도 실패 시 외부 catch가 LlmNetworkError를 던진다.
      mockedGenerateObject.mockRejectedValue(new Error('Network error'))

      await expect(adapter.generate([MOCK_LAW], '질문', MOCK_TEMPORAL))
        .rejects.toBeInstanceOf(LlmNetworkError)
    })

    it('알 수 없는 raw Error는 catch-all로 LlmUnavailableError를 던진다', async () => {
      mockedGenerateObject.mockRejectedValueOnce(new Error('보지 못한 사유'))

      await expect(adapter.generate([MOCK_LAW], '질문', MOCK_TEMPORAL))
        .rejects.toBeInstanceOf(LlmUnavailableError)
    })
  })

  describe('시점 컨텍스트', () => {
    it('explicit=true이면 프롬프트에 기준 시점이 포함된다', async () => {
      mockedGenerateObject.mockResolvedValueOnce(MOCK_OPENAI_RESPONSE as never)

      const temporalWithDate: TemporalContext = {
        requestedAt: new Date('2026-05-15'),
        targetDate: new Date('2023-01-01'),
        explicit: true,
      }

      await adapter.generate([MOCK_LAW], '2023년 귀속 부가가치세 면세 대상', temporalWithDate)

      const callArgs = mockedGenerateObject.mock.calls[0][0] as { prompt: string }
      expect(callArgs.prompt).toContain('2023-01-01')
    })
  })

  // ─── TAX-038: 비법령 [결정] 라벨 학습 ─────────────────────────────────────────
  //
  // TAX-037에서 lawVerifier V4 정규식이 [결정: YYYY.MM.DD]를 4번째 패턴으로 허용했지만,
  // 운영 LLM 프롬프트가 비법령 분기 규칙·sourceType·결정일을 모르면 [현행]으로 폴백되어
  // 결정일 맥락이 손실된다(TAX-037 리포트 §잠재 위험 1).
  //
  // 본 블록은 (1) 비법령 입력 시 컨텍스트에 sourceType·결정일이 노출되고,
  //         (2) 법령 입력 시 메타가 노출되지 않아 기존 출력 형식이 보존되며,
  //         (3) LLM이 [결정: ...]을 반환하면 그대로 통과됨을 단언한다.
  describe('TAX-038 비법령 [결정] 라벨 학습', () => {
    // 심판례 픽스처 — TAX-037 골든셋 G-S-NL과 동일한 sourceType·decisionDate 패턴
    const MOCK_TRIBUNAL: TaxLaw = {
      sourceType: '심판례',
      lawName: '조세심판원 조심 2020부1558',
      articleNumber: '',
      articleTitle: '쟁점농지 양도소득세 과세처분의 당부',
      content: '심판청구를 기각한다.\n조특법 제69조 제1항 단서에 따라 비과세 대상에 해당하지 않는다.',
      revisionDate: '2020-06-16',
      enforcementDate: '',
      sourceUrl: 'https://www.law.go.kr/allDeccSc.do?query=%EC%A1%B0%EC%8B%AC%202020%EB%B6%801558',
      trustTier: 'T3',
      caseNumber: '조심 2020부1558',
      issuingBody: '조세심판원',
      decisionDate: '2020-06-16',
    }

    it('[프롬프트] 비법령 입력 시 LLM 컨텍스트에 sourceType·결정일이 노출된다', async () => {
      mockedGenerateObject.mockResolvedValueOnce({
        object: {
          citations: [
            {
              lawIndex: 0,
              label: '🟡유사사례',
              focusHint: '심판청구를 기각한다',
              temporalLabel: '[결정: 2020.06.16]',
            },
          ],
          summary: '유사 사례에서는 쟁점농지 양도세를 비과세 대상으로 보지 않았습니다.',
          temporalLabel: '[결정: 2020.06.16]',
        },
      } as never)

      await adapter.generate([MOCK_TRIBUNAL], '농지 양도세 심판례', MOCK_TEMPORAL)

      const callPrompt = (mockedGenerateObject.mock.calls[0][0] as { prompt: string }).prompt
      expect(callPrompt).toContain('sourceType: 심판례')
      expect(callPrompt).toContain('결정일: 2020-06-16')
    })

    it('[응답] LLM이 [결정: YYYY.MM.DD] 형식을 반환하면 그대로 통과된다 (V4 PASS 보장)', async () => {
      mockedGenerateObject.mockResolvedValueOnce({
        object: {
          citations: [
            {
              lawIndex: 0,
              label: '🟡유사사례',
              focusHint: '심판청구를 기각한다',
              temporalLabel: '[결정: 2020.06.16]',
            },
          ],
          summary: '유사 사례에서는 ...',
          temporalLabel: '[결정: 2020.06.16]',
        },
      } as never)

      const result = await adapter.generate([MOCK_TRIBUNAL], '농지 양도세 심판례', MOCK_TEMPORAL)

      // [결정: ...] 라벨은 lawVerifier V4 4번째 정규식(TAX-037)과 정확히 매칭됨
      expect(result.temporalLabel).toBe('[결정: 2020.06.16]')
      expect(result.citations[0].temporalLabel).toBe('[결정: 2020.06.16]')
    })

    it('[회귀 방지] 법령 입력 시 컨텍스트에 sourceType·결정일 메타가 노출되지 않는다', async () => {
      mockedGenerateObject.mockResolvedValueOnce(MOCK_OPENAI_RESPONSE as never)

      await adapter.generate([MOCK_LAW], '부가가치세 면세 대상', MOCK_TEMPORAL)

      const callPrompt = (mockedGenerateObject.mock.calls[0][0] as { prompt: string }).prompt
      // 법령 케이스는 nonlawMeta=''이라 기존 출력 형식을 그대로 보존해야 한다
      expect(callPrompt).not.toContain('sourceType:')
      expect(callPrompt).not.toContain('결정일:')
      // 기존 형식의 핵심 토큰은 그대로
      expect(callPrompt).toContain('[0] 부가가치세법 제26조 (T1)')
      expect(callPrompt).toContain('시행일: 2026-01-01')
    })

    it('[결정일 불명] 비법령에 decisionDate 없으면 "불명"으로 노출되어 [현행] 폴백 허용', async () => {
      const tribunalNoDate: TaxLaw = { ...MOCK_TRIBUNAL, decisionDate: undefined }
      mockedGenerateObject.mockResolvedValueOnce({
        object: {
          citations: [
            {
              lawIndex: 0,
              label: '🟡유사사례',
              focusHint: '심판청구를 기각한다',
              temporalLabel: '[현행]',
            },
          ],
          summary: '유사 사례에서는 ...',
          temporalLabel: '[현행]',
        },
      } as never)

      await adapter.generate([tribunalNoDate], '결정일 불명 심판례', MOCK_TEMPORAL)

      const callPrompt = (mockedGenerateObject.mock.calls[0][0] as { prompt: string }).prompt
      expect(callPrompt).toContain('결정일: 불명')
    })
  })
})
