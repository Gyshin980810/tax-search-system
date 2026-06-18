import { createHash } from 'node:crypto'
import { detectPii, maskPhoneEmail } from '../utils/piiFilter'
import { AppError } from '../domain/errors'
import { DISCLAIMER } from '../domain/disclaimer'
import { computeVerifyDiagnostics } from '../adapters/verifyDiagnostics'
import { extractTerms, scoreRelevance, cosineSimilarity, combinedScore } from '../domain/nonLawRelevance'
import type { IQueryRewriterPort } from '../ports/llmQueryRewriterPort'
import type { ISearchPort } from '../ports/taxLawSearchPort'
import type { IAnswerGeneratorPort } from '../ports/llmAnswerGeneratorPort'
import type { ILawVerifierPort } from '../ports/lawVerifierPort'
import type { IEmbeddingPort } from '../ports/embeddingPort'
import type { IVectorSearchPort } from '../ports/vectorSearchPort'
import type { IOpsLogPort, OpsQueryLogEntry } from '../ports/opsLogPort'
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
 * 참고 목록 노출 최소 관련도 (TAX-6B-10, 회계사 결정 2026-06-17 — 엄격 컷오프).
 * 점수가 이 값 미만(=검색어가 사건명·본문 어디에도 없음)인 자료는 참고 목록에서 제외한다.
 * 검색된 비법령 자료가 전부 무관하면 참고 목록은 빈 배열이 된다("무관한 건 빼라").
 */
const MIN_RELEVANCE_SCORE = 1

/**
 * 의미(벡터) 재정렬 시 임베딩 대상 상한 (TAX-6B-12).
 * 후보가 이보다 많으면 글자 점수 상위 N건만 임베딩해 P95·비용을 보호한다.
 * 비법령 참고 후보는 보통 이 수 이내라 일반적으로는 전부 임베딩된다(안전장치).
 */
const SEMANTIC_RERANK_LIMIT = 20

/**
 * 판례 코퍼스(pgvector) 라이브 배선 상수 (TAX-6B-14).
 * pgvector에 적재된 대법원 판례(T4)를 질문 의미검색으로 참고 목록에 합류시킬 때의 보수적 게이트.
 *  - PRECEDENT_TOP_K: 벡터DB에서 일단 끌어올 판례 후보 수.
 *  - PRECEDENT_MIN_SIMILARITY: 이 cosine 유사도 미만은 무관으로 보고 제외(보수적 바닥).
 *  - PRECEDENT_MAX: 게이트 통과분 중 최종 노출 상한(노이즈 위험을 소수로 가둠).
 * PoC(TAX-6B-13) 실측 기준 초기값이며, 노이즈(0.42)·진짜이득(0.38) 역전 사례가 있어
 * 바닥만으로 완전 분리는 불가 → 상한 소수 + ⚪T4 라벨로 위험을 제한한다.
 */
const PRECEDENT_TOP_K = 5
const PRECEDENT_MIN_SIMILARITY = 0.5
const PRECEDENT_MAX = 2

/**
 * 참고자료(TaxLaw)의 관련도 점수 — 사건명·명칭(제목)과 본문(content)을 함께 평가한다 (TAX-015C → TAX-6B-10).
 * 점수 산정 본체는 domain/nonLawRelevance(scoreRelevance)에 있고, 여기선 TaxLaw 필드를 매핑만 한다.
 * (어댑터의 본문 조회 선별과 동일 기준을 쓰기 위해 domain으로 추출 — TAX-6B-11)
 */
