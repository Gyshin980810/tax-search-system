import 'server-only'
import type { LabeledAnswer, VerifyDiagnostics } from '../domain/LabeledAnswer'
import type { CitationLabel } from '../domain/Citation'
import { TIER_ALLOWED_LABELS } from './lawVerifier'

/**
 * TAX-042D — V3 라벨 적정성 진단 마커 계산 헬퍼 (Stage 4 풀세트 보강 E·F·G)
 *
 * 배경:
 *   TAX-029/040/041 7차 baseline에서 V3 라벨 적정성 실패율 13.5%(100회 측정 13건) 관측.
 *   주된 패턴은 "T3·T4 자료에 🟢직접근거 오부착"(위험 방향)과 "T1·T2 자료에 ⚪참고자료
 *   후퇴"(안전 방향)이다. 두 미스매치를 운영 로그에서 분리 측정해야 SYSTEM_PROMPT
 *   강화 효과(E·F·G)를 정량 비교할 수 있다.
 *
 * 도메인 무결성 보호 (CLAUDE.md §6.4 V3·V6 판정 로직 절대 무변경):
 *   - V3 PASS/FAIL 판정은 오직 lawVerifier.ts의 checkV3가 수행한다.
 *   - 본 함수는 진단 전용으로, 회계사 화면 라벨·검증 결과에 영향을 주지 않는다.
 *   - TIER_ALLOWED_LABELS는 lawVerifier에서 export된 단일 진실 원천을 재사용한다.
 *
 * 폐지(deprecation) 판정 — 회계사 결정 2026-06-08 옵션 A 단순화:
 *   '⚫폐지' 라벨이 CitationLabel enum 4종 안에 있고 모든 Tier에 허용되어 있으므로
 *   v3Groups.deprecation은 항상 'pass'로 고정한다. sourceType·revisionDate 기반
 *   폐지 자료 누락 감지 강화는 별도 티켓에서 진행한다.
 */

/**
 * V3 라벨 enum 4종 — Citation.ts의 CitationLabel과 1:1 정합.
 *
 * citationItemSchema(zod)와 CitationLabel union이 진실 원천이며 본 상수는 진단 전용.
 * 새 라벨 추가 시 두 곳 모두 동기 갱신해야 한다.
 */
const VALID_LABEL_ENUM: readonly CitationLabel[] = [
  '🟢직접근거',
  '🟡유사사례',
  '⚪참고자료',
  '⚫폐지',
]

/**
 * LabeledAnswer를 받아 V3 라벨 적정성 진단 마커 3종(verifyMarker·tierMatchGrade·v3Groups)을 계산한다.
 *
 * 분류 기준:
 *   - VERIFIED        : 모든 citation의 (라벨 enum) ∧ (Tier 매핑) ∧ (폐지)가 pass — V3 PASS와 동치
 *   - PARTIAL_VERIFIED: V3 FAIL이지만 안전 방향(T1·T2 자료에 ⚪참고자료로 후퇴)
 *   - LABEL_MISMATCH  : 위 어느 쪽도 아님 (위험 방향 또는 enum 밖)
 *
 * tierMatchGrade:
 *   - exact   : Tier-라벨 매핑이 정확 (V3 PASS와 동치)
 *   - loose   : 안전 방향 미스매치(T1·T2 → ⚪)
 *   - mismatch: 위험 방향 또는 enum 밖
 *
 * 순수 함수 — 외부 호출·side effect 없음 (TAX-042C llmRetryPolicy.ts 격리 패턴 답습).
 *
 * @param answer LLM 생성 + law-verifier 검증 후 finalState.answer에서 호출
 * @returns LabeledAnswer.diagnostics에 부착할 진단 마커
 */
export function computeVerifyDiagnostics(answer: LabeledAnswer): VerifyDiagnostics {
  // (1) 라벨 enum 그룹 — 모든 citation의 label이 4종 enum 안에 있어야 pass.
  const labelEnumPass = answer.citations.every((c) => VALID_LABEL_ENUM.includes(c.label))

  // (2) Tier 매핑 그룹 — lawVerifier.checkV3와 동일한 판정.
  //     단일 진실 원천 TIER_ALLOWED_LABELS 재사용으로 sync 위험 회피.
  const tierMappingPass = answer.citations.every((c) =>
    TIER_ALLOWED_LABELS[c.taxLaw.trustTier].includes(c.label),
  )

  // (3) 폐지 그룹 — 회계사 결정 옵션 A: 항상 pass 고정.
  const deprecationPass = true

  const v3Groups: VerifyDiagnostics['v3Groups'] = {
    labelEnum: labelEnumPass ? 'pass' : 'fail',
    tierMapping: tierMappingPass ? 'pass' : 'fail',
    deprecation: deprecationPass ? 'pass' : 'fail',
  }

  // 안전 방향 미스매치 감지 — T1·T2 자료에 ⚪참고자료 부착(over-cautious).
  const isLoose = answer.citations.some(
    (c) =>
      (c.taxLaw.trustTier === 'T1' || c.taxLaw.trustTier === 'T2') &&
      c.label === '⚪참고자료',
  )

  const allPass = labelEnumPass && tierMappingPass && deprecationPass

  const tierMatchGrade: VerifyDiagnostics['tierMatchGrade'] = tierMappingPass
    ? 'exact'
    : isLoose
      ? 'loose'
      : 'mismatch'

  const verifyMarker: VerifyDiagnostics['verifyMarker'] = allPass
    ? 'VERIFIED'
    : tierMatchGrade === 'loose'
      ? 'PARTIAL_VERIFIED'
      : 'LABEL_MISMATCH'

  return { verifyMarker, tierMatchGrade, v3Groups }
}
