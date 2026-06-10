/**
 * 베타 접근 로그아웃 API (TAX-056)
 *
 * 세션 쿠키를 즉시 만료시켜 게이트 밖으로 내보냅니다.
 */
import { NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME } from '@/auth/session'

export async function POST() {
  const response = NextResponse.json({ ok: true })
  // maxAge 0으로 쿠키를 즉시 삭제합니다.
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}
