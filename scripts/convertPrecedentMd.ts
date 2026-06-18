#!/usr/bin/env node
/**
 * precedent-kr 세무 판례(.md) → TaxLaw[] 변환기 — TAX-6B-13 (PoC)
 *
 * 외부 오픈소스 precedent-kr(legalize-kr, 국가법령정보센터 OpenAPI 기반)의
 * 세무 판례 마크다운(.md)을 우리 도메인 TaxLaw[]로 무손실 변환한다.
 * 다음 단계: npm run embed -- --input scripts/precedent_poc.json
 *
 * ⚠️ extractLaws.ts(법령)·collectNonlaw.ts(비법령 API)와 대칭 구조:
 *   - extractLaws    : 골든셋 → 법령 TaxLaw[]
 *   - collectNonlaw  : 외부 API 검색 → 비법령 TaxLaw[]
 *   - convertPrecedentMd : 로컬 판례 .md → 판례(T4) TaxLaw[]
 *
 * ⚠️ 대원칙(CLAUDE.md §6.1 인용 무결성):
 *   - content(본문)는 .md 원문 그대로 보존 — 가공·요약·의역 절대 금지.
 *   - 모든 항목에 frontmatter '출처' URL을 sourceUrl로 매핑(원문 링크 보장).
 *
 * 회계사 결정(2026-06-17, PoC): 최근 대법원 판례 약 300건(POC_LIMIT)
 * 회계사 결정(2026-06-18, TAX-6B-16): 전량 적재 — 세무 폴더 전체(대법원+하급심) 10,083건.
 *   - 활용 등급: 참고자료(references) — trustTier='T4'
 *
 * 실행:
 *   npm run convert:precedent              → PoC: 대법원 최근 300건 → scripts/precedent_poc.json
 *   npm run convert:precedent -- --all     → 전량: 세무 전체(대법원+하급심) → scripts/precedent_full.json
 *   npm run convert:precedent -- --dry-run → 변환 통계만 출력(파일 미생성)
 *   npm run convert:precedent -- --limit 100
 *   npm run convert:precedent -- --all --out scripts/x.json → 출력 경로 지정
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { TaxLaw } from '../src/domain/TaxLaw'

// ─── 회계사 결정 정책 (2026-06-17) ─────────────────────────────────────────────

/** PoC 적재 상한 — 최근 대법원 판례 N건(비용·노이즈 최소화) */
export const POC_LIMIT = 300

/**
 * precedent-kr 저장소 경로(이 프로젝트의 형제 폴더).
 * 다른 위치면 --source 인수로 덮어쓴다.
 */
export const DEFAULT_SOURCE_DIR = join('..', 'precedent-kr-main', '세무', '대법원')

/**
 * 전량 모드(--all) 소스 폴더 — 세무 폴더 전체(대법원 + 하급심).
 * ⚠️ '세무' 폴더만 대상 — 형제 폴더(가사·민사·형사·특허 등)는 제외(다른 법령 혼입 방지).
 * 각 .md frontmatter의 '사건종류: 세무'가 이중 안전장치이나, 경로 자체로 1차 차단한다.
 */
export const FULL_SOURCE_DIRS = [
  join('..', 'precedent-kr-main', '세무', '대법원'),
  join('..', 'precedent-kr-main', '세무', '하급심'),
]

// ─── 순수 함수 (단위 테스트 대상 — 파일시스템 비의존) ──────────────────────────

/** frontmatter에서 파싱한 메타(필요 필드만) */
export interface PrecedentMeta {
  사건번호?: string
  사건명?: string
  법원명?: string
  출처?: string
  선고일자?: string
  [key: string]: string | undefined
}

/**
 * precedent-kr .md를 (frontmatter, body)로 분리한다.
 * 형식: 파일 선두 '---\n' ... '\n---\n' 뒤가 본문.
 * frontmatter가 없으면 frontmatter={}·body=원문 전체.
 */
export function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  // 선두 '---' 와 그 다음 '---' 사이를 frontmatter로 본다(\r\n 안전).
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { frontmatter: '', body: raw }
  return { frontmatter: m[1], body: m[2] }
}

/**
 * YAML frontmatter(단순 key: value)를 객체로 파싱한다.
 * - 첫 ': ' 기준 분할(값에 ':'가 있어도 안전)
 * - 양끝 따옴표 제거(예: 판례일련번호: '208608')
 * 외부 yaml 의존 없이 precedent-kr의 단순 스칼라 frontmatter만 처리한다.
 */
