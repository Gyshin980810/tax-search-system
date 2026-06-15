/**
 * @vitest-environment node
 *
 * TAX-6A-11 (처방 D): 라벨 결정론화 — resolveCitationLabel 단위 검증
 *
 * 목적: LLM이 어떤 라벨을 내든, 최종 라벨은 Trust Tier로 100% 결정됨을 보장한다.
 *       이 매핑이 lawVerifier.TIER_ALLOWED_LABELS와 1:1로 정합하므로 checkV3는
 *       구조적으로 항상 PASS한다(라벨 비결정성 제거).
 */
import { describe, it, expect } from 'vitest'
import { resolveCitationLabel } from '@/adapters/llmAnswerGenerator'
import { TIER_ALLOWED_LABELS } from '@/adapters/lawVerifier'
import type { CitationLabel } from '@/domain/Citation'
import type { TrustTier } from '@/domain/TaxLaw'

const ALL_LABELS: CitationLabel[] = ['🟢직접근거', '🟡유사사례', '⚪참고자료', '⚫폐지']
const ALL_TIERS: TrustTier[] = ['T1', 'T2', 'T3', 'T4']

describe('resolveCitationLabel — Trust Tier 기반 결정론 매핑', () => {
  it('[T1·T2 → 🟢] LLM이 어떤 라벨을 내도 T1·T2는 🟢직접근거 (단, 폐지 제외)', () => {
    for (const tier of ['T1', 'T2'] as TrustTier[]) {
      for (const llmLabel of ['🟢직접근거', '🟡유사사례', '⚪참고자료']) {
        expect(resolveCitationLabel(tier, llmLabel as CitationLabel)).toBe('🟢직접근거')
      }
    }
  })

  it('[T3·T4 → 🟡] LLM이 🟢를 내도 T3·T4는 🟡유사사례 (위험 방향 차단)', () => {
    for (const tier of ['T3', 'T4'] as TrustTier[]) {
      for (const llmLabel of ['🟢직접근거', '🟡유사사례', '⚪참고자료']) {
        expect(resolveCitationLabel(tier, llmLabel as CitationLabel)).toBe('🟡유사사례')
      }
    }
  })

  it('[폐지 보존] LLM이 ⚫폐지로 판단하면 모든 Tier에서 ⚫폐지 유지', () => {
    for (const tier of ALL_TIERS) {
      expect(resolveCitationLabel(tier, '⚫폐지')).toBe('⚫폐지')
    }
  })

  it('[V3 구조적 PASS] 모든 (Tier × LLM라벨) 조합의 결과가 TIER_ALLOWED_LABELS에 포함', () => {
    for (const tier of ALL_TIERS) {
      for (const llmLabel of ALL_LABELS) {
        const resolved = resolveCitationLabel(tier, llmLabel)
        // checkV3와 동일한 판정: 결과는 항상 해당 Tier 허용 라벨 집합 안에 있어야 한다.
        expect(TIER_ALLOWED_LABELS[tier]).toContain(resolved)
      }
    }
  })

  it('[결정론] 동일 입력은 항상 동일 출력 (비결정성 0)', () => {
    const first = resolveCitationLabel('T1', '🟡유사사례')
    for (let i = 0; i < 100; i++) {
      expect(resolveCitationLabel('T1', '🟡유사사례')).toBe(first)
    }
  })
})
