/**
 * 골든셋 케이스 골격 생성기 (TAX-028)
 *
 * 회계사 시드(eval/golden_seeds.json) → 실제 국세법령정보시스템 API에서 원문 조회
 *   → V1·V2를 기계적으로 보장하는 케이스 골격을 eval/golden_direct.draft.json 으로 출력.
 *
 * ⚠️ 대원칙(CLAUDE.md §2 책임 분리, 티켓 §3.2):
 *   - 스크립트는 "정답"을 만들지 않는다. summary(정답 답변)는 __TODO__ 마커로 비워
 *     반드시 회계사가 직접 작성하게 한다(AI가 만든 정답을 AI가 채점하는 자기참조 오류 방지).
 *   - 법령 원문(content)은 API 응답을 문자 그대로 주입한다(§6.1 원문 보존, 가공·요약 금지).
 *
 * 실행: npm run golden:build
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TaxLaw } from '../../src/domain/TaxLaw'

/** summary 미작성 표식 — status 스크립트가 "회계사 작성 대기"로 집계한다 */
const TODO_MARKER = '__TODO_회계사_작성__'

/**
 * content 보강 경고 임계값.
 * 어댑터는 조문에 따라 본문(항·호)을 합치지 않고 제목 줄만 반환하는 경우가 있다
 * (예: 항이 많은 부가가치세법 제26조). 이 경우 회계사가 law.go.kr 전체 원문으로 보강해야 한다.
 */
const CONTENT_MIN_LENGTH = 40

// ─── 시드 스키마 ──────────────────────────────────────────────────────────────

interface Seed {
  id: string
  category?: string
  question: string
  lawName: string
  articleNumber: string
  expectedLabel?: string
  expectedStatus?: 'PASS' | 'FAIL'
  note?: string
}

