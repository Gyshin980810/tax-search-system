import { describe, it, expect } from 'vitest'
import { detectPii } from '@/utils/piiFilter'
import { PiiDetectedError } from '@/domain/errors'

describe('detectPii — PII 필터 단위 테스트', () => {

  // ─── 정상 쿼리 통과 ───────────────────────────────────────────
  describe('정상 쿼리는 통과', () => {
    it('일반 세법 키워드는 통과한다', () => {
      expect(() => detectPii('부가가치세')).not.toThrow()
      expect(() => detectPii('법인세 납부')).not.toThrow()
      expect(() => detectPii('종합소득세 신고 방법')).not.toThrow()
    })

    it('짧은 숫자는 통과한다', () => {
      expect(() => detectPii('12345')).not.toThrow()
      expect(() => detectPii('123456789')).not.toThrow()  // 9자리
    })

    it('성별코드 0·9는 등록번호 패턴 아님 → 통과', () => {
      expect(() => detectPii('800101-0234567')).not.toThrow()
      expect(() => detectPii('800101-9234567')).not.toThrow()
    })

    it('11자리 이상 연속 숫자는 사업자번호 아님 → 통과', () => {
      expect(() => detectPii('12345678901')).not.toThrow()   // 11자리
      expect(() => detectPii('전화번호 01012345678')).not.toThrow()
    })
  })

  // ─── 주민·외국인등록번호 차단 ────────────────────────────────
  describe('주민·외국인등록번호 → PiiDetectedError throw', () => {
    it('성별코드 1~4 (내국인) 하이픈 형식을 차단한다', () => {
      expect(() => detectPii('800101-1234567')).toThrow(PiiDetectedError)
      expect(() => detectPii('800101-2234567')).toThrow(PiiDetectedError)
      expect(() => detectPii('800101-3234567')).toThrow(PiiDetectedError)
      expect(() => detectPii('800101-4234567')).toThrow(PiiDetectedError)
    })

    it('성별코드 5~8 (외국인등록번호) 하이픈 형식을 차단한다', () => {
      expect(() => detectPii('800101-5234567')).toThrow(PiiDetectedError)
      expect(() => detectPii('800101-8234567')).toThrow(PiiDetectedError)
    })

    it('텍스트 사이에 주민번호가 포함돼도 차단한다', () => {
      expect(() => detectPii('홍길동 800101-1234567 씨의 세금')).toThrow(PiiDetectedError)
    })

    it('하이픈 없는 13자리 형식도 차단한다', () => {
      expect(() => detectPii('8001011234567')).toThrow(PiiDetectedError)
    })

    it('공백으로 구분자를 대체한 우회 시도를 차단한다', () => {
      expect(() => detectPii('800101 1234567')).toThrow(PiiDetectedError)
    })
  })

  // ─── 사업자등록번호 차단 ──────────────────────────────────────
  describe('사업자등록번호 → PiiDetectedError throw', () => {
    it('하이픈 포함 기본 형식을 차단한다', () => {
      expect(() => detectPii('123-45-67890')).toThrow(PiiDetectedError)
    })

    it('텍스트 사이에 사업자번호가 포함돼도 차단한다', () => {
      expect(() => detectPii('사업자 123-45-67890 법인세 신고')).toThrow(PiiDetectedError)
    })

    it('하이픈 없는 10자리 단독 형식을 차단한다', () => {
      expect(() => detectPii('1234567890')).toThrow(PiiDetectedError)
    })
  })

  // ─── 에러 타입 확인 ──────────────────────────────────────────
  describe('에러 코드 검증', () => {
    it('PiiDetectedError의 code가 E-PII-DETECTED이다', () => {
      try {
        detectPii('800101-1234567')
        expect.fail('에러가 발생해야 합니다')
      } catch (err) {
        expect(err).toBeInstanceOf(PiiDetectedError)
        expect((err as PiiDetectedError).code).toBe('E-PII-DETECTED')
      }
    })
  })
})
