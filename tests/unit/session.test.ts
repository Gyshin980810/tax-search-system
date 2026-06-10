/**
 * 베타 접근 세션 서명·검증 테스트 (TAX-056)
 * src/auth/session.ts의 순수함수 회귀 방지.
 */
import { describe, it, expect } from 'vitest'
import { signSession, verifySession, constantTimeEqual } from '@/auth/session'

describe('signSession', () => {
  it('같은 시크릿은 항상 같은 서명을 만든다(결정적)', async () => {
    const a = await signSession('my-secret-key')
    const b = await signSession('my-secret-key')
    expect(a).toBe(b)
  })

  it('다른 시크릿은 다른 서명을 만든다', async () => {
    const a = await signSession('secret-one')
    const b = await signSession('secret-two')
    expect(a).not.toBe(b)
  })

  it('서명은 hex 문자열이다(SHA-256 → 64자)', async () => {
    const sig = await signSession('any-secret')
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
  })

  it('서명에 시크릿 평문이 포함되지 않는다', async () => {
    const secret = 'super-secret-passphrase'
    const sig = await signSession(secret)
    expect(sig).not.toContain(secret)
  })
})

describe('verifySession', () => {
  const secret = 'session-secret-123'

  it('올바른 시크릿으로 만든 토큰은 검증을 통과한다', async () => {
    const token = await signSession(secret)
    expect(await verifySession(token, secret)).toBe(true)
  })

  it('undefined 토큰은 거부한다', async () => {
    expect(await verifySession(undefined, secret)).toBe(false)
  })

  it('빈 문자열 토큰은 거부한다', async () => {
    expect(await verifySession('', secret)).toBe(false)
  })

  it('변조된 토큰은 거부한다', async () => {
    const token = await signSession(secret)
    const tampered = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0')
    expect(await verifySession(tampered, secret)).toBe(false)
  })

  it('다른 시크릿으로 만든 토큰은 거부한다(시크릿 교체 시 기존 쿠키 무효화)', async () => {
    const token = await signSession('old-secret')
    expect(await verifySession(token, 'new-secret')).toBe(false)
  })
})

describe('constantTimeEqual', () => {
  it('완전히 같은 문자열은 true', () => {
    expect(constantTimeEqual('passcode123', 'passcode123')).toBe(true)
  })

  it('다른 문자열은 false', () => {
    expect(constantTimeEqual('passcode123', 'passcode124')).toBe(false)
  })

  it('길이가 다르면 false', () => {
    expect(constantTimeEqual('short', 'longer-string')).toBe(false)
  })

  it('빈 문자열끼리는 true', () => {
    expect(constantTimeEqual('', '')).toBe(true)
  })
})
