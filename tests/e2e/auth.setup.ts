/**
 * Playwright 인증 셋업 (TAX-056 베타 게이트 대응)
 *
 * 모든 E2E 테스트 실행 전 베타 패스코드로 로그인하여
 * 세션 쿠키를 .auth/user.json에 저장합니다.
 * 이후 chromium 프로젝트가 이 storageState를 재사용하므로
 * 각 테스트는 이미 인증된 상태에서 시작합니다.
 */
import { test as setup } from '@playwright/test'
import fs from 'fs'

const authFile = '.auth/user.json'

setup('베타 접근 게이트 로그인', async ({ page }) => {
  fs.mkdirSync('.auth', { recursive: true })

  // 빈 페이지 로드 후 fetch를 브라우저 context 안에서 실행
  // credentials: 'include' 덕분에 Set-Cookie 헤더가 브라우저 쿠키 jar에 저장됨
  await page.goto('/')
  const ok = await page.evaluate(async (passcode) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode }),
      credentials: 'include',
    })
    return res.ok
  }, process.env.BETA_ACCESS_CODE ?? 'e2e-dummy')

  if (!ok) throw new Error('E2E 로그인 실패 — BETA_ACCESS_CODE 환경변수를 확인하세요')

  // 쿠키가 브라우저 context에 저장되었으므로 storageState로 덤프
  await page.context().storageState({ path: authFile })
})
