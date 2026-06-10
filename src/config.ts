/**
 * 환경변수 Fail-fast 검증 — 누락 시 앱 시작 단계에서 즉시 종료 (SSOT §4.1)
 * 이 파일을 import하면 검증이 즉시 실행됩니다.
 *
 * 'server-only'를 import해 클라이언트 번들에 API 키가 포함되지 않도록 강제합니다.
 */
import 'server-only'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `[config] 필수 환경변수 '${name}'가 설정되지 않았습니다.\n` +
      `.env.local 파일에 ${name}=<값> 을 추가하거나 Vercel 환경변수를 확인하세요.`
    )
  }
  // API 키 형식 검증 — 개행·제어문자가 포함된 env 값으로 인한 헤더 인젝션 방지
  if (!/^[\x20-\x7E]{1,256}$/.test(value)) {
    throw new Error(`[config] 환경변수 '${name}' 형식이 올바르지 않습니다.`)
  }
  return value
}

/**
 * PostgreSQL URL 환경변수 전용 검증 — URL은 256자를 초과할 수 있어 requireEnv와 분리 (TAX-026-B)
 * Neon·Supabase·Vercel Postgres URL은 파라미터 포함 시 길이가 김.
 */
function requireUrlEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `[config] 필수 환경변수 '${name}'가 설정되지 않았습니다.\n` +
      `.env.local 파일에 ${name}=postgres://... 형식으로 추가하거나 Vercel 환경변수를 확인하세요.`
    )
  }
  if (!value.startsWith('postgres')) {
    throw new Error(
      `[config] 환경변수 '${name}'는 postgres:// 또는 postgresql:// 로 시작해야 합니다.`
    )
  }
  return value
}

export const config = {
  nationalTaxApiKey: requireEnv('NATIONAL_TAX_API_KEY'),
  openaiApiKey: requireEnv('OPENAI_API_KEY'),
  /**
   * 베타 접근 게이트 (TAX-056).
   * 회계사 지인 소수 베타 배포 시 단일 공유 패스코드로 접근을 제한합니다.
   * betaAccessCode: 공유 패스코드 / sessionSecret: 쿠키 서명용 비밀키.
   * 미들웨어(Edge)는 이 config를 import하지 않고 process.env를 직접 읽습니다.
   */
  betaAccessCode: requireEnv('BETA_ACCESS_CODE'),
  sessionSecret: requireEnv('SESSION_SECRET'),
  /**
   * Phase 4 벡터 DB 활성화 시에만 설정 (TAX-026-B).
   * 미설정 시 FallbackSearchPort가 비활성화되고 직접 매칭만 동작.
   * Vercel Postgres·Neon·Supabase 연결 문자열 (postgres://... 형식).
   */
  databaseUrl: process.env.DATABASE_URL
    ? requireUrlEnv('DATABASE_URL')
    : null,
} as const
