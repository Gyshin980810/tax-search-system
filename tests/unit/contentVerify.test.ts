import { describe, it, expect } from 'vitest'
import { checkContent } from '@/domain/contentVerify'

describe('contentVerify — 내용(도메인 정확도) 검증기 (TAX-6B-9 방안 A)', () => {
  describe('mustInclude — 포함 필수 키워드', () => {
    it('키워드가 summary에 있으면 CONTENT_PASS', () => {
      const result = checkContent('대체 조항으로 통합투자세액공제가 신설되었습니다.', {
        mustInclude: ['통합투자세액공제'],
      })
      expect(result.status).toBe('CONTENT_PASS')
      expect(result.failedMustInclude).toHaveLength(0)
    })

    it('키워드가 summary에 없으면 CONTENT_FAIL + 실패 키워드 반환', () => {
      const result = checkContent('대체 조항도 존재하지 않습니다.', {
        mustInclude: ['통합투자세액공제'],
      })
      expect(result.status).toBe('CONTENT_FAIL')
      expect(result.failedMustInclude).toEqual(['통합투자세액공제'])
    })

    it('여러 키워드 중 일부만 없어도 CONTENT_FAIL (없는 것만 보고)', () => {
      const result = checkContent('통합투자세액공제로 대체되었습니다.', {
        mustInclude: ['통합투자세액공제', '통합고용세액공제'],
      })
      expect(result.status).toBe('CONTENT_FAIL')
      expect(result.failedMustInclude).toEqual(['통합고용세액공제'])
    })
  })

  describe('mustExclude — 포함 금지 표현', () => {
    it('금지 표현이 summary에 없으면 CONTENT_PASS', () => {
      const result = checkContent('통합투자세액공제로 대체되었습니다.', {
        mustExclude: ['대체 조항도 존재하지 않습니다'],
      })
      expect(result.status).toBe('CONTENT_PASS')
      expect(result.failedMustExclude).toHaveLength(0)
    })

    it('금지 표현이 summary에 있으면 CONTENT_FAIL + 실패 표현 반환', () => {
      const result = checkContent('이 공제는 폐지되었고 대체 조항도 존재하지 않습니다.', {
        mustExclude: ['대체 조항도 존재하지 않습니다'],
      })
      expect(result.status).toBe('CONTENT_FAIL')
      expect(result.failedMustExclude).toEqual(['대체 조항도 존재하지 않습니다'])
    })
  })

  describe('mustInclude + mustExclude 결합', () => {
    it('둘 다 통과하면 CONTENT_PASS', () => {
      const result = checkContent(
        '조특법 제121조의17에 따라 기업도시개발구역 입주기업 법인세 감면이 적용됩니다.',
        {
          mustInclude: ['제121조의17'],
          mustExclude: ['직접 근거(법령 본문)를 찾지 못했습니다'],
        }
      )
      expect(result.status).toBe('CONTENT_PASS')
      expect(result.failedMustInclude).toHaveLength(0)
      expect(result.failedMustExclude).toHaveLength(0)
    })

    it('include 통과·exclude 실패면 CONTENT_FAIL', () => {
      const result = checkContent(
        '직접 근거(법령 본문)를 찾지 못했습니다. 제121조의17 관련 유사 사례만 있습니다.',
        {
          mustInclude: ['제121조의17'],
          mustExclude: ['직접 근거(법령 본문)를 찾지 못했습니다'],
        }
      )
      expect(result.status).toBe('CONTENT_FAIL')
      expect(result.failedMustInclude).toHaveLength(0)
      expect(result.failedMustExclude).toEqual(['직접 근거(법령 본문)를 찾지 못했습니다'])
    })
  })

  describe('경계 조건', () => {
    it('spec이 비어 있으면(검증 대상 아님) CONTENT_PASS', () => {
      const result = checkContent('아무 내용', {})
      expect(result.status).toBe('CONTENT_PASS')
    })

    it('공백 차이는 무시(연속 공백 정규화)', () => {
      const result = checkContent('통합투자  세액공제로\n대체', {
        mustInclude: ['통합투자 세액공제'],
      })
      expect(result.status).toBe('CONTENT_PASS')
    })
  })
})
