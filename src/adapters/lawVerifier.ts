import type { ILawVerifierPort } from '../ports/lawVerifierPort'
import type { LabeledAnswer } from '../domain/LabeledAnswer'
import type { TaxLaw, TrustTier } from '../domain/TaxLaw'
import type { VerificationResult } from '../domain/VerificationResult'
import type { CitationLabel } from '../domain/Citation'
import { DISCLAIMER } from '../domain/disclaimer'

/**
 * Trust Tier별 허용 라벨 매핑 (CLAUDE.md §6.2, §6.3)
 * T1/T2: 직접 근거 출처 → 🟢직접근거 또는 ⚫폐지
 * T3/T4: 예규·판례 → 🟡유사사례·⚪참고자료·⚫폐지 (단독 🟢 금지)
 *
 * ⚠️ TAX-042D 풀세트 보강 F·G에서 verifyDiagnostics.ts가 같은 상수를 import하므로
 *    export로 노출한다. 값 자체는 무변경 — V3 PASS/FAIL 판정 로직(checkV3) 보호.
 */
export const TIER_ALLOWED_LABELS: Record<TrustTier, CitationLabel[]> = {
  T1: ['🟢직접근거', '⚫폐지'],
  T2: ['🟢직접근거', '⚫폐지'],
  T3: ['🟡유사사례', '⚪참고자료', '⚫폐지'],
  T4: ['🟡유사사례', '⚪참고자료', '⚫폐지'],
}

/**
 * 🟡유사사례 인용이 있는 답변에서 금지되는 단정형 표현 패턴 (CLAUDE.md §6.3)
 * 유사 사례를 현재 사안에 직접 적용하는 단정 표현을 감지한다.
 */
const ASSERTIVE_PATTERNS: RegExp[] = [
  /이 경우(도)?\s.+(입니다|됩니다)/,
  /이 케이스(도)?\s.+(입니다|됩니다)/,
  /따라서\s.+(됩니다|입니다)/,
  /반드시\s.+해야\s합니다/,
  /동일하게\s.+(됩니다|입니다)/,
  /같은 경우(에)?\s.+(입니다|됩니다)/,
  /동일한\s.+이\s적용됩니다/,
]

/**
 * V4 시점 라벨 형식 정규식 (CLAUDE.md §6.2 — TAX-037: 비법령용 [결정] 추가, TAX-6A-9: 단일 날짜 허용)
 *
 * 표기 기준은 현행 답변 생성 코드(llmAnswerGenerator.ts 프롬프트)·골든셋과
 * 일치시킨다. 즉 [적용 시점]의 물결표(~)는 양옆 공백 없음.
 * ⚠️ 사양 문서(SSOT §7.5 / PRD §6.4.1 / CLAUDE.md §6.2)는 `~` 양옆 공백
 *    표기라 1자 불일치 — 사양↔코드 정합은 BUG-003 범위 밖(별도 정합 티켓,
 *    리포트 §5 참조). 본 검증은 "현행 정상 답변을 깨지 않음"을 우선한다.
 *
 * [결정: YYYY.MM.DD]: 비법령(심판례·해석례·판례) — 결정·선고·회신일 (TAX-037)
 * [적용 시점: YYYY.MM.DD]: 단일 날짜 형식 — LLM이 시작일을 알지 못할 때 생성 (TAX-6A-9, 회계사 승인 2026-06-14)
 */
const TEMPORAL_LABEL_PATTERNS: RegExp[] = [
  /^\[현행\]$/,
  // 완전한 범위 [적용 시점: YYYY.MM.DD~YYYY.MM.DD]
  /^\[적용 시점: \d{4}\.\d{2}\.\d{2}~\d{4}\.\d{2}\.\d{2}\]$/,
  // 단일 날짜 [적용 시점: YYYY.MM.DD] — 시작일만 또는 종료일만 (TAX-6A-9, 회계사 승인 2026-06-14)
  /^\[적용 시점: \d{4}\.\d{2}\.\d{2}\]$/,
  // 시작일만 있는 범위 [적용 시점: YYYY.MM.DD~] (TAX-6A-9)
  /^\[적용 시점: \d{4}\.\d{2}\.\d{2}~\]$/,
  /^\[폐지: \d{4}\.\d{2}\.\d{2}\]$/,
  /^\[결정: \d{4}\.\d{2}\.\d{2}\]$/,
]

