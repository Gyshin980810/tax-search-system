#!/usr/bin/env node
/**
 * 인용 연결망 엣지 추출·적재 — TAX-6B-31
 *
 * 판례·심판례 원문에 명시된 상호 인용을 추출·분류해 Neon `citation_edges`에 적재한다.
 * LLM·임베딩 호출 0(과금 0), snippet은 원문 부분 문자열 그대로(§6.1 인용 무결성).
 * 검색·답변 경로는 이 테이블을 아직 읽지 않는다(TAX-6B-32에서 반영).
 *
 * 두 단계 분리(collectTribunal.ts 선례 — 재실행·검증 가능):
 *   npm run citation:build -- --extract   → 로컬 JSON(scripts/citation_edges.json) 산출 + 요약 통계
 *   npm run citation:build -- --load      → citation_edges.json을 Neon에 멱등 적재
 *
 * 설계 결정(회계사 승인 2026-07-06):
 *   A) in_corpus 판정은 DB(taxlaw_embeddings)에서 직접 조회한 사건번호 집합 기준(진실 소스).
 *   B) 1998년 이전 고등법원 "구" 사건번호 충돌 14건은 사건번호+법원명 복합 대조
 *      (법원 불명이면 보수적으로 in_corpus=false — 오연결 원천 차단).
 *
 * 원천 이원화(§2.4 ②): 판례→판례 엣지는 참조판례 구조화 필드(edge_source='field', 오탐0·날짜동반)를
 *   1순위로, 판례내용 전문(edge_source='body')을 보조로 쓴다. 원천이 없는 판례는 판시사항+판결요지
 *   정규식으로 폴백(밀도 낮음 감수).
 */

import { createReadStream, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { Pool } from 'pg'
import {
  normalizeCaseNumber,
  normalizeTribunalCaseNumber,
  extractCitedCaseNumbers,
  extractCitedTribunalNumbers,
  extractTribunalSelfId,
  splitBracketGroups,
  classifyCitationEdge,
  extractCitedDate,
  extractSnippet,
  parseReferencedCitations,
  type CitationEdgeType,
} from '../src/domain/precedentCitation'

// ─── 경로·상수 ──────────────────────────────────────────────────────────────

const ROOT = process.cwd()
const PRECEDENT_FULL = join(ROOT, 'scripts', 'precedent_full.json')
const CITATION_SOURCE_DIR = join(ROOT, 'scripts', 'precedent_full')
const TRIBUNAL_RECORDS = join(ROOT, 'scripts', 'tribunal', 'records.jsonl')
const TRIBUNAL_CITATION_SOURCE = join(ROOT, 'scripts', 'tribunal_citation_source.jsonl')
const EDGES_OUT = join(ROOT, 'scripts', 'citation_edges.json')

/**
 * 결정 B — 사건번호 단독 키로는 구분 불가한 충돌 14건(1998년 이전 서울·대구·광주·부산 각
 * 고등법원이 "구" 행정사건 번호를 독립적으로 매기던 시기). 이 사건번호가 인용 대상(to)이면
 * 법원명까지 대조해야 하며, 법원 불명이면 in_corpus=false로 보수 처리한다.
 * (2026-07-06 판례 중복 정리 작업에서 전수 실증 — 전부 서로 다른 사건 확인됨)
 */
const COLLISION_CASE_NUMBERS = new Set(
  [
    '71구9', '72구60', '81구173', '81구33', '82구108', '82구229', '82구291',
    '82구43', '82구87', '83구188', '84구72', '85구152', '85구379', '86구113',
  ].map(normalizeCaseNumber),
)

type DocType = '판례' | '심판례'

/** citation_edges 한 행 — DDL 컬럼과 1:1 대응 */
interface CitationEdgeRow {
  from_id: string
  from_type: DocType
  to_id: string
  to_type: DocType
  edge_type: CitationEdgeType
  edge_source: 'field' | 'body'
  snippet: string
  in_corpus: boolean
  cited_date: string | null
  group_no: number | null
}

// ─── 유틸 ───────────────────────────────────────────────────────────────────

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
    console.error('[citation] DATABASE_URL 환경변수가 필요합니다.')
    process.exit(1)
  }
  return new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } })
}

