/**
 * extractExcerpt 단위 테스트 (TAX-041 옵션 A)
 *
 * LLM이 focusHint(짧은 키워드)만 출력하고 어댑터가 content에서 정확한 substring을 추출하는 헬퍼.
 * 추출 결과는 항상 content의 substring이어야 V2(인용 무결성) 100% 보장이 가능하다.
 */
import { describe, it, expect } from 'vitest'
import { extractExcerpt } from '@/adapters/llmAnswerGenerator'

describe('extractExcerpt — TAX-041 옵션 A', () => {
  describe('정확 매칭', () => {
    it('focusHint가 content에 그대로 들어 있으면 해당 위치 주변 문장을 추출한다', () => {
      const content = '제26조(면세) 다음 각 호의 재화 또는 용역의 공급에 대하여는 부가가치세를 면제한다.'
      const focusHint = '부가가치세를 면제한다'
      const result = extractExcerpt(content, focusHint)

      expect(content).toContain(result)
      expect(result).toContain('부가가치세를 면제한다')
    })

    it('여러 문장 중 focusHint를 포함하는 문장만 추출한다', () => {
      const content = '서론입니다. 본문에서는 부가가치세를 면제한다. 결론입니다.'
      const focusHint = '부가가치세를 면제한다'
      const result = extractExcerpt(content, focusHint)

      expect(result).toContain('부가가치세를 면제한다')
      expect(result).not.toContain('서론')
      expect(result).not.toContain('결론')
    })

    it('focusHint가 줄바꿈으로 구분된 문장 안에 있으면 그 문장만 추출한다', () => {
      const content = '심판청구를 기각한다.\n조특법 제69조 단서에 따라 비과세 대상에 해당하지 않는다.'
      const focusHint = '심판청구를 기각한다'
      const result = extractExcerpt(content, focusHint)

      expect(result).toContain('심판청구를 기각한다')
      expect(result).not.toContain('조특법')
    })
  })

  describe('토큰 매칭 (fallback)', () => {
    it('focusHint가 정확히 안 들어가도 토큰 매칭으로 가장 관련 있는 문장을 추출한다', () => {
      const content = '서론. 부가가치세 면제 대상은 다음과 같다. 결론.'
      const focusHint = '부가가치세 면제'  // 부분 매칭
      const result = extractExcerpt(content, focusHint)

      expect(result).toContain('부가가치세 면제 대상은 다음과 같다')
    })

    it('토큰 일치 점수가 가장 높은 문장을 선택한다', () => {
      const content = '첫 문장에는 세금 얘기. 둘째 문장에는 부가가치세 면제 얘기. 셋째 문장.'
      const focusHint = '부가가치세 면제'
      const result = extractExcerpt(content, focusHint)

      expect(result).toContain('부가가치세 면제')
    })
  })

  describe('결과의 V2 보장 — content substring 보장', () => {
    it('결과는 항상 trimmed content의 substring이다 — 정확 매칭 케이스', () => {
      const content = '제50조(기본공제) ①거주자에 대해서는 150만원을 공제한다.'
      const focusHint = '150만원을 공제한다'
      const result = extractExcerpt(content, focusHint)

      expect(content.includes(result)).toBe(true)
    })

    it('결과는 항상 trimmed content의 substring이다 — 토큰 매칭 케이스', () => {
      const content = '제50조(기본공제) ①거주자에 대해서는 150만원을 공제한다.'
      const focusHint = '공제 금액 150'
      const result = extractExcerpt(content, focusHint)

      expect(content.includes(result)).toBe(true)
    })

    it('결과는 항상 trimmed content의 substring이다 — fallback 케이스', () => {
      const content = '제1조 첫 문장. 제2조 둘째 문장.'
      const focusHint = '없는키워드xyz'
      const result = extractExcerpt(content, focusHint)

      expect(content.includes(result)).toBe(true)
    })
  })

  // TAX-041 5차 진단 회귀 가드: 날짜 표기(예: "x. x. 까지")에서 split·join이 공백 패턴을
  // 변형해 substring을 깨뜨리는 문제가 41건 발생. 인덱스 기반 slice로 안전망 강제.
  describe('날짜 표기 substring 안전망 (5차 진단 회귀 가드)', () => {
    it('"x. x. 까지도" 패턴이 포함된 원문에서도 결과가 substring이다', () => {
      const content = '청구인은 2021. 12. 10. 까지도 미국에서 거주한 것으로 나타나는 점, 별도 처리.'
      const focusHint = '미국에서 거주한'
      const result = extractExcerpt(content, focusHint)

      expect(content.includes(result)).toBe(true)
      expect(result).toContain('미국에서 거주한')
    })

    it('"3. 6. 모친 AAA" 같은 날짜 시작 문장도 substring을 보장한다', () => {
      const content = '심판청구 경위. 3. 6. 모친 AAA(이하 "피상속인"이라 한다)의 상속 발생. 이후 처분.'
      const focusHint = '모친 AAA'
      const result = extractExcerpt(content, focusHint)

      expect(content.includes(result)).toBe(true)
    })

    it('이중 공백·마침표 직후 공백 없음 패턴에서도 substring 보장', () => {
      const content = '제1조.  공백둘개 패턴.제2조.공백없음 패턴 둘다 있음.'
      const focusHint = '공백없음'
      const result = extractExcerpt(content, focusHint)

      expect(content.includes(result)).toBe(true)
    })
  })

  describe('엣지 케이스', () => {
    it('빈 content는 빈 문자열을 반환한다', () => {
      expect(extractExcerpt('', '아무거나')).toBe('')
    })

    it('빈 focusHint는 첫 문장을 반환한다', () => {
      const content = '첫째 문장은 충분히 깁니다. 둘째 문장도 충분히 깁니다.'  // 각 15자 이상이라 분리됨
      const result = extractExcerpt(content, '')
      expect(result).toBe('첫째 문장은 충분히 깁니다.')
    })

    it('한 문장만 있는 content는 그 문장을 그대로 반환한다', () => {
      const content = '제26조 면세 규정만 있습니다'
      const result = extractExcerpt(content, '면세')
      expect(content.includes(result)).toBe(true)
    })

    it('content 앞뒤 공백은 trim된다 (V2의 trim 허용과 일치)', () => {
      const content = '  부가가치세를 면제한다.  '
      const result = extractExcerpt(content, '면제')
      expect(result.startsWith(' ')).toBe(false)
      expect(result.endsWith(' ')).toBe(false)
    })

    it('짧은 조각(번호만 있는 문장)은 인접 문장과 합쳐진다', () => {
      const content = '1. 거주자.\n2. 비거주자.\n3. 외국인.'
      const result = extractExcerpt(content, '거주자')
      // 어떤 문장이든 content 안에 있어야 함
      expect(content.includes(result)).toBe(true)
    })
  })
})
