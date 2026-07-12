#!/usr/bin/env node
/**
 * OVERRULED 검수 반영 — TAX-6B-33
 *
 * 회계사가 채운 docs/review/OVERRULED_candidates_batch*.md를 파싱해 "확정(판례→판례)"
 * 행만 citation_edges에 edge_type='OVERRULED'로 반영한다(기존 (from_id,to_id) 행이 있으면
 * UPDATE, 없으면 INSERT). "확정(입법→판례)"는 인용 엣지가 아니므로 DB에 반영하지 않고
 * SUPERSEDED_BY_LAW 목록으로만 콘솔에 요약 출력한다(활용 설계는 별도 티켓, §7 Risks).
 * "해당없음"·"보류"·빈칸은 스킵한다.
 *
 * 자동 확정 금지(이 티켓의 존재 이유): 방향·주체 판정은 회계사가 표에 직접 기입한 값만
 * 그대로 반영한다 — LLM 호출도, 휴리스틱 추정도 하지 않는다(§3.2).
 *
 * 사용법: npm run overruled:apply
 * 멱등: 같은 검수 파일을 다시 실행해도 결과는 바뀌지 않는다(ON CONFLICT UPDATE가 같은
 * edge_type으로 덮어쓰므로 재실행 전후 행 수·값이 불변).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import {
  parseReviewTable,
  classifyReviewVerdict,
  parseDocCell,
  parseOverruledTarget,
} from '../src/domain/precedentCitation'

const ROOT = process.cwd()
const REVIEW_DIR = join(ROOT, 'docs', 'review')

type DocType = '판례' | '심판례'

interface OverruledEdge {
  from_id: string
  from_type: DocType
  to_id: string
  to_type: DocType
  /**
   * 표 셀의 발췌를 그대로 저장한다 — extractOverruledCandidates.ts가 렌더링을 위해
   * 개행만 공백으로 접은 버전이다(§6.1 정책, 해당 스크립트 상단 주석 참조). 신규 INSERT시에만
   * 쓰이며, 기존 엣지 UPDATE 시에는 원 적재(TAX-6B-31) 당시의 무변형 snippet이 그대로 남는다.
   */
  snippet: string
}

/** Neon 연결 끊김 대비 재시도(feedback_neon_connection_retry) — 장시간 배치 필수 */
async function withRetry<T>(fn: () => Promise<T>, label: string, retries = 5): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const wait = Math.min(1000 * 2 ** (attempt - 1), 15000)
      console.warn(`  [재시도 ${attempt}/${retries}] ${label} 실패 — ${wait}ms 후 재시도: ${String(e).slice(0, 120)}`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw lastErr
}

function makePool(): Pool {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('[apply] DATABASE_URL 환경변수가 필요합니다.')
    process.exit(1)
  }
  return new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } })
}

function collectReviewFiles(): string[] {
  if (!existsSync(REVIEW_DIR)) return []
  return readdirSync(REVIEW_DIR)
    .filter((f) => /^OVERRULED_candidates_batch\d+\.md$/.test(f))
    .sort()
    .map((f) => join(REVIEW_DIR, f))
}

/** 코퍼스 존재 여부(in_corpus) — 신규 INSERT시에만 조회(UPDATE는 기존 값을 건드리지 않음) */
async function corpusHas(pool: Pool, docType: DocType, caseNumber: string): Promise<boolean> {
  const sourceType = docType === '심판례' ? '심판례' : '판례'
  const res = await withRetry(
    () => pool.query('SELECT 1 FROM taxlaw_embeddings WHERE source_type = $1 AND case_number = $2 LIMIT 1', [
      sourceType,
      caseNumber,
    ]),
    `코퍼스 조회 ${docType} ${caseNumber}`,
  )
  return (res.rowCount ?? 0) > 0
}

function printSupersededByLaw(list: { from: string; note: string }[]): void {
  if (list.length === 0) return
  console.log('\n═══ 입법 변경(SUPERSEDED_BY_LAW) — 엣지 미반영, 기록만 ═══')
  for (const item of list) console.log(`  ${item.from} — ${item.note}`)
}

