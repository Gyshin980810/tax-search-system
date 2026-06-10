/**
 * RAG 파이프라인 E2E 테스트 (실제 LLM + 실제 API)
 *
 * [1] GPT-4o-mini → 자연어 질문을 세법 검색 키워드로 변환
 * [2] 국세법령정보시스템 API → 실제 법령 조문 검색
 * [3] GPT-4o-mini → 검색된 조문으로 라벨링된 답변 생성
 *
 * server-only / config.ts 우회: 환경변수를 직접 주입
 *
 * 실행: node scripts/test-rag-e2e.mjs
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createOpenAI } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { z } from 'zod'

// ─── .env.local 로드 ─────────────────────────────────────────────────────────

function loadEnvLocal() {
  try {
    const content = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8')
    for (const line of content.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq < 0) continue
      const k = t.slice(0, eq).trim()
      const v = t.slice(eq + 1).trim()
      if (k && v && !process.env[k]) process.env[k] = v
    }
  } catch { /* .env.local 없으면 기존 환경변수 사용 */ }
}

loadEnvLocal()

const TAX_API_KEY = process.env.NATIONAL_TAX_API_KEY
const OPENAI_KEY  = process.env.OPENAI_API_KEY
const BASE_URL    = 'https://www.law.go.kr'
const TIMEOUT_MS  = 8_000

// ─── 색상 출력 유틸 ───────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
  blue:   '\x1b[34m',
}

function log(color, ...args) { console.log(color + args.join(' ') + C.reset) }
function hr(ch = '─', n = 60) { return ch.repeat(n) }

// ─── 국세법령 API 유틸 ────────────────────────────────────────────────────────

function toIsoDate(raw) {
  if (!raw || raw.length !== 8) return raw ?? ''
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
}

async function fetchJson(url) {
  const ctrl = new AbortController()
  const id   = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  } finally {
    clearTimeout(id)
  }
}

async function searchLaws(keyword) {
  const p = new URLSearchParams({ OC: TAX_API_KEY, target: 'law', type: 'JSON', query: keyword, display: '5', page: '1' })
  const data = await fetchJson(`${BASE_URL}/DRF/lawSearch.do?${p}`)
  const ls = data.LawSearch
  if (!ls || ls.resultCode !== '00' || !ls.law) return []
  return Array.isArray(ls.law) ? ls.law : [ls.law]
}

async function fetchArticles(lsiSeq) {
  const p = new URLSearchParams({ OC: TAX_API_KEY, target: 'law', MST: lsiSeq, type: 'JSON' })
  const data = await fetchJson(`${BASE_URL}/DRF/lawService.do?${p}`)
  const law = data.법령
  if (!law?.기본정보) return []
  const raw = law.조문?.조문단위
  if (!raw) return []
  const all = Array.isArray(raw) ? raw : [raw]
  const info = law.기본정보
  return all
    .filter(a => a.조문여부 === '조문')
    .map(a => {
      const match = (a.조문내용 ?? '').match(/^(제\d+조(?:의\d+)?)/)
      const efYd  = a.조문시행일자 || info.시행일자
      return {
        lawName:         info.법령명_한글,
        articleNumber:   match ? match[1] : String(a.조문번호),
        articleTitle:    '',
        content:         a.조문내용 ?? '',
        revisionDate:    a.조문시행일자 ? toIsoDate(a.조문시행일자) : toIsoDate(info.공포일자),
        enforcementDate: toIsoDate(info.시행일자),
        sourceUrl:       `${BASE_URL}/lsInfoP.do?efYd=${efYd}&lsiSeq=${lsiSeq}`,
        trustTier:       toTrustTier(info.법종구분?.content ?? ''),
      }
    })
}

function toTrustTier(t) {
  if (t === '법률' || t.endsWith('법')) return 'T1'
  if (t.includes('대통령령') || t.endsWith('령')) return 'T1'
  if (t.includes('규칙') || t.includes('규정')) return 'T1'
  if (t.includes('부칙') || t.includes('경과조치')) return 'T2'
  if (t.includes('예규') || t.includes('훈령') || t.includes('고시')) return 'T3'
  return 'T3'
}

async function apiSearch(keyword) {
  const laws = await searchLaws(keyword)
  if (!laws.length) return []
  return fetchArticles(laws[0].법령일련번호)
}

// ─── [1] LLM — 쿼리 변환 ─────────────────────────────────────────────────────

const QUERY_SYSTEM = `당신은 대한민국 세법 전문 검색 보조 시스템입니다.
회계사가 자연어로 질문한 세법 쟁점을 국세법령정보시스템 API 검색에 적합한 키워드로 변환합니다.

규칙:
1. 반드시 "법령명" 또는 "법령명 + 핵심 용어" 형식으로 키워드를 생성합니다.
   예시: "법인세법", "소득세법", "부가가치세법", "상속세 및 증여세법", "국세기본법"
2. 최대 3개의 검색 쿼리를 생성합니다 (핵심 법령 → 관련 법령 순서).
3. 각 키워드는 15자 이내로 간결하게 작성합니다.
4. 법령명 검색이 원칙입니다. 개념어·문장형 키워드는 사용하지 않습니다.
5. 가지급금 관련 질문 → "법인세법", 부가가치세 → "부가가치세법", 상속·증여 → "상속세 및 증여세법"처럼 매핑하세요.`

