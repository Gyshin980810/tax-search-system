import { detectPii } from '../utils/piiFilter'
import { AppError } from '../domain/errors'
import { DISCLAIMER } from '../domain/disclaimer'
import { computeVerifyDiagnostics } from '../adapters/verifyDiagnostics'
import type { IQueryRewriterPort } from '../ports/llmQueryRewriterPort'
import type { ISearchPort } from '../ports/taxLawSearchPort'
import type { IAnswerGeneratorPort } from '../ports/llmAnswerGeneratorPort'
import type { ILawVerifierPort } from '../ports/lawVerifierPort'
import type { LabeledAnswer } from '../domain/LabeledAnswer'
import type { TemporalContext } from '../domain/TemporalContext'
import type { TaxLaw } from '../domain/TaxLaw'
import type { Citation } from '../domain/Citation'
import type { VerificationResult } from '../domain/VerificationResult'
import type { MatchStage } from '../domain/SearchResult'

/**
 * matchStage가 정의된 경우에만 4번째 인수로 전달한다 (TAX-026-G).
 * undefined를 전달하지 않으므로 기존 테스트(3인수 기댓값)와의 하위호환 유지.
 */
function callGenerate(
  generator: IAnswerGeneratorPort,
  laws: TaxLaw[],
  question: string,
  temporal: TemporalContext,
  matchStage?: MatchStage,
): Promise<LabeledAnswer> {
  return matchStage != null
    ? generator.generate(laws, question, temporal, matchStage)
    : generator.generate(laws, question, temporal)
}

/** 참고 목록 최대 노출 건수 (TAX-015B 5 → TAX-015D 10, 회계사 결정 2026-05-21) */
const MAX_REFERENCES = 10

/**
 * 검색어 토큰이 참고자료의 사건명·명칭에 몇 개나 포함되는지로 관련도 점수를 산출한다 (TAX-015C).
 *
 * 참고자료는 사건명(articleTitle)·명칭(lawName)이 주 텍스트 신호다.
 * 부분 문자열 포함(includes) 기준의 가벼운 휴리스틱이며, 의미 기반 유사도(벡터DB)는 별도 트랙이다.
 */
function relevanceScore(ref: TaxLaw, terms: string[]): number {
  const haystack = `${ref.articleTitle} ${ref.lawName}`
  let score = 0
  for (const term of terms) {
    if (haystack.includes(term)) score += 1
  }
  return score
}

/** 자료 식별 키 — 인용 여부 비교용 (법령=조문번호, 비법령=사건/안건번호) */
function identityKey(t: TaxLaw): string {
  return t.sourceType === '법령'
    ? `법령|${t.lawName}|${t.articleNumber}`
    : `${t.sourceType}|${t.caseNumber ?? ''}`
}

/**
 * 검색 결과를 발췌 인용 대상(citable)과 본문 없는 참고 풀(contentlessRefs)로 분리한다 (TAX-015B).
 *
 * - citable: 본문(content)이 있는 자료 → LLM 발췌 인용 + law-verifier V1~V6 검증 대상.
 * - contentlessRefs: 본문이 없는 비법령 자료(예: 국세 출처 판례) → 참고 목록 후보.
 *
 * 본문 없는 '법령'은 비정상 데이터이므로 어느 쪽에도 넣지 않는다(드롭).
 * 최종 참고 목록(인용 안 된 자료 합산·정렬·상한)은 답변 생성 후 buildReferences가 구성한다 (TAX-015D).
 */
function splitResults(items: TaxLaw[]): { citable: TaxLaw[]; contentlessRefs: TaxLaw[] } {
  const citable: TaxLaw[] = []
  const contentlessRefs: TaxLaw[] = []
  for (const item of items) {
    if (item.content.trim() !== '') {
      citable.push(item)
    } else if (item.sourceType !== '법령') {
      contentlessRefs.push(item)
    }
  }
  return { citable, contentlessRefs }
}

/**
 * 최종 참고 목록(references)을 구성한다 (TAX-015D).
 *
 * 「본문 없는 비법령 자료」 + 「검색됐지만 LLM이 인용하지 않은 본문 있는 비법령(해석례·판례)」을
 * 합쳐 검색어 관련도순(TAX-015C)으로 정렬한 뒤 상위 MAX_REFERENCES건으로 제한한다.
 *
 * - 참고 목록은 발췌(excerpt)를 만들지 않으므로 law-verifier V검증 대상이 아니다(citation 승격 금지 — TAX-015B).
 * - 인용된 자료는 식별자로 제외해 중복 노출을 막는다.
 * - 인용 안 된 자료는 LLM이 본 답변에서 제외한 것이라 ⚪참고자료 성격에 부합한다.
 *   정렬: 관련도 점수↓ → 선고일↓ → 사건번호↑ (결정론성 보장). 점수 전부 0이면 선고일순 수렴.
 */
