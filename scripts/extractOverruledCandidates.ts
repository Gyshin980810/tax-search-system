#!/usr/bin/env node
/**
 * OVERRULED(뒤집힘) 후보 추출 — TAX-6B-33
 *
 * 판례·심판례 본문에서 뒤집힘 신호(전원합의체·판례변경·견해변경·배치범위변경)를 탐지해
 * 회계사 검수용 마크다운 표로 산출한다. LLM·임베딩 미사용(과금 0) — 방향·주체(누가 누구를
 * 뒤집었는가) 판정은 이 스크립트가 하지 않는다. 회계사가 표의 "검수 결과" 컬럼에 직접
 * 기입해야만 다음 단계(applyOverruledReview.ts)에서 citation_edges에 반영된다.
 *
 * 사용법: npm run overruled:extract
 * 산출: docs/review/OVERRULED_candidates_batch{N}.md (300건 단위 분할, 신호 매치마다 1행)
 *
 * 발췌 표기 정책(§6.1 인용 무결성):
 *   - 발췌 본문은 content.slice()의 순수 부분 문자열이며 단어·문장 변형은 전혀 없다.
 *   - 단, 판례·심판례 원문에는 섹션 구분 개행(\n\n)이 잦아 마크다운 표 한 행 안에 그대로
 *     넣으면 표가 깨진다. 따라서 표 렌더링을 위해 개행만 단일 공백으로 접는다(단어 삭제·
 *     삽입·재배열 없음 — 공백류 정규화만). 원문 자체(정본)는 records.jsonl/precedent_full.json에
 *     무변형으로 남아 있으므로 검증 시 "개행→공백 접기를 역으로 반영해" 대조한다.
 */

import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import {
  findReversalSignals,
  extractTribunalSelfId,
  extractSnippet,
  normalizeCaseNumber,
  normalizeTribunalCaseNumber,
  type ReversalSignalName,
} from '../src/domain/precedentCitation'

const ROOT = process.cwd()
const PRECEDENT_FULL = join(ROOT, 'scripts', 'precedent_full.json')
const TRIBUNAL_RECORDS = join(ROOT, 'scripts', 'tribunal', 'records.jsonl')
const REVIEW_DIR = join(ROOT, 'docs', 'review')
const BATCH_SIZE = 300

type DocType = '판례' | '심판례'

interface Candidate {
  docType: DocType
  caseNumber: string
  signal: ReversalSignalName
  /** 표 렌더링용 개행→공백 접기 적용본(§6.1 정책 — 파일 상단 주석 참조) */
  snippetForTable: string
}

/** 마크다운 표 셀 안전화 — 개행을 단일 공백으로 접고, 열 구분자 `|`만 이스케이프한다(내용 변형 없음) */
function toTableCell(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').replace(/\|/g, '\\|')
}

function extractCandidatesFromDoc(docType: DocType, caseNumber: string, content: string): Candidate[] {
  if (!content || !caseNumber) return []
  const out: Candidate[] = []
  for (const sig of findReversalSignals(content)) {
    const rawSnippet = extractSnippet(content, sig.index, 90)
    out.push({
      docType,
      caseNumber,
      signal: sig.signal,
      snippetForTable: toTableCell(rawSnippet),
    })
  }
  return out
}

function loadPrecedentCandidates(): Candidate[] {
  if (!existsSync(PRECEDENT_FULL)) {
    console.warn(`[extract] ⚠️ ${PRECEDENT_FULL} 없음 — 판례 후보 건너뜀`)
    return []
  }
  const data = JSON.parse(readFileSync(PRECEDENT_FULL, 'utf-8')) as {
    caseNumber?: string
    content?: string
  }[]
  const out: Candidate[] = []
  for (const d of data) {
    const cn = normalizeCaseNumber(d.caseNumber ?? '')
    out.push(...extractCandidatesFromDoc('판례', cn, d.content ?? ''))
  }
  console.log(`[extract] 판례 ${data.length}건 스캔 → 신호 매치 ${out.length}건`)
  return out
}

