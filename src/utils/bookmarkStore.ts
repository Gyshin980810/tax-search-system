import { maskPhoneEmail } from './piiFilter'

export interface BookmarkEntry {
  id: string
  rawQuestion: string   // 마스킹된 질문 (§7 원문 저장 금지)
  summary: string
  temporalLabel: string
  savedAt: string       // ISO 문자열
}

const BOOKMARK_KEY = 'tax-bookmarks'

export function loadBookmarks(): BookmarkEntry[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(BOOKMARK_KEY) ?? '[]') as BookmarkEntry[]
  } catch {
    return []
  }
}

/** 저장된 질문과 비교 시 둘 다 마스킹해 일치 여부를 판단한다 (§7) */
export function isBookmarked(rawQuestion: string): boolean {
  const masked = maskPhoneEmail(rawQuestion)
  return loadBookmarks().some((b) => b.rawQuestion === masked)
}

/** 저장 전 질문을 마스킹한다 (§7 원문 보관 금지, FR-12) */
export function addBookmark(entry: Omit<BookmarkEntry, 'id' | 'savedAt'>): void {
  const masked = maskPhoneEmail(entry.rawQuestion)
  const bookmarks = loadBookmarks().filter((b) => b.rawQuestion !== masked)
  bookmarks.unshift({
    rawQuestion: masked,
    summary: entry.summary,
    temporalLabel: entry.temporalLabel,
    id: Date.now().toString(),
    savedAt: new Date().toISOString(),
  })
  localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmarks))
}

export function removeBookmark(rawQuestion: string): void {
  const masked = maskPhoneEmail(rawQuestion)
  const bookmarks = loadBookmarks().filter((b) => b.rawQuestion !== masked)
  localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmarks))
}
