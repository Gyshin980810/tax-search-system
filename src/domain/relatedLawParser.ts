/**
 * 심판례 '관련법령'·'참조결정' 필드 파서 (TAX-033)
 *
 * 진단5(2026-05-24) 실측 변이 20건에서 확인된 규칙을 반영한다:
 *
 * [관련법령 변이]
 *   - 복수 법령: " / " 또는 "/" 로 구분
 *   - 법령명: 「」 안에 위치
 *   - 시행령이 「」 밖에 붙음: 「법인세법」 시행령제89조
 *   - 조문 제목 【】 포함: 「법인세법」 제3조 【실질과세】
 *   - 항 포함: 「국세기본법」 제26조 제2항
 *   - 조의숫자: 「국세기본법」 제26조의2
 *   - 깨진 번호: 제O조 (원문 유지)
 *   - 중복: 정규화 없이 rawText 기준으로 dedup
 *   - trailing "/": 끝에 " /" 있는 경우 빈 토큰 제거
 *
 * [참조결정 변이]
 *   - 복수: "/" 로 구분
 *   - trailing "/": 빈 토큰 제거
 *   - 조심/국심 혼재
 *
 * 설계 원칙 (§6.1 원문 보존):
 *   - 라벨(rawText)은 원문 조각 그대로 — 변형·의역 금지
 *   - 법령명·조문 분해는 매칭·그룹핑 내부용으로만 사용
 *   - 깨진 데이터도 원문 유지 (매칭 실패를 허용, 표시는 가능)
 */

import { normalizeLawName } from './lawAliases'

// ──────────────────────────────────────────────────
// 타입 정의
// ──────────────────────────────────────────────────

/**
 * 관련법령 단일 항목 — 「법령명」 조문표기 한 조각
 */
export interface ParsedLawRef {
  /**
   * 원문 조각 — UI 라벨·법령 링크 생성에 사용 (변형 없음, §6.1)
   * 예: "「조세특례제한법」 제69조", "「법인세법」 시행령제106조"
   */
  rawText: string
  /**
   * 「」 안의 법령명 원문
   * 예: "조세특례제한법", "상속세및증여세법"
   * 「」 없는 조각은 빈 문자열
   */
  lawName: string
  /**
   * 「」 뒤의 조문 표기 원문
   * 예: "제69조", "시행령제89조", "제3조 【실질과세】", "제26조 제2항"
   * 「」 없는 조각은 빈 문자열
   */
  articleRef: string
  /**
   * normalizeLawName()으로 정규화된 법령명 (매칭·그룹핑 내부용)
   * 예: "상속세및증여세법" → "상속세및증여세법" (약칭 사전 없으면 원문 그대로)
   */
  lawNameNormalized: string
}

/**
 * 참조결정 단일 항목 — 심판례 청구번호 한 건
 */
export interface ParsedReference {
  /**
   * 청구번호 원문
   * 예: "조심2011서1540", "국심2004중3046"
   */
  rawText: string
}

// ──────────────────────────────────────────────────
// 파서 함수
// ──────────────────────────────────────────────────

/**
 * 심판례 '관련법령' 필드를 파싱하여 ParsedLawRef 배열로 반환한다.
 *
 * 처리 순서:
 * 1. "/" 로 split
 * 2. 각 토큰 trim + 빈 토큰 제거
 * 3. rawText 기준 중복 제거
 * 4. 각 토큰에서 법령명·조문 추출 (parseSingleLawRef)
 *
 * @param raw '관련법령' 필드 원문 (null/undefined/빈 문자열 허용)
 * @returns ParsedLawRef 배열 (중복 제거됨). 빈 입력 시 []
 */
export function parseRelatedLaws(raw: string | null | undefined): ParsedLawRef[] {
  if (!raw || raw.trim() === '') return []

  // "/" 로 분리 (공백 포함 " / "·붙은 "/" 모두 처리)
  const tokens = raw
    .split('/')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

  // rawText 기준 중복 제거
  const seen = new Set<string>()
  const unique = tokens.filter((t) => {
    if (seen.has(t)) return false
    seen.add(t)
    return true
  })

  return unique.map(parseSingleLawRef)
}

/**
 * 심판례 '참조결정' 필드를 파싱하여 ParsedReference 배열로 반환한다.
 *
 * 처리 순서:
 * 1. "/" 로 split
 * 2. 각 토큰 trim + 빈 토큰 제거
 * 3. rawText 기준 중복 제거
 *
 * @param raw '참조결정' 필드 원문 (null/undefined/빈 문자열 허용)
 * @returns ParsedReference 배열. 빈 입력 시 []
 */
export function parseReferences(raw: string | null | undefined): ParsedReference[] {
  if (!raw || raw.trim() === '') return []

  const tokens = raw
    .split('/')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

  const seen = new Set<string>()
  return tokens
    .filter((t) => {
      if (seen.has(t)) return false
      seen.add(t)
      return true
    })
    .map((rawText) => ({ rawText }))
}

// ──────────────────────────────────────────────────
// 내부 유틸
// ──────────────────────────────────────────────────

/**
 * 단일 법령 참조 조각을 분해한다 (내부 사용).
 *
 * 「법령명」조문표기 패턴을 파싱한다.
 * 「」가 없거나 매칭 실패 시 rawText만 채우고 나머지는 빈 문자열로 반환
 * (원문 보존, 매칭 실패를 허용하되 표시는 가능하게 유지).
 *
 * @param token "/" 분리 후 trim된 단일 조각
 */
function parseSingleLawRef(token: string): ParsedLawRef {
  // 「법령명」 추출: 「부터 」까지를 법령명으로, 나머지를 조문표기로
  const bracketMatch = token.match(/「([^」]+)」(.*)/)

  if (!bracketMatch) {
    // 「」가 없는 조각 — 원문 유지, 분해 불가
    return {
      rawText: token,
      lawName: '',
      articleRef: '',
      lawNameNormalized: '',
    }
  }

  const lawName = bracketMatch[1].trim()       // 「」 안 (법령명 원문)
  const articleRef = bracketMatch[2].trim()    // 「」 뒤 (조문 표기 원문)
  const lawNameNormalized = normalizeLawName(lawName)

  return {
    rawText: token,
    lawName,
    articleRef,
    lawNameNormalized,
  }
}
