/**
 * 신고 환류 리포트 생성기 (TAX-030-C, FR-24 연계)
 *
 * Neon `ops_feedback`(회계사 👎 "조용한 틀림" 신고)을 queryHash로 묶어
 *   → 빈도순 집계 → eval/golden_harvest_review.md(회계사 검토용 표)로 출력한다.
 *
 * ⚠️ 대원칙(CLAUDE.md §2·§6.3 책임 분리, 티켓 §3.2):
 *   - 스크립트는 "정답"을 만들지 않는다. 어떤 조문이 직접근거인지(lawName·articleNumber)는
 *     ops_feedback에 구조적으로 없으며, 그 판단은 세법 정답이므로 회계사가 직접 채운다.
 *     (AI가 틀린 답을 모아 AI가 정답으로 박제하는 자기참조 오류 방지)
 *   - 이 리포트는 회귀 게이트(golden_direct.json)가 아니다. 회계사가 표를 보고
 *     golden_seeds.json에 시드를 입력한 뒤 `npm run golden:build`로 환류를 이어간다.
 *   - 회계사 식별자(이메일·이름·IP)는 ops_feedback에 없고, 질문·사유는 적재 시
 *     maskPhoneEmail로 마스킹된다. 본 스크립트는 방어적으로 한 번 더 마스킹한다.
 *
 * 실행: npm run golden:harvest
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { maskPhoneEmail } from '../../src/utils/piiFilter'
import type { OpsFeedbackRow } from '../../src/ports/opsLogPort'

// ─── 유틸 ────────────────────────────────────────────────────────────────────

/**
 * .env.local 을 직접 로드한다(buildCases.ts와 동일 패턴 — 크로스 환경 안전).
 * opsLog 어댑터가 server-only이므로 동적 import 전에 환경변수를 주입한다.
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

/** 마크다운 표 셀 안전화 — 파이프·줄바꿈이 표를 깨지 않도록 치환한다 */
function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
}

/** ISO 시각 → YYYY-MM-DD (표에는 날짜만 표시) */
function toDate(iso: string): string {
  return iso.slice(0, 10)
}

// ─── 리포트 생성 (순수 함수 — 단위 테스트 대상) ─────────────────────────────────

/**
 * 신고 집계 행 → 회계사 검토용 마크다운 리포트를 만든다.
 *
 * 부수효과·I/O 없이 입력(rows)만으로 문자열을 만든다. 질문·사유는 방어적으로
 * maskPhoneEmail을 한 번 더 적용한다(혹시 마스킹 누락분이 있어도 리포트엔 안 나가도록).
 *
 * @param rows - listFeedback() 집계 결과 (빈도순 정렬 가정)
 * @param generatedAt - 리포트 생성 시각 (테스트 고정용, 기본값 now)
 */
export function buildReviewMarkdown(rows: OpsFeedbackRow[], generatedAt: Date = new Date()): string {
  const header = [
    '# 신고 환류 검토 리포트 (TAX-030-C)',
    '',
    `> 생성: ${generatedAt.toISOString()} · 신고 묶음 ${rows.length}건 (질문 해시 기준)`,
    '> 출처: Neon `ops_feedback` (회계사 👎 신고) — `npm run golden:harvest` 자동 생성',
    '',
    '## 이 리포트로 무엇을 하나요',
    '',
    '회계사가 "조용한 틀림"으로 신고한 질문을 **자주 신고된 순서**로 모았습니다.',
    '각 행을 검토해 골든셋에 박제할 가치가 있으면 아래 흐름으로 환류하세요.',
    '',
    '1. 신고 횟수·사유를 보고 **골든셋에 넣을 질문**을 고른다.',
    '2. `eval/golden_seeds.json`에 시드를 추가한다 — `question`은 아래 표에서 복사,',
    '   **`lawName`·`articleNumber`(정답 조문)는 회계사가 직접 채운다**',
    '   (ops_feedback에는 정답 조문이 없습니다 — 어떤 조문이 직접근거인지는 세법 판단).',
    '3. `npm run golden:build` → draft에서 `summary` 작성·검수 → `golden_direct.json` 머지.',
    '4. CI 회귀(`run_golden.test.ts`)로 같은 실수의 재발을 영구 차단.',
    '',
    '> ⚠️ 이 파일은 **회귀 게이트가 아닙니다**. 검수 없이 골든셋에 직접 넣지 마세요(자기참조 채점 방지).',
    '',
  ]

  if (rows.length === 0) {
    return (
      header.join('\n') +
      '\n## 결과\n\n아직 집계할 신고가 없습니다. 베타 운영 중 👎 신고가 쌓이면 다시 실행하세요.\n'
    )
  }

  const tableHead = [
    '## 신고 묶음 (빈도순)',
    '',
    '| 순위 | 신고수 | 마지막 신고 | 출처유형 | 마스킹된 질문 | 신고 사유 | 정답 조문(회계사 기입) |',
    '|---:|---:|---|---|---|---|---|',
  ]

  const tableRows = rows.map((r, i) => {
    const rank = i + 1
    const sources = r.sourceTypes.length > 0 ? escapeCell(r.sourceTypes.join(', ')) : '—'
    const question = escapeCell(maskPhoneEmail(r.queryNorm))
    const reasons =
      r.reasons.length > 0
        ? escapeCell(r.reasons.map((x) => maskPhoneEmail(x)).join(' / '))
        : '(사유 없음)'
    // 정답 조문 칸은 비워 둔다 — 회계사 기입 (티켓 §3.2)
    return `| ${rank} | ${r.reportCount} | ${toDate(r.lastReportedAt)} | ${sources} | ${question} | ${reasons} | |`
  })

  return header.join('\n') + '\n' + tableHead.join('\n') + '\n' + tableRows.join('\n') + '\n'
}

// ─── 메인 ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const root = process.cwd()
  loadDotenv(join(root, '.env.local'))

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('[오류] DATABASE_URL이 설정되지 않았습니다.')
    console.error('원인: .env.local에 DATABASE_URL이 없어 ops_feedback을 조회할 수 없습니다.')
    console.error('해결: .env.local에 Neon DATABASE_URL을 추가한 뒤 다시 실행하세요.')
    process.exit(1)
  }

  // 환경변수 주입 후 동적 import (opsLog 어댑터는 server-only)
  const { PgOpsLogAdapter } = await import('../../src/adapters/opsLog')
  const opsLog = new PgOpsLogAdapter(databaseUrl)

  const rows = await opsLog.listFeedback()
  const markdown = buildReviewMarkdown(rows)

  const outPath = join(root, 'eval', 'golden_harvest_review.md')
  writeFileSync(outPath, markdown, 'utf-8')

  console.log('\n─── 요약 ───')
  console.log(`신고 묶음: ${rows.length}건 (질문 해시 기준)`)
  console.log(`총 신고수: ${rows.reduce((sum, r) => sum + r.reportCount, 0)}건`)
  console.log(`출력: ${outPath}`)
  console.log(
    '\n다음 단계: 리포트를 열어 골든셋에 넣을 질문을 고르고, golden_seeds.json에 시드 입력\n' +
      '  (정답 조문 lawName·articleNumber는 회계사가 직접 채움) → npm run golden:build',
  )
}

// tsx로 직접 실행될 때만 main() 호출 — vitest import 시에는 실행하지 않는다
if (process.argv[1] && process.argv[1].includes('harvestToSeeds')) {
  main().catch((err) => {
    console.error('[실패]', err)
    process.exit(1)
  })
}