function relevanceScore(ref: TaxLaw, terms: string[]): number {
  return scoreRelevance(`${ref.articleTitle} ${ref.lawName}`, ref.content, terms)
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
 *   정렬: 관련도 점수↓ → 선고일↓ → 사건번호↑ (결정론성 보장).
 * - TAX-6B-10: 관련도 MIN_RELEVANCE_SCORE 미만(무관) 자료는 컷오프. 전부 무관하면 빈 배열.
 */
async function buildReferences(
  citable: TaxLaw[],
  contentlessRefs: TaxLaw[],
  citations: Citation[],
  keyword: string,
  question: string,
  embeddingPort?: IEmbeddingPort,
  vectorSearchPort?: IVectorSearchPort,
): Promise<TaxLaw[]> {
  const citedKeys = new Set(citations.map((c) => identityKey(c.taxLaw)))
  // citable 중 인용되지 않은 비법령(해석례·판례)
  const uncitedNonLaw = citable.filter(
    (t) => t.sourceType !== '법령' && !citedKeys.has(identityKey(t)),
  )

  const terms = extractTerms(keyword)
  const candidates = [...contentlessRefs, ...uncitedNonLaw]

  // [1] 글자(부분문자열) 점수를 1회 계산한다.
  const textScored = candidates.map((ref) => ({ ref, textScore: relevanceScore(ref, terms) }))

  // [2] 의미(벡터) 유사도로 보강한다 (TAX-6B-12 방향 C).
  //  embeddingPort 미주입/실패 시 글자 점수만 사용(graceful degrade).
  //  ⚠️ 컷오프는 의미 점수 산정 *후* 적용한다 — 글자 0점이어도 의미가 가까운 자료(표기변이)를 살리기 위함.
  //  질문 벡터(queryVec)는 [4] 판례 라이브 검색과 공유한다 — 추가 임베딩 콜 0 (TAX-6B-14, P95 보호).
  const { queryVec, scored } = await applySemanticScores(textScored, question, embeddingPort)

  // [3] 외부 API 후보 컷오프 (TAX-6B-10 엄격 컷오프).
  //  관련도 MIN_RELEVANCE_SCORE 미만(무관) 자료는 제외. 전부 무관하면 외부 후보는 비게 된다.
  const externalFiltered = scored.filter((s) => s.score >= MIN_RELEVANCE_SCORE)

  // [4] 판례 코퍼스(pgvector) 라이브 검색 (TAX-6B-14).
  //  같은 질문 벡터로 판례만 의미검색 → 보수적 게이트(유사도 바닥 + 상위 N건) 통과분만.
  //  이미 외부 후보·인용에 있는 사건번호는 제외해 중복 노출을 막는다.
  const excludeKeys = new Set([...citedKeys, ...externalFiltered.map((s) => identityKey(s.ref))])
  const precedentScored = await fetchPrecedentReferences(queryVec, vectorSearchPort, excludeKeys)

  // [5] 병합 → 정렬 → 상한.
  const merged = [...externalFiltered, ...precedentScored].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    const byDate = (b.ref.decisionDate ?? '').localeCompare(a.ref.decisionDate ?? '')
    if (byDate !== 0) return byDate
    return (a.ref.caseNumber ?? '').localeCompare(b.ref.caseNumber ?? '')
  })

  return merged.slice(0, MAX_REFERENCES).map((s) => s.ref)
}

/**
 * 판례 코퍼스(pgvector)에서 질문과 의미가 가까운 판례를 가져온다 (TAX-6B-14 라이브 배선).
 *
 * - queryVec(질문 벡터)는 의미 재정렬에서 이미 만든 것을 재사용한다 — 추가 임베딩 콜 0.
 * - 보수적 2단 게이트: 유사도 PRECEDENT_MIN_SIMILARITY 이상만 남기고 → 상위 PRECEDENT_MAX건.
 * - 이미 노출 예정인 자료(excludeKeys)는 사건번호로 중복 제거.
 * - vectorSearchPort/queryVec 미주입 또는 검색 실패 시 빈 배열(graceful degrade) — 기존 동작 회귀 없음.
 * - 판례는 ⚪T4 참고자료로만 노출되며 발췌(excerpt) 인용으로 승격되지 않는다(§6.4 V검증 비대상).
 *   점수는 외부 후보와 같은 척도로 정렬하기 위해 combinedScore(글자 0, 유사도)로 환산한다.
 */
async function fetchPrecedentReferences(
  queryVec: number[] | undefined,
  vectorSearchPort: IVectorSearchPort | undefined,
  excludeKeys: Set<string>,
): Promise<{ ref: TaxLaw; score: number }[]> {
  if (!vectorSearchPort || !queryVec) return []
  try {
    const matches = await vectorSearchPort.searchSimilar(queryVec, PRECEDENT_TOP_K, '판례')
    return matches
      .filter((m) => m.similarity >= PRECEDENT_MIN_SIMILARITY && !excludeKeys.has(identityKey(m.item)))
      .slice(0, PRECEDENT_MAX)
      .map((m) => ({ ref: m.item, score: combinedScore(0, m.similarity) }))
  } catch {
    // 벡터 검색 실패 — 판례 경로만 조용히 건너뛴다. 외부 API 참고 목록은 그대로 구성된다.
    return []
  }
}