function buildReferences(
  citable: TaxLaw[],
  contentlessRefs: TaxLaw[],
  citations: Citation[],
  keyword: string,
): TaxLaw[] {
  const citedKeys = new Set(citations.map((c) => identityKey(c.taxLaw)))
  // citable 중 인용되지 않은 비법령(해석례·판례)
  const uncitedNonLaw = citable.filter(
    (t) => t.sourceType !== '법령' && !citedKeys.has(identityKey(t)),
  )

  const terms = keyword.split(/\s+/).filter((t) => t.length >= 2)
  const all = [...contentlessRefs, ...uncitedNonLaw].sort((a, b) => {
    const byScore = relevanceScore(b, terms) - relevanceScore(a, terms)
    if (byScore !== 0) return byScore
    const byDate = (b.decisionDate ?? '').localeCompare(a.decisionDate ?? '')
    if (byDate !== 0) return byDate
    return (a.caseNumber ?? '').localeCompare(b.caseNumber ?? '')
  })

  return all.slice(0, MAX_REFERENCES)
}

// ─── TwoStageSpec 제네릭 2단계 실행기 ────────────────────────────────────────

/** verify 단계에서 두 시도 사이를 흐르는 상태 타입 */
interface VerifyState {
  answer: LabeledAnswer
  citable: TaxLaw[]
  contentlessRefs: TaxLaw[]
  verifyResult: VerificationResult
}

/**
 * 2단계 실행 스펙: 비용 없는 선처리(Stage 1) + 본격 복구(Stage 2)
 *
 * - preRetry: V5 자동 부착 등 재생성 없이 적용 가능한 수정 + 재검증.
 *             수정 불필요하면 state 그대로 반환.
 * - recover:  V1(재검색+재생성) 또는 V2~V6(재생성) 경로 + 재검증.
 *             상태를 받아 복구 후 새 상태(verifyResult 갱신 포함)를 반환.
 * - isFailure: verifyResult.status === 'FAIL' 여부 판단.
 */
interface TwoStageSpec<TState> {
  isFailure: (state: TState) => boolean
  preRetry:  (state: TState) => Promise<TState>
  recover:   (state: TState) => Promise<TState>
}

/**
 * TwoStageSpec 실행기: 최초 상태를 받아 2단계로 실행한다.
 *
 * 흐름:
 *   isFailure(initial)? NO → 즉시 반환
 *                       YES → preRetry → isFailure? NO → 반환
 *                                                   YES → recover → isFailure? NO → 반환
 *                                                                               YES → throw E-VERIFY-FAIL
 */
async function runTwoStage<TState>(
  initial: TState,
  spec: TwoStageSpec<TState>,
): Promise<TState> {
  if (!spec.isFailure(initial)) return initial

  // Stage 1: 비용 없는 선처리 (V5 자동 부착 등)
  let state = await spec.preRetry(initial)
  if (!spec.isFailure(state)) return state

  // Stage 2: 본격 복구 (V1 재검색 또는 V2~V6 재생성)
  state = await spec.recover(state)
  if (spec.isFailure(state)) {
    throw new AppError(
      'E-VERIFY-FAIL',
      '답변 검증에 실패했습니다. 해당 질문은 직접 국세청 또는 담당 세무사에게 문의해 주세요.',
    )
  }
  return state
}

// ─── Usecase ─────────────────────────────────────────────────────────────────

/**
 * RAG 5단계 오케스트레이션 Usecase (SSOT §3.3, CLAUDE.md §4)
 *
 * [1] 자연어 쿼리 변환
 * [2] 외부 API 검색
 * [3] 답변 생성 + 라벨링 + Trust Tier
 * [4] law-verifier V1~V6 검증 (M3 추가)
 * [5] 회계사 화면 출력 (API Route에서 처리)
 *
 * 재시도 정책 (PRD §13.2):
 *   V1 실패 → 재검색 1회 후 재생성·재검증
 *   V2~V6 실패 → 재생성 1회 후 재검증
 *   재시도 후에도 FAIL → E-VERIFY-FAIL throw (회계사에 노출 금지)
 *
 * fetch/HTTP 직접 호출 금지 — 모든 외부 호출은 Port 인터페이스 위임 (SSOT §3.2)
 */
