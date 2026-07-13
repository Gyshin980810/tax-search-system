import type { SourceType, TaxLaw } from '../src/domain/TaxLaw'

export interface EmbedCaseIssueItem {
  index: number
  sourceType: SourceType
  caseNumber?: string
  externalId?: string
  lawName: string
  articleTitle: string
  decisionDate?: string
  sourceUrl: string
}

export interface DuplicateCaseNumberIssue {
  sourceType: SourceType
  caseNumber: string
  externalId?: string
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
    ...(law.externalId?.trim() ? { externalId: law.externalId.trim() } : {}),
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
 * - 판례·해석례·심판례는 식별자 중복을 적재 전 차단한다. externalId가 있으면 이를 우선해,
 *   국세청 해석례의 비고유 caseNumber가 오탐으로 차단하지 않도록 한다.
 * - 원문/본문은 읽기만 하며 변형하지 않는다(§6.1).
 */
export function inspectNonLawCaseNumbers(laws: TaxLaw[]): EmbedInputQualityReport {
  const groups = new Map<string, { caseNumber: string; externalId?: string; items: EmbedCaseIssueItem[] }>()
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

    const externalId = law.externalId?.trim()
    const identifier = externalId || caseNumber
    const key = `${law.sourceType}|${identifier}`
    const group = groups.get(key) ?? { caseNumber, ...(externalId ? { externalId } : {}), items: [] }
    group.items.push(issueItem)
    groups.set(key, group)
  })

  const duplicateCaseNumbers: DuplicateCaseNumberIssue[] = []
  for (const [key, group] of groups.entries()) {
    if (group.items.length < 2) continue
    const [sourceType] = key.split('|') as [SourceType]
    duplicateCaseNumbers.push({
      sourceType,
      caseNumber: group.caseNumber,
      ...(group.externalId ? { externalId: group.externalId } : {}),
      count: group.items.length,
      items: group.items,
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
