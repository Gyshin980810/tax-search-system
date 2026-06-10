/**
 * 비법령 골든셋 후보 검색 스크립트 (TAX-036)
 *
 * 키워드 목록으로 NationalTaxLawAdapter.search() 를 호출하여
 * 심판례·해석례·판례·국세청해석 후보를 수집한다.
 * 결과는 eval/golden_nonlaw_probe.json 으로 저장하여 회계사가 검수한다.
 *
 * ⚠️ 대원칙(CLAUDE.md §2 책임 분리, 티켓 §3):
 *   - 스크립트는 "어느 자료를 골든셋에 채택할지" 정답을 만들지 않는다.
 *     후보 메타와 본문 미리보기만 추출하며, 채택·question·라벨은 회계사가 확정한다.
 *   - 본문(content)은 원문 그대로 미리보기 200자만 노출 (CLAUDE.md §6.1 원문 보존).
 *   - 비법령 자료의 sourceType별 본문 유무로 활용 가능성을 즉시 판단:
 *       · 심판례·법제처 해석례: 본문 有 → citations(인용) 케이스 후보
 *       · 판례·국세청 해석:   본문 無 → references(참고목록) 케이스 후보
 *
 * 실행: npm run golden:probe-nonlaw
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TaxLaw } from '../../src/domain/TaxLaw'

// ─── 검색 키워드 ─────────────────────────────────────────────────────────────
// 회계사 실무 빈도 + 비법령(심판례·해석례) 풍부도를 고려한 8개 키워드 초안.
// 부족하면 회계사가 직접 추가하여 재실행 가능.
const KEYWORDS: readonly string[] = [
  '접대비',
  '1세대 1주택 비과세',
  '감가상각',
  '특수관계자',
  '주택임대소득',
  '사전증여재산',
  '비사업용 토지',
  '면세 의료',
] as const

/** 본문 미리보기 길이 — 너무 길면 검수 가독성 저하, 너무 짧으면 사안 파악 불가 */
const CONTENT_PREVIEW_CHARS = 200

// ─── 유틸 ────────────────────────────────────────────────────────────────────

/**
 * .env.local 직접 로드 (buildCases.ts와 동일 패턴 — 크로스 환경 안전).
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
 * 비법령 후보 한 건의 메타데이터.
 * 회계사가 이 정보만으로 "골든셋에 쓸지/어떤 질문에 맞을지" 판단할 수 있게 압축.
 */
interface NonlawCandidate {
  sourceType: TaxLaw['sourceType']
  trustTier: TaxLaw['trustTier']
  /** 사건명·문서명 (lawName 필드에 담긴 비법령 대표 명칭) */
  caseName: string
  /** 사건번호·문서번호 — 비법령 식별자, V1 검증의 키 */
  caseNumber: string
  /** 사건/조문 제목 */
  articleTitle: string
  /** 결정일/선고일/회신일 */
  decisionDate: string
  /** 본문 길이 — 0이면 citations 불가, references 후보 */
  contentLength: number
  /** 본문 앞 200자 — 사안 파악용 (원문 그대로) */
  contentPreview: string
  /** 원문 링크 */
  sourceUrl: string
}

interface KeywordResult {
  keyword: string
  totalItems: number
  /** sourceType별 건수 (법령 포함, 검색 분포 확인용) */
  byType: Record<string, number>
  /** 비법령(법령 제외) 후보 목록 — Trust Tier 순 */
  candidates: NonlawCandidate[]
}

// ─── 메인 ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const root = process.cwd()
  loadDotenv(join(root, '.env.local'))

  // 환경변수 주입 후 동적 import (config Fail-fast 통과)
  const { NationalTaxLawAdapter } = await import('../../src/adapters/nationalTaxLaw')
  const adapter = new NationalTaxLawAdapter()

  const results: KeywordResult[] = []
  let totalNonlaw = 0

  // 외부 API 레이트 보호를 위해 순차 호출
  for (const keyword of KEYWORDS) {
    try {
      const result = await adapter.search({ keyword, requestedAt: new Date() })
      const byType: Record<string, number> = {}
      const candidates: NonlawCandidate[] = []

      for (const item of result.items) {
        byType[item.sourceType] = (byType[item.sourceType] ?? 0) + 1
        if (item.sourceType === '법령') continue // 비법령만 후보로

        candidates.push({
          sourceType: item.sourceType,
          trustTier: item.trustTier,
          caseName: item.lawName,
          caseNumber: item.caseNumber ?? '',
          articleTitle: item.articleTitle,
          decisionDate: item.decisionDate ?? '',
          contentLength: item.content.length,
          contentPreview: item.content.slice(0, CONTENT_PREVIEW_CHARS),
          sourceUrl: item.sourceUrl,
        })
      }

      results.push({ keyword, totalItems: result.items.length, byType, candidates })
      totalNonlaw += candidates.length

      const typeSummary = Object.entries(byType)
        .map(([k, v]) => `${k}:${v}`)
        .join(' ')
      console.log(
        `[OK]   "${keyword}" → 총 ${result.items.length}건  비법령 ${candidates.length}건  (${typeSummary})`,
      )
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      results.push({ keyword, totalItems: 0, byType: {}, candidates: [] })
      console.warn(`[FAIL] "${keyword}" — ${reason}`)
    }
  }

  // 결과 저장
  const probe = {
    generatedAt: new Date().toISOString(),
    description:
      '비법령 골든셋 후보 — TAX-036. 회계사가 본 파일에서 8건(PASS 6 + 네거티브 2)을 채택. ' +
      '심판례·해석례(본문 有)는 citations 케이스, 판례·국세청해석(본문 無)은 references 케이스 후보.',
    generatedBy: 'scripts/golden/probeNonlaw.ts',
    keywords: KEYWORDS,
    results,
  }

  const outPath = join(root, 'eval', 'golden_nonlaw_probe.json')
  writeFileSync(outPath, JSON.stringify(probe, null, 2) + '\n', 'utf-8')

  console.log('\n─── 요약 ───')
  console.log(`키워드: ${KEYWORDS.length}개  |  비법령 후보: ${totalNonlaw}건`)
  console.log(`출력: ${outPath}`)
  console.log(
    '\n다음 단계: 회계사가 후보를 검수해 채택할 8건(PASS 6: 심판례·해석례 우선 / 네거티브 2: V3·V6)을 결정',
  )
}

main().catch((err) => {
  console.error('[실패]', err)
  process.exit(1)
})
