#!/usr/bin/env node
/**
 * DB 마이그레이션 — TAX-026-H
 *
 * 사용법:
 *   npm run migrate
 *
 * 동작:
 *   scripts/migrate.sql을 Neon(pgvector) 인스턴스에 실행합니다.
 *   IF NOT EXISTS 조건이 있어 재실행해도 안전합니다.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { Pool } from 'pg'

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('[migrate] DATABASE_URL 환경변수가 필요합니다.')
  process.exit(1)
}

async function main() {
  const sqlPath = join(process.cwd(), 'scripts', 'migrate.sql')
  const sql = readFileSync(sqlPath, 'utf8')

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })

  console.log('[migrate] Neon 연결 중...')
  try {
    await pool.query(sql)
    console.log('[migrate] 완료 — taxlaw_embeddings 테이블 및 vector 확장 생성 성공')
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error('[migrate] 오류:', err)
  process.exit(1)
})
