#!/usr/bin/env node
/**
 * 비법령(심판례·해석례·판례) 대량 수집·정규화기 — TAX-052
 *
 * 회계사 확정 키워드 셋(eval/collect_keywords_nonlaw.json)으로 국세법령정보 OpenAPI를
 * 검색하여, 임베딩 가능한 비법령 자료(content 보유·caseNumber 보유)만 추려
 * scripts/laws_for_embed_nonlaw.json 으로 출력한다. (다음 단계: TAX-053 npm run embed)
 *
 * ⚠️ extractLaws.ts(법령용)와 대칭 구조:
 *   - extractLaws: 골든셋 → 법령 TaxLaw[]
 *   - collectNonlaw: 외부 API 키워드 검색 → 비법령 TaxLaw[]
 *
 * ⚠️ 대원칙(CLAUDE.md §6.1 인용 무결성):
 *   - content(원문)는 어댑터가 가져온 그대로 보존 — 가공·요약·의역 절대 금지.
 *   - 본문 없는 국세청해석(ntsCgmExpc)은 content 빈 문자열 → 필터에서 자동 탈락(references 트랙 소관).
 *
 * 회계사 확정 정책(2026-06-10):
 *   - 키워드: eval/collect_keywords_nonlaw.json (5세목)
 *   - target 우선순위: 심판례·해석례 우선 → 판례 차순 (TARGET_PRIORITY)
 *   - 규모 상한: 키워드당 최대 30건 (MAX_PER_KEYWORD)
 *   - 본문 최소 길이: 200자 (CONTENT_MIN_LENGTH)
 *
 * 실행:
 *   npm run collect:nonlaw            → scripts/laws_for_embed_nonlaw.json 생성
 *   npm run collect:nonlaw -- --dry-run → 수집·필터 통계만 출력(파일 미생성)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { TaxLaw, SourceType } from '../src/domain/TaxLaw'

// ─── 회계사 확정 정책 (2026-06-10) ─────────────────────────────────────────────

/** 결정 ②: 집계·정렬 우선순위 — 심판례·해석례 우선, 판례 차순 */
export const TARGET_PRIORITY: readonly SourceType[] = ['심판례', '해석례', '판례']

/** 결정 ③: 키워드당 수집 상한 (비용·노이즈 폭증 방지) */
export const MAX_PER_KEYWORD = 30

/** 본문 최소 길이 — 제목만 있는 허수 자료 컷(buildNonlawCases와 동일 기준) */
export const CONTENT_MIN_LENGTH = 200

// ─── 시드 스키마 ──────────────────────────────────────────────────────────────

interface KeywordSeed {
  /** 세목 — 집계·로그 표시용(검색에는 미사용) */
  category?: string
  /** 외부 API 검색 키워드 */
  keyword: string
}

interface KeywordFile {
  keywords?: KeywordSeed[]
}

// ─── 순수 함수 (단위 테스트 대상 — 외부 API 비의존) ────────────────────────────

/**
 * caseNumber 공백·대소문자 정규화(중복 비교용).
 * 외부 API가 "조심 2012서2999" / "조심2012서2999" 둘 다 줄 수 있어 통일한다.
 * (buildNonlawCases.ts와 동일 규칙)
 */