/**
 * 자료 식별자 정규화 — 유형별 동일성 비교(key)·표시(label) 단일 진입점 (TAX-022)
 *
 * - 법령: lawName + articleNumber (조문번호가 식별자)
 * - 비법령(판례·해석례·심판례 등): caseNumber (사건번호가 식별자; 없으면 key = '')
 *
 * key = '' 이면 식별 불가 → matchesIdentity에서 false 반환 (환각 차단, V1 규칙).
 * sourceType 미지정 데이터(레거시 골든셋 픽스처 등)는 법령으로 간주 (하위호환).
 */
function identityOf(law: TaxLaw): { type: string; key: string; label: string } {
  const type = law.sourceType ?? '법령'
  if (type === '법령') {
    const k = `${law.lawName} ${law.articleNumber}`
    return { type, key: k, label: k }
  }
  const key = law.caseNumber ?? ''
  return { type, key, label: `${law.lawName} ${key}`.trim() }
}

function matchesIdentity(source: TaxLaw, cited: TaxLaw): boolean {
  const s = identityOf(source)
  const c = identityOf(cited)
  return s.type === c.type && !!c.key && s.key === c.key
}

/** 실패 메시지용 식별자 문자열 — 자료유형에 맞는 식별자 표기 */
function identityLabel(law: TaxLaw): string {
  return identityOf(law).label
}

/**
 * 텍스트에서 큰따옴표로 감싼 인용 스팬을 추출한다 (BUG-002)
 *
 * LLM이 summary에 따옴표 친 환각 인용을 넣어도 잡기 위함.
 * 직선 큰따옴표("...")와 한국어 출력에서 흔한 곡선 큰따옴표(“...”) 모두 대상.
 * 작은따옴표·낫표(「」)는 본 범위 밖 (오탐 방지 — 별도 티켓).
 */
function extractQuotedSpans(text: string): string[] {
  const spans: string[] = []
  for (const m of text.matchAll(/"([^"]+)"/g)) spans.push(m[1])
  for (const m of text.matchAll(/“([^”]+)”/g)) spans.push(m[1])
  return spans
}

// ─── V1~V6 개별 검사 함수 ────────────────────────────────────────────────────
// 반환값: 실패 이유 목록 (빈 배열 = 통과)

function checkV1(answer: LabeledAnswer, sourceLaws: TaxLaw[]): string[] {
  const fails: string[] = []
  for (const citation of answer.citations) {
    if (!sourceLaws.some((law) => matchesIdentity(law, citation.taxLaw))) {
      fails.push(`V1: 인용이 검색 결과에 없음 — ${identityLabel(citation.taxLaw)}`)
    }
  }
  return fails
}

function checkV2(answer: LabeledAnswer, sourceLaws: TaxLaw[]): string[] {
  const fails: string[] = []
  // citation 발췌 원문 대조 (BUG-005 — N-2)
  for (const citation of answer.citations) {
    const content = citation.taxLaw.content.trim()
    // content가 없는 비법령(API 본문 미제공)은 발췌 불가 — V2 면제 (TAX-6A-9, 회계사 승인 2026-06-14)
    if (content.length === 0) continue
    const excerpt = citation.excerpt.trim()
    if (excerpt.length === 0) {
      fails.push(
        `V2: 발췌가 비어 있음 — ${citation.taxLaw.lawName} ${citation.taxLaw.articleNumber}`,
      )
    } else if (!content.includes(excerpt)) {
      fails.push(
        `V2: 발췌가 원문과 불일치 — ${citation.taxLaw.lawName} ${citation.taxLaw.articleNumber}` +
        ` (발췌 앞 30자: "${excerpt.slice(0, 30)}")`,
      )
    }
  }
  // summary 큰따옴표 인용 원문 대조 (BUG-002)
  for (const span of extractQuotedSpans(answer.summary)) {
    const quoted = span.trim()
    if (quoted.length > 0 && !sourceLaws.some((law) => law.content.includes(quoted))) {
      fails.push(
        `V2: summary 인용이 원문과 불일치 — (인용 앞 30자: "${quoted.slice(0, 30)}")`,
      )
    }
  }
  return fails
}