/** scripts/precedent_full/ 안에서 가장 최신 인용 원천 파일 경로(없으면 null) */
function latestCitationSourceFile(): string | null {
  if (!existsSync(CITATION_SOURCE_DIR)) return null
  const files = readdirSync(CITATION_SOURCE_DIR)
    .filter((f) => f.startsWith('precedent_citation_source_') && f.endsWith('.json'))
    .sort()
  return files.length > 0 ? join(CITATION_SOURCE_DIR, files[files.length - 1]) : null
}

// ─── 코퍼스 로드(결정 A — DB가 진실 소스) ────────────────────────────────────

/** 판례 사건번호 → 법원명 집합(충돌 대비). in_corpus 판정 기준. */
async function loadPrecedentCorpus(pool: Pool): Promise<Map<string, Set<string>>> {
  const res = await withRetry(
    () => pool.query<{ case_number: string | null; issuing_body: string | null }>(
      `SELECT case_number, issuing_body FROM taxlaw_embeddings WHERE source_type = '판례'`,
    ),
    '판례 코퍼스 조회',
  )
  const map = new Map<string, Set<string>>()
  for (const r of res.rows) {
    const cn = normalizeCaseNumber(r.case_number ?? '')
    if (!cn) continue
    if (!map.has(cn)) map.set(cn, new Set())
    if (r.issuing_body) map.get(cn)!.add(r.issuing_body)
  }
  return map
}

/** 심판례 사건번호 집합. 심판례→심판례 in_corpus 판정용. */
async function loadTribunalCorpus(pool: Pool): Promise<Set<string>> {
  const res = await withRetry(
    () => pool.query<{ case_number: string | null }>(
      `SELECT case_number FROM taxlaw_embeddings WHERE source_type = '심판례'`,
    ),
    '심판례 코퍼스 조회',
  )
  const set = new Set<string>()
  for (const r of res.rows) {
    // 0채움 정규화 — 본문 유래 to_id와 표기 통일(DB는 이미 4자리라 사실상 멱등)
    const cn = normalizeTribunalCaseNumber(r.case_number ?? '')
    if (cn) set.add(cn)
  }
  return set
}

/**
 * 판례 to_id가 코퍼스에 있는가(결정 B 반영).
 * @param citedCourt 인용문에 동반된 법원명(참조판례 필드 유래만 있음). body 유래는 undefined.
 */
function isPrecInCorpus(
  toId: string,
  corpusPrec: Map<string, Set<string>>,
  citedCourt?: string,
): boolean {
  const courts = corpusPrec.get(toId)
  if (!courts) return false
  if (!COLLISION_CASE_NUMBERS.has(toId)) return true
  // 충돌 사건번호: 법원명까지 일치해야 함(불명이면 보수적으로 false)
  if (!citedCourt) return false
  return courts.has(citedCourt)
}

// ─── 판례 노드 로드(원천 이원화) ─────────────────────────────────────────────

interface PrecedentNode {
  referencedCases: string // 참조판례 구조화 필드(원천, edge_source='field')
  fullContent: string // 판례내용 전문(원천, edge_source='body')
  content: string // 판시사항+판결요지(precedent_full.json 폴백)
}

/** 인용 원천(우선) ∪ precedent_full.json(폴백 content) 병합 → caseNumber별 노드 맵 */
function loadPrecedentNodes(): Map<string, PrecedentNode> {
  const nodeMap = new Map<string, PrecedentNode>()

  const srcPath = latestCitationSourceFile()
  if (srcPath) {
    const src = JSON.parse(readFileSync(srcPath, 'utf-8')) as {
      caseNumber: string
      referencedCases?: string
      fullContent?: string
    }[]
    for (const s of src) {
      const cn = normalizeCaseNumber(s.caseNumber ?? '')
      if (!cn) continue
      nodeMap.set(cn, {
        referencedCases: s.referencedCases ?? '',
        fullContent: s.fullContent ?? '',
        content: '',
      })
    }
    console.log(`[extract] 인용 원천 로드: ${src.length}건 (${srcPath})`)
  } else {
    console.warn('[extract] ⚠️ 인용 원천 파일 없음 — 판시사항+판결요지 폴백만 사용(밀도 낮음)')
  }

  if (existsSync(PRECEDENT_FULL)) {
    const full = JSON.parse(readFileSync(PRECEDENT_FULL, 'utf-8')) as {
      caseNumber?: string
      content?: string
    }[]
    for (const f of full) {
      const cn = normalizeCaseNumber(f.caseNumber ?? '')
      if (!cn) continue
      const existing = nodeMap.get(cn)
      if (existing) existing.content = f.content ?? ''
      else nodeMap.set(cn, { referencedCases: '', fullContent: '', content: f.content ?? '' })
    }
    console.log(`[extract] precedent_full.json 병합: ${full.length}건`)
  }

  return nodeMap
}

