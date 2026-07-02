/**
 * TAX-031: 세법 약칭 정규화 + 법령명 정확매칭 선택 단위 테스트
 *
 * 통증 A(검색 1위가 동음이의 법령 — "지방세법" → "지방교부세법") 차단 로직을
 * 순수 함수 단위로 검증한다(외부 API 비의존).
 */
import { describe, it, expect } from 'vitest'
import { normalizeLawName, selectBestLaw, splitLegalAxis, LAW_ALIASES } from '@/domain/lawAliases'

describe('normalizeLawName — 세법 약칭 정규화', () => {
  it('등록된 약칭을 정식 법령명으로 확장한다', () => {
    expect(normalizeLawName('조특법')).toBe('조세특례제한법')
    expect(normalizeLawName('국기법')).toBe('국세기본법')
    expect(normalizeLawName('부가세법')).toBe('부가가치세법')
    expect(normalizeLawName('상증세법')).toBe('상속세 및 증여세법')
    expect(normalizeLawName('상증법')).toBe('상속세 및 증여세법')
    expect(normalizeLawName('종부세법')).toBe('종합부동산세법')
  })

  it('정식 법령명은 그대로 통과시킨다(별칭 아님)', () => {
    expect(normalizeLawName('소득세법')).toBe('소득세법')
    expect(normalizeLawName('법인세법')).toBe('법인세법')
    expect(normalizeLawName('지방세법')).toBe('지방세법')
  })

  it('앞뒤 공백을 제거한다', () => {
    expect(normalizeLawName('  상증세법  ')).toBe('상속세 및 증여세법')
    expect(normalizeLawName(' 소득세법 ')).toBe('소득세법')
  })

  it('빈 문자열·undefined를 안전하게 처리한다', () => {
    expect(normalizeLawName('')).toBe('')
    // @ts-expect-error 방어적 입력 검증
    expect(normalizeLawName(undefined)).toBe('')
  })

  it('약칭 사전은 닫힌 집합이다(회계사 확정 6개)', () => {
    expect(Object.keys(LAW_ALIASES)).toHaveLength(6)
  })
})

describe('selectBestLaw — 법령명 정확매칭 선택', () => {
  const make = (names: string[]) => names.map((법령명한글) => ({ 법령명한글 }))

  it('[핵심] 1위가 동음이의 법령이어도 완전일치 법령을 선택한다 (지방세법 시나리오)', () => {
    // 실측 재현: "지방세법" 검색 → [0] 지방교부세법, [3] 지방세법
    const laws = make(['지방교부세법', '지방교부세법 시행령', '지방교부세법 시행규칙', '지방세법', '지방세법 시행령'])
    const result = selectBestLaw(laws, '지방세법')
    expect(result?.law.법령명한글).toBe('지방세법')
    expect(result?.matchType).toBe('exact')
  })

  it('완전일치가 접두일치를 이긴다 (순서 무관)', () => {
    // "지방세법 시행령"이 앞에 있어도 완전일치 "지방세법"을 우선
    const laws = make(['지방세법 시행령', '지방세법'])
    const result = selectBestLaw(laws, '지방세법')
    expect(result?.law.법령명한글).toBe('지방세법')
    expect(result?.matchType).toBe('exact')
  })

  it('완전일치가 없으면 접두일치를 선택한다', () => {
    const laws = make(['소득세법 시행령', '소득세법 시행규칙'])
    const result = selectBestLaw(laws, '소득세법')
    expect(result?.law.법령명한글).toBe('소득세법 시행령')
    expect(result?.matchType).toBe('prefix')
  })

  it('완전·접두일치가 없으면 부분일치를 선택한다', () => {
    const laws = make(['관세법', '국제조세조정에 관한 법률'])
    const result = selectBestLaw(laws, '조세조정')
    expect(result?.law.법령명한글).toBe('국제조세조정에 관한 법률')
    expect(result?.matchType).toBe('partial')
  })

  it('어떤 매칭도 없으면 첫 번째로 폴백하고 fallback으로 신호한다', () => {
    const laws = make(['전혀다른법', '또다른법'])
    const result = selectBestLaw(laws, '소득세법')
    expect(result?.law.법령명한글).toBe('전혀다른법')
    expect(result?.matchType).toBe('fallback')
  })

  it('빈 후보 배열이면 null을 반환한다', () => {
    expect(selectBestLaw([], '소득세법')).toBeNull()
  })
})

describe('splitLegalAxis — 법리축/사실축 분리 (TAX-6B-24)', () => {
  it('[핵심] 결합 키워드에서 법리축과 사실축을 분리한다', () => {
    // TAX-042G가 만든 "법인세법 손비"를 법령명("법인세법")과 쟁점("손비")으로 분리
    expect(splitLegalAxis('법인세법 손비')).toEqual({ legalAxis: '법인세법', factAxis: '손비' })
  })

  it('순수 법령명은 사실축 없이 그대로 반환한다(무변경)', () => {
    expect(splitLegalAxis('소득세법')).toEqual({ legalAxis: '소득세법', factAxis: '' })
  })

  it('다단어 법령명("상속세 및 증여세법")을 통째로 법리축에 보존한다', () => {
    expect(splitLegalAxis('상속세 및 증여세법 상속공제')).toEqual({
      legalAxis: '상속세 및 증여세법',
      factAxis: '상속공제',
    })
  })

  it('"시행령"/"시행규칙" 후행 토큰을 법리축에 흡수한다', () => {
    expect(splitLegalAxis('법인세법 시행령 접대비')).toEqual({
      legalAxis: '법인세법 시행령',
      factAxis: '접대비',
    })
    expect(splitLegalAxis('부가가치세법 시행규칙 세금계산서')).toEqual({
      legalAxis: '부가가치세법 시행규칙',
      factAxis: '세금계산서',
    })
  })

  it('약칭도 "~법" 토큰으로 인식한다(정규화는 downstream normalizeLawName 담당)', () => {
    expect(splitLegalAxis('조특법 세액공제')).toEqual({ legalAxis: '조특법', factAxis: '세액공제' })
  })

  it('법령명 토큰이 없으면 입력 전체를 legalAxis로 통과시킨다(회귀 0건)', () => {
    // "접대비"만 검색 → 기존 동작(searchLaws에 원본 전달)과 동일
    expect(splitLegalAxis('접대비')).toEqual({ legalAxis: '접대비', factAxis: '' })
    expect(splitLegalAxis('접대비 손금 한도')).toEqual({ legalAxis: '접대비 손금 한도', factAxis: '' })
  })

  it('여러 사실축 토큰을 공백으로 보존한다', () => {
    expect(splitLegalAxis('법인세법 접대비 손금 한도')).toEqual({
      legalAxis: '법인세법',
      factAxis: '접대비 손금 한도',
    })
  })

  it('앞뒤 공백·빈 문자열을 안전하게 처리한다', () => {
    expect(splitLegalAxis('  법인세법 손비  ')).toEqual({ legalAxis: '법인세법', factAxis: '손비' })
    expect(splitLegalAxis('')).toEqual({ legalAxis: '', factAxis: '' })
    // @ts-expect-error 방어적 입력 검증
    expect(splitLegalAxis(undefined)).toEqual({ legalAxis: '', factAxis: '' })
  })
})
