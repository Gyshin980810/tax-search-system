/**
 * 법령 골든셋 후보 검색 스크립트 (TAX-036 보강)
 *
 * 5개 세목(소득세·법인세·부가가치세·상속증여세·지방세)별 키워드로
 * NationalTaxLawAdapter.search()를 호출하여 법령(조문) 후보를 수집한다.
 * 결과는 eval/golden_law_probe.json 으로 저장하여 회계사가 검수한다.
 *
 * ⚠️ 대원칙(CLAUDE.md §2 책임 분리, §6.1 원문 보존):
 *   - 스크립트는 "어느 조문을 골든셋에 채택할지" 정답을 만들지 않는다.
 *     후보 메타와 본문 미리보기만 추출하며, 채택·question·라벨은 회계사가 확정한다.
 *   - 본문(content)은 원문 그대로 미리보기 240자만 노출(법령은 비법령보다 조금 더 길게).
 *   - probeNonlaw.ts와 대칭: 그쪽은 법령 제외, 이쪽은 법령만 수집.
 *
 * 실행: npm run golden:probe-law
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TaxLaw } from '../../src/domain/TaxLaw'

// ─── 검색 키워드 ─────────────────────────────────────────────────────────────
// 5개 세목 균형 추출(회계사 결정 2026-05-30).
// ⚠️ 어댑터는 "정확한 법령명"으로 검색해야 조문을 반환한다(searchLaws→fetchLawArticles).
//    일반 주제어("양도소득세 비과세")는 법령 매칭이 안 돼 비법령만 반환되므로,
//    각 세목의 핵심 법률·시행령 명을 키워드로 사용한다.
const KEYWORDS_BY_TAX: Record<string, readonly string[]> = {
  소득세: ['소득세법', '소득세법 시행령'],
  법인세: ['법인세법', '법인세법 시행령'],
  부가가치세: ['부가가치세법', '부가가치세법 시행령'],
  상속증여세: ['상속세 및 증여세법', '상속세 및 증여세법 시행령'],
  지방세: ['지방세법', '지방세법 시행령'],
} as const

const KEYWORDS: readonly string[] = Object.values(KEYWORDS_BY_TAX).flat()

/**
 * 키워드 → 세목 역인덱스. 결과를 세목별로 묶을 때 사용.
 */
const KEYWORD_TO_TAX: Record<string, string> = {}
for (const [tax, kws] of Object.entries(KEYWORDS_BY_TAX)) {
  for (const kw of kws) KEYWORD_TO_TAX[kw] = tax
}

/** 본문 미리보기 길이 — 법령 조문은 비법령보다 길게 (회계사 사안 파악 보조) */
const CONTENT_PREVIEW_CHARS = 240

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

// ─── 후보 메타 스키마 ────────────────────────────────────────────────────────

/**
 * 법령 후보 한 건의 메타데이터.
 * 회계사가 이 정보만으로 "골든셋에 쓸지/어떤 질문에 맞을지" 판단할 수 있게 압축.
 */
interface LawCandidate {
  /** 세목 — 결과 그룹핑용 (회계사 선택 시 분포 확인 용이) */
  taxCategory: string
  trustTier: TaxLaw['trustTier']
  /** 법령명 (예: 소득세법, 부가가치세법 시행령) */
  lawName: string
  /** 조문번호 (예: 제50조 제1항 제1호) — V1 검증의 키 */
  articleNumber: string
  /** 조문제목 (예: 기본공제) */
  articleTitle: string
  /** 최종 개정일 — 시점 판단 보조 */
  revisionDate: string
  /** 시행일 — 시점 라벨 부착의 기준 */
  enforcementDate: string
  /** 본문 길이 — 너무 짧으면 excerpt 좁히기 곤란, 너무 길면 사안 분기 多 */
  contentLength: number
  /** 본문 앞 240자 — 사안 파악용 (원문 그대로) */
  contentPreview: string
  /** 원문 링크 */
  sourceUrl: string
}

interface KeywordResult {
  keyword: string
  taxCategory: string
  totalItems: number
  /** sourceType별 건수 (비법령 포함, 검색 분포 확인용) */
  byType: Record<string, number>
  /** 법령 후보 목록 — 시행일 최신순 */
  candidates: LawCandidate[]
}

// ─── 메인 ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const root = process.cwd()
  loadDotenv(join(root, '.env.local'))

  // 환경변수 주입 후 동적 import (config Fail-fast 통과)
  const { NationalTaxLawAdapter } = await import('../../src/adapters/nationalTaxLaw')
  const adapter = new NationalTaxLawAdapter()

  const results: KeywordResult[] = []
  let totalLaw = 0

  // 외부 API 레이트 보호를 위해 순차 호출
  for (const keyword of KEYWORDS) {
    const taxCategory = KEYWORD_TO_TAX[keyword] ?? '기타'
    try {
      const result = await adapter.search({ keyword, requestedAt: new Date() })
      const byType: Record<string, number> = {}
      const candidates: LawCandidate[] = []

      for (const item of result.items) {
        byType[item.sourceType] = (byType[item.sourceType] ?? 0) + 1
        if (item.sourceType !== '법령') continue // 법령만 후보로

        candidates.push({
          taxCategory,
          trustTier: item.trustTier,
          lawName: item.lawName,
          articleNumber: item.articleNumber,
          articleTitle: item.articleTitle,
          revisionDate: item.revisionDate,
          enforcementDate: item.enforcementDate,
          contentLength: item.content.length,
          contentPreview: item.content.slice(0, CONTENT_PREVIEW_CHARS),
          sourceUrl: item.sourceUrl,
        })
      }

      // 시행일 최신순 정렬 — 회계사 검수 시 최신 조문 우선 노출
      candidates.sort((a, b) => b.enforcementDate.localeCompare(a.enforcementDate))

      results.push({ keyword, taxCategory, totalItems: result.items.length, byType, candidates })
      totalLaw += candidates.length

      const typeSummary = Object.entries(byType)
        .map(([k, v]) => `${k}:${v}`)
        .join(' ')
      console.log(
        `[OK]   [${taxCategory}] "${keyword}" → 총 ${result.items.length}건  법령 ${candidates.length}건  (${typeSummary})`,
      )
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      results.push({ keyword, taxCategory, totalItems: 0, byType: {}, candidates: [] })
      console.warn(`[FAIL] [${taxCategory}] "${keyword}" — ${reason}`)
    }
  }

  // 결과 저장
  const probe = {
    generatedAt: new Date().toISOString(),
    description:
      '법령 골든셋 후보 — TAX-036 보강. 회계사가 본 파일에서 세목별로 후보를 채택. ' +
      '시행일 최신순으로 정렬되어 있으며, 본문 길이가 너무 짧으면(<80자) 항·호 보강 필요 가능.',
    generatedBy: 'scripts/golden/probeLaw.ts',
    keywordsByTax: KEYWORDS_BY_TAX,
    results,
  }

  const outPath = join(root, 'eval', 'golden_law_probe.json')
  writeFileSync(outPath, JSON.stringify(probe, null, 2) + '\n', 'utf-8')

  console.log('\n─── 요약 ───')
  console.log(`키워드: ${KEYWORDS.length}개  |  법령 후보: ${totalLaw}건`)
  console.log(`출력: ${outPath}`)
  console.log(
    '\n다음 단계: 회계사가 후보를 검수해 세목별로 채택할 케이스를 결정 → golden_law_review.md 작성',
  )
}

main().catch((err) => {
  console.error('[실패]', err)
  process.exit(1)
})