// ─── 엣지 추출 ───────────────────────────────────────────────────────────────

/** 같은 (from,to) 쌍은 첫 발생만 유지(snippet은 최초 인용 문맥) */
function makeEdgeSink() {
  const edgeMap = new Map<string, CitationEdgeRow>()
  return {
    add(e: CitationEdgeRow) {
      if (e.from_id === e.to_id) return // 자기참조 방지
      const key = `${e.from_id}\t${e.to_id}`
      if (!edgeMap.has(key)) edgeMap.set(key, e)
    },
    values: () => [...edgeMap.values()],
  }
}

type EdgeSink = ReturnType<typeof makeEdgeSink>

/**
 * 본문(판례내용 전문 또는 심판례 content)에서 괄호 그룹 단위로 엣지를 추출한다(edge_source='body').
 * 그룹 끝 관용구를 그룹 내 모든 인용에 적용(사슬 오분류 방지, §2.4 ①).
 */
function extractBodyEdges(
  fromId: string,
  fromType: DocType,
  content: string,
  corpusPrec: Map<string, Set<string>>,
  corpusTribunal: Set<string>,
  sink: EdgeSink,
): void {
  if (!content) return
  let groupNo = 0
  for (const g of splitBracketGroups(content)) {
    groupNo++
    const edgeType = classifyCitationEdge(g.text)
    const citedDate = extractCitedDate(g.text)
    const snippet = extractSnippet(content, g.start)
    // 판례 인용(…판결/…결정 맥락)
    for (const to of extractCitedCaseNumbers(g.text, fromId)) {
      sink.add({
        from_id: fromId,
        from_type: fromType,
        to_id: to,
        to_type: '판례',
        edge_type: edgeType,
        edge_source: 'body',
        snippet,
        in_corpus: isPrecInCorpus(to, corpusPrec), // body 유래 = 법원 불명
        cited_date: citedDate,
        group_no: groupNo,
      })
    }
    // 심판례 인용(조심/국심/감심 접두 필수)
    for (const to of extractCitedTribunalNumbers(g.text, fromId)) {
      sink.add({
        from_id: fromId,
        from_type: fromType,
        to_id: to,
        to_type: '심판례',
        edge_type: edgeType,
        edge_source: 'body',
        snippet,
        in_corpus: corpusTribunal.has(to),
        cited_date: citedDate,
        group_no: groupNo,
      })
    }
  }
}

/** 판례 엣지: 참조판례 필드(1순위, field) + 판례내용/폴백 본문(body) */
function extractPrecedentEdges(
  nodes: Map<string, PrecedentNode>,
  corpusPrec: Map<string, Set<string>>,
  corpusTribunal: Set<string>,
  sink: EdgeSink,
): void {
  for (const [fromId, node] of nodes) {
    // 1순위: 참조판례 구조화 필드(오탐0·날짜동반) — 전부 판례 인용, 보수적으로 REFERS
    if (node.referencedCases) {
      for (const c of parseReferencedCitations(node.referencedCases)) {
        sink.add({
          from_id: fromId,
          from_type: '판례',
          to_id: c.caseNumber,
          to_type: '판례',
          edge_type: 'REFERS', // 참조판례 필드엔 관용구가 없음 → 가장 약한 주장(안전)
          edge_source: 'field',
          snippet: node.referencedCases.slice(0, 180),
          in_corpus: isPrecInCorpus(c.caseNumber, corpusPrec, c.court), // 법원명 동반 대조
          cited_date: c.date,
          group_no: null,
        })
      }
    }
    // 2순위: 판례내용 전문(우선) 또는 판시사항+판결요지 폴백
    extractBodyEdges(fromId, '판례', node.fullContent || node.content, corpusPrec, corpusTribunal, sink)
  }
}

