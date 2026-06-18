#!/usr/bin/env node
/**
 * 임베딩 적재 배치 — TAX-026-E
 *
 * 사용법:
 *   npx tsx scripts/embed.ts --input <laws.json>
 *   npx tsx scripts/embed.ts --input <laws.json> --dry-run
 *
 * laws.json 형식: TaxLaw[] 배열 (content가 있는 항목만 처리)
 *
 * 동작:
 *   1. laws.json을 읽어 content 보유 항목 필터
 *   2. content_hash(SHA-256)로 이미 적재된 항목 스킵 (재실행 안전)
 *   3. voyage-4(1024차원)로 배치 임베딩 생성 (TAX-6B-15, 이전 OpenAI에서 전환)
 *   4. pgvector taxlaw_embeddings 테이블에 upsert
 *
 * ⚠️ DB는 vector(1024) 스키마여야 함. 1536(OpenAI) 스키마에 적재하면 차원 불일치 오류.
 *    모델 전환 시 기존 데이터를 비우고(TRUNCATE) 전량 재적재해야 한다.
 */

import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { Pool } from 'pg'
import type { TaxLaw } from '../src/domain/TaxLaw'
import { VoyageEmbeddingAdapter } from '../src/adapters/embedding'

// 환경변수 직접 로드 (server-only 제약 없는 스크립트 컨텍스트)
const DATABASE_URL = process.env.DATABASE_URL
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY

if (!DATABASE_URL) {
  console.error('[embed] DATABASE_URL 환경변수가 필요합니다.')
  process.exit(1)
}
if (!VOYAGE_API_KEY) {
  console.error('[embed] VOYAGE_API_KEY 환경변수가 필요합니다.')
  process.exit(1)
}

// CLI 인수 파싱
const args = process.argv.slice(2)
const inputIdx = args.indexOf('--input')
const inputFile = inputIdx !== -1 ? args[inputIdx + 1] : null
const dryRun = args.includes('--dry-run')

/**
 * 배치 크기 — voyage-4 단일 요청은 문서 수·토큰 양쪽 한도를 가진다.
 * 비법령(심판례·해석례) 본문은 최대 6,000자(약 4,000 토큰) × 20건 ≈ 80,000 토큰으로 안전.
 * 법령(짧은 조문) 기준 100에서 20으로 축소 — TAX-053 비법령 적재 시 토큰 초과 방지.
 */
const BATCH_SIZE = 20

/**
 * voyage-4 컨텍스트 최대 32,000 토큰.
 * 한국어는 약 1.5~2자/토큰이므로 6000자 ≈ 3000~4000 토큰으로 안전하게 제한.
 */
const MAX_CONTENT_CHARS = 6000

function truncateContent(content: string): string {
  return content.length > MAX_CONTENT_CHARS ? content.slice(0, MAX_CONTENT_CHARS) + '(…)' : content
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

async function main() {
  if (!inputFile) {
    console.error('[embed] --input <laws.json> 인수가 필요합니다.')
    process.exit(1)
  }

  const rawLaws: TaxLaw[] = JSON.parse(readFileSync(inputFile, 'utf8'))
  // content가 있는 항목만 임베딩 대상
  const laws = rawLaws.filter((l) => l.content.trim().length > 0)
  console.log(`[embed] 전체 ${rawLaws.length}건 중 content 보유 ${laws.length}건 처리 예정`)

  if (dryRun) {
    console.log('[embed] --dry-run 모드: DB 저장 없이 종료합니다.')
    return
  }

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  const embedder = new VoyageEmbeddingAdapter(VOYAGE_API_KEY!)

  let inserted = 0
  let skipped = 0

  for (let i = 0; i < laws.length; i += BATCH_SIZE) {
    const batch = laws.slice(i, i + BATCH_SIZE)
    const hashes = batch.map((l) => sha256(l.content))

    // 이미 적재된 항목 확인 (content_hash UNIQUE)
    const { rows: existingRows } = await pool.query<{ content_hash: string }>(
      `SELECT content_hash FROM taxlaw_embeddings WHERE content_hash = ANY($1)`,
      [hashes],
    )
    const existingSet = new Set(existingRows.map((r) => r.content_hash))

    const newItems = batch.filter((_, idx) => !existingSet.has(hashes[idx]))
    const newHashes = hashes.filter((h) => !existingSet.has(h))
    skipped += batch.length - newItems.length

    if (newItems.length === 0) {
      console.log(`[embed] 배치 ${Math.floor(i / BATCH_SIZE) + 1}: 전체 스킵 (이미 적재됨)`)
      continue
    }

    const embeddings = await embedder.embedBatch(newItems.map((l) => truncateContent(l.content)))

    // 배치 upsert
    for (let j = 0; j < newItems.length; j++) {
      const law = newItems[j]
      const embedding = embeddings[j]
      const hash = newHashes[j]
      await pool.query(
        `INSERT INTO taxlaw_embeddings
           (source_type, law_name, article_number, case_number, article_title,
            content, embedding, revision_date, enforcement_date,
            source_url, trust_tier, issuing_body, decision_date, content_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7::vector,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (content_hash) DO NOTHING`,
        [
          law.sourceType,
          law.lawName,
          law.articleNumber || null,
          law.caseNumber || null,
          law.articleTitle || null,
          law.content,
          `[${embedding.join(',')}]`,
          law.revisionDate || null,
          law.enforcementDate || null,
          law.sourceUrl,
          law.trustTier,
          law.issuingBody || null,
          law.decisionDate || null,
          hash,
        ],
      )
      inserted++
    }

    console.log(
      `[embed] 배치 ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(laws.length / BATCH_SIZE)}: ` +
      `${newItems.length}건 적재 완료`,
    )
  }

  await pool.end()
  console.log(`[embed] 완료 — 적재: ${inserted}건, 스킵: ${skipped}건`)
}

main().catch((err) => {
  console.error('[embed] 오류:', err)
  process.exit(1)
})
