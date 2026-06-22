import type { SourceType, TaxLaw } from '../src/domain/TaxLaw'

export interface EmbedCaseIssueItem {
  index: number
  sourceType: SourceType
  caseNumber?: string
  lawName: string
  articleTitle: string
  decisionDate?: string
  sourceUrl: string
}

export interface DuplicateCaseNumberIssue {
  sourceType: SourceType
  caseNumber: string
  count: number
  items: EmbedCaseIssueItem[]
}

export interface MissingCaseNumberIssue extends EmbedCaseIssueItem {
  reason: 'missing-case-number'
}

export interface EmbedInputQualityReport {
  checked: number
  nonLawChecked: number
  duplicateCaseNumbers: DuplicateCaseNumberIssue[]
  missingCaseNumbers: MissingCaseNumberIssue[]
  hasIssues: boolean
}

function toIssueItem(law: TaxLaw, index: number): EmbedCaseIssueItem {
  return {
    index,
    sourceType: law.sourceType,
    ...(law.caseNumber?.trim() ? { caseNumber: law.caseNumber.trim() } : {}),
    lawName: law.lawName,
    articleTitle: law.articleTitle,
    ...(law.decisionDate ? { decisionDate: law.decisionDate } : {}),
    sourceUrl: law.sourceUrl,
  }
}

/**
 * 임베딩 적재 전 비법령 식별자 품질을 검사한다.
 *
 * - 법령은 조문 식별자(lawName + articleNumber)를 쓰므로 검사 대상에서 제외한다.
 * - 판례·해석례·심판례는 V1 식별과 중복 제거가 caseNumber에 의존하므로 누락·중복을 적재 전 차단한다.
 * - 원문/본문은 읽기만 하며 변형하지 않는다(§6.1).
 */
export function inspectNonLawCaseNumbers(laws: TaxLaw[]): EmbedInputQualityReport {
  const groups = new Map<string, EmbedCaseIssueItem[]>()
  const missingCaseNumbers: MissingCaseNumberIssue[] = []
  let nonLawChecked = 0

  laws.forEach((law, index) => {
    if (law.sourceType === '법령') return

    nonLawChecked += 1
    const issueItem = toIssueItem(law, index)
    const caseNumber = law.caseNumber?.trim()

    if (!caseNumber) {
      missingCaseNumbers.push({ ...issueItem, reason: 'missing-case-number' })
      return
    }

    const key = `${law.sourceType}|${caseNumber}`
    const items = groups.get(key) ?? []
    items.push(issueItem)
    groups.set(key, items)
  })

  const duplicateCaseNumbers: DuplicateCaseNumberIssue[] = []
  for (const [key, items] of groups.entries()) {
    if (items.length < 2) continue
    const [sourceType, caseNumber] = key.split('|') as [SourceType, string]
    duplicateCaseNumbers.push({
      sourceType,
      caseNumber,
      count: items.length,
      items,
    })
  }

  duplicateCaseNumbers.sort((a, b) => {
    if (a.sourceType !== b.sourceType) return a.sourceType.localeCompare(b.sourceType)
    return a.caseNumber.localeCompare(b.caseNumber)
  })
  missingCaseNumbers.sort((a, b) => {
    if (a.sourceType !== b.sourceType) return a.sourceType.localeCompare(b.sourceType)
    return a.index - b.index
  })

  return {
    checked: laws.length,
    nonLawChecked,
    duplicateCaseNumbers,
    missingCaseNumbers,
    hasIssues: duplicateCaseNumbers.length > 0 || missingCaseNumbers.length > 0,
  }
}
