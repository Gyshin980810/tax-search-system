/**
 * TAX-033: 관련법령·참조결정 파서 단위 테스트
 *
 * 실측 변이(진단5, 2026-05-24) 20건을 픽스처로 사용한다.
 * 외부 API 의존 없음 — 순수 함수 테스트.
 */
import { describe, it, expect } from 'vitest'
import { parseRelatedLaws, parseReferences } from '@/domain/relatedLawParser'

// ──────────────────────────────────────────────────
// parseRelatedLaws
// ──────────────────────────────────────────────────

describe('parseRelatedLaws — 관련법령 파싱', () => {
  // ── 기본 케이스 ──

  it('단일 법령(기본형)을 파싱한다', () => {
    const result = parseRelatedLaws('「조세특례제한법」 제69조')
    expect(result).toHaveLength(1)
    expect(result[0].rawText).toBe('「조세특례제한법」 제69조')   // 원문 그대로
    expect(result[0].lawName).toBe('조세특례제한법')
    expect(result[0].articleRef).toBe('제69조')
  })

  it('lawNameNormalized는 normalizeLawName()을 거친 값이다', () => {
    // 정식명은 사전에 없으므로 그대로 통과
    const result = parseRelatedLaws('「소득세법」 제104조')
    expect(result[0].lawNameNormalized).toBe('소득세법')
  })

  // ── 복수 법령 ──

  it('[진단5] 복수 법령("/"구분)을 분리한다', () => {
    const result = parseRelatedLaws('「법인세법」 제67조 / 「법인세법」 시행령제106조')
    expect(result).toHaveLength(2)
    expect(result[0].rawText).toBe('「법인세법」 제67조')
    expect(result[1].rawText).toBe('「법인세법」 시행령제106조')
    expect(result[1].articleRef).toBe('시행령제106조')
  })

  // ── 조문 표기 변이 ──

  it('[진단5] 시행령이 「」 밖에 있어도 원문을 보존한다', () => {
    const result = parseRelatedLaws('「법인세법」 시행령제89조')
    expect(result[0].rawText).toBe('「법인세법」 시행령제89조')
    expect(result[0].lawName).toBe('법인세법')
    expect(result[0].articleRef).toBe('시행령제89조')
  })

  it('[진단5] 조문 제목 【】가 포함되어도 원문을 보존한다', () => {
    const result = parseRelatedLaws('「법인세법」 제3조 【실질과세】')
    expect(result[0].rawText).toBe('「법인세법」 제3조 【실질과세】')
    expect(result[0].articleRef).toBe('제3조 【실질과세】')
  })

  it('[진단5] 항이 포함된 조문을 처리한다', () => {
    const result = parseRelatedLaws('「국세기본법」 제26조 제2항')
    expect(result[0].articleRef).toBe('제26조 제2항')
    expect(result[0].lawName).toBe('국세기본법')
  })

  it('[진단5] 제N조의M 형식을 처리한다', () => {
    const result = parseRelatedLaws('「국세기본법」 제26조의2')
    expect(result[0].articleRef).toBe('제26조의2')
    expect(result[0].lawName).toBe('국세기본법')
  })

  it('[진단5] 제N조의M + 항이 함께 있는 경우를 처리한다', () => {
    const result = parseRelatedLaws('「국세기본법」 제47조의3 제2항')
    expect(result[0].articleRef).toBe('제47조의3 제2항')
  })

  // ── 중복·trailing "/" ──

  it('[진단5] 중복 항목(rawText 동일)을 제거한다', () => {
    const result = parseRelatedLaws(
      '「종합부동산세법」 제8조 【과세표준】 / 「종합부동산세법」 제8조 【과세표준】',
    )
    expect(result).toHaveLength(1)
  })

  it('[진단5] trailing "/" (빈 꼬리)를 제거한다', () => {
    const result = parseRelatedLaws('「소득세법」 제104조 / ')
    expect(result).toHaveLength(1)
    expect(result[0].rawText).toBe('「소득세법」 제104조')
  })

  it('[진단5] trailing " /" (공백+슬래시)를 제거한다', () => {
    // 예: "「부가가치세법」 제26조 /"
    const result = parseRelatedLaws('「부가가치세법」 제26조 /')
    expect(result).toHaveLength(1)
  })

  // ── 깨진 데이터 방어 ──

  it('[진단5] 깨진 번호(제O조)도 원문을 유지한다', () => {
    const result = parseRelatedLaws('「상속세및증여세법」 제O조【상속세 과세가액】')
    expect(result[0].rawText).toBe('「상속세및증여세법」 제O조【상속세 과세가액】')
    expect(result[0].lawName).toBe('상속세및증여세법')
    // 매칭 실패여도 표시는 가능
    expect(result[0].articleRef).toBe('제O조【상속세 과세가액】')
  })

  it('「」가 없는 조각은 rawText만 채우고 나머지는 빈 문자열이다', () => {
    // 「」 없는 깨진 데이터
    const result = parseRelatedLaws('소득세법 제104조')
    expect(result[0].rawText).toBe('소득세법 제104조')
    expect(result[0].lawName).toBe('')
    expect(result[0].articleRef).toBe('')
    expect(result[0].lawNameNormalized).toBe('')
  })

  // ── 빈·null 입력 방어 ──

  it('null을 안전하게 처리한다 (빈 배열 반환)', () => {
    expect(parseRelatedLaws(null)).toEqual([])
  })

  it('undefined를 안전하게 처리한다', () => {
    expect(parseRelatedLaws(undefined)).toEqual([])
  })

  it('빈 문자열을 안전하게 처리한다', () => {
    expect(parseRelatedLaws('')).toEqual([])
  })

  it('공백만 있는 문자열을 안전하게 처리한다', () => {
    expect(parseRelatedLaws('   ')).toEqual([])
  })

  // ── 원문 보존 확인 ──

  it('rawText는 원문 조각과 문자 단위로 일치한다 (§6.1)', () => {
    // 복수의 경우에도 각 조각의 rawText는 trim 후 원문 그대로
    const raw = '「조세특례제한법」 제69조 / 「소득세법」 제104조'
    const result = parseRelatedLaws(raw)
    expect(result[0].rawText).toBe('「조세특례제한법」 제69조')
    expect(result[1].rawText).toBe('「소득세법」 제104조')
  })
})