export function parseFrontmatter(frontmatter: string): PrecedentMeta {
  const meta: PrecedentMeta = {}
  for (const line of frontmatter.split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    if (!key) continue
    let value = line.slice(idx + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    meta[key] = value
  }
  return meta
}

/**
 * 판례 .md 한 건을 TaxLaw(sourceType='판례', trustTier='T4')로 변환한다.
 * 필수 식별자(사건번호·출처) 또는 본문이 없으면 null(스킵).
 *
 * 매핑:
 *   사건명 → lawName·articleTitle / 사건번호 → caseNumber / 법원명 → issuingBody
 *   선고일자 → decisionDate / 출처 → sourceUrl / 본문(원문 그대로) → content
 *   판례는 조문번호·개정/시행 개념이 없어 articleNumber·revisionDate·enforcementDate는 빈 문자열.
 */
export function mdToTaxLaw(raw: string): TaxLaw | null {
  const { frontmatter, body } = splitFrontmatter(raw)
  const meta = parseFrontmatter(frontmatter)

  const caseNumber = (meta.사건번호 ?? '').trim()
  const sourceUrl = (meta.출처 ?? '').trim()
  const content = body.trim()

  // 식별자·원문 링크·본문이 없으면 참고자료로 쓸 수 없으므로 스킵
  if (!caseNumber || !sourceUrl || content.length === 0) return null

  const caseName = (meta.사건명 ?? '').trim()
  const court = (meta.법원명 ?? '').trim()
  const decisionDate = (meta.선고일자 ?? '').trim()

  return {
    sourceType: '판례',
    lawName: caseName || caseNumber,
    articleNumber: '',
    articleTitle: caseName,
    content, // ⚠️ §6.1 원문 그대로 — 가공 금지
    revisionDate: '',
    enforcementDate: '',
    sourceUrl,
    trustTier: 'T4',
    ...(caseNumber ? { caseNumber } : {}),
    ...(court ? { issuingBody: court } : {}),
    ...(decisionDate ? { decisionDate } : {}),
  }
}

/**
 * 최근 대법원 판례 파일명을 상한만큼 선별한다.
 * 파일명 형식 '대법원_YYYY-MM-DD_사건번호.md'에서 날짜가 고정 위치라
 * 파일명 내림차순 정렬이 곧 선고일 최신순이다(법원명 접두어가 동일하므로).
 */
export function selectRecentFiles(fileNames: string[], limit: number = POC_LIMIT): string[] {
  return fileNames
    .filter((f) => f.endsWith('.md'))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit)
}

// ─── 메인 (스크립트 직접 실행 시에만 동작) ─────────────────────────────────────

function getArg(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run')
  const all = process.argv.includes('--all')
  const root = process.cwd()

  // 전량(--all): 세무 폴더 전체(대법원+하급심), 상한 없음(Infinity)
  // PoC(기본): 단일 폴더(--source 또는 대법원), POC_LIMIT 상한
  const sourceDirs = all
    ? FULL_SOURCE_DIRS.map((d) => join(root, d))
    : [getArg('--source') ?? join(root, DEFAULT_SOURCE_DIR)]
  const limit = all ? Infinity : Number(getArg('--limit') ?? POC_LIMIT)
  const defaultOut = all ? 'precedent_full.json' : 'precedent_poc.json'
  const outPath = getArg('--out') ?? join(root, 'scripts', defaultOut)

  // 모든 소스 폴더 존재 확인(하나라도 없으면 중단)
  for (const dir of sourceDirs) {
    if (!existsSync(dir)) {
      console.error(`[오류] 판례 소스 폴더가 없습니다: ${dir}`)
      console.error('원인: precedent-kr-main/세무 경로 불일치')
      console.error('해결: --source <경로>로 지정하거나 폴더 위치를 확인하세요.')
      process.exit(1)
    }
  }

  console.log(
    `[convertPrecedentMd] ${all ? '전량(대법원+하급심)' : 'PoC'} 모드` +
      (dryRun ? ' (DRY-RUN — 파일 미생성)' : ''),
  )

  // 여러 폴더를 순회하며 변환(폴더별 진행 로그 출력)
  const laws: TaxLaw[] = []
  let skipped = 0
  for (const sourceDir of sourceDirs) {
    const allFiles = readdirSync(sourceDir)
    const selected = selectRecentFiles(allFiles, limit)
    let dirOk = 0
    for (const fileName of selected) {
      const raw = readFileSync(join(sourceDir, fileName), 'utf-8')
      const law = mdToTaxLaw(raw)
      if (law) {
        laws.push(law)
        dirOk++
      } else {
        skipped++
      }
    }
    console.log(`  ${sourceDir}: ${allFiles.length}건 중 ${dirOk}건 변환`)
  }

  console.log('\n─── 요약 ───')
  console.log(`변환 성공: ${laws.length}건 / 스킵(식별자·본문 결측): ${skipped}건`)
  if (laws.length > 0) {
    const dates = laws.map((l) => l.decisionDate ?? '').filter(Boolean).sort()
    console.log(`선고일 범위: ${dates[0]} ~ ${dates[dates.length - 1]}`)
    const avgLen = Math.round(laws.reduce((s, l) => s + l.content.length, 0) / laws.length)
    console.log(`본문 평균 길이: ${avgLen}자`)
  }

  if (dryRun) {
    console.log('\n[DRY-RUN] 파일을 쓰지 않았습니다. 결과가 적절하면 --dry-run 없이 다시 실행하세요.')
    return
  }

  // ⚠️ TaxLaw[] 원문 그대로 직렬화 — content 변형 없음(embed.ts 입력 포맷과 동일)
  writeFileSync(outPath, JSON.stringify(laws, null, 2) + '\n', 'utf-8')
  console.log(`\n출력: ${outPath}`)
  console.log(`다음 단계: npm run embed -- --input ${outPath.replace(root + '\\', '').replace(/\\/g, '/')}`)
}

// vitest import 시 main() 미실행(순수 함수만 노출) — collectNonlaw.ts와 동일 가드
const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  main()
}
