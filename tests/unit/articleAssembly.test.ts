/**
 * @vitest-environment node
 *
 * TAX-032: 조문 본문 항·호·목 조립 단위 테스트
 *
 * 통증 B(content가 "조문 제목만") 해소 로직을 검증한다.
 * 픽스처는 실제 API 응답 구조(article_dump.mjs 실측 2026-05-24)를 고정한 것이다.
 * 합격선은 인용 무결성(V2) — 조립 결과가 원문 텍스트를 "문자 그대로" 포함해야 한다.
 */
import { describe, it, expect } from 'vitest'
import { assembleArticleContent } from '@/adapters/nationalTaxLaw'

// 조문단위 공통 메타 (조문내용·항은 각 케이스에서 덮어씀)
const BASE = {
  조문번호: 1,
  조문여부: '조문',
  조문시행일자: '20260101',
  조문키: 'k',
}

describe('assembleArticleContent — 조문 본문(항·호·목) 조립', () => {
  it('항이 없는 조문은 조문내용(제목)만 반환한다 (기존 동작 보존)', () => {
    const art = { ...BASE, 조문내용: '제1조(목적) 이 법은 부가가치세의 과세(課稅) 요건을 규정함을 목적으로 한다.' }
    expect(assembleArticleContent(art)).toBe(art.조문내용)
  })

  it('항·호를 원문 그대로 결합한다 (부가세 제26조 — 항내용 문자열 + 호)', () => {
    const art = {
      ...BASE,
      조문번호: 26,
      조문내용: '제26조(재화 또는 용역의 공급에 대한 면세)',
      항: [
        {
          항번호: '①',
          항내용: '① 다음 각 호의 재화 또는 용역의 공급에 대하여는 부가가치세를 면제한다. <개정 2015.8.11>',
          호: [
            { 호번호: '1.', 호내용: '1.  가공되지 아니한 식료품' },
            { 호번호: '2.', 호내용: '2.  수돗물' },
            { 호번호: '3.', 호내용: '3.  연탄과 무연탄' },
          ],
        },
        {
          항번호: '②',
          항내용: '② 제1항에 따라 면세되는 재화 또는 용역의 공급에 통상적으로 부수되는 재화 또는 용역의 공급은 그 면세되는 재화 또는 용역의 공급에 포함되는 것으로 본다.',
        },
      ],
    }
    const content = assembleArticleContent(art)

    // V2: 제목·항·호 원문을 문자 그대로 포함
    expect(content).toContain('제26조(재화 또는 용역의 공급에 대한 면세)')
    expect(content).toContain('① 다음 각 호의 재화 또는 용역의 공급에 대하여는 부가가치세를 면제한다. <개정 2015.8.11>')
    expect(content).toContain('1.  가공되지 아니한 식료품')
    expect(content).toContain('2.  수돗물')
    expect(content).toContain('② 제1항에 따라 면세되는')

    // 본문이 제목보다 훨씬 길어졌다 (통증 B 해소)
    expect(content.length).toBeGreaterThan(art.조문내용.length)
  })

  it('항·호 번호를 중복 부착하지 않는다 (번호는 내용에 이미 포함)', () => {
    const art = {
      ...BASE,
      항: {
        항번호: '①',
        항내용: '① 다음 각 호의 재화 또는 용역의 공급에 대하여는 부가가치세를 면제한다.',
        호: { 호번호: '1.', 호내용: '1.  가공되지 아니한 식료품' },
      },
      조문내용: '제26조(재화 또는 용역의 공급에 대한 면세)',
    }
    const content = assembleArticleContent(art)
    // 번호를 prepend했다면 "① ①", "1. 1." 처럼 중복됐을 것
    expect(content).not.toMatch(/①\s*①/)
    expect(content).not.toMatch(/1\.\s*1\.\s+가공/)
  })

  it('세율표(중첩 배열)를 괘선·세율 텍스트까지 원문 순서로 보존한다 (소득세 제55조)', () => {
    const 세율표 = [
      [
        '①거주자의 종합소득에 대한 소득세는 해당 연도의 종합소득과세표준에 다음의 세율을 적용하여 계산한 금액(이하 "종합소득산출세액"이라 한다)을 그 세액으로 한다. <개정 2022.12.31>',
        '<img src="http://www.law.go.kr/flDownload.do?flSeq=123278409"  alt="img123278409" >',
        '┌────────┬──────────────────────────┐',
        '│종합소득        │세   율                                             │',
        '│1,400만원 이하  │과세표준의 6퍼센트                                  │',
        '│1,400만원 초과  │84만원 + (1,400만원을 초과하는 금액의 15퍼센트)     │',
        '└────────┴──────────────────────────┘',
        '</img>',
      ],
    ]
    const art = {
      ...BASE,
      조문번호: 55,
      조문내용: '제55조(세율)',
      항: [{ 항번호: '①', 항내용: 세율표 }],
    }
    const content = assembleArticleContent(art)

    // 괘선·세율 셀 텍스트가 누락·재구성 없이 그대로 포함
    expect(content).toContain('┌')
    expect(content).toContain('│1,400만원 이하  │과세표준의 6퍼센트')
    expect(content).toContain('84만원 + (1,400만원을 초과하는 금액의 15퍼센트)')
    expect(content).toContain('</img>')

    // 원문 순서 보존: 헤더 행이 데이터 행보다 앞에 온다
    expect(content.indexOf('세   율')).toBeLessThan(content.indexOf('1,400만원 이하'))
    expect(content.indexOf('1,400만원 이하')).toBeLessThan(content.indexOf('1,400만원 초과'))
  })

  it('호 하위 목(目)까지 본문에 포함한다 (지방세 제11조 — 단일 항·호 객체 정규화)', () => {
    const art = {
      ...BASE,
      조문번호: 11,
      조문내용: '제11조(부동산 취득의 세율)',
      // 항·호가 (배열이 아닌) 단일 객체로 오는 혼재 케이스도 정규화되는지 확인
      항: {
        항번호: '①',
        항내용: '① 부동산에 대한 취득세는 다음 각 호에 해당하는 표준세율을 적용하여 계산한 금액을 그 세액으로 한다.',
        호: {
          호번호: '1.',
          호내용: '1.  상속으로 인한 취득',
          목: [
            { 목번호: '가.', 목내용: '가.  농지: 1천분의 23' },
            { 목번호: '나.', 목내용: '나.  농지 외의 것: 1천분의 28' },
          ],
        },
      },
    }
    const content = assembleArticleContent(art)
    expect(content).toContain('① 부동산에 대한 취득세는')
    expect(content).toContain('1.  상속으로 인한 취득')
    expect(content).toContain('가.  농지: 1천분의 23')
    expect(content).toContain('나.  농지 외의 것: 1천분의 28')
  })

  it('빈 항내용·undefined 노드를 안전하게 건너뛴다', () => {
    const art = {
      ...BASE,
      조문내용: '제2조(정의)',
      항: [
        { 항번호: '①', 항내용: '' },          // 빈 문자열 → 제외
        { 항번호: '②', 항내용: undefined },    // 누락 → 제외
        { 항번호: '③', 항내용: '③ 본문 텍스트' },
      ],
    }
    const content = assembleArticleContent(art)
    expect(content).toBe('제2조(정의)\n③ 본문 텍스트')
  })
})
