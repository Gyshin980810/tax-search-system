/**
 * 비법령(심판례·해석례·판례·국세청해석) 골든셋 빌더 (TAX-036 보강)
 *
 * 회계사 비법령 시드(eval/golden_seeds_nonlaw.json) → 실제 외부 API에서 본문 조회
 *   → V1을 caseNumber로 기계적 보장하는 케이스 골격을 eval/golden_direct_nonlaw.draft.json 으로 출력.
 *
 * ⚠️ buildCases.ts(법령용)와의 대칭 구조:
 *   - 법령용: lawName + articleNumber 로 매칭
 *   - 비법령: searchKeyword(검색용) + caseNumber(매칭용) 로 매칭
 *   - 라벨 기본값: 🟡유사사례(T3·T4) — 단정 금지(V6) 보장 위해 'isExclusive' 의미가 약함
 *
 * ⚠️ 대원칙(CLAUDE.md §2 책임 분리, §6.1 원문 보존):
 *   - summary(정답 답변)는 회계사가 직접 작성(__TODO__ 마커).
 *   - content는 어댑터가 가져온 원문을 그대로 주입(가공·요약 금지).
 *
 * 실행: npm run golden:build-nonlaw
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TaxLaw, SourceType } from '../../src/domain/TaxLaw'

/** summary 미작성 표식 — status 스크립트가 "회계사 작성 대기"로 집계 */
const TODO_MARKER = '__TODO_회계사_작성__'

/**
 * content 보강 경고 임계값.
 * 비법령은 사안·결정요지가 본문이므로 일반적으로 충분한 길이지만,
 * 국세청 해석 같이 본문 없는 자료는 별도 references 트랙에서 처리한다.
 */
const CONTENT_MIN_LENGTH = 200

// ─── 시드 스키마 ──────────────────────────────────────────────────────────────

interface NonlawSeed {
  id: string
  category?: string
  question: string
  /** 외부 API 검색용 자연어 키워드 (예: "사전증여재산") */
  searchKeyword: string
  /** 자료유형 — search() 결과 필터링용 */
  sourceType: SourceType
  /** 사건번호·문서번호 — 결과 매칭의 키 (V1 검증의 기준) */
  caseNumber: string
  expectedLabel?: string
  expectedStatus?: 'PASS' | 'FAIL'
  note?: string
}

