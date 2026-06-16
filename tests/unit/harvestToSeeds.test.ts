import { describe, it, expect } from 'vitest'
import { buildReviewMarkdown } from '../../scripts/golden/harvestToSeeds'
import type { OpsFeedbackRow } from '@/ports/opsLogPort'

/** 집계 행 1건을 만드는 헬퍼 (필요한 필드만 덮어쓰기) */
function makeRow(overrides: Partial<OpsFeedbackRow> = {}): OpsFeedbackRow {
  return {
    queryHash: 'abc1234567890def',
    queryNorm: '부가가치세 면세 대상',
    reasons: ['결론이 반대입니다'],
    sourceTypes: ['법령'],
    reportCount: 1,
    lastReportedAt: '2026-06-16T09:30:00.000Z',
    ...overrides,
  }
}

const FIXED_AT = new Date('2026-06-16T12:00:00.000Z')

describe('buildReviewMarkdown (TAX-030-C)', () => {
  it('신고가 없으면 "집계할 신고가 없습니다" 안내를 낸다', () => {
    const md = buildReviewMarkdown([], FIXED_AT)
    expect(md).toContain('아직 집계할 신고가 없습니다')
    // 빈 결과여도 표 헤더는 만들지 않는다
    expect(md).not.toContain('| 순위 |')
  })

  it('행이 있으면 빈도순 표를 만들고 순위·신고수를 표시한다', () => {
    const md = buildReviewMarkdown(
      [makeRow({ reportCount: 5 }), makeRow({ reportCount: 2, queryNorm: '근로소득 범위' })],
      FIXED_AT,
    )
    expect(md).toContain('| 순위 | 신고수 |')
    // 첫 행(순위 1)이 신고수 5
    expect(md).toMatch(/\| 1 \| 5 \|/)
    // 둘째 행(순위 2)이 신고수 2
    expect(md).toMatch(/\| 2 \| 2 \|/)
    expect(md).toContain('근로소득 범위')
  })

  it('정답 조문 칸을 비워 둔다 (회계사 기입란 — 정답 자동생성 금지)', () => {
    const md = buildReviewMarkdown([makeRow()], FIXED_AT)
    // 표 본문 행은 "정답 조문" 칸이 비어 끝나야 한다 (… | |)
    const bodyLine = md.split('\n').find((l) => l.startsWith('| 1 |'))
    expect(bodyLine).toBeTruthy()
    expect(bodyLine!.trimEnd().endsWith('| |')).toBe(true)
    // 헤더에 회계사 기입 안내가 있다
    expect(md).toContain('정답 조문(회계사 기입)')
  })

  it('마지막 신고 시각은 날짜(YYYY-MM-DD)만 표시한다', () => {
    const md = buildReviewMarkdown([makeRow({ lastReportedAt: '2026-06-16T09:30:00.000Z' })], FIXED_AT)
    expect(md).toContain('2026-06-16')
    expect(md).not.toContain('T09:30:00')
  })

  it('질문에 파이프(|)가 있어도 표가 깨지지 않게 escape한다', () => {
    const md = buildReviewMarkdown([makeRow({ queryNorm: '면세 | 영세율 차이' })], FIXED_AT)
    expect(md).toContain('면세 \\| 영세율 차이')
  })

  it('여러 신고 사유를 " / "로 합치고, 사유가 없으면 "(사유 없음)"으로 표시한다', () => {
    const multi = buildReviewMarkdown([makeRow({ reasons: ['사유A', '사유B'] })], FIXED_AT)
    expect(multi).toContain('사유A / 사유B')

    const none = buildReviewMarkdown([makeRow({ reasons: [] })], FIXED_AT)
    expect(none).toContain('(사유 없음)')
  })

  it('출처유형이 비면 "—"로 표시한다', () => {
    const md = buildReviewMarkdown([makeRow({ sourceTypes: [] })], FIXED_AT)
    const bodyLine = md.split('\n').find((l) => l.startsWith('| 1 |'))
    expect(bodyLine).toContain('| — |')
  })

  it('방어적 마스킹: 혹시 마스킹 안 된 휴대폰·이메일이 와도 리포트엔 마스킹되어 나간다', () => {
    const md = buildReviewMarkdown(
      [makeRow({ queryNorm: '010-1234-5678 환급', reasons: ['user@example.com 회신요청'] })],
      FIXED_AT,
    )
    // 원문 노출 금지
    expect(md).not.toContain('010-1234-5678')
    expect(md).not.toContain('user@example.com')
    // 마스킹 형태로 노출
    expect(md).toContain('010-****-5678')
    expect(md).toContain('us***@example.com')
  })
})