export function normalizeCaseNumber(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

/**
 * 임베딩 가능한 비법령 자료인지 판정.
 * 3조건 모두 충족해야 통과:
 *   1. 법령이 아님(sourceType !== '법령') — 비법령만 수집
 *   2. caseNumber 보유 — 식별자 없으면 검증(V1)·중복 제거 불가
 *   3. content 길이 ≥ minLength — 본문 없는/허수 자료 컷(국세청해석 자동 탈락)
 *
 * @param minLength 본문 최소 길이(기본 CONTENT_MIN_LENGTH)
 */
export function isEmbeddableNonlaw(item: TaxLaw, minLength: number = CONTENT_MIN_LENGTH): boolean {
  if (item.sourceType === '법령') return false
  if (!item.caseNumber || item.caseNumber.trim().length === 0) return false
  if (!item.content || item.content.trim().length < minLength) return false
  return true
}

/**
 * caseNumber 기준 중복 제거(먼저 등장한 항목 보존, 원문 불변).
 * 같은 사건/문서가 여러 키워드에서 잡혀도 한 번만 임베딩하기 위함.
 */
export function dedupByCaseNumber(items: TaxLaw[]): TaxLaw[] {
  const seen = new Set<string>()
  return items.filter((it) => {
    const key = normalizeCaseNumber(it.caseNumber ?? it.lawName)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 키워드당 수집 상한 절단(외부 API 응답 순서 보존) */
export function applyPerKeywordLimit(items: TaxLaw[], max: number = MAX_PER_KEYWORD): TaxLaw[] {
  return max > 0 ? items.slice(0, max) : items
}

/**
 * TARGET_PRIORITY 순으로 안정 정렬(심판례·해석례 → 판례).
 * 우선순위에 없는 sourceType은 뒤로 보낸다. 동순위는 입력 순서 유지.
 */
export function sortByTargetPriority(items: TaxLaw[]): TaxLaw[] {
  const rank = (t: SourceType): number => {
    const i = TARGET_PRIORITY.indexOf(t)
    return i === -1 ? TARGET_PRIORITY.length : i
  }
  return items
    .map((it, idx) => ({ it, idx }))
    .sort((a, b) => rank(a.it.sourceType) - rank(b.it.sourceType) || a.idx - b.idx)
    .map((x) => x.it)
}

// ─── 유틸 (스크립트 실행 전용) ─────────────────────────────────────────────────

/**
 * .env.local 직접 로드(buildNonlawCases.ts와 동일 패턴).
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

/** 비법령 sourceType별 건수 집계(로그용) */
function countByType(items: TaxLaw[]): Record<string, number> {
  const acc: Record<string, number> = {}
  for (const it of items) acc[it.sourceType] = (acc[it.sourceType] ?? 0) + 1
  return acc
}

// ─── 메인 (스크립트 직접 실행 시에만 동작) ─────────────────────────────────────

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  const root = process.cwd()
  loadDotenv(join(root, '.env.local'))

  const seedPath = join(root, 'eval', 'collect_keywords_nonlaw.json')
  if (!existsSync(seedPath)) {
    console.error(`[오류] 키워드 셋 파일이 없습니다: ${seedPath}`)
    console.error('원인: eval/collect_keywords_nonlaw.json 미작성')
    console.error('해결: 회계사 확정 키워드 셋(5세목)을 작성하세요.')
    process.exit(1)
  }

  const seedFile = JSON.parse(readFileSync(seedPath, 'utf-8')) as KeywordFile
  const seeds = (seedFile.keywords ?? []).filter((s) => s && s.keyword && s.keyword.trim().length > 0)

  if (seeds.length === 0) {
    console.log('키워드 셋이 비어 있습니다. keywords 배열을 채운 뒤 다시 실행하세요.')
    process.exit(0)
  }

  // 환경변수 주입 후 동적 import (config Fail-fast 통과 — buildNonlawCases 패턴)
  const { NationalTaxLawAdapter } = await import('../src/adapters/nationalTaxLaw')
  const adapter = new NationalTaxLawAdapter()

  console.log(
    `[collectNonlaw] 키워드 ${seeds.length}개 / 키워드당 최대 ${MAX_PER_KEYWORD}건 / 본문 최소 ${CONTENT_MIN_LENGTH}자` +
      (dryRun ? ' (DRY-RUN — 파일 미생성)' : ''),
  )

  const collected: TaxLaw[] = []
  const perKeywordLog: { keyword: string; category: string; kept: number; raw: number }[] = []

  // 외부 API 레이트 보호를 위해 순차 호출(buildNonlawCases 패턴)
  for (const seed of seeds) {
    const category = seed.category ?? '-'
    try {
      // articleNumberHint 미부여 → 어댑터가 비법령 4종(해석례·국세청해석·심판례·판례)까지 검색
      const result = await adapter.search({ keyword: seed.keyword, requestedAt: new Date() })
      const embeddable = result.items.filter((it) => isEmbeddableNonlaw(it))
      const limited = applyPerKeywordLimit(embeddable, MAX_PER_KEYWORD)
      collected.push(...limited)
      perKeywordLog.push({ keyword: seed.keyword, category, kept: limited.length, raw: result.items.length })
      console.log(
        `[OK]   [${category}] "${seed.keyword}" — 응답 ${result.items.length}건 → 임베딩가능 ${embeddable.length}건 → 채택 ${limited.length}건`,
      )
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      perKeywordLog.push({ keyword: seed.keyword, category, kept: 0, raw: 0 })
      console.warn(`[SKIP] [${category}] "${seed.keyword}" — 조회 실패: ${reason}`)
    }
  }

  // 전체 누적분 중복 제거(키워드 간 겹침 제거) 후 우선순위 정렬
  const deduped = sortByTargetPriority(dedupByCaseNumber(collected))

  console.log('\n─── 요약 ───')
  console.log(`수집(중복 포함): ${collected.length}건  →  중복 제거 후: ${deduped.length}건`)
  console.log(`유형별: ${JSON.stringify(countByType(deduped))}`)

  if (dryRun) {
    console.log('\n[DRY-RUN] 파일을 쓰지 않았습니다. 결과가 적절하면 --dry-run 없이 다시 실행하세요.')
    return
  }

  const outPath = join(root, 'scripts', 'laws_for_embed_nonlaw.json')
  // ⚠️ TaxLaw[] 원문 그대로 직렬화 — content 변형 없음(embed.ts 입력 포맷과 동일)
  writeFileSync(outPath, JSON.stringify(deduped, null, 2) + '\n', 'utf-8')

  console.log(`출력: ${outPath}`)
  console.log('\n다음 단계: npm run embed -- --input scripts/laws_for_embed_nonlaw.json  (TAX-053)')
}

// vitest가 이 파일을 import할 때는 main()을 실행하지 않도록 직접 실행 여부를 가드.
//   - 스크립트로 직접 실행: import.meta.url === argv[1]을 file URL로 변환한 값
//   - 테스트로 import: 두 값이 달라 main() 미실행(순수 함수만 노출)
const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  main().catch((err) => {
    console.error('[실패]', err)
    process.exit(1)
  })
}
