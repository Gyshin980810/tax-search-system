#!/usr/bin/env node
/**
 * 골든셋 → TaxLaw[] 추출기 — TAX-026-H
 *
 * 사용법:
 *   npx tsx scripts/extractLaws.ts
 *   → scripts/laws_for_embed.json 생성
 *
 * 동작:
 *   eval/golden_direct.json + eval/golden_direct_nonlaw.json 의
 *   sourceLaws + citations.taxLaw 에서 TaxLaw 객체를 모아
 *   content가 있는 고유 항목만 scripts/laws_for_embed.json 으로 저장한다.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { TaxLaw } from '../src/domain/TaxLaw'

const root = process.cwd()

interface GoldenCase {
  sourceLaws?: TaxLaw[]
  answer?: {
    citations?: Array<{ taxLaw?: TaxLaw }>
    references?: TaxLaw[]
  }
}

interface GoldenFile {
  cases?: GoldenCase[]
}

function extractFromFile(filePath: string): TaxLaw[] {
  if (!existsSync(filePath)) {
    console.warn(`[skip] 파일 없음: ${filePath}`)
    return []
  }
  const file: GoldenFile = JSON.parse(readFileSync(filePath, 'utf-8'))
  const laws: TaxLaw[] = []
  for (const c of file.cases ?? []) {
    for (const law of c.sourceLaws ?? []) laws.push(law)
    for (const cit of c.answer?.citations ?? []) {
      if (cit.taxLaw) laws.push(cit.taxLaw)
    }
    for (const ref of c.answer?.references ?? []) laws.push(ref)
  }
  return laws
}

/** sourceType 누락(구버전 픽스처) 시 '법령' 기본값 보정 */
function normalizeSourceType(law: TaxLaw): TaxLaw {
  return law.sourceType ? law : { ...law, sourceType: '법령' }
}

function dedup(laws: TaxLaw[]): TaxLaw[] {
  const seen = new Set<string>()
  return laws.filter((l) => {
    // 법령은 lawName+articleNumber, 비법령은 caseNumber 로 중복 제거
    const key = l.sourceType === '법령'
      ? `${l.lawName}|${l.articleNumber}`
      : `${l.sourceType}|${l.caseNumber ?? l.lawName}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const inputFiles = [
  join(root, 'eval', 'golden_direct.json'),
  join(root, 'eval', 'golden_direct_nonlaw.json'),
]

const allLaws = inputFiles.flatMap(extractFromFile).map(normalizeSourceType)
const unique = dedup(allLaws)
const withContent = unique.filter((l) => l.content && l.content.trim().length > 0)

const outPath = join(root, 'scripts', 'laws_for_embed.json')
writeFileSync(outPath, JSON.stringify(withContent, null, 2) + '\n', 'utf-8')

console.log(`[extractLaws] 총 ${allLaws.length}건 → 중복 제거 ${unique.length}건 → content 보유 ${withContent.length}건`)
console.log(`[extractLaws] 출력: ${outPath}`)