async function main(): Promise<void> {
  const files = collectReviewFiles()
  if (files.length === 0) {
    console.error(`[apply] ${REVIEW_DIR}에 검수 파일이 없습니다 — 먼저 npm run overruled:extract 실행 필요`)
    process.exit(1)
  }

  const edgesToApply: OverruledEdge[] = []
  const supersededByLaw: { from: string; note: string }[] = []
  let skipped = 0
  let malformed = 0

  for (const file of files) {
    const markdown = readFileSync(file, 'utf-8')
    const { rows, errors } = parseReviewTable(markdown)
    if (errors.length > 0) {
      console.error(`[apply] ⚠️ ${file}: 허용되지 않은 검수 결과 값 ${errors.length}건 — 이 파일 전체를 반영하지 않습니다.`)
      for (const e of errors) console.error(`    줄 ${e.line}: ${e.reason}`)
      continue // 오류가 있는 파일은 부분 반영하지 않고 전체 건너뜀(오타로 인한 오반영 차단)
    }

    for (const row of rows) {
      const action = classifyReviewVerdict(row.verdict)
      if (action === 'skip') {
        skipped++
        continue
      }
      const src = parseDocCell(row.caseNumber)
      if (!src) {
        console.warn(`[apply] ⚠️ 문서(사건번호) 셀 파싱 실패 — 건너뜀: "${row.caseNumber}" (${file})`)
        malformed++
        continue
      }
      if (action === 'superseded_by_law') {
        supersededByLaw.push({
          from: `${src.docType} ${src.caseNumber}`,
          note: row.overruledBy || '(뒤집은 주체 미기입)',
        })
        continue
      }
      // action === 'apply' (확정(판례→판례))
      const target = parseOverruledTarget(row.overruledTarget)
      if (!target) {
        console.warn(`[apply] ⚠️ 뒤집힌 대상 미기입/파싱 실패 — 건너뜀 (문서: ${src.docType} ${src.caseNumber}, ${file})`)
        malformed++
        continue
      }
      edgesToApply.push({
        from_id: src.caseNumber,
        from_type: src.docType,
        to_id: target.caseNumber,
        to_type: target.docType,
        // extractOverruledCandidates.ts는 표 가독성을 위해 발췌를 큰따옴표로 감싼다 —
        // DB 저장 전 그 겉따옴표만 벗겨낸다(내용 문자는 무변형, §6.1).
        snippet: row.snippet.replace(/^"|"$/g, ''),
      })
    }
  }

  console.log(`[apply] 반영 대상(확정(판례→판례)): ${edgesToApply.length}건`)
  console.log(`[apply] 입법 변경(기록만, 엣지 미반영): ${supersededByLaw.length}건`)
  console.log(`[apply] 스킵(해당없음/보류/빈칸): ${skipped}건`)
  if (malformed > 0) console.log(`[apply] 파싱 실패(건너뜀): ${malformed}건`)

  printSupersededByLaw(supersededByLaw)

  if (edgesToApply.length === 0) {
    console.log('[apply] 반영할 확정(판례→판례) 행이 없습니다. 종료.')
    return
  }

  const pool = makePool()
  try {
    let applied = 0
    for (const e of edgesToApply) {
      const inCorpus = await corpusHas(pool, e.to_type, e.to_id)
      await withRetry(
        () =>
          pool.query(
            `INSERT INTO citation_edges (from_id, from_type, to_id, to_type, edge_type, edge_source, snippet, in_corpus, cited_date, group_no)
             VALUES ($1,$2,$3,$4,'OVERRULED','field',$5,$6,NULL,NULL)
             ON CONFLICT (from_id, to_id) DO UPDATE SET edge_type = 'OVERRULED'`,
            [e.from_id, e.from_type, e.to_id, e.to_type, e.snippet, inCorpus],
          ),
        `엣지 반영 ${e.from_id}→${e.to_id}`,
      )
      applied++
      if (applied % 100 === 0) console.log(`[apply] ${applied}/${edgesToApply.length} 반영...`)
    }
    console.log(`[apply] 완료 — ${applied}건 반영(edge_type=OVERRULED)`)
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error('[apply] 오류:', err)
  process.exit(1)
})