function checkV3(answer: LabeledAnswer): string[] {
  const fails: string[] = []
  for (const citation of answer.citations) {
    const allowed = TIER_ALLOWED_LABELS[citation.taxLaw.trustTier]
    if (!allowed.includes(citation.label)) {
      fails.push(
        `V3: 라벨 부적절 — ${citation.taxLaw.trustTier} 출처에 '${citation.label}' 사용` +
        ` (허용: ${allowed.join(', ')})`,
      )
    }
  }
  return fails
}

function checkV4(answer: LabeledAnswer): string[] {
  if (!answer.temporalLabel || answer.temporalLabel.trim() === '') {
    return ['V4: 시점 라벨 미부착 — temporalLabel이 비어 있음']
  }
  if (!TEMPORAL_LABEL_PATTERNS.some((p) => p.test(answer.temporalLabel.trim()))) {
    return [`V4: 시점 라벨 형식 불일치 — "${answer.temporalLabel.trim().slice(0, 30)}"`]
  }
  return []
}

function checkV5(answer: LabeledAnswer): string[] {
  if (!answer.disclaimer || answer.disclaimer.trim() === '') {
    return ['V5: 면책 고지 미부착 — disclaimer가 비어 있음']
  }
  if (answer.disclaimer.trim() !== DISCLAIMER) {
    return ['V5: 면책 고지가 표준 문구(DISCLAIMER)와 불일치']
  }
  return []
}

function checkV6(answer: LabeledAnswer): string[] {
  if (!answer.citations.some((c) => c.label === '🟡유사사례')) return []
  for (const pattern of ASSERTIVE_PATTERNS) {
    if (pattern.test(answer.summary)) {
      return [
        `V6: 🟡유사사례에서 단정형 표현 감지 — summary 앞 50자: "${answer.summary.slice(0, 50)}"`,
      ]
    }
  }
  return []
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

/**
 * law-verifier 검증 어댑터 — V1~V6 규칙 기반 검증 (CLAUDE.md §6.4)
 *
 * LLM 호출 없이 순수 TypeScript 로직으로 동작합니다.
 * tax-generator와 완전히 독립된 인스턴스로 실행됩니다.
 */
export class LawVerifierAdapter implements ILawVerifierPort {
  async verify(answer: LabeledAnswer, sourceLaws: TaxLaw[]): Promise<VerificationResult> {
    const v1Fails = checkV1(answer, sourceLaws)
    const v2Fails = checkV2(answer, sourceLaws)
    const v3Fails = checkV3(answer)
    const v4Fails = checkV4(answer)
    const v5Fails = checkV5(answer)
    const v6Fails = checkV6(answer)

    const checks = {
      v1: v1Fails.length === 0,
      v2: v2Fails.length === 0,
      v3: v3Fails.length === 0,
      v4: v4Fails.length === 0,
      v5: v5Fails.length === 0,
      v6: v6Fails.length === 0,
    }
    const failReasons = [
      ...v1Fails, ...v2Fails, ...v3Fails,
      ...v4Fails, ...v5Fails, ...v6Fails,
    ]
    return {
      status: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
      checks,
      failReasons,
    }
  }
}