const querySchema = z.object({
  queries: z.array(z.object({ keyword: z.string().min(1).max(100) })).min(1).max(3),
})

async function rewriteQuery(question) {
  const openai = createOpenAI({ apiKey: OPENAI_KEY })
  const { object } = await generateObject({
    model:  openai('gpt-4o-mini'),
    schema: querySchema,
    system: QUERY_SYSTEM,
    prompt: `질문: ${question}`,
  })
  return object.queries.map(q => q.keyword.trim())
}

// ─── [3] LLM — 답변 생성 ─────────────────────────────────────────────────────

const ANSWER_SYSTEM = `당신은 대한민국 세법 전문 검색 어시스턴트입니다.
회계사의 질문에 대해 아래 제공된 법령 조문만을 근거로 답변을 생성합니다.

[인용 무결성 규칙 — 절대 준수]
1. excerpt(발췌)는 반드시 제공된 조문 content 원문에서 그대로 추출합니다. 단어 하나도 임의로 변경·요약·의역하지 않습니다.
2. 부분 인용 시 생략은 (…)로만 표시합니다.
3. 제공된 조문에 없는 내용을 인용하거나 창작하지 않습니다.

[라벨링 규칙]
- 🟢직접근거: T1/T2 출처이고 질문에 직접 적용. 단정형 허용.
- 🟡유사사례: T3/T4 출처이거나 사실관계 차이 가능. "유사 사례에서는..." 형태로만 기술. 단정 금지.
- ⚪참고자료: 관련 쟁점만 다루는 경우.
- ⚫폐지: 폐지·삭제된 조문.

[시점 라벨]
temporalLabel은 반드시: "[현행]" | "[적용 시점: YYYY.MM.DD~YYYY.MM.DD]" | "[폐지: YYYY.MM.DD]" 중 하나.

[summary 규칙]
🟡에서 단정형 금지. 직접 근거가 없으면 "직접 근거를 찾지 못했습니다. 유사 사례 또는 참고 자료를 확인해 주세요."로 작성.`

const citationSchema = z.object({
  lawIndex:      z.number().int().min(0),
  label:         z.enum(['🟢직접근거', '🟡유사사례', '⚪참고자료', '⚫폐지']),
  excerpt:       z.string(),
  temporalLabel: z.string(),
})

const answerSchema = z.object({
  citations:     z.array(citationSchema),
  summary:       z.string(),
  temporalLabel: z.string(),
})

function buildLawsContext(laws) {
  if (!laws.length) return '[검색된 법령 없음]'
  return laws.map((law, idx) =>
    `[${idx}] ${law.lawName} ${law.articleNumber} (${law.trustTier})\n시행일: ${law.enforcementDate}\n원문:\n${law.content}`
  ).join('\n\n---\n\n')
}

