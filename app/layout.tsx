import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '세법 검색 시스템',
  description: '국세법령정보시스템 기반 세법 검색 어시스턴트',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-gray-50 min-h-screen">
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <h1 className="text-xl font-semibold text-gray-800">세법 검색 시스템</h1>
          <p className="text-sm text-gray-500 mt-0.5">국세법령정보시스템 공식 API 기반 · 회계사 전용</p>
        </header>
        <main className="max-w-4xl mx-auto px-4 py-8">{children}</main>
      </body>
    </html>
  )
}
