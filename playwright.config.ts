import { defineConfig, devices } from '@playwright/test'

// E2E 테스트 중 Next.js 서버 시작 시 필수 환경변수 더미값 주입
// 실제 API는 page.route()로 모킹하므로 값은 사용되지 않는다.
process.env.NATIONAL_TAX_API_KEY ||= 'e2e-dummy'
process.env.OPENAI_API_KEY ||= 'e2e-dummy'

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
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
