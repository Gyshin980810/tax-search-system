#!/usr/bin/env node
/**
 * 판례 인용 연결망 밀도 측정 — TAX-6B-23 (그래프 DB 전 효용 검증 PoC)
 *
 * scripts/precedent_full.json(TaxLaw[])을 읽어 본문에서 인용 사건번호를 추출하고,
 * 보유 코퍼스 내부 연결 밀도를 측정·리포트한다. 그래프 DB 도입의 게이트.
 *
 * ⚠️ 외부 API·LLM·임베딩 미사용(과금 0). content는 읽기 전용 파싱(§6.1).
 * ⚠️ DB·src 런타임(어댑터/유스케이스/포트) 무변경 — 순수 함수 + 오프라인 집계만.
 *
 * 실행:
 *   npm run probe:citation                         → precedent_full.json 측정
 *   npm run probe:citation -- --input scripts/x.json
 *   npm run probe:citation -- --top 20             → 피인용 상위 N건
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TaxLaw } from '../src/domain/TaxLaw'
import { buildCitationGraph, type CitationNode } from '../src/domain/precedentCitation'

function getArg(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + '%'
}

function main(): void {
  const root = process.cwd()
  const inputPath = getArg('--input') ?? join(root, 'scripts', 'precedent_full.json')
  const topN = Number(getArg('--top') ?? 10)
  const edgesOut = join(root, 'scripts', 'precedent_edges.json')

  if (!existsSync(inputPath)) {
    console.error(`[오류] 입력 파일이 없습니다: ${inputPath}`)
    console.error('원인: precedent_full.json 미생성')
    console.error('해결: npm run convert:precedent -- --all 로 생성 후 다시 실행하세요.')
    process.exit(1)
  }

  console.log(`[precedentCitationProbe] 입력: ${inputPath}`)
  const raw = readFileSync(inputPath, 'utf-8')
  const laws = JSON.parse(raw) as TaxLaw[]

  // 판례만 대상(caseNumber·content 보유). 코퍼스 노드로 변환.
  const nodes: CitationNode[] = laws
    .filter((l) => (l.caseNumber ?? '').trim() !== '' && l.content.trim() !== '')
    .map((l) => ({ caseNumber: l.caseNumber as string, content: l.content }))

  const { edges, stats } = buildCitationGraph(nodes, topN)

  // ─── 리포트 출력 ─────────────────────────────────────────────────────────
  console.log('\n─── 판례 인용 연결망 측정 결과 ───')
  console.log(`전체 판례(노드)         : ${stats.totalNodes.toLocaleString()}건`)
  console.log(
    `인용 1건+ 포함 판례     : ${stats.nodesWithAnyCitation.toLocaleString()}건 ` +
      `(${pct(stats.totalNodes ? stats.nodesWithAnyCitation / stats.totalNodes : 0)})`,
  )
  console.log(`총 엣지(인용 관계)      : ${stats.totalEdges.toLocaleString()}개`)
  console.log(`  ├ 내부 엣지(코퍼스 내): ${stats.internalEdges.toLocaleString()}개`)
  console.log(`  └ 외부 엣지(코퍼스 밖): ${stats.externalEdges.toLocaleString()}개`)
  console.log('')
  console.log(
    `★ 내부 연결 밀도        : ${pct(stats.internalDensity)} ` +
      `(${stats.nodesWithInternalEdge.toLocaleString()} / ${stats.totalNodes.toLocaleString()} 노드가 코퍼스 내부를 인용)`,
  )
  console.log(`고립 노드(내부 연결 0)  : ${stats.isolatedNodes.toLocaleString()}건`)
  console.log('')
  console.log(`피인용 상위 ${topN}건(허브 후보):`)
  for (const [i, t] of stats.topCited.entries()) {
    console.log(`  ${String(i + 1).padStart(2)}. ${t.caseNumber}  ← 내부 피인용 ${t.inDegree}회`)
  }

  // ─── 엣지 JSON 덤프(후속 그래프 적재 재사용) ─────────────────────────────
  writeFileSync(edgesOut, JSON.stringify(edges, null, 2) + '\n', 'utf-8')
  console.log(`\n엣지 목록 저장: ${edgesOut} (${edges.length.toLocaleString()}개)`)

  // ─── 도입 판단 힌트(밀도 해석) ───────────────────────────────────────────
  console.log('\n─── 해석 힌트 ───')
  const d = stats.internalDensity
  if (d >= 0.3) {
    console.log(`내부 밀도 ${pct(d)} — 코퍼스 내부 연결이 충분. 그래프 DB 효용 가능성 높음.`)
  } else if (d >= 0.1) {
    console.log(`내부 밀도 ${pct(d)} — 연결이 부분적. 허브 중심 부분 그래프만 효용 있을 수 있음.`)
  } else {
    console.log(
      `내부 밀도 ${pct(d)} — 연결이 듬성듬성(주로 코퍼스 밖 인용). 그래프 DB 효용 낮음 가능성.`,
    )
  }
  console.log('※ 이 추출은 보수적(누락 가능) — 측정 밀도는 하한값으로 해석할 것.')
  console.log('※ 최종 도입 판단은 회계사가 docs/reports/TAX-6B-23_report.md 검토 후 결정.')
}

main()
