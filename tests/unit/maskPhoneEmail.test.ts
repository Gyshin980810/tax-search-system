import { describe, it, expect } from 'vitest'
import { maskPhoneEmail } from '@/utils/piiFilter'

describe('maskPhoneEmail — 휴대폰·이메일 마스킹 (TAX-6B-3, FR-11)', () => {

  describe('휴대폰 번호 마스킹', () => {
    it('하이픈 포함 010 번호를 마스킹한다', () => {
      const result = maskPhoneEmail('010-1234-5678 양도소득세')
      expect(result).toContain('010-****-5678')
      expect(result).not.toContain('1234')
    })

    it('하이픈 없는 11자리 번호를 마스킹한다', () => {
      const result = maskPhoneEmail('01012345678 법인세')
      expect(result).toContain('****')
      expect(result).not.toContain('1234')
    })

    it('점 구분자 형식도 마스킹한다', () => {
      const result = maskPhoneEmail('010.1234.5678')
      expect(result).toContain('****')
    })

    it('공백 구분자 형식도 마스킹한다', () => {
      const result = maskPhoneEmail('010 1234 5678')
      expect(result).toContain('****')
    })

    it('구 번호(011·016 등)도 마스킹한다', () => {
      const result = maskPhoneEmail('011-123-4567 문의')
      expect(result).toContain('****')
    })
  })

  describe('이메일 마스킹', () => {
    it('일반 이메일을 마스킹하고 도메인은 유지한다', () => {
      const result = maskPhoneEmail('john@example.com 문의')
      expect(result).toContain('@example.com')
      expect(result).not.toContain('john')
      expect(result).toContain('***')
    })

    it('로컬 파트 2자 이하는 첫 글자만 노출한다', () => {
      const result = maskPhoneEmail('a@test.com')
      expect(result).toMatch(/^a\*\*\*@test\.com$/)
    })
  })

  describe('마스킹 불필요 케이스', () => {
    it('전화번호·이메일이 없으면 원본을 그대로 반환한다', () => {
      const q = '부가가치세 면세 대상'
      expect(maskPhoneEmail(q)).toBe(q)
    })

    it('11자리 초과 연속 숫자는 전화번호로 처리하지 않는다', () => {
      const q = '123456789012 세금 문의'
      expect(maskPhoneEmail(q)).toBe(q)
    })
  })

  describe('복합 케이스', () => {
    it('휴대폰 + 이메일이 모두 있으면 둘 다 마스킹한다', () => {
      const result = maskPhoneEmail('010-1234-5678 john@example.com 세금')
      expect(result).not.toContain('1234')
      expect(result).not.toContain('john')
      expect(result).toContain('@example.com')
      expect(result).toContain('5678')
    })
  })
})
