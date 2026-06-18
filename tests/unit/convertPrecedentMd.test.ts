/**
 * TAX-6B-13: precedent-kr 판례 .md → TaxLaw 변환 순수 함수 단위 테스트
 *
 * 파일시스템을 건드리지 않고 frontmatter 파싱·매핑·선별 규칙만 검증한다.
 * 가장 중요한 단언: content 원문 불변(CLAUDE.md §6.1 인용 무결성).
 */
import { describe, it, expect } from 'vitest'
import {
  splitFrontmatter,
  parseFrontmatter,
  mdToTaxLaw,
  selectRecentFiles,
} from '../../scripts/convertPrecedentMd'

// precedent-kr 실제 형식을 본뜬 샘플(대법원_1962-07-26_62누21.md 발췌)
const SAMPLE_MD = `---
판례일련번호: '208608'
사건번호: 62누21
사건명: 물품세부과처분취소
법원명: 대법원
법원등급: 대법원
사건종류: 세무
출처: https://www.law.go.kr/LSW/precInfoP.do?precSeq=208608
첨부파일: []
선고일자: 1962-07-26
---

# 물품세부과처분취소

## 판시사항

세관 화물취급인과 구 물품세법 제5조의 징수 대상자

## 판결요지

본법 제5조 소정의 물품세징수대상자인 인취인은 화주이냐 수입신고인이냐를 구별하지 않는다.
`

describe('convertPrecedentMd (TAX-6B-13 판례 .md 변환)', () => {
  describe('splitFrontmatter', () => {
    it('선두 --- 블록을 frontmatter와 body로 분리한다', () => {
      const { frontmatter, body } = splitFrontmatter(SAMPLE_MD)
      expect(frontmatter).toContain('사건번호: 62누21')
      expect(body).toContain('# 물품세부과처분취소')
      expect(body).not.toContain('판례일련번호')
    })

    it('frontmatter가 없으면 본문 전체를 body로 둔다', () => {
      const { frontmatter, body } = splitFrontmatter('# 제목\n내용')
      expect(frontmatter).toBe('')
      expect(body).toBe('# 제목\n내용')
    })
  })

  describe('parseFrontmatter', () => {
    it('key: value를 객체로 파싱한다', () => {
      const meta = parseFrontmatter('사건번호: 62누21\n법원명: 대법원')
      expect(meta.사건번호).toBe('62누21')
      expect(meta.법원명).toBe('대법원')
    })

    it('양끝 따옴표를 제거한다', () => {
      const meta = parseFrontmatter("판례일련번호: '208608'")
      expect(meta.판례일련번호).toBe('208608')
    })

    it('값에 콜론이 있어도 첫 콜론 기준으로만 분할한다(URL 안전)', () => {
      const meta = parseFrontmatter('출처: https://www.law.go.kr/x?precSeq=1')
      expect(meta.출처).toBe('https://www.law.go.kr/x?precSeq=1')
    })
  })

  describe('mdToTaxLaw', () => {
    it('판례를 sourceType=판례·trustTier=T4로 매핑한다', () => {
      const law = mdToTaxLaw(SAMPLE_MD)
      expect(law).not.toBeNull()
      expect(law!.sourceType).toBe('판례')
      expect(law!.trustTier).toBe('T4')
      expect(law!.caseNumber).toBe('62누21')
      expect(law!.lawName).toBe('물품세부과처분취소')
      expect(law!.articleTitle).toBe('물품세부과처분취소')
      expect(law!.issuingBody).toBe('대법원')
      expect(law!.decisionDate).toBe('1962-07-26')
      expect(law!.sourceUrl).toContain('precSeq=208608')
    })

    it('content를 .md 본문 원문 그대로 보존한다(§6.1 — 가공 금지)', () => {
      const law = mdToTaxLaw(SAMPLE_MD)
      // body(trim)와 문자 단위 일치해야 한다
      const { body } = splitFrontmatter(SAMPLE_MD)
      expect(law!.content).toBe(body.trim())
      expect(law!.content).toContain('# 물품세부과처분취소')
      expect(law!.content).toContain('화주이냐 수입신고인이냐를 구별하지 않는다')
    })

    it('판례는 조문번호·개정/시행일이 빈 문자열이다', () => {
      const law = mdToTaxLaw(SAMPLE_MD)
      expect(law!.articleNumber).toBe('')
      expect(law!.revisionDate).toBe('')
      expect(law!.enforcementDate).toBe('')
    })

    it('사건번호가 없으면 null(스킵)', () => {
      const noCase = SAMPLE_MD.replace('사건번호: 62누21\n', '')
      expect(mdToTaxLaw(noCase)).toBeNull()
    })

    it('출처(원문 링크)가 없으면 null(스킵)', () => {
      const noUrl = SAMPLE_MD.replace(/출처: .*\n/, '')
      expect(mdToTaxLaw(noUrl)).toBeNull()
    })

    it('본문이 비면 null(스킵)', () => {
      const onlyFront = SAMPLE_MD.split('---\n')[1]
      expect(mdToTaxLaw(`---\n${onlyFront}---\n`)).toBeNull()
    })
  })

  describe('selectRecentFiles', () => {
    const files = [
      '대법원_1962-07-26_62누21.md',
      '대법원_2019-12-27_2019두47834.md',
      '대법원_2005-03-11_2004두1234.md',
      'README.txt', // .md 아님 → 제외
    ]

    it('.md만 골라 선고일 최신순(파일명 내림차순)으로 정렬한다', () => {
      const result = selectRecentFiles(files, 10)
      expect(result[0]).toBe('대법원_2019-12-27_2019두47834.md')
      expect(result[1]).toBe('대법원_2005-03-11_2004두1234.md')
      expect(result).not.toContain('README.txt')
    })

    it('상한(limit)만큼만 반환한다', () => {
      expect(selectRecentFiles(files, 1)).toHaveLength(1)
      expect(selectRecentFiles(files, 1)[0]).toBe('대법원_2019-12-27_2019두47834.md')
    })
  })
})
