import '@testing-library/jest-dom'

// 테스트 환경에서 API 키 미설정 시 더미 키 사용 (MSW/vi.mock이 실제 네트워크 차단)
if (!process.env.NATIONAL_TAX_API_KEY) {
  process.env.NATIONAL_TAX_API_KEY = 'test-api-key-for-vitest'
}
if (!process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = 'test-openai-key-for-vitest'
}
// Voyage 임베딩 키 (TAX-6B-15) — config.ts requireEnv 통과용 더미
if (!process.env.VOYAGE_API_KEY) {
  process.env.VOYAGE_API_KEY = 'test-voyage-key-for-vitest'
}
// 베타 접근 게이트 환경변수 (TAX-056) — config.ts requireEnv 통과용 더미
if (!process.env.BETA_ACCESS_CODE) {
  process.env.BETA_ACCESS_CODE = 'test-beta-access-code'
}
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'test-session-secret-for-vitest'
}
