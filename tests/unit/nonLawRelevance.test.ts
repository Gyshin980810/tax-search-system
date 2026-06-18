import { describe, it, expect } from 'vitest'
import {
  extractTerms,
  scoreRelevance,
  cosineSimilarity,
  combinedScore,
  SEMANTIC_WEIGHT,
  TITLE_MATCH_WEIGHT,
  BODY_MATCH_WEIGHT,
} from '@/domain/nonLawRelevance'

describe('nonLawRelevance (TAX-6B-10/11 공유 관련도 점수)', () => {
  describe('extractTerms', () => {
    it('2글자 이상 토큰만 남긴다', () => {
      expect(extractTerms('가 양도소득세 비')).toEqual(['양도소득세'])
    })

    it('불용어("관련" 등)를 제거한다', () => {
      // '관련'은 NONLAW_STOPWORDS — 제거되고 핵심어만 남음
      expect(extractTerms('양도소득세 관련')).toEqual(['양도소득세'])
    })

    it('공백 단위로 분해한다', () => {
      expect(extractTerms('가지급금 인정이자')).toEqual(['가지급금', '인정이자'])
    })
  })

  describe('scoreRelevance', () => {
    const terms = ['양도소득세']

    it('제목 매칭은 강한 신호(TITLE_MATCH_WEIGHT)다', () => {
      expect(scoreRelevance('양도소득세 부과처분', '', terms)).toBe(TITLE_MATCH_WEIGHT)
    })

    it('본문에만 있으면 약한 신호(BODY_MATCH_WEIGHT)다', () => {
      expect(scoreRelevance('법인세 사건', '양도소득세 쟁점', terms)).toBe(BODY_MATCH_WEIGHT)
    })

    it('제목·본문 양쪽에 있으면 강한 신호로만 1회 계산한다(중복 합산 금지)', () => {
      expect(scoreRelevance('양도소득세', '양도소득세', terms)).toBe(TITLE_MATCH_WEIGHT)
    })

    it('어디에도 없으면 0점이다', () => {
      expect(scoreRelevance('취득세 사건', '취득세 본문', terms)).toBe(0)
    })

    it('여러 토큰의 점수를 합산한다', () => {
      const multi = ['가지급금', '인정이자']
      expect(scoreRelevance('가지급금 인정이자 부과', '', multi)).toBe(TITLE_MATCH_WEIGHT * 2)
    })
  })

  // ─── TAX-6B-12 방향 C: 의미(벡터) 유사도 ──────────────────────────────────
  describe('cosineSimilarity', () => {
    it('동일 방향 벡터는 1이다', () => {
      expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1)
    })

    it('직교(무관) 벡터는 0이다', () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
    })

    it('반대 방향 벡터는 -1이다', () => {
      expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1)
    })

    it('크기와 무관하게 방향만 본다(스케일 불변)', () => {
      expect(cosineSimilarity([1, 1], [10, 10])).toBeCloseTo(1)
    })

    it('영벡터·길이 불일치는 0(안전)', () => {
      expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
      expect(cosineSimilarity([], [])).toBe(0)
      expect(cosineSimilarity([1, 2], [1])).toBe(0)
    })
  })

  describe('combinedScore', () => {
    it('글자 점수에 의미 유사도를 가중합한다', () => {
      // 2 + 3×0.5 = 3.5
      expect(combinedScore(2, 0.5)).toBeCloseTo(2 + SEMANTIC_WEIGHT * 0.5)
    })

    it('글자 0점이어도 의미가 가까우면 컷오프(1) 이상이 된다(표기변이 구제)', () => {
      // cosine ≈ 1/SEMANTIC_WEIGHT(≈0.33) 이상이면 1점 이상
      expect(combinedScore(0, 0.4)).toBeGreaterThanOrEqual(1)
    })

    it('음수 cosine(반대 의미)은 0으로 클램프 — 글자 점수를 깎지 않는다', () => {
      expect(combinedScore(2, -0.9)).toBe(2)
    })
  })
})
