/**
 * 베타 접근 게이트 프록시 (TAX-056)
 *
 * 모든 요청을 가로채 세션 쿠키를 검증하는 "정문 경비원"입니다.
 * 유효한 세션이 없으면 /login으로 돌려보냅니다.
 *
 * Next.js 16에서 'middleware' 파일 컨벤션이 'proxy'로 변경되었습니다.
 * Edge 런타임에서 실행되므로 Node 전용 모듈을 쓰지 않고,
 * src/auth/session.ts의 Web Crypto 함수만 사용합니다.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifySession, SESSION_COOKIE_NAME } from '@/auth/session'

export async function proxy(request: NextRequest) {
  const secret = process.env.SESSION_SECRET

  // 시크릿이 없으면 게이트가 무력화되므로, 안전하게 전부 차단(로그인으로 유도)합니다.
  // (운영에서는 config Fail-fast로 먼저 걸리지만, 이중 안전장치)
  if (!secret) {
    return redirectToLogin(request)
  }

  // 쿠키의 세션 토큰을 검증합니다.
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  const isValid = await verifySession(token, secret)

  if (!isValid) {
    return redirectToLogin(request)
  }

  // 통과 — 원래 목적지로 진행합니다.
  return NextResponse.next()
}

/**
 * 로그인 페이지로 리다이렉트합니다.
 * 원래 가려던 경로를 ?from= 쿼리에 담아, 로그인 후 되돌아갈 수 있게 합니다.
 * @param {NextRequest} request
 * @returns {NextResponse} 리다이렉트 응답
 */
function redirectToLogin(request: NextRequest): NextResponse {
  const loginUrl = new URL('/login', request.url)
  const from = request.nextUrl.pathname + request.nextUrl.search
  if (from && from !== '/') {
    loginUrl.searchParams.set('from', from)
  }
  return NextResponse.redirect(loginUrl)
}

/**
 * 게이트를 적용할 경로 범위.
 * 다음은 제외합니다(게이트 없이 통과):
 * - /login           : 로그인 페이지 자체
 * - /api/auth/login  : 패스코드 검증 API
 * - /_next/static, /_next/image : 빌드 정적자원(스타일 깨짐 방지)
 * - favicon.ico      : 파비콘
 */
export const config = {
  matcher: ['/((?!login|api/auth/login|_next/static|_next/image|favicon.ico).*)'],
}