/**
 * 심판례 인용 원천(TAX-6B-37) 로드 — seq → 참조결정 필드. 심판례→심판례 field 엣지 정밀화용.
 * 원천이 없으면 빈 맵(심판례는 body 방식만 — 판례와 달리 body가 이미 잘 작동).
 */
async function loadTribunalCitationSources(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (!existsSync(TRIBUNAL_CITATION_SOURCE)) {
    console.warn('[extract] ⚠️ 심판례 인용 원천(참조결정) 없음 — 심판례 field 엣지 건너뜀(body만)')
    return map
  }
  const rl = createInterface({ input: createReadStream(TRIBUNAL_CITATION_SOURCE), crlfDelay: Infinity })
  for await (const line of rl) {
    const t = line.trim()
    if (!t) continue
    try {
      const r = JSON.parse(t) as { seq?: string; referencedDecisions?: string }
      if (r.seq && r.referencedDecisions) map.set(r.seq, r.referencedDecisions)
    } catch {
      // 손상 줄 무시
    }
  }
  console.log(`[extract] 심판례 인용 원천 로드: 참조결정 보유 ${map.size}건`)
  return map
}

/** 심판례 엣지: records.jsonl 스트리밍(2.3GB) — 심판례→판례(body), 심판례→심판례(field 우선 + body) */
async function extractTribunalEdges(
  corpusPrec: Map<string, Set<string>>,
  corpusTribunal: Set<string>,
  tribunalCitations: Map<string, string>,
  sink: EdgeSink,
): Promise<number> {
  if (!existsSync(TRIBUNAL_RECORDS)) {
    console.warn(`[extract] ⚠️ 심판례 원천 없음: ${TRIBUNAL_RECORDS} — 심판례 엣지 건너뜀`)
    return 0
  }
  const rl = createInterface({ input: createReadStream(TRIBUNAL_RECORDS), crlfDelay: Infinity })
  let n = 0
  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let seq: string | undefined
    let law: { lawName?: string; caseNumber?: string; content?: string }
    try {
      const rec = JSON.parse(trimmed) as { seq?: string; law?: typeof law }
      if (!rec.law) continue
      seq = rec.seq
      law = rec.law
    } catch {
      continue // 깨진 행은 보수적으로 건너뜀
    }
    const fromId = extractTribunalSelfId(law.lawName ?? '') ?? normalizeTribunalCaseNumber(law.caseNumber ?? '')
    if (!fromId) continue
    // 1순위: 참조결정 필드(edge_source='field', 심판례→심판례) — TAX-6B-37. 관용구 없어 REFERS.
    const ref = seq ? tribunalCitations.get(seq) : undefined
    if (ref) {
      for (const to of extractCitedTribunalNumbers(ref, fromId)) {
        sink.add({
          from_id: fromId,
          from_type: '심판례',
          to_id: to,
          to_type: '심판례',
          edge_type: 'REFERS',
          edge_source: 'field',
          snippet: ref.slice(0, 180),
          in_corpus: corpusTribunal.has(to),
          cited_date: null, // 참조결정 필드엔 선고일이 동반되지 않음
          group_no: null,
        })
      }
    }
    // 2순위: 본문(이유) 괄호 그룹 — 심판례→판례, 심판례→심판례
    extractBodyEdges(fromId, '심판례', law.content ?? '', corpusPrec, corpusTribunal, sink)
    if (++n % 20000 === 0) console.log(`[extract] 심판례 ${n}건 처리...`)
  }
  return n
}

// ─── 통계 ───────────────────────────────────────────────────────────────────

