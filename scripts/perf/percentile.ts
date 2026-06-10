/**
 * 백분위 계산 유틸 (TAX-029)
 *
 * RAG 5단계 누적 응답시간 측정용. 단계별·전체 누적 시간 배열에서
 * P50/P95/P99/Max/Mean/Stdev를 산출하고 표 형태로 콘솔에 출력한다.
 *
 * 백분위 정의(Nearest Rank): sorted[Math.ceil(p/100 * n) - 1]
 *  - 예) n=100, p=95 → 인덱스 94 (정렬 후 95번째 값)
 *  - 100회 측정 기준 분포 해석에 직관적.
 */

/** 단일 단계 통계 묶음 */
export interface Stats {
  n: number
  mean: number
  stdev: number
  p50: number
  p95: number
  p99: number
  max: number
}

/**
 * 표본 배열에서 통계 5종을 계산한다.
 * 빈 배열이면 모든 값을 0으로 반환(측정 실패 케이스 대비).
 */
export function computeStats(samples: number[]): Stats {
  if (samples.length === 0) {
    return { n: 0, mean: 0, stdev: 0, p50: 0, p95: 0, p99: 0, max: 0 }
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const n = sorted.length
  const mean = sorted.reduce((s, v) => s + v, 0) / n
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n
  const stdev = Math.sqrt(variance)
  return {
    n,
    mean,
    stdev,
    p50: percentileAt(sorted, 50),
    p95: percentileAt(sorted, 95),
    p99: percentileAt(sorted, 99),
    max: sorted[n - 1],
  }
}

/**
 * 정렬된 배열에서 nearest-rank 백분위 값을 반환한다.
 * - p=0이면 최솟값, p=100이면 최댓값.
 * - 100회 측정·p=95이면 정렬 후 인덱스 94(=95번째 값).
 */
function percentileAt(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (p <= 0) return sorted[0]
  if (p >= 100) return sorted[sorted.length - 1]
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]
}

/** 밀리초를 'X.XXs' 또는 'XXms' 형식으로 변환 */
function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  if (ms >= 1) return `${ms.toFixed(0)}ms`
  return `${ms.toFixed(2)}ms`
}

/**
 * 단계별·누적 통계를 콘솔 테이블로 출력한다.
 *
 * @param stagesByName  단계명 → 표본 배열 (예: { rewrite, search, answer, verify })
 * @param totals        100회 누적 응답시간 배열
 * @param passThreshold P95 합격선 (밀리초). 누적 P95 < threshold면 PASS
 */
export function printReport(
  stagesByName: Record<string, number[]>,
  totals: number[],
  passThreshold: number,
): { stages: Record<string, Stats>; total: Stats; pass: boolean } {
  const stageStats: Record<string, Stats> = {}
  for (const [name, samples] of Object.entries(stagesByName)) {
    stageStats[name] = computeStats(samples)
  }
  const totalStats = computeStats(totals)
  const pass = totalStats.p95 < passThreshold

  // 헤더
  const header = ['단계'.padEnd(12), 'n', '평균', 'P50', 'P95', 'P99', 'Max']
    .map((h, i) => (i === 0 ? h : h.padStart(10)))
    .join(' ')
  console.log('\n=== TAX-029 P95 측정 결과 ===')
  console.log(header)
  console.log('-'.repeat(header.length))

  for (const [name, s] of Object.entries(stageStats)) {
    const row = [
      name.padEnd(12),
      String(s.n).padStart(10),
      fmtMs(s.mean).padStart(10),
      fmtMs(s.p50).padStart(10),
      fmtMs(s.p95).padStart(10),
      fmtMs(s.p99).padStart(10),
      fmtMs(s.max).padStart(10),
    ].join(' ')
    console.log(row)
  }
  console.log('-'.repeat(header.length))
  const totalRow = [
    '누적'.padEnd(12),
    String(totalStats.n).padStart(10),
    fmtMs(totalStats.mean).padStart(10),
    fmtMs(totalStats.p50).padStart(10),
    fmtMs(totalStats.p95).padStart(10),
    fmtMs(totalStats.p99).padStart(10),
    fmtMs(totalStats.max).padStart(10),
  ].join(' ')
  console.log(totalRow)
  console.log('-'.repeat(header.length))
  console.log(
    pass
      ? `✅ PASS — 누적 P95 ${fmtMs(totalStats.p95)} < 합격선 ${fmtMs(passThreshold)}`
      : `❌ FAIL — 누적 P95 ${fmtMs(totalStats.p95)} ≥ 합격선 ${fmtMs(passThreshold)}`,
  )

  return { stages: stageStats, total: totalStats, pass }
}
