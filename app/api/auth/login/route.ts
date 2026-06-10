/**
 * 베타 접근 로그인 API (TAX-056)
 *
 * 패스코드를 받아 검증하고, 일치하면 서명된 세션 쿠키를 발급합니다.
 * 이 경로는 미들웨어 matcher에서 제외되어 게이트 없이 접근 가능합니다.
 */
import { NextResponse } from 'next/server'
import {
  signSession,
  constantTimeEqual,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from '@/auth/session'

export async function POST(request: Request) {
  const accessCode = process.env.BETA_ACCESS_CODE
  const secret = process.env.SESSION_SECRET

  // 서버 설정 누락 — 패스코드/시크릿 값은 응답에 절대 노출하지 않습니다.
  if (!accessCode || !secret) {
    return NextResponse.json(
      { ok: false, error: 'E-CONFIG', message: '서버 설정 오류입니다. 관리자에게 문의하세요.' },
      { status: 500 },
    )
  }

  // 요청 본문 파싱
  let passcode = ''
  try {
    const body = (await request.json()) as { passcode?: unknown }
    if (typeof body.passcode === 'string') {
      passcode = body.passcode
    }
  } catch {
    return NextResponse.json(
      { ok: false, message: '잘못된 요청입니다.' },
      { status: 400 },
    )
  }

  // 패스코드 상수 시간 비교(타이밍 공격 방지)
  if (!constantTimeEqual(passcode, accessCode)) {
    return NextResponse.json(
      { ok: false, message: '패스코드가 올바르지 않습니다.' },
      { status: 401 },
    )
  }

  // 통과 — 서명 쿠키 발급
  const token = await signSession(secret)
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true, // JS에서 쿠키 접근 차단(XSS로 탈취 방지)
    secure: process.env.NODE_ENV === 'production', // 프로덕션은 HTTPS에서만 전송
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
  return response
}