function printStats(edges: CitationEdgeRow[]): void {
  const total = edges.length
  const dir = (f: DocType, t: DocType) => edges.filter((e) => e.from_type === f && e.to_type === t).length
  const byType = (t: CitationEdgeType) => edges.filter((e) => e.edge_type === t).length
  const bySource = (s: 'field' | 'body') => edges.filter((e) => e.edge_source === s).length
  const inCorpus = edges.filter((e) => e.in_corpus).length
  const pct = (n: number) => (total > 0 ? ((n / total) * 100).toFixed(1) : '0.0')

  console.log('\n═══ 추출 요약 통계 ═══')
  console.log(`총 엣지: ${total}`)
  console.log(`방향별: 판례→판례 ${dir('판례', '판례')} · 심판례→판례 ${dir('심판례', '판례')} · 심판례→심판례 ${dir('심판례', '심판례')}`)
  console.log(`종류별: FOLLOWS ${byType('FOLLOWS')}(${pct(byType('FOLLOWS'))}%) · REFERS ${byType('REFERS')}(${pct(byType('REFERS'))}%) · APPEAL ${byType('APPEAL')}(${pct(byType('APPEAL'))}%)`)
  console.log(`원천별: field ${bySource('field')} · body ${bySource('body')}`)
  console.log(`in_corpus: ${inCorpus} (${pct(inCorpus)}%)`)
}

// ─── --extract ───────────────────────────────────────────────────────────────

async function runExtract(): Promise<void> {
  const pool = makePool()
  try {
    console.log('[extract] DB 코퍼스 조회 중(결정 A)...')
    const corpusPrec = await loadPrecedentCorpus(pool)
    const corpusTribunal = await loadTribunalCorpus(pool)
    console.log(`[extract] 코퍼스: 판례 ${corpusPrec.size}건 · 심판례 ${corpusTribunal.size}건`)

    const sink = makeEdgeSink()

    const nodes = loadPrecedentNodes()
    console.log(`[extract] 판례 노드 ${nodes.size}건 → 엣지 추출...`)
    extractPrecedentEdges(nodes, corpusPrec, corpusTribunal, sink)

    const tribunalCitations = await loadTribunalCitationSources()
    console.log('[extract] 심판례 스트리밍 → 엣지 추출...')
    const tribunalCount = await extractTribunalEdges(corpusPrec, corpusTribunal, tribunalCitations, sink)
    console.log(`[extract] 심판례 ${tribunalCount}건 처리 완료`)

    const edges = sink.values()
    writeFileSync(EDGES_OUT, JSON.stringify(edges, null, 2) + '\n', 'utf-8')
    console.log(`[extract] 산출: ${edges.length}개 엣지 → ${EDGES_OUT}`)
    printStats(edges)
  } finally {
    await pool.end()
  }
}

// ─── --load ──────────────────────────────────────────────────────────────────

async function runLoad(): Promise<void> {
  if (!existsSync(EDGES_OUT)) {
    console.error(`[load] ${EDGES_OUT} 없음 — 먼저 --extract 실행 필요`)
    process.exit(1)
  }
  const edges = JSON.parse(readFileSync(EDGES_OUT, 'utf-8')) as CitationEdgeRow[]
  console.log(`[load] ${edges.length}개 엣지 적재 시작...`)

  const pool = makePool()
  const BATCH = 1000
  const COLS = 10
  let loaded = 0
  try {
    for (let i = 0; i < edges.length; i += BATCH) {
      const batch = edges.slice(i, i + BATCH)
      const placeholders: string[] = []
      const params: unknown[] = []
      batch.forEach((e, j) => {
        const b = j * COLS
        placeholders.push(
          `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`,
        )
        params.push(
          e.from_id, e.from_type, e.to_id, e.to_type, e.edge_type,
          e.edge_source, e.snippet, e.in_corpus, e.cited_date, e.group_no,
        )
      })
      await withRetry(
        () => pool.query(
          `INSERT INTO citation_edges
             (from_id, from_type, to_id, to_type, edge_type, edge_source, snippet, in_corpus, cited_date, group_no)
           VALUES ${placeholders.join(',')}
           ON CONFLICT (from_id, to_id) DO NOTHING`,
          params,
        ),
        `배치 적재 ${i}~${i + batch.length}`,
      )
      loaded += batch.length
      if (loaded % 20000 === 0 || loaded === edges.length) {
        console.log(`[load] ${loaded}/${edges.length} 적재...`)
      }
    }
    console.log(`[load] 완료 — ${edges.length}개 처리(ON CONFLICT 중복은 무시)`)
  } finally {
    await pool.end()
  }
}

// ─── 진입점 ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--extract')) {
    await runExtract()
  } else if (args.includes('--load')) {
    await runLoad()
  } else {
    console.error('사용법: npm run citation:build -- --extract | --load')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[citation] 오류:', err)
  process.exit(1)
})
