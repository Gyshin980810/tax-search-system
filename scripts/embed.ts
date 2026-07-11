#!/usr/bin/env node
/**
 * 임베딩 적재 배치 — TAX-026-E (TAX-6B-18C: 대용량 입력 스트리밍 보강)
 *
 * 사용법:
 *   npx tsx scripts/embed.ts --input <laws.json>
 *   npx tsx scripts/embed.ts --input <laws.json> --dry-run
 *
 * laws.json 형식: TaxLaw[] 배열 (content가 있는 항목만 처리)
 *   - 0.5GiB 미만: 표준 JSON(pretty-print 등 임의 형식) 통째로 파싱
 *   - 0.5GiB 이상: `[`/`]`/빈 줄을 건너뛰고 한 줄 1객체(끝 콤마 제거)로 스트리밍 파싱
 *     (Node/V8 문자열 길이 한계 536,870,888자 방어 — collectTribunal.ts 산출물 형식과 일치)
 *
 * 동작:
 *   1. laws.json을 스트리밍으로 훑어 content 보유 항목 수 확인 + 비법령 caseNumber 품질 검사
 *   2. content_hash(SHA-256)로 이미 적재된 항목 스킵 (재실행 안전)
 *   3. voyage-4(1024차원)로 문서 수·글자 수 예산 배치 임베딩 생성 즉시 적재 — 전체를 메모리에 올리지 않음
 *   4. pgvector taxlaw_embeddings 테이블에 upsert
 *
 * ⚠️ DB는 vector(1024) 스키마여야 함. 1536(OpenAI) 스키마에 적재하면 차원 불일치 오류.
 *    모델 전환 시 기존 데이터를 비우고(TRUNCATE) 전량 재적재해야 한다.
 */

import { createHash } from 'crypto'
import { createReadStream, readFileSync, statSync, writeFileSync } from 'fs'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { Pool } from 'pg'
import type { TaxLaw } from '../src/domain/TaxLaw'
import { VOYAGE_EMBEDDING_MODEL, VoyageEmbeddingAdapter } from '../src/adapters/embedding'
import { inspectNonLawCaseNumbers } from './embedQuality'

/** 비법령 사건번호 품질 리포트 — 적재 전 중복·누락 발견 시 생성 */
const CASE_ISSUE_REPORT_PATH = 'scripts/embed_case_number_issues.json'

/**
 * 배치 크기 — voyage-4 단일 요청은 문서 수·토큰 양쪽 한도를 가진다.
 * 글자 수 예산과 함께 적용한다. 긴 문서가 한 요청에 몰려 토큰 한도를 넘지 않도록 방어한다.
 */
export const BATCH_SIZE = 20

/**
 * voyage-4 요청당 입력 글자 수 예산.
 * 한국어 약 1.5~2자/토큰 기준 90,000자는 약 45,000~60,000 토큰이다.
 */
export const BATCH_CHARACTER_BUDGET = 90_000

/**
 * voyage-4 컨텍스트 최대 32,000 토큰.
 * 한국어 약 1.5~2자/토큰 기준 30,000자는 약 15,000~20,000 토큰으로 안전하게 제한한다.
 * 현재 국세청 세법해석례 최장 본문(26,886자)을 절단하지 않는다.
 */
export const MAX_CONTENT_CHARS = 30_000

/** Node/V8 문자열 길이 한계(536,870,888자) 방어 — 이 바이트 수 이상이면 줄 스트리밍 모드 */
export const STREAM_THRESHOLD_BYTES = 0.5 * 1024 * 1024 * 1024

export function truncateContent(content: string): string {
  return content.length > MAX_CONTENT_CHARS ? content.slice(0, MAX_CONTENT_CHARS) + '(…)' : content
}