interface NonlawSeedFile {
  seeds?: NonlawSeed[]
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

/**
 * .env.local 직접 로드 (buildCases.ts·probeNonlaw.ts와 동일 패턴).
 * config.ts가 import 시점에 requireEnv로 Fail-fast 하므로,
 * 어댑터 동적 import 전에 환경변수를 process.env에 주입해야 한다.
 */
function loadDotenv(path: string): void {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const key = m[1]
    if (process.env[key] !== undefined) continue
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
 * caseNumber 공백 정규화. 외부 API에서 "조심 2012서2999" 또는 "조심2012서2999" 둘 다 나올 수 있어
 * 매칭 시 공백을 제거하고 소문자로 비교한다.
 * 예: "조심 2012서2999" → "조심2012서2999"
 */
function normalizeCaseNumber(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

/** PENDING 검증 결과 초기값(골든셋 픽스처용) */
function pendingVerification() {
  return {
    status: 'PENDING' as const,
    checks: { v1: false, v2: false, v3: false, v4: false, v5: false, v6: false },
    failReasons: [] as string[],
  }
}

/**
 * 비법령용 시점 라벨 (TAX-037 — SSOT v2.4·PRD·CLAUDE.md §6.2 정합).
 *
 * decisionDate(YYYY-MM-DD)를 [결정: YYYY.MM.DD] 형식으로 변환한다.
 * 결정일 불명이거나 상시 해석 원칙인 경우에는 [현행]을 반환한다.
 */
function buildTemporalLabel(decisionDate: string | undefined): string {
  if (!decisionDate) return '[현행]'
  const m = decisionDate.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return '[현행]'
  return `[결정: ${m[1]}.${m[2]}.${m[3]}]`
}

/** 시드 + 조회된 원문 비법령 자료 → 골든셋 케이스 골격 (summary는 비움) */
function buildCase(seed: NonlawSeed, taxLaw: TaxLaw, disclaimer: string) {
  const contentNote =
    taxLaw.content.length < CONTENT_MIN_LENGTH
      ? ` ⚠content 짧음(${taxLaw.content.length}자) — references 트랙 검토 필요`
      : ''
  const temporalLabel = buildTemporalLabel(taxLaw.decisionDate)
  const label = seed.expectedLabel ?? '🟡유사사례'

  return {
    id: seed.id,
    description: `[초안 → 회계사 검수 대기] ${seed.note ?? seed.category ?? ''}${contentNote}`.trim(),
    question: seed.question,
    sourceLaws: [taxLaw],
    answer: {
      rawQuestion: seed.question,
      citations: [
        {
          taxLaw,
          label,
          // excerpt 기본값 = 사안 본문 전체. 회계사가 핵심 결정요지로 좁힐 것.
          excerpt: taxLaw.content,
          temporalLabel,
        },
      ],
      // ⚠️ 정답 답변은 스크립트가 만들지 않는다 — 회계사가 작성 (티켓 §3.2)
      summary: TODO_MARKER,
      temporalLabel,
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

  const seedPath = join(root, 'eval', 'golden_seeds_nonlaw.json')
  if (!existsSync(seedPath)) {
    console.error(`[오류] 비법령 시드 파일이 없습니다: ${seedPath}`)
    console.error('원인: eval/golden_seeds_nonlaw.json 미작성')
    console.error('해결: TAX-036 골든셋 가이드를 참고해 비법령 시드를 입력하세요.')
    process.exit(1)
  }

  const seedFile = JSON.parse(readFileSync(seedPath, 'utf-8')) as NonlawSeedFile
  const seeds = (seedFile.seeds ?? []).filter(
    (s) => s && s.id && s.searchKeyword && s.caseNumber && s.sourceType,
  )

  if (seeds.length === 0) {
    console.log('비법령 시드가 비어 있습니다. seeds 배열을 채운 뒤 다시 실행하세요.')
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
      const result = await adapter.search({
        keyword: seed.searchKeyword,
        requestedAt: new Date(),
      })
      const wantCaseNorm = normalizeCaseNumber(seed.caseNumber)
      const matched = result.items.find(
        (it) =>
          it.sourceType === seed.sourceType &&
          it.caseNumber !== undefined &&
          normalizeCaseNumber(it.caseNumber).includes(wantCaseNorm),
      )
      if (!matched) {
        const reason = `'${seed.searchKeyword}' 검색 결과에서 ${seed.sourceType} ${seed.caseNumber} 미매칭`
        skipped.push({ id: seed.id, reason })
        console.warn(`[SKIP] ${seed.id}: ${reason}`)
        continue
      }
      cases.push(buildCase(seed, matched, DISCLAIMER))
      const warnContent = matched.content.length < CONTENT_MIN_LENGTH ? '  ⚠content 짧음' : ''
      console.log(
        `[OK]   ${seed.id} ← ${matched.sourceType} ${matched.caseNumber ?? ''} ` +
          `"${matched.articleTitle.slice(0, 40)}..." (content ${matched.content.length}자)${warnContent}`,
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
      '비법령 골든셋 초안(draft) — buildNonlawCases.ts가 시드에서 자동 생성. ' +
      'summary는 __TODO__(회계사 작성 대기). 검수 후 eval/golden_direct.json 에 머지하세요. ' +
      '이 파일은 회귀 게이트(테스트) 대상이 아닙니다.',
    generatedBy: 'scripts/golden/buildNonlawCases.ts',
    generatedAt: new Date().toISOString(),
    cases,
  }

  const outPath = join(root, 'eval', 'golden_direct_nonlaw.draft.json')
  writeFileSync(outPath, JSON.stringify(draft, null, 2) + '\n', 'utf-8')

  console.log('\n─── 요약 ───')
  console.log(`생성: ${cases.length}건  |  스킵: ${skipped.length}건  |  시드: ${seeds.length}건`)
  console.log(`출력: ${outPath}`)
  console.log(
    '\n다음 단계: draft에서 (1) summary 작성  (2) excerpt를 핵심 결정요지로 좁히기  (3) temporalLabel 확정\n' +
      '→ golden_direct.json 에 머지 → npm run golden:status 로 진행률·V1~V6 사전점검 확인',
  )
}

main().catch((err) => {
  console.error('[실패]', err)
  process.exit(1)
})