async function loadTribunalCandidates(): Promise<Candidate[]> {
  if (!existsSync(TRIBUNAL_RECORDS)) {
    console.warn(`[extract] ⚠️ ${TRIBUNAL_RECORDS} 없음 — 심판례 후보 건너뜀`)
    return []
  }
  const out: Candidate[] = []
  const rl = createInterface({ input: createReadStream(TRIBUNAL_RECORDS), crlfDelay: Infinity })
  let n = 0
  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let law: { lawName?: string; caseNumber?: string; content?: string }
    try {
      const rec = JSON.parse(trimmed) as { law?: typeof law }
      if (!rec.law) continue
      law = rec.law
    } catch {
      continue // 손상 줄은 보수적으로 건너뜀
    }
    const cn = extractTribunalSelfId(law.lawName ?? '') ?? normalizeTribunalCaseNumber(law.caseNumber ?? '')
    out.push(...extractCandidatesFromDoc('심판례', cn, law.content ?? ''))
    if (++n % 20000 === 0) console.log(`[extract] 심판례 ${n}건 처리...`)
  }
  console.log(`[extract] 심판례 ${n}건 스캔 → 신호 매치 ${out.length}건`)
  return out
}

/**
 * 요약 통계 출력. AC1 비교 대상(티켓 §1.1 "뒤집힘 신호 보유 심판례 1,219건")은
 * "매치 건수"가 아니라 "신호를 1개 이상 보유한 문서 수"이므로 문서 단위 집계를 별도로 낸다.
 */
function printSummary(candidates: Candidate[]): void {
  const byMatchSignal = new Map<ReversalSignalName, number>()
  const tribDocsWithSignal = new Set<string>()
  const tribDocsBySignal = new Map<ReversalSignalName, Set<string>>()

  for (const c of candidates) {
    byMatchSignal.set(c.signal, (byMatchSignal.get(c.signal) ?? 0) + 1)
    if (c.docType === '심판례') {
      tribDocsWithSignal.add(c.caseNumber)
      if (!tribDocsBySignal.has(c.signal)) tribDocsBySignal.set(c.signal, new Set())
      tribDocsBySignal.get(c.signal)!.add(c.caseNumber)
    }
  }

  console.log('\n═══ 추출 요약(매치 단위 — 표의 행 수와 동일) ═══')
  console.log(`총 신호 매치: ${candidates.length}`)
  for (const [signal, count] of byMatchSignal) console.log(`  ${signal}: ${count}`)

  console.log('\n═══ 심판례 문서 단위 집계(티켓 §1.1 실측치 1,219건과 비교용) ═══')
  console.log(`신호 보유 심판례 문서 수: ${tribDocsWithSignal.size}`)
  for (const [signal, set] of tribDocsBySignal) console.log(`  ${signal}: ${set.size}건`)
}

function writeBatches(candidates: Candidate[]): void {
  if (!existsSync(REVIEW_DIR)) mkdirSync(REVIEW_DIR, { recursive: true })
  const header =
    '| # | 문서(사건번호) | 신호 | 원문 발췌(±90자, 무변형·개행→공백 접기) | 검수 결과 | 뒤집은 주체 | 뒤집힌 대상 |\n' +
    '|---|---|---|---|---|---|---|\n'
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE)
    const rows = batch
      .map((c, j) => {
        const no = i + j + 1
        // 검수 결과·뒤집은 주체·뒤집힌 대상은 항상 빈칸으로 생성한다(§9.1 STEP2 — 회계사 기입란,
        // AI가 방향·주체를 미리 채우지 않는다. 발췌 안에 사건번호가 이미 드러나므로 정보 손실 없음).
        return `| ${no} | ${c.docType} ${toTableCell(c.caseNumber)} | ${c.signal} | "${c.snippetForTable}" |  |  |  |`
      })
      .join('\n')
    const batchNo = Math.floor(i / BATCH_SIZE) + 1
    const path = join(REVIEW_DIR, `OVERRULED_candidates_batch${batchNo}.md`)
    writeFileSync(path, header + rows + '\n', 'utf-8')
    console.log(`[extract] 산출: ${path} (${batch.length}건)`)
  }
}

async function main(): Promise<void> {
  const tribCandidates = await loadTribunalCandidates()
  const precCandidates = loadPrecedentCandidates()
  const candidates = [...tribCandidates, ...precCandidates]
  printSummary(candidates)
  writeBatches(candidates)
}

main().catch((err) => {
  console.error('[extract] 오류:', err)
  process.exit(1)
})
