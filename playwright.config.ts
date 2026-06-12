import { defineConfig, devices } from '@playwright/test'
import fs from 'fs'

// .env.local을 파싱하여 playwright 프로세스에 주입
// reuseExistingServer 시 기존 서버와 환경변수가 일치해야 로그인이 성공함 (TAX-056)
try {
  const lines = fs.readFileSync('.env.local', 'utf-8').split('\n')
  for (const line of lines) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!(k in process.env)) process.env[k] = v
  }
} catch { /* .env.local 없으면 더미값으로 폴백 */ }

// E2E 테스트 중 Next.js 서버 시작 시 필수 환경변수 더미값 주입
// 실제 API는 page.route()로 모킹하므로 값은 사용되지 않는다.
process.env.NATIONAL_TAX_API_KEY ||= 'e2e-dummy'
process.env.OPENAI_API_KEY ||= 'e2e-dummy'
// 베타 게이트 환경변수 — auth.setup.ts 로그인 시 동일 값 사용 (TAX-056)
process.env.BETA_ACCESS_CODE ||= 'e2e-dummy'
process.env.SESSION_SECRET ||= 'e2e-dummy-session-secret-for-playwright-32ch'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [
    // 1단계: 로그인 → .auth/user.json 생성
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    // 2단계: 저장된 인증 상태로 실제 테스트 실행
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