// ──────────────────────────────────────────────────
// parseReferences
// ──────────────────────────────────────────────────

describe('parseReferences — 참조결정 파싱', () => {
  it('단건 청구번호를 파싱한다', () => {
    const result = parseReferences('조심2011서1540')
    expect(result).toHaveLength(1)
    expect(result[0].rawText).toBe('조심2011서1540')
  })

  it('[진단5] 복수 청구번호("/"구분)를 분리한다', () => {
    const result = parseReferences('조심2013중3738 / 국심2004중3046 / 조심2008서0163')
    expect(result).toHaveLength(3)
    expect(result[0].rawText).toBe('조심2013중3738')
    expect(result[1].rawText).toBe('국심2004중3046')
    expect(result[2].rawText).toBe('조심2008서0163')
  })

  it('[진단5] trailing "/" (빈 꼬리)를 제거한다', () => {
    const result = parseReferences('조심2009중1248 /')
    expect(result).toHaveLength(1)
    expect(result[0].rawText).toBe('조심2009중1248')
  })

  it('중복 청구번호를 제거한다', () => {
    const result = parseReferences('조심2011서1540 / 조심2011서1540')
    expect(result).toHaveLength(1)
  })

  it('국심(구 국세심판원) 번호도 처리한다', () => {
    // 구 국세심판원 번호 형식 포함
    const result = parseReferences('국심1993전2739')
    expect(result[0].rawText).toBe('국심1993전2739')
  })

  it('null을 안전하게 처리한다', () => {
    expect(parseReferences(null)).toEqual([])
  })

  it('undefined를 안전하게 처리한다', () => {
    expect(parseReferences(undefined)).toEqual([])
  })

  it('빈 문자열을 안전하게 처리한다', () => {
    expect(parseReferences('')).toEqual([])
  })

  it('rawText는 원문 청구번호와 일치한다 (§6.1)', () => {
    const result = parseReferences('조심2020부1558')
    expect(result[0].rawText).toBe('조심2020부1558')
  })
})