async function generateAnswer(laws, question) {
  const openai = createOpenAI({ apiKey: OPENAI_KEY })
  const { object } = await generateObject({
    model:  openai('gpt-4o-mini'),
    schema: answerSchema,
    system: ANSWER_SYSTEM,
    prompt: `[회계사 질문]\n${question}\n\n[제공된 법령 조문]\n${buildLawsContext(laws)}`,
  })

  const citations = object.citations
    .filter(c => c.lawIndex >= 0 && c.lawIndex < laws.length)
    .map(c => ({ ...c, taxLaw: laws[c.lawIndex] }))

  return { citations, summary: object.summary, temporalLabel: object.temporalLabel }
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────

const QUESTION = '해외 자회사에 대한 대여금이 가지급금이 아닌 것으로 인정되는 경우를 찾아줘.'

async function main() {
  console.log()
  log(C.bold + C.cyan, '='.repeat(60))
  log(C.bold + C.cyan, ' RAG 파이프라인 E2E 테스트 (GPT-4o-mini + 실제 API)')
  log(C.bold + C.cyan, '='.repeat(60))
  log(C.gray, `질문: ${QUESTION}`)
  console.log()

  // 사전 조건 확인
  if (!TAX_API_KEY) { log(C.red, '✗ NATIONAL_TAX_API_KEY 없음'); process.exit(1) }
  if (!OPENAI_KEY)  { log(C.red, '✗ OPENAI_API_KEY 없음');       process.exit(1) }

  // ── [1] 쿼리 변환 ──────────────────────────────────────────────────────────
  log(C.bold + C.blue, `\n[1단계] GPT-4o-mini → 검색 키워드 변환`)
  log(C.gray, hr())

  let keywords
  const t1 = Date.now()
  try {
    keywords = await rewriteQuery(QUESTION)
    log(C.gray, `응답 시간: ${Date.now() - t1}ms`)
    keywords.forEach((kw, i) => log(C.green, `  키워드 ${i + 1}: ${kw}`))
  } catch (err) {
    log(C.red, `✗ LLM 쿼리 변환 실패: ${err.message}`)
    process.exit(1)
  }

  // ── [2] 실제 API 검색 ──────────────────────────────────────────────────────
  log(C.bold + C.blue, `\n[2단계] 국세법령정보시스템 API 검색`)
  log(C.gray, hr())

  let allLaws = []
  for (const kw of keywords) {
    const t2 = Date.now()
    try {
      const results = await apiSearch(kw)
      log(C.gray, `  "${kw}" → ${results.length}건 (${Date.now() - t2}ms)`)
      allLaws = [...allLaws, ...results]
    } catch (err) {
      log(C.yellow, `  ⚠ "${kw}" 검색 실패: ${err.message}`)
    }
  }

  // 중복 조문 제거 (법령명+조문번호 기준)
  const seen = new Set()
  const laws = allLaws.filter(l => {
    const key = `${l.lawName}|${l.articleNumber}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  log(C.gray, `\n  중복 제거 후 총 ${laws.length}건의 조문을 LLM에 전달합니다.`)

  if (laws.length === 0) {
    log(C.yellow, '\n  ⚠ 검색 결과 없음 — LLM에 빈 법령 목록으로 답변 생성 시도합니다.')
  }

  // 검색된 조문 목록 출력
  console.log()
  laws.slice(0, 10).forEach((l, i) => {
    log(C.gray, `  [${i}] ${l.lawName} ${l.articleNumber} (${l.trustTier}) 시행: ${l.enforcementDate}`)
  })
  if (laws.length > 10) log(C.gray, `  ... 외 ${laws.length - 10}건 (LLM에는 전부 전달)`)

  // ── [3] 답변 생성 ──────────────────────────────────────────────────────────
  log(C.bold + C.blue, `\n[3단계] GPT-4o-mini → 라벨링 답변 생성`)
  log(C.gray, hr())

  let answer
  const t3 = Date.now()
  try {
    answer = await generateAnswer(laws, QUESTION)
    log(C.gray, `응답 시간: ${Date.now() - t3}ms`)
  } catch (err) {
    log(C.red, `✗ LLM 답변 생성 실패: ${err.message}`)
    process.exit(1)
  }

  // ── 결과 출력 ──────────────────────────────────────────────────────────────
  console.log()
  log(C.bold + C.cyan, '='.repeat(60))
  log(C.bold + C.cyan, ' 최종 답변')
  log(C.bold + C.cyan, '='.repeat(60))

  log(C.gray, `시점 라벨: ${answer.temporalLabel}`)
  console.log()

  if (answer.citations.length === 0) {
    log(C.yellow, '  ⚠ 인용된 조문 없음')
  } else {
    answer.citations.forEach((c, i) => {
      const labelColor = c.label.startsWith('🟢') ? C.green
                       : c.label.startsWith('🟡') ? C.yellow
                       : c.label.startsWith('⚫') ? C.gray
                       : C.reset
      log(C.bold, `\n인용 ${i + 1} ${labelColor}${c.label}${C.reset}`)
      log(C.gray, `  출처:   ${c.taxLaw.lawName} ${c.taxLaw.articleNumber}`)
      log(C.gray, `  시행일: ${c.taxLaw.enforcementDate}  Trust: ${c.taxLaw.trustTier}`)
      log(C.gray, `  시점:   ${c.temporalLabel}`)
      log(C.gray, `  원문링크: ${c.taxLaw.sourceUrl}`)
      console.log()
      log(C.reset, `  [발췌]`)
      c.excerpt.split('\n').forEach(l => log(C.reset, `  ${l}`))
    })
  }

  console.log()
  log(C.bold, '─── 요약 ─────────────────────────────────────────────')
  console.log(answer.summary)

  console.log()
  log(C.gray, '─── 면책 고지 ────────────────────────────────────────')
  log(C.gray, '본 답변은 국세법령정보시스템 공식 데이터를 기반으로 생성되었습니다.')
  log(C.gray, '법령의 적용 여부는 구체적인 사실관계에 따라 달라질 수 있으므로,')
  log(C.gray, '최종 판단은 담당 회계사·세무사가 검토해야 합니다.')
  log(C.gray, '(law-verifier 검증은 Phase 3에서 활성화됩니다 — 현재 PENDING)')

  console.log()
  log(C.bold + C.green, '✅ RAG 파이프라인 E2E 테스트 완료')
  console.log()
}

main().catch(err => {
  console.error('\n예상치 못한 오류:', err)
  process.exit(1)
})
