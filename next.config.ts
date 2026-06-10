import type { NextConfig } from "next";

// next.config.ts 로딩 시 필수 환경변수 존재 여부 확인
// (server-only가 없는 경량 검증 — 실제 Fail-fast는 src/config.ts에서 수행)
const REQUIRED_ENV = ['NATIONAL_TAX_API_KEY', 'OPENAI_API_KEY'] as const
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(
      `[next.config] 필수 환경변수 '${key}'가 설정되지 않았습니다. .env.local을 확인하세요.`,
    )
  }
}

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ]
  },
};

export default nextConfig;