interface SeedFile {
  targetCount?: number
  seeds?: Seed[]
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

/**
 * .env.local 을 직접 로드한다(node --env-file 의존 제거 — 크로스 환경 안전).
 * config.ts가 import 시점에 requireEnv로 Fail-fast 하므로, 어댑터를 동적 import 하기 전에
 * 환경변수를 process.env에 주입해야 한다.
 */
function loadDotenv(path: string): void {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const key = m[1]
    if (process.env[key] !== undefined) continue // 기존 환경변수 우선
    let value = m[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

/**
 * 조문번호에서 "조문 단위" 식별자만 추출한다.
 * 예: "제50조 제1항 제1호" → "제50조", "제50조의2 제1항" → "제50조의2".
 * API 어댑터는 조문 단위(제N조)까지만 파싱하므로 매칭은 이 단위로 한다.
 */
function extractArticleRoot(articleNumber: string): string {
  const m = articleNumber.match(/^제\d+조(?:의\d+)?/)
  return m ? m[0] : articleNumber.trim()
}

/** PENDING 검증 결과 초기값(골든셋 픽스처용) */
function pendingVerification() {
  return {
    status: 'PENDING' as const,
    checks: { v1: false, v2: false, v3: false, v4: false, v5: false, v6: false },
    failReasons: [] as string[],
  }
}

/** 시드 + 조회된 원문 조문 → 골든셋 케이스 골격 (summary는 비움) */
function buildCase(seed: Seed, taxLaw: TaxLaw, disclaimer: string, lawNameMismatch = false) {
  const contentNote =
    taxLaw.content.length < CONTENT_MIN_LENGTH ? ' ⚠content 보강 필요(API가 조문 제목만 반환)' : ''
  const nameNote = lawNameMismatch
    ? ` ⚠법령 불일치(시드 '${seed.lawName}' ≠ 매칭 '${taxLaw.lawName}' — 검색이 다른 법령 반환, 검수 필수)`
    : ''
  return {
    id: seed.id,
    description: `[초안 → 회계사 검수 대기] ${seed.note ?? seed.category ?? ''}${contentNote}${nameNote}`.trim(),
    question: seed.question,
    sourceLaws: [taxLaw],
    answer: {
      rawQuestion: seed.question,
      citations: [
        {
          taxLaw,
          label: seed.expectedLabel ?? '🟢직접근거',
          // excerpt 기본값 = 조문 전체. 회계사가 핵심 항·호로 좁히되 content 안의 글자만 남길 것.
          excerpt: taxLaw.content,
          temporalLabel: '[현행]',
        },
      ],
      // ⚠️ 정답 답변은 스크립트가 만들지 않는다 — 회계사가 작성 (티켓 §3.2)
      summary: TODO_MARKER,
      temporalLabel: '[현행]',
      disclaimer,
      verificationResult: pendingVerification(),
      generatedAt: new Date().toISOString(),
    },
    expectedStatus: seed.expectedStatus ?? 'PASS',
  }
}

// ─── 메인 ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const root = process.cwd()
  loadDotenv(join(root, '.env.local'))

  const seedPath = join(root, 'eval', 'golden_seeds.json')
  if (!existsSync(seedPath)) {
    console.error(`[오류] 시드 파일이 없습니다: ${seedPath}`)
    console.error('원인: eval/golden_seeds.json 미작성')
    console.error('해결: GOLDEN_SET_GUIDE.md의 시드 양식을 참고해 시드를 입력하세요.')
    process.exit(1)
  }

  const seedFile = JSON.parse(readFileSync(seedPath, 'utf-8')) as SeedFile
  const seeds = (seedFile.seeds ?? []).filter((s) => s && s.lawName && s.articleNumber && s.id)

  if (seeds.length === 0) {
    console.log('시드가 비어 있습니다. eval/golden_seeds.json 의 seeds 배열을 채운 뒤 다시 실행하세요.')
    process.exit(0)
  }

  // 환경변수 주입 후 동적 import (config Fail-fast 통과)
  const { NationalTaxLawAdapter } = await import('../../src/adapters/nationalTaxLaw')
  const { DISCLAIMER } = await import('../../src/domain/disclaimer')
  const adapter = new NationalTaxLawAdapter()

  const cases: ReturnType<typeof buildCase>[] = []
  const skipped: { id: string; reason: string }[] = []

  // 외부 API 레이트 보호를 위해 순차 호출
  for (const seed of seeds) {
    try {
      const result = await adapter.search({ keyword: seed.lawName, requestedAt: new Date() })
      const wantRoot = extractArticleRoot(seed.articleNumber)
      const matched = result.items.find(
        (it) => it.sourceType === '법령' && extractArticleRoot(it.articleNumber) === wantRoot,
      )
      if (!matched) {
        const reason = `'${seed.lawName} ${seed.articleNumber}'(조문단위 ${wantRoot}) 조문을 API 결과에서 찾지 못함`
        skipped.push({ id: seed.id, reason })
        console.warn(`[SKIP] ${seed.id}: ${reason}`)
        continue
      }
      // 법령명 오매칭 검사 — 검색이 시드와 다른 법령을 반환했는지(예: '지방세법' → '지방교부세법')
      const lawNameMismatch = !(
        matched.lawName.includes(seed.lawName) || seed.lawName.includes(matched.lawName)
      )
      cases.push(buildCase(seed, matched, DISCLAIMER, lawNameMismatch))
      const warnContent = matched.content.length < CONTENT_MIN_LENGTH ? '  ⚠content 짧음' : ''
      const warnName = lawNameMismatch ? `  ⚠법령 불일치(매칭:${matched.lawName})` : ''
      console.log(
        `[OK]   ${seed.id} ← ${matched.lawName} ${matched.articleNumber} (content ${matched.content.length}자)${warnContent}${warnName}`,
      )
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      skipped.push({ id: seed.id, reason })
      console.warn(`[SKIP] ${seed.id}: 조회 실패 — ${reason}`)
    }
  }

  const draft = {
    version: new Date().toISOString().slice(0, 10),
    description:
      '골든셋 초안(draft) — buildCases.ts가 시드에서 자동 생성. summary는 __TODO__(회계사 작성 대기). ' +
      '검수 후 eval/golden_direct.json 에 머지하세요. 이 파일은 회귀 게이트(테스트) 대상이 아닙니다.',
    generatedBy: 'scripts/golden/buildCases.ts',
    generatedAt: new Date().toISOString(),
    cases,
  }

  const outPath = join(root, 'eval', 'golden_direct.draft.json')
  writeFileSync(outPath, JSON.stringify(draft, null, 2) + '\n', 'utf-8')

  console.log('\n─── 요약 ───')
  console.log(`생성: ${cases.length}건  |  스킵: ${skipped.length}건  |  시드: ${seeds.length}건`)
  console.log(`출력: ${outPath}`)
  console.log(
    '\n다음 단계: draft에서 (1) summary 작성  (2) excerpt를 핵심 항·호로 좁히기  (3) expectedStatus 확정\n' +
      '→ golden_direct.json 에 머지 → npm run golden:status 로 진행률·V1~V6 사전점검 확인',
  )
}

main().catch((err) => {
  console.error('[실패]', err)
  process.exit(1)
})