export async function generateAnswer(
  queryRewriter: IQueryRewriterPort,
  searchPort: ISearchPort,
  answerGenerator: IAnswerGeneratorPort,
  verifier: ILawVerifierPort,
  question: string,
  temporal: TemporalContext,
): Promise<LabeledAnswer> {
  // [사전] PII 필터 — 감지 시 PiiDetectedError throw
  detectPii(question)

  // [1] 자연어 쿼리 변환
  const queries = await queryRewriter.rewrite(question, temporal)

  // [2] 외부 API 검색 — 첫 번째 쿼리 사용 (Phase 4에서 다중 쿼리 확장 예정)
  const searchResult = await searchPort.search(queries[0])

  // [2-a] 발췌 인용 대상(citable)과 본문 없는 참고 풀(contentlessRefs) 분리 (TAX-015B)
  //  본문 없는 판례는 발췌할 수 없으므로 LLM·검증에서 제외한다.
  //  최종 참고 목록은 답변 생성 후 buildReferences가 구성한다 (TAX-015C 정렬, TAX-015D 확장).
  const split = splitResults(searchResult.items)

  // [3] 답변 생성 + 라벨링 + Trust Tier — 본문 있는 자료(citable)만 전달
  // matchStage 전달: vector/expanded 시 어댑터가 라벨을 강제 하향 (TAX-026-G)
  const answer = await callGenerate(answerGenerator, split.citable, question, temporal, searchResult.matchStage)

  // [4] law-verifier V1~V6 검증 + 재시도 정책 (PRD §13.2, CLAUDE.md §6.4)
  //  V5 자동 부착(Stage 1) → V1/V2~V6 복구(Stage 2) → 여전히 FAIL이면 E-VERIFY-FAIL throw
  const finalState = await runTwoStage<VerifyState>(
    {
      answer,
      citable: split.citable,
      contentlessRefs: split.contentlessRefs,
      verifyResult: await verifier.verify(answer, split.citable),
    },
    {
      isFailure: (s) => s.verifyResult.status === 'FAIL',

      // Stage 1: V5 면책 고지 자동 부착 — 재생성 없이 DISCLAIMER 주입 후 재검증
      preRetry: async (s) => {
        if (s.verifyResult.checks.v5) return s
        const ans = { ...s.answer, disclaimer: DISCLAIMER }
        const vr  = await verifier.verify(ans, s.citable)
        return { ...s, answer: ans, verifyResult: vr }
      },

      // Stage 2: V1(재검색+재생성) 또는 V2~V6(재생성) 복구 후 재검증
      recover: async (s) => {
        if (!s.verifyResult.checks.v1) {
          // V1 경로: 재검색 → 재분리 → 재생성 → 재검증 (참고 풀도 갱신)
          const sr       = await searchPort.search(queries[0])
          const newSplit = splitResults(sr.items)
          const ans      = await callGenerate(answerGenerator, newSplit.citable, question, temporal, sr.matchStage)
          const vr       = await verifier.verify(ans, newSplit.citable)
          return { answer: ans, citable: newSplit.citable, contentlessRefs: newSplit.contentlessRefs, verifyResult: vr }
        }
        // V2~V6 경로: 재생성 → 재검증
        const ans = await callGenerate(answerGenerator, s.citable, question, temporal, searchResult.matchStage)
        const vr  = await verifier.verify(ans, s.citable)
        return { ...s, answer: ans, verifyResult: vr }
      },
    },
  )

  // 최종 참고 목록 구성 (TAX-015D): 본문 없는 자료 + 인용 안 된 해석례·판례, 관련도순 상위 N건
  const references = buildReferences(
    finalState.citable,
    finalState.contentlessRefs,
    finalState.answer.citations,
    queries[0].keyword,
  )
  // TAX-042D Stage 4 풀세트 보강 E·F·G — V3 라벨 적정성 진단 마커 부착.
  //   V3 PASS/FAIL 판정은 lawVerifier가 단독 수행하며, 본 호출은 운영 로그·후속 측정용
  //   진단 신호만 제공한다(CLAUDE.md §6.4 무변경 보호).
  const diagnostics = computeVerifyDiagnostics(finalState.answer)
  return { ...finalState.answer, references, verificationResult: finalState.verifyResult, diagnostics }
}