/** 다음 문서를 추가하면 배치 글자 수 예산을 채우거나 넘는지 판단한다. */
export function shouldFlushBeforeAdding(batch: TaxLaw[], nextLaw: TaxLaw): boolean {
  if (batch.length === 0) return false
  const batchCharacterCount = batch.reduce((total, law) => total + law.content.length, 0)
  return batchCharacterCount + nextLaw.content.length >= BATCH_CHARACTER_BUDGET
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * `[`로 시작해 한 줄에 객체 하나씩(끝에 `,` 붙을 수 있음) 나열된 배열 파일의 한 줄을 파싱한다.
 * `[`·`]`·빈 줄은 null(건너뜀). collectTribunal.ts finalize() 산출물 형식과 일치.
 */
export function parseArrayLine(rawLine: string): TaxLaw | null {
  const line = rawLine.trim()
  if (line === '' || line === '[' || line === ']') return null
  const jsonText = line.endsWith(',') ? line.slice(0, -1) : line
  return JSON.parse(jsonText) as TaxLaw
}

/**
 * 입력 파일을 TaxLaw 스트림으로 순회한다.
 * - thresholdBytes 미만: 표준 JSON.parse(통째로) — 기존 동작·형식 호환 100%.
 * - thresholdBytes 이상: 줄 단위 스트리밍(parseArrayLine) — 메모리에 전체를 올리지 않음.
 */
export async function* iterateLaws(
  inputFile: string,
  thresholdBytes: number = STREAM_THRESHOLD_BYTES,
): AsyncGenerator<TaxLaw> {
  const { size } = statSync(inputFile)
  if (size < thresholdBytes) {
    const raw: TaxLaw[] = JSON.parse(readFileSync(inputFile, 'utf8'))
    for (const law of raw) yield law
    return
  }
  const rl = createInterface({ input: createReadStream(inputFile, 'utf8'), crlfDelay: Infinity })
  for await (const line of rl) {
    const law = parseArrayLine(line)
    if (law) yield law
  }
}

function hasContent(law: TaxLaw): boolean {
  return law.content.trim().length > 0
}

/**
 * Neon 등 서버리스 Postgres는 유휴 후 재연결 과정에서 간헐적으로
 * "Connection terminated unexpectedly" 오류를 낼 수 있다.
 * 몇 시간짜리 적재 작업이 그 오류 하나로 전부 죽지 않도록 짧은 재시도를 둔다.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 2000,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= retries) throw err
      console.warn(
        `[embed] DB 쿼리 실패(시도 ${attempt}/${retries}), ${delayMs}ms 후 재시도: ${(err as Error).message}`,
      )
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const inputIdx = args.indexOf('--input')
  const inputFile = inputIdx !== -1 ? args[inputIdx + 1] : null
  const dryRun = args.includes('--dry-run')
  const allowCaseIssues = args.includes('--allow-case-issues')

  if (!inputFile) {
    console.error('[embed] --input <laws.json> 인수가 필요합니다.')
    process.exit(1)
  }

  // ── 1패스: 품질 검사 (content는 흘려보내고 식별자 메타만 수집 — 메모리 절약) ──
  let totalCount = 0
  const metaLaws: TaxLaw[] = []
  for await (const law of iterateLaws(inputFile)) {
    totalCount++
    if (hasContent(law)) metaLaws.push({ ...law, content: '' })
  }
  console.log(`[embed] 전체 ${totalCount}건 중 content 보유 ${metaLaws.length}건 처리 예정`)

  const qualityReport = inspectNonLawCaseNumbers(metaLaws)
  if (qualityReport.hasIssues) {
    writeFileSync(CASE_ISSUE_REPORT_PATH, `${JSON.stringify(qualityReport, null, 2)}\n`, 'utf8')
    console.error(
      `[embed] 비법령 caseNumber 품질 오류: ` +
      `중복 ${qualityReport.duplicateCaseNumbers.length}그룹, ` +
      `누락 ${qualityReport.missingCaseNumbers.length}건. ` +
      `리포트: ${CASE_ISSUE_REPORT_PATH}`,
    )
    if (!allowCaseIssues) {
      console.error('[embed] 적재를 중단합니다. 검토 후 재실행하거나 예외 승인 시 --allow-case-issues를 사용하세요.')
      process.exit(1)
    }
    console.warn('[embed] --allow-case-issues 지정으로 품질 오류가 있어도 계속 진행합니다.')
  }

  if (dryRun) {
    console.log('[embed] --dry-run 모드: DB 저장 없이 종료합니다.')
    return
  }

  // ── 실제 적재 직전에만 환경변수 요구 (dry-run은 환경변수 없이도 실행 가능) ──
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

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  const embedder = new VoyageEmbeddingAdapter(VOYAGE_API_KEY)

  let inserted = 0
  let skipped = 0
  let batchNum = 0
  let batch: TaxLaw[] = []

  async function flushBatch(): Promise<void> {
    if (batch.length === 0) return
    batchNum++
    const current = batch
    batch = []

    const hashes = current.map((l) => sha256(l.content))
    const { rows: existingRows } = await withRetry(() =>
      pool.query<{ content_hash: string }>(
        `SELECT content_hash FROM taxlaw_embeddings WHERE content_hash = ANY($1)`,
        [hashes],
      ),
    )
    const existingSet = new Set(existingRows.map((r) => r.content_hash))

    const newItems = current.filter((_, idx) => !existingSet.has(hashes[idx]))
    const newHashes = hashes.filter((h) => !existingSet.has(h))
    skipped += current.length - newItems.length

    if (newItems.length === 0) {
      console.log(`[embed] 배치 ${batchNum}: 전체 스킵 (이미 적재됨)`)
      return
    }

    const embeddings = await embedder.embedBatch(newItems.map((l) => truncateContent(l.content)))

    for (let j = 0; j < newItems.length; j++) {
      const law = newItems[j]
      const embedding = embeddings[j]
      const hash = newHashes[j]
      await withRetry(() =>
        pool.query(
          `INSERT INTO taxlaw_embeddings
             (source_type, law_name, article_number, case_number, article_title,
              content, embedding, revision_date, enforcement_date,
              source_url, trust_tier, issuing_body, decision_date, content_hash, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7::vector,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
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
            JSON.stringify({
              embeddingModel: VOYAGE_EMBEDDING_MODEL,
              ...(law.externalId?.trim() ? { externalId: law.externalId.trim() } : {}),
            }),
          ],
        ),
      )
      inserted++
    }

    console.log(`[embed] 배치 ${batchNum}: ${newItems.length}건 적재 완료`)
  }

  // ── 2패스: 실제 적재 (content 보유분만, 배치 채워지는 즉시 처리 — 전체를 메모리에 올리지 않음) ──
  for await (const law of iterateLaws(inputFile)) {
    if (!hasContent(law)) continue
    if (shouldFlushBeforeAdding(batch, law)) await flushBatch()
    batch.push(law)
    if (batch.length === BATCH_SIZE) await flushBatch()
  }
  await flushBatch()

  await pool.end()
  console.log(`[embed] 완료 — 적재: ${inserted}건, 스킵: ${skipped}건`)
}

// vitest import 시 main() 미실행(순수 함수만 노출) — collectTribunal.ts와 동일 가드
const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  main().catch((err) => {
    console.error('[embed] 오류:', err)
    process.exit(1)
  })
}