/** 의미 임베딩 입력 텍스트 — 사건명·명칭 + 본문(없으면 사건명만). 원문 읽기만(§6.1). */
function semanticText(ref: TaxLaw): string {
  return `${ref.articleTitle} ${ref.lawName} ${ref.content}`.trim()
}

/**
 * 글자 점수 후보에 의미(벡터) 유사도를 가중합한다 (TAX-6B-12 방향 C).
 *
 * - embeddingPort 미주입(로컬·테스트·DB 미설정)이면 글자 점수를 그대로 사용한다.
 * - 임베딩 호출 실패 시에도 글자 점수로 자동 복귀한다(graceful degrade) — 참고 목록이 빈손이 되지 않게.
 * - P95 보호: 임베딩 대상은 SEMANTIC_RERANK_LIMIT건으로 제한하고, [질의, 후보…]를 배치 1콜로 임베딩한다.
 * - 반환의 queryVec(질문 벡터)는 판례 라이브 검색(TAX-6B-14)이 재사용한다 — 임베딩 콜 1회로 공유.
 *   후보가 없어도(textScored 빈 배열) embeddingPort가 있으면 질문만 임베딩해 queryVec을 만든다.
 */
async function applySemanticScores(
  textScored: { ref: TaxLaw; textScore: number }[],
  question: string,
  embeddingPort?: IEmbeddingPort,
): Promise<{ queryVec: number[] | undefined; scored: { ref: TaxLaw; score: number }[] }> {
  const textOnly = () => textScored.map((s) => ({ ref: s.ref, score: s.textScore }))

  // 의미검색 비활성: 글자 점수를 그대로 사용 (queryVec 없음)
  if (!embeddingPort) {
    return { queryVec: undefined, scored: textOnly() }
  }

  // 후보가 상한을 넘으면 글자 점수 상위만 임베딩한다(드문 케이스 — P95 우선).
  const targets =
    textScored.length <= SEMANTIC_RERANK_LIMIT
      ? textScored
      : [...textScored].sort((a, b) => b.textScore - a.textScore).slice(0, SEMANTIC_RERANK_LIMIT)
  const targetSet = new Set(targets.map((t) => t.ref))

  try {
    // [질의, 후보1, 후보2, …] 배치 임베딩 — 외부 API 왕복 1회 (후보 0건이면 질의만)
    const [queryVec, ...refVecs] = await embeddingPort.embedBatch([
      question,
      ...targets.map((t) => semanticText(t.ref)),
    ])

    const cosineByRef = new Map<TaxLaw, number>()
    targets.forEach((t, i) => {
      cosineByRef.set(t.ref, cosineSimilarity(queryVec, refVecs[i]))
    })

    const scored = textScored.map((s) => {
      // 임베딩 대상이 아니면(상한 초과분) 의미 점수 없이 글자 점수만
      const cosine = targetSet.has(s.ref) ? (cosineByRef.get(s.ref) ?? 0) : 0
      return { ref: s.ref, score: combinedScore(s.textScore, cosine) }
    })
    return { queryVec, scored }
  } catch {
    // 임베딩 실패 — 글자 점수로 복귀(부가 기능 저하 < 빈손). 핵심 파이프라인은 영향 없음.
    return { queryVec: undefined, scored: textOnly() }
  }
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

// ─── 운영 로그 헬퍼 (TAX-030-A, FR-23) ──────────────────────────────────────

/** 원본 질문의 SHA-256 해시 앞 16자 — 중복 패턴 집계용(고유키 아님, CLAUDE.md §7) */
function hashQuery(question: string): string {
  return createHash('sha256').update(question).digest('hex').slice(0, 16)
}

/** 자료 목록에서 출처 유형을 중복 제거해 추출 — ['법령','심판례'] 등 */
function uniqueSourceTypes(items: TaxLaw[]): string[] {
  return [...new Set(items.map((t) => t.sourceType))]
}

/** 검증 결과에서 실패(false)한 항목 키만 추출 — ['v2','v3'] 등 */
function failedChecksOf(result: VerificationResult): string[] {
  const checks = result.checks
  return (Object.keys(checks) as Array<keyof typeof checks>).filter((k) => !checks[k])
}

/**
 * 운영 로그를 fail-soft로 기록한다 (TAX-030-A).
 *
 * - opsLog 미주입(undefined) 시 무동작 — 하위 호환.
 * - 적재 실패(DB 장애 등)는 내부에서 삼켜 답변 생성을 막지 않는다(fail-soft, CLAUDE.md §7.8).
 */
async function safeRecord(opsLog: IOpsLogPort | undefined, entry: OpsQueryLogEntry): Promise<void> {
  if (!opsLog) return
  try {
    await opsLog.recordQuery(entry)
  } catch {
    // fail-soft: 로그 적재 실패가 회계사 답변 생성을 막지 않는다
  }
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
  opsLog?: IOpsLogPort,
  embeddingPort?: IEmbeddingPort,
  vectorSearchPort?: IVectorSearchPort,
): Promise<LabeledAnswer> {
  // [사전] PII 필터 — 감지 시 PiiDetectedError throw (운영 로그에 도달하지 않음)
  detectPii(question)

  // 운영 로그 메타데이터 준비 (TAX-030-A) — 식별자 없는 마스킹 질문·해시·소요시간만 수집
  const startedAt = Date.now()
  const queryNorm = maskPhoneEmail(question)   // 휴대폰·이메일 마스킹 후 저장 (CLAUDE.md §7)
  const queryHash = hashQuery(question)
  let matchStage: MatchStage | undefined
  let sourceTypes: string[] = []
  // runTwoStage가 throw하면 finalState를 못 받으므로, isFailure 클로저로 마지막 검증 결과를 캡처한다.
  let lastVerifyResult: VerificationResult | undefined

  try {
    // [1] 자연어 쿼리 변환
    const queries = await queryRewriter.rewrite(question, temporal)

    // [2] 외부 API 검색 — 첫 번째 쿼리 사용 (Phase 4에서 다중 쿼리 확장 예정)
    const searchResult = await searchPort.search(queries[0])
    matchStage = searchResult.matchStage

    // [2-a] 발췌 인용 대상(citable)과 본문 없는 참고 풀(contentlessRefs) 분리 (TAX-015B)
    //  본문 없는 판례는 발췌할 수 없으므로 LLM·검증에서 제외한다.
    //  최종 참고 목록은 답변 생성 후 buildReferences가 구성한다 (TAX-015C 정렬, TAX-015D 확장).
    const split = splitResults(searchResult.items)
    sourceTypes = uniqueSourceTypes(split.citable)

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
        isFailure: (s) => {
          // 운영 로그용: throw 직전 마지막 검증 결과를 캡처 (검증 판정 로직 무변경)
          lastVerifyResult = s.verifyResult
          return s.verifyResult.status === 'FAIL'
        },

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
    const references = await buildReferences(
      finalState.citable,
      finalState.contentlessRefs,
      finalState.answer.citations,
      queries[0].keyword,
      question,
      embeddingPort,
      vectorSearchPort,
    )
    // TAX-042D Stage 4 풀세트 보강 E·F·G — V3 라벨 적정성 진단 마커 부착.
    //   V3 PASS/FAIL 판정은 lawVerifier가 단독 수행하며, 본 호출은 운영 로그·후속 측정용
    //   진단 신호만 제공한다(CLAUDE.md §6.4 무변경 보호).
    const diagnostics = computeVerifyDiagnostics(finalState.answer)

    // [운영 로그] 성공 경로 기록 (TAX-030-A) — V1 재검색 시 갱신될 수 있어 finalState 기준
    await safeRecord(opsLog, {
      queryNorm,
      queryHash,
      matchStage,
      sourceTypes: uniqueSourceTypes(finalState.citable),
      verifyStatus: 'PASS',
      failedChecks: [],
      latencyMs: Date.now() - startedAt,
    })

    return { ...finalState.answer, references, verificationResult: finalState.verifyResult, diagnostics }
  } catch (err) {
    // [운영 로그] E-VERIFY-FAIL 경로도 기록한 뒤 그대로 전파 (TAX-030-A, fail-soft)
    if (err instanceof AppError && err.code === 'E-VERIFY-FAIL') {
      await safeRecord(opsLog, {
        queryNorm,
        queryHash,
        matchStage,
        sourceTypes,
        verifyStatus: 'FAIL',
        failedChecks: lastVerifyResult ? failedChecksOf(lastVerifyResult) : [],
        latencyMs: Date.now() - startedAt,
      })
    }
    throw err
  }
}
