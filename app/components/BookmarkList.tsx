'use client'

import { useState, useEffect } from 'react'
import { loadBookmarks, removeBookmark, type BookmarkEntry } from '@/utils/bookmarkStore'

interface BookmarkListProps {
  onSelect: (question: string) => void
}

export function BookmarkList({ onSelect }: BookmarkListProps) {
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    // localStorage는 서버 렌더링 시 존재하지 않으므로 마운트 후 동기화가 의도된 설계다.
    // useState 지연 초기화로 옮기면 서버·클라이언트 결과가 달라져 하이드레이션 불일치가 난다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBookmarks(loadBookmarks())
  }, [])

  function handleRemove(rawQuestion: string) {
    removeBookmark(rawQuestion)
    setBookmarks(loadBookmarks())
  }

  if (bookmarks.length === 0) return null

  return (
    <div
      data-testid="bookmark-panel"
      className="bg-white border border-gray-200 rounded-lg"
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        data-testid="bookmark-toggle"
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg"
      >
        <span>⭐ 즐겨찾기 ({bookmarks.length})</span>
        <span className="text-gray-400 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <ul
          data-testid="bookmark-list"
          className="border-t border-gray-200 divide-y divide-gray-100"
        >
          {bookmarks.map((bk) => (
            <li key={bk.id} className="flex items-start gap-2 px-4 py-3">
              <div className="flex-1 min-w-0">
                <button
                  type="button"
                  onMouseDown={() => onSelect(bk.rawQuestion)}
                  data-testid="bookmark-item"
                  className="text-sm text-left text-gray-800 hover:text-blue-600 w-full truncate block"
                >
                  {bk.rawQuestion}
                </button>
                <p className="text-xs text-gray-400 mt-0.5 truncate">{bk.summary}</p>
              </div>
              <button
                type="button"
                onClick={() => handleRemove(bk.rawQuestion)}
                data-testid="bookmark-remove"
                aria-label="즐겨찾기 제거"
                className="flex-shrink-0 text-gray-300 hover:text-red-500 text-base leading-none mt-0.5"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
