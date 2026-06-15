import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadBookmarks,
  isBookmarked,
  addBookmark,
  removeBookmark,
} from '@/utils/bookmarkStore'

const BOOKMARK_KEY = 'tax-bookmarks'

describe('bookmarkStore — 즐겨찾기 CRUD (TAX-6B-4, FR-12)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  // ─── 기본 CRUD ──────────────────────────────────────────────────────────
  it('북마크가 없으면 빈 배열을 반환한다', () => {
    expect(loadBookmarks()).toEqual([])
  })

  it('북마크를 추가하고 로드할 수 있다', () => {
    addBookmark({ rawQuestion: '법인세 납부', summary: '요약', temporalLabel: '[현행]' })
    const list = loadBookmarks()
    expect(list).toHaveLength(1)
    expect(list[0].rawQuestion).toBe('법인세 납부')
  })

  it('북마크를 제거할 수 있다', () => {
    addBookmark({ rawQuestion: '법인세 납부', summary: '요약', temporalLabel: '[현행]' })
    removeBookmark('법인세 납부')
    expect(loadBookmarks()).toHaveLength(0)
  })

  it('중복 추가 시 1개만 유지하며 최신 버전이 맨 앞에 온다', () => {
    addBookmark({ rawQuestion: '부가세', summary: '요약1', temporalLabel: '[현행]' })
    addBookmark({ rawQuestion: '법인세', summary: '요약2', temporalLabel: '[현행]' })
    addBookmark({ rawQuestion: '부가세', summary: '요약3', temporalLabel: '[현행]' }) // 중복

    const list = loadBookmarks()
    expect(list).toHaveLength(2)
    expect(list[0].rawQuestion).toBe('부가세')
    expect(list[0].summary).toBe('요약3')
  })

  // ─── isBookmarked ───────────────────────────────────────────────────────
  it('isBookmarked — 저장된 질문을 인식한다', () => {
    addBookmark({ rawQuestion: '법인세 납부', summary: '요약', temporalLabel: '[현행]' })
    expect(isBookmarked('법인세 납부')).toBe(true)
  })

  it('isBookmarked — 저장되지 않은 질문을 인식한다', () => {
    expect(isBookmarked('법인세 납부')).toBe(false)
  })

  // ─── PII 마스킹 (§7) ────────────────────────────────────────────────────
  it('저장 시 휴대폰 번호를 마스킹한다', () => {
    addBookmark({
      rawQuestion: '010-1234-5678 양도세',
      summary: '요약',
      temporalLabel: '[현행]',
    })
    const stored = JSON.parse(localStorage.getItem(BOOKMARK_KEY) ?? '[]')[0]
    expect(stored.rawQuestion).toContain('****')
    expect(stored.rawQuestion).not.toContain('1234-5678')
  })

  it('마스킹된 버전으로 isBookmarked를 조회할 수 있다', () => {
    addBookmark({
      rawQuestion: '010-1234-5678 양도세',
      summary: '요약',
      temporalLabel: '[현행]',
    })
    expect(isBookmarked('010-1234-5678 양도세')).toBe(true)
  })

  it('마스킹된 버전으로 removeBookmark를 실행할 수 있다', () => {
    addBookmark({
      rawQuestion: '010-1234-5678 양도세',
      summary: '요약',
      temporalLabel: '[현행]',
    })
    removeBookmark('010-1234-5678 양도세')
    expect(loadBookmarks()).toHaveLength(0)
  })
})
