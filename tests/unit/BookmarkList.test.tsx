/**
 * BookmarkList 단위 테스트 (TAX-6B-4)
 *
 * 북마크 패널 표시·접기, 항목 선택, 제거 검증.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BookmarkList } from '../../app/components/BookmarkList'

const BOOKMARK_KEY = 'tax-bookmarks'

function setBookmarks(items: { rawQuestion: string; summary: string }[]) {
  const entries = items.map((item, idx) => ({
    id: String(idx),
    rawQuestion: item.rawQuestion,
    summary: item.summary,
    temporalLabel: '[현행]',
    savedAt: new Date().toISOString(),
  }))
  localStorage.setItem(BOOKMARK_KEY, JSON.stringify(entries))
}

describe('BookmarkList (TAX-6B-4)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('북마크가 없으면 렌더링되지 않는다', () => {
    render(<BookmarkList onSelect={vi.fn()} />)
    expect(screen.queryByTestId('bookmark-panel')).toBeNull()
  })

  it('북마크가 있으면 접힌 상태로 패널이 표시된다', () => {
    setBookmarks([{ rawQuestion: '법인세 납부', summary: '요약' }])
    render(<BookmarkList onSelect={vi.fn()} />)

    expect(screen.getByTestId('bookmark-panel')).toBeTruthy()
    expect(screen.queryByTestId('bookmark-list')).toBeNull() // 기본 접힘
    expect(screen.getByTestId('bookmark-toggle').textContent).toContain('1')
  })

  it('토글 버튼 클릭 시 목록이 펼쳐진다', () => {
    setBookmarks([{ rawQuestion: '부가세 면세', summary: '요약' }])
    render(<BookmarkList onSelect={vi.fn()} />)

    fireEvent.click(screen.getByTestId('bookmark-toggle'))

    expect(screen.getByTestId('bookmark-list')).toBeTruthy()
    expect(screen.getByTestId('bookmark-item').textContent).toBe('부가세 면세')
  })

  it('항목 클릭 시 onSelect가 해당 질문으로 호출된다', () => {
    setBookmarks([{ rawQuestion: '법인세 납부', summary: '요약' }])
    const onSelect = vi.fn()
    render(<BookmarkList onSelect={onSelect} />)

    fireEvent.click(screen.getByTestId('bookmark-toggle'))
    fireEvent.mouseDown(screen.getByTestId('bookmark-item'))

    expect(onSelect).toHaveBeenCalledWith('법인세 납부')
  })

  it('제거 버튼 클릭 시 항목이 사라진다', () => {
    setBookmarks([
      { rawQuestion: '법인세 납부', summary: '요약1' },
      { rawQuestion: '부가세 면세', summary: '요약2' },
    ])
    render(<BookmarkList onSelect={vi.fn()} />)

    fireEvent.click(screen.getByTestId('bookmark-toggle'))
    const removeButtons = screen.getAllByTestId('bookmark-remove')
    fireEvent.click(removeButtons[0])

    // 제거 후 1개만 남음
    expect(screen.getAllByTestId('bookmark-item')).toHaveLength(1)
  })

  it('마지막 항목 제거 시 패널이 사라진다', () => {
    setBookmarks([{ rawQuestion: '법인세 납부', summary: '요약' }])
    render(<BookmarkList onSelect={vi.fn()} />)

    fireEvent.click(screen.getByTestId('bookmark-toggle'))
    fireEvent.click(screen.getByTestId('bookmark-remove'))

    expect(screen.queryByTestId('bookmark-panel')).toBeNull()
  })
})
