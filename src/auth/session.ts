/**
 * 베타 접근 세션 서명·검증 (TAX-056)
 *
 * 미들웨어(Edge 런타임)와 API Route(Node 런타임) 양쪽에서 import하므로,
 * 두 런타임 모두에서 동작하는 Web Crypto(`crypto.subtle`)만 사용합니다.
 * → Node 전용 'crypto' 모듈이나 'server-only'을 import하지 않습니다.
 *
 * 쿠키에는 패스코드 평문이 아니라, 시크릿으로 만든 HMAC 서명만 저장합니다.
 * 서명은 시크릿을 모르면 위조할 수 없으므로, 쿠키를 훔쳐봐도 안전합니다.
 */

// 서명 대상 페이로드(고정). 만료는 쿠키 maxAge로 관리합니다.
const SESSION_PAYLOAD = 'beta-valid'

/**
 * 시크릿으로 세션 서명값(hex 문자열)을 생성합니다.
 * @param {string} secret - 서명용 비밀키 (환경변수 SESSION_SECRET)
 * @returns {Promise<string>} HMAC-SHA256 서명의 hex 표현
 */
export async function signSession(secret: string): Promise<string> {
  const encoder = new TextEncoder()
  // 시크릿을 HMAC 키로 가져옵니다.
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  // 고정 페이로드에 서명합니다.
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(SESSION_PAYLOAD))
  return bufferToHex(signature)
}

/**
 * 쿠키에 담긴 토큰이 시크릿으로 만든 서명과 일치하는지 검증합니다.
 * @param {string | undefined} token - 쿠키에서 읽은 세션 토큰
 * @param {string} secret - 서명용 비밀키
 * @returns {Promise<boolean>} 유효하면 true
 */
export async function verifySession(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false
  const expected = await signSession(secret)
  return constantTimeEqual(token, expected)
}

/**
 * 두 문자열을 상수 시간으로 비교합니다(타이밍 공격 방지).
 * 일반 비교는 앞 글자가 틀리면 빨리 끝나서, 응답 속도로 값을 추측당할 수 있습니다.
 * 이 함수는 길이가 같으면 항상 모든 글자를 끝까지 비교합니다.
 * @param {string} a
 * @param {string} b
 * @returns {boolean} 완전히 같으면 true
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/**
 * ArrayBuffer를 hex 문자열로 변환합니다.
 * @param {ArrayBuffer} buffer
 * @returns {string} 소문자 hex
 */
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** 세션 쿠키 이름 — 미들웨어·Route가 공유 */
export const SESSION_COOKIE_NAME = 'beta_session'

/** 세션 유지 기간(초). 회계사 결정: 30일 (TAX-056) */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
