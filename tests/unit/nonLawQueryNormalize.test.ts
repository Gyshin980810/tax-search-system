/**
 * TAX-043: 비법령 검색 자연어 정규화 단위 테스트
 *
 * 옵션 B(불용어 제거) + 옵션 C(사건번호 정확매칭)를 순수 함수 단위로 검증한다.
 * 외부 API·부수효과 비의존.
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeNonLawQuery,
  NONLAW_STOPWORDS,
  COURT_CASE_RE,
  TRIBUNAL_CASE_RE,
} from '@/domain/nonLawQueryNormalize'

describe('NONLAW_STOPWORDS — 사전 보증', () => {
  it('닫힌 집합이다(회계사 결정 A안 29개)', () => {
    // 사전 확장은 회계사 승인 필요 — 임의 추가 시 본 테스트가 실패하도록 잠금
    // 그룹별: ①의문 8 + ②관계어 5 + ③메타 5 + ④추상 7 + ⑤단위 4 = 29
    expect(NONLAW_STOPWORDS.size).toBe(29)
  })

  it('핵심 세무 단어는 절대 불용어가 아니다(회귀 차단)', () => {
    const taxCoreWords = ['가산세', '신고누락', '환급', '양도세', '법인세', '사기', '부정행위', '경정청구']
    for (const w of taxCoreWords) {
      expect(NONLAW_STOPWORDS.has(w)).toBe(false)
    }
  })
})

describe('normalizeNonLawQuery — 옵션 B (불용어 제거)', () => {
  it('자연어 군더더기를 제거한다', () => {
    const r = normalizeNonLawQuery('법인이 사기로 양도세 신고누락 시 가산세 사례 찾아줘')
    expect(r.caseNumber).toBeNull()
    expect(r.keyword).toBe('법인이 사기로 양도세 신고누락 시 가산세')
    expect(r.applied).toEqual(['stopwords'])
  })

  it('다중 불용어를 동시에 제거한다', () => {
    const r = normalizeNonLawQuery('양도세 가산세 관련 판례 알려줘')
    expect(r.keyword).toBe('양도세 가산세')
    expect(r.applied).toEqual(['stopwords'])
  })

  it('앞뒤 공백을 trim한다', () => {
    const r = normalizeNonLawQuery('  양도세 가산세  ')
    expect(r.keyword).toBe('양도세 가산세')
    expect(r.applied).toEqual([])
  })

  it('불용어가 없으면 applied는 빈 배열이다', () => {
    const r = normalizeNonLawQuery('1세대 1주택 비과세')
    expect(r.keyword).toBe('1세대 1주택 비과세')
    expect(r.applied).toEqual([])
  })

  it('[보수적 fallback] 모든 단어가 불용어면 원본을 보존한다', () => {
    // 외부 API에 빈 query를 보내 검색이 무력화되는 사고 방지
    const r = normalizeNonLawQuery('찾아줘 알려줘 검색')
    expect(r.keyword).toBe('찾아줘 알려줘 검색')
    expect(r.applied).toEqual([])
  })

  it('빈 입력을 안전하게 처리한다', () => {
    expect(normalizeNonLawQuery('').keyword).toBe('')
    expect(normalizeNonLawQuery('').caseNumber).toBeNull()
    expect(normalizeNonLawQuery('   ').keyword).toBe('')
    // @ts-expect-error 방어적 입력 검증
    expect(normalizeNonLawQuery(undefined).keyword).toBe('')
  })
})

describe('normalizeNonLawQuery — 옵션 C (판례 사건번호)', () => {
  it('대법원 사건번호를 추출한다', () => {
    const r = normalizeNonLawQuery('2023두12345 관련 판례 보여줘')
    expect(r.caseNumber).toBe('2023두12345')
    expect(r.applied).toContain('court_case')
  })

  it('연도 + 분류기호 + 번호 사이 공백을 허용한다', () => {
    const r = normalizeNonLawQuery('2023 두 12345')
    expect(r.caseNumber).toBe('2023두12345') // 공백 제거 정규화
    expect(r.applied).toContain('court_case')
  })

  it('1999년 prefix(19xx)도 인식한다', () => {
    const r = normalizeNonLawQuery('1999두1234 어떤 판결')
    expect(r.caseNumber).toBe('1999두1234')
  })

  it('사건번호 + 불용어 혼재 시 caseNumber와 stripped keyword 모두 반환', () => {
    const r = normalizeNonLawQuery('가산세 2023두12345 관련 판례 찾아줘')
    expect(r.caseNumber).toBe('2023두12345')
    expect(r.keyword).toBe('가산세 2023두12345')
    expect(r.applied).toEqual(expect.arrayContaining(['court_case', 'stopwords']))
  })
})

describe('normalizeNonLawQuery — 옵션 C (심판례 청구번호)', () => {
  it('조세심판원 청구번호를 추출한다', () => {
    const r = normalizeNonLawQuery('조심2023서0001 결정')
    expect(r.caseNumber).toBe('조심2023서0001')
    expect(r.applied).toContain('tribunal_case')
  })

  it('"조심"·연도·지역기호·번호 사이 공백을 허용한다', () => {
    const r = normalizeNonLawQuery('조심 2023 서 0001')
    expect(r.caseNumber).toBe('조심2023서0001')
    expect(r.applied).toContain('tribunal_case')
  })

  it('심판례를 판례 정규식보다 먼저 검사한다(접두 "조심" 우선)', () => {
    const r = normalizeNonLawQuery('조심2023서0001 가산세')
    expect(r.applied).toContain('tribunal_case')
    expect(r.applied).not.toContain('court_case')
  })
})

describe('normalizeNonLawQuery — 오매칭 방지 (안전성)', () => {
  it('연도 prefix가 없는 일반 단어는 사건번호로 인식하지 않는다', () => {
    // "두 사람"의 "두"는 분류기호로 보이지만 연도 prefix가 없어 미매칭
    const r1 = normalizeNonLawQuery('두 사람의 가산세')
    expect(r1.caseNumber).toBeNull()

    const r2 = normalizeNonLawQuery('가산세 부과')
    expect(r2.caseNumber).toBeNull()

    const r3 = normalizeNonLawQuery('양도소득세 신고누락')
    expect(r3.caseNumber).toBeNull()
  })

  it('연도 형식이 아닌 4자리 숫자는 사건번호로 인식하지 않는다', () => {
    // "1234"는 19xx/20xx 형식이 아님
    const r = normalizeNonLawQuery('1234두56')
    expect(r.caseNumber).toBeNull()
  })

  it('"조심"만 있고 청구번호 형식이 아니면 인식하지 않는다', () => {
    const r = normalizeNonLawQuery('조심해서 검토')
    expect(r.caseNumber).toBeNull()
  })
})

describe('정규식 직접 검증 (보조)', () => {
  it('COURT_CASE_RE는 표준 대법원 형식을 잡는다', () => {
    expect(COURT_CASE_RE.test('2023두12345')).toBe(true)
    expect(COURT_CASE_RE.test('2020고합1234')).toBe(true)
    expect(COURT_CASE_RE.test('1999노5678')).toBe(true)
  })

  it('COURT_CASE_RE는 연도 prefix 없는 입력을 거부한다', () => {
    expect(COURT_CASE_RE.test('두12345')).toBe(false)
    expect(COURT_CASE_RE.test('1234두56')).toBe(false) // 1234는 19xx/20xx 아님
  })

  it('TRIBUNAL_CASE_RE는 조심 청구번호를 잡는다', () => {
    expect(TRIBUNAL_CASE_RE.test('조심2023서0001')).toBe(true)
    expect(TRIBUNAL_CASE_RE.test('조심 2023 부 1234')).toBe(true)
  })
})
