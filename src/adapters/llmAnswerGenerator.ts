import 'server-only'
import { generateObject, APICallError, NoObjectGeneratedError } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'
import { config } from '../config'
import type { IAnswerGeneratorPort } from '../ports/llmAnswerGeneratorPort'
import type { TaxLaw } from '../domain/TaxLaw'
import type { LabeledAnswer } from '../domain/LabeledAnswer'
import type { TemporalContext } from '../domain/TemporalContext'
import type { Citation } from '../domain/Citation'
import type { CitationLabel } from '../domain/Citation'
import type { MatchStage } from '../domain/SearchResult'
import { pendingVerification } from '../domain/VerificationResult'
import { DISCLAIMER } from '../domain/disclaimer'
import {
  LlmTimeoutError,
  LlmUnavailableError,
  LlmSchemaValidationError,
  LlmNetworkError,
  LlmRateLimitError,
  LlmEmptyResponseError,
} from '../domain/errors'
import { truncateForContext } from './contextBudget'
import {
  detectEmptyResponse,
  getRetryDelay,
  isTransientNetworkError,
  parseRetryAfter,
} from './llmRetryPolicy'

/**
 * LLM API 응답 타임아웃 (25초)
 *
 * PRD §7.1 누적 P95 < 15초·PRD §13 E-LLM-TIMEOUT 30초와 정합.
 * 25초 = (P95 합격선 15s) + 안전 마진 10s, PRD §13 한도 내.
 * TAX-029 측정에서 10초 박힘이 90% 실패를 유발해 TAX-040으로 상향.
 */
const LLM_TIMEOUT_MS = 25_000

/**
 * TAX-041 옵션 A — SYSTEM_PROMPT 단순화
 *
 * LLM이 excerpt를 직접 작성하지 않고 focusHint로 위치만 가리킨다.
 * excerpt는 어댑터가 content에서 정확한 substring으로 추출한다(extractExcerpt).
 * 이렇게 하면 GPT-4o-mini가 원문을 글자 단위로 복사하지 못해 V2가 실패하는 문제(80%+)를 차단한다.
 */
const SYSTEM_PROMPT = `당신은 대한민국 세법 전문 검색 어시스턴트입니다.
회계사의 질문에 대해 아래 제공된 법령 조문만을 근거로 답변을 생성합니다.

[출력 규칙]
각 citation은 다음 4개 필드만 정합니다. 발췌문(excerpt)은 어댑터가 자동으로 추출하므로 직접 작성하지 않습니다.
- lawIndex: 조문 목록의 [N] 인덱스
- label: 라벨(🟢직접근거 / 🟡유사사례 / ⚪참고자료 / ⚫폐지)
- focusHint: 강조하고 싶은 부분의 핵심 키워드 또는 시작 어절 5~20자.
             content 안에 실제로 등장하는 표현을 그대로 짧게 옮겨 적습니다.
             설명·해설·"~조에 따르면"·"에서는"·꺽쇠 따옴표 같은 표현을 추가하지 않습니다.
- temporalLabel: 시점 라벨(아래 규칙 참조)

[citations 선정 규칙 — TAX-042B]
- citations 배열은 최대 5개까지. 조문 목록이 5개를 초과하면, 회계사 질문과 가장 직접
  관련된 5개만 선정합니다.
- 선정 우선순위: (1) T1·T2 출처 > (2) 질문 키워드와 직접 매칭되는 조문 > (3) 시행령·시행규칙 본문 > (4) 그 외

[중략 마커 처리 규칙 — TAX-042F]
- 조문 본문에 "⋯ 중략 N자 ⋯" 마커가 있으면 해당 부분은 보이지 않는 상태입니다. 그
  마커 부분에 답이 있을 것으로 보이면 해당 조문을 citations에서 제외하고, summary에서
  "본 조문은 본문 일부가 생략되어 직접 인용을 제시할 수 없습니다"를 명시합니다.
- 보이는 부분(head·tail)으로 명확히 답할 수 있으면 정상적으로 citations에 포함하되,
  focusHint는 반드시 마커 바깥 텍스트에서 골라야 합니다.

[라벨링 규칙 — 조문 목록의 Trust Tier 기준 엄수]
조문 목록에 표시된 (T1)·(T2)·(T3)·(T4)를 보고 라벨을 결정합니다:
- 🟢직접근거: (T1)(법률·시행령·규칙) 또는 (T2)(부칙·경과조치) 출처만 허용. 단정형 표현 허용.
- 🟡유사사례: (T3)(예규·훈령·고시·심판례·해석례) 또는 (T4)(판례)는 반드시 이 라벨 이하.
  summary에서도 "유사 사례에서는 ..." 형태로만 기술. "이 케이스도 X입니다" 같은 단정형 금지.
- ⚪참고자료: 관련 쟁점만 다루는 경우.
- ⚫폐지: 폐지·삭제된 조문.

⚠️ (T3) 또는 (T4) 출처에 🟢직접근거 라벨을 붙이면 검증이 FAIL됩니다.

[라벨 결정 표 — Tier × 사안 적용 정도 (TAX-042D Stage 4 — V3 정확성 강화)]
| 출처 Tier               | 질문 사안에 직접 적용 | 유사 사안·간접 적용 | 관련 쟁점만 다룸 | 폐지·삭제 조문 |
|-------------------------|------------------------|----------------------|------------------|----------------|
| T1·T2 (법령·시행령·부칙)| 🟢직접근거             | 🟢직접근거           | 🟢직접근거       | ⚫폐지         |
| T3 (예규·심판례·해석례) | 🟡유사사례             | 🟡유사사례           | ⚪참고자료       | ⚫폐지         |
| T4 (판례)               | 🟡유사사례             | 🟡유사사례           | ⚪참고자료       | ⚫폐지         |

⚠️ 라벨 결정 시 절대 금지 (V3 FAIL 직결):
- (T3)·(T4) 출처 → 🟢직접근거 금지 (위험 방향, 회계사가 판례를 법령처럼 인용해 가산세 위험).
  반드시 🟡유사사례 또는 ⚪참고자료 중 선택하고 summary에서도 "유사 사례에서는 …" 표현 유지.
- (T1)·(T2) 출처 → ⚪참고자료로 후퇴 금지 (안전 방향이지만 직접 근거 누락 → 회계사가 조문 못 봄).
  반드시 🟢직접근거를 우선 사용.

[라벨 결정 체크리스트 — TAX-048·TAX-051 (citation 생성 직전 반드시 수행)]

Step 1: 현재 citation의 출처 Tier가 (T1) 또는 (T2)인가?
  → YES: 🟢직접근거 / 🟡유사사례 / ⚪참고자료 / ⚫폐지 중 선택 (사안 적용 정도 기반)
  → NO (T3 또는 T4): Step 2로 이동

Step 2: 출처 Tier가 (T3) 또는 (T4)이다.
  → 🟢직접근거 절대 금지 (예외 없음, 회계사 보호 의무)
  → 허용 라벨: 🟡유사사례 / ⚪참고자료 / ⚫폐지 중 선택만 가능

⚠️ 자주 발생하는 실수 (TAX-051 — V3 FAIL 직결):
- 실수: "T1·T2가 없으니 T3에 🟢직접근거 부여" → V3 FAIL, E-VERIFY-FAIL 위험
- 실수: "심판례가 사안에 정확히 일치하니 🟢" → V3 FAIL, 판례·예규·심판례는 무조건 🟡 이하
- 실수: "예규가 법령 해석을 명확히 제시하니 🟢" → V3 FAIL, 예규는 법령이 아님
- 올바른 처리: 검색결과 전체가 T3·T4만 있어도 모든 라벨은 🟡 또는 ⚪로 한정
  + summary 첫 문장에 "직접 근거(법령 본문)를 찾지 못했습니다." 명시

[T1·T2 부재 시 동작 규칙 — TAX-048]
검색된 조문 목록 전체가 (T3) 또는 (T4)만 있고 (T1)·(T2)가 하나도 없는 경우:
- 모든 citations 라벨은 🟡유사사례 또는 ⚪참고자료만 사용 (위 Step 2 적용).
- summary 첫 문장에 "직접 근거(법령 본문)를 찾지 못했습니다." 를 반드시 명시.
- 단정형 표현 금지. "유사 사례에서는 …" / "참고가 될 수 있는 자료" 형태만 사용.
- 회계사가 T3·T4 자료를 법령처럼 인용해 가산세 위험에 노출되지 않도록 보호하는 게 시스템 의무입니다.

[시점 라벨 규칙 — CLAUDE.md §6.2 / TAX-037·TAX-038·TAX-050]

[법령(sourceType='법령')의 temporalLabel 결정 트리]
1순위: 회계사가 시점을 명시하지 않았고 제공된 법령이 현행이면 → "[현행]"
       (대부분의 경우 이 옵션을 택합니다. 법령 시행일은 본문 인용에서 다루세요.)
2순위: 회계사가 과거 특정 시점(예: "2020년 기준")을 명시했고
       시작일·종료일을 모두 특정할 수 있으면
       → "[적용 시점: YYYY.MM.DD~YYYY.MM.DD]" (양쪽 날짜 8자리 필수, ~ 양옆 공백 없음)
3순위: 조문이 폐지·삭제된 경우 → "[폐지: YYYY.MM.DD]"

[금지 — 자주 발생하는 실수 (TAX-050)]
- 금지: "[적용 시점: 2025.10.01]" (종료일 없는 단일 일자)
- 금지: "[적용 시점: 2025.10.01~]" (~ 뒤 비움)
- 종료일을 특정할 수 없으면 "[현행]"으로 폴백하세요.

[비법령(sourceType='판례'|'해석례'|'심판례')의 temporalLabel]
- "[결정: YYYY.MM.DD]" — 제공된 '결정일'을 그대로 사용. 결정일이 '불명'이면 "[현행]" 허용.

[summary 규칙]
- 🟡유사사례에서 단정형 표현 금지. "직접 적용되는 조문을 찾지 못했습니다" 명시 가능.
- 검색 결과가 없으면 "직접 근거를 찾지 못했습니다. 유사 사례 또는 참고 자료를 확인해 주세요." 로 작성.

[질문 전제 검증 규칙 — TAX-6A-8]
질문에 "~라는 조항이 있나요?", "~하면 면제된다는 규정이 있나요?" 등 사실 주장이 전제로 포함된 경우:
1. 제공된 조문에서 그 전제를 직접 뒷받침하는 근거를 찾아라.
2. 근거가 없으면 summary 첫 문장에 반드시 "질문에서 언급한 [전제 내용]에 해당하는 조항을 찾지 못했습니다."를 명시하라.
3. 유사 제도(간이과세·가업상속공제 등)가 있더라도, 전제(전액 면세·전액 면제·비과세 등)와 내용이 다르면 그 차이를 명확히 서술할 것.
4. 직접 근거 없이 질문의 전제를 사실처럼 되풀이하거나, "~받을 수 있습니다" 등으로 가능성을 시사하지 말 것.`

export const citationItemSchema = z.object({
  lawIndex: z.number().int().min(0),
  label: z.enum(['🟢직접근거', '🟡유사사례', '⚪참고자료', '⚫폐지']),
  focusHint: z.string(),
  temporalLabel: z.string(),
})

export const answerSchema = z.object({
  citations: z.array(citationItemSchema).max(5),
  summary: z.string(),
  temporalLabel: z.string(),
})

/**
 * 조문 배열을 시스템 프롬프트에 삽입할 텍스트로 변환
 *
 * TAX-038: 비법령(판례·해석례·심판례)일 때만 sourceType·결정일을 LLM에 명시 노출한다.
 * 법령(sourceType='법령')은 기존 출력 형식을 byte-level 동일하게 유지(회귀 방지).
 * LLM이 sourceType을 보고 [결정: YYYY.MM.DD] vs [현행] 분기를 정확히 선택할 수 있게 한다.
 */
function buildLawsContext(laws: TaxLaw[]): string {
  if (laws.length === 0) return '[검색된 법령 없음]'
  return laws.map((law, idx) => {
    const nonlawMeta =
      law.sourceType !== '법령'
        ? `\nsourceType: ${law.sourceType}\n결정일: ${law.decisionDate ?? '불명'}`
        : ''
    return `[${idx}] ${law.lawName} ${law.articleNumber} (${law.trustTier})${nonlawMeta}\n시행일: ${law.enforcementDate}\n원문:\n${law.content}`
  }).join('\n\n---\n\n')
}

/**
 * TAX-041 옵션 A — content에서 focusHint가 가리키는 정확한 substring을 추출
 *
 * LLM이 excerpt를 직접 작성하지 않고 focusHint(짧은 키워드)로 위치만 가리킨다.
 * 모든 결과는 trimmedContent의 정확한 substring(slice)이므로 V2 100% 보장.
 *
 * 추출 우선순위:
 *   1) focusHint가 content에 정확히 들어있으면, 그 위치를 포함하는 완전 문장 추출
 *   2) focusHint를 단어 단위로 쪼개 가장 많이 매칭되는 문장(인덱스 기반) 추출
 *   3) fallback: content의 첫 문장
 *
 * 5차 진단 발견(2026-06-05): 문자열 split·join 방식은 날짜 표기(예: "x. x. 까지")에서
 * 공백 패턴을 변형해 substring을 깨뜨림. 모든 분할을 인덱스 배열로만 처리하고
 * 결과는 trimmedContent.slice(start, end)로 반환해 substring 안전망을 강제한다.
 */
export function extractExcerpt(content: string, focusHint: string): string {
  const trimmedContent = content.trim()
  if (trimmedContent.length === 0) return ''

  const hint = focusHint.trim()

  // 1) focusHint 정확 매칭 — 포함 위치 주변 문장 경계 확장 (slice는 substring 보장)
  if (hint.length > 0 && trimmedContent.includes(hint)) {
    const idx = trimmedContent.indexOf(hint)
    const start = findSentenceStart(trimmedContent, idx)
    const end = findSentenceEnd(trimmedContent, idx + hint.length)
    const sentence = trimmedContent.slice(start, end)
    if (sentence.trim().length > 0) return sentence
  }

  const boundaries = findSentenceBoundaries(trimmedContent)

  // 2) 토큰 매칭 — 인덱스 기반 slice (V2 substring 보장)
  if (hint.length > 0 && boundaries.length >= 2) {
    const tokens = hint.split(/\s+/).filter((t) => t.length >= 2)
    if (tokens.length > 0) {
      let bestIdx = -1
      let bestScore = 0
      for (let i = 0; i < boundaries.length - 1; i++) {
        const sentence = trimmedContent.slice(boundaries[i], boundaries[i + 1])
        const score = tokens.filter((t) => sentence.includes(t)).length
        if (score > bestScore) {
          bestScore = score
          bestIdx = i
        }
      }
      if (bestIdx >= 0) {
        return trimmedContent.slice(boundaries[bestIdx], boundaries[bestIdx + 1])
      }
    }
  }

  // 3) fallback: 첫 문장
  if (boundaries.length >= 2) {
    return trimmedContent.slice(boundaries[0], boundaries[1])
  }
  return trimmedContent.slice(0, Math.min(200, trimmedContent.length))
}

/**
 * 문장 경계 인덱스 배열 반환.
 *
 * 결과: [start_0, start_1, ..., text.length]
 * 각 (boundaries[i], boundaries[i+1])이 한 문장 구간 — slice 시 substring 보장.
 *
 * 마침표(.) · 물음표(?) · 느낌표(!) · 한글 마침표(。) · 줄바꿈 다음을 경계로 잡되,
 * 너무 짧은 구간(<15자)은 다음 경계와 결합해 의미 단위로 묶는다.
 */
function findSentenceBoundaries(text: string): number[] {
  const raw: number[] = [0]
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\n' || ch === '.' || ch === '?' || ch === '!' || ch === '。') {
      raw.push(i + 1)
    }
  }
  if (raw[raw.length - 1] !== text.length) {
    raw.push(text.length)
  }

  // 너무 짧은 구간(<15자)은 다음 경계와 결합
  const merged: number[] = [raw[0]]
  for (let i = 1; i < raw.length; i++) {
    const lastStart = merged[merged.length - 1]
    const candidateEnd = raw[i]
    if (candidateEnd - lastStart < 15 && i < raw.length - 1) {
      continue
    }
    merged.push(candidateEnd)
  }
  return merged
}

function findSentenceStart(text: string, idx: number): number {
  for (let i = idx - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch === '\n' || ch === '.' || ch === '?' || ch === '!' || ch === '。') {
      return i + 1
    }
  }
  return 0
}

function findSentenceEnd(text: string, idx: number): number {
  for (let i = idx; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\n' || ch === '.' || ch === '?' || ch === '!' || ch === '。') {
      return i + 1
    }
  }
  return text.length
}

/**
 * Node 네트워크 레벨 에러 판정 (TAX-042A 진단 인프라).
 *
 * Vercel AI SDK가 wrap하지 않은 raw fetch/undici 에러를 식별한다.
 * APICallError로 분류되지 못한 ECONNRESET·ENOTFOUND 등이 여기서 잡힌다.
 */
function isNetworkLikeError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const code = (err as NodeJS.ErrnoException).code
  if (code && ['ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN'].includes(code)) {
    return true
  }
  return /fetch failed|network|socket hang up/i.test(err.message)
}

/**
 * TAX-042C — LLM 호출 재시도 wrapper.
 *
 * 흐름:
 *   1) callOnce() 1차 호출
 *   2) transient 네트워크/Rate Limit 오류면 jitter backoff(또는 Retry-After 헤더) 후 1회 재시도
 *   3) 정상 결과지만 빈/잘린 응답이면 jitter backoff 후 1회 재시도, 그래도 빈 응답이면 LlmEmptyResponseError
 *
 * 안전 장치:
 *   - 최대 호출 횟수 2회 (네트워크 분기) + 1회 (빈 응답 분기) 합 3회 상한 → 무한 루프 방지
 *   - controller.signal.aborted 시 재시도 안 함 (LLM_TIMEOUT_MS 25s 보호)
 *   - Zod·Timeout·non-transient는 isTransientNetworkError가 false → 즉시 throw
 *
 * korean-law-mcp fetch-with-retry.ts 인사이트 적응:
 *   - getRetryDelay(500): 500~750ms jitter (썬더링 허드 방지)
 *   - parseRetryAfter(err): OpenAI 429 Retry-After 헤더 존중 (10초 상한 클램프)
 *   - detectEmptyResponse(obj): citations=0 AND summary 공백 → transient로 재시도
 */
async function performWithRetry(
  callOnce: () => Promise<{ object: z.infer<typeof answerSchema> }>,
  controller: AbortController,
): Promise<{ object: z.infer<typeof answerSchema> }> {
  let result: { object: z.infer<typeof answerSchema> }
  try {
    result = await callOnce()
  } catch (firstErr) {
    if (!isTransientNetworkError(firstErr) || controller.signal.aborted) {
      throw firstErr
    }
    // 보강 D: 429 Retry-After 헤더 우선, 없으면 보강 B jitter backoff (500~750ms)
    const retryAfterMs = parseRetryAfter(firstErr)
    const waitMs = retryAfterMs ?? getRetryDelay(500)
    await new Promise((r) => setTimeout(r, waitMs))
    result = await callOnce()
  }

  // 보강 A: 빈/잘린 응답이면 transient로 간주해 추가 1회 재시도
  if (detectEmptyResponse(result.object)) {
    await new Promise((r) => setTimeout(r, getRetryDelay(500)))
    result = await callOnce()
    if (detectEmptyResponse(result.object)) {
      throw new LlmEmptyResponseError()
    }
  }
  return result
}

/**
 * TAX-051: V3 라벨 안전망 — T3·T4 출처에 🟢직접근거가 잘못 부여된 경우 강제 다운그레이드.
 *
 * 배경: TAX-029 P95 재측정(2026-06-09)에서 V3 실패 6건(6.1%) 발생.
 *       SYSTEM_PROMPT [라벨 결정 표]·[T1·T2 부재 규칙]이 명시되어 있음에도
 *       GPT-4o-mini가 약 6% 확률로 두 규칙을 모두 무시 → LLM 비결정성.
 *
 * 동작:
 *   1) T3·T4 citation에 🟢직접근거가 부여됐다면 🟡유사사례로 다운그레이드
 *   2) T1·T2가 하나도 없고 다운그레이드가 발생했다면 summary 첫 문장에
 *      "직접 근거(법령 본문)를 찾지 못했습니다." 자동 보정 (TAX-048 정합)
 *   3) T1·T2가 섞여 있으면 summary는 무변경 (이미 직접 근거가 다뤄지므로)
 *
 * 회계사 보호 목적: T3·T4(예규·심판례·판례)를 법령처럼 인용해 의뢰인 보고서에
 * 직접 적용하면 가산세·법적 분쟁 위험 (CLAUDE.md §6.3).
 */
export function downgradeT3T4DirectCitations(
  citations: Citation[],
  summary: string,
): { citations: Citation[]; summary: string; downgradedCount: number } {
  let downgradedCount = 0
  const fixedCitations = citations.map((c) => {
    const tier = c.taxLaw.trustTier
    if ((tier === 'T3' || tier === 'T4') && c.label === '🟢직접근거') {
      downgradedCount += 1
      return { ...c, label: '🟡유사사례' as CitationLabel }
    }
    return c
  })

  const hasAnyT1T2 = fixedCitations.some(
    (c) => c.taxLaw.trustTier === 'T1' || c.taxLaw.trustTier === 'T2',
  )
  let fixedSummary = summary
  if (downgradedCount > 0 && !hasAnyT1T2) {
    const prefix = '직접 근거(법령 본문)를 찾지 못했습니다.'
    if (!summary.startsWith(prefix)) {
      fixedSummary = `${prefix} ${summary}`
    }
  }

  return { citations: fixedCitations, summary: fixedSummary, downgradedCount }
}

/**
 * TAX-6A-10 (1b): V3 라벨 안전망 양방향 보강 — T1·T2 과소부착 라벨 🟢 승격.
 *
 * 배경: TAX-6A-10 진단(2026-06-15)에서 LLM이 T1 법령 본문을 🟡유사사례로 과도
 *       하향하는 V3 실패(G3-05)를 발견. 기존 downgradeT3T4DirectCitations는
 *       위험 방향(T3·T4→🟢)만 교정하고, 이 과소평가 방향(T1·T2→🟡·⚪)은 빈틈이었음.
 *
 * 보수적 승격 정책 (회계사 승인 2026-06-15):
 *   - summary가 부정형("찾지 못했")이면 승격하지 않는다. LLM이 "이 조문은 직접 답이
 *     아니다"라고 판단한 것을 존중 — 관련만 있는 조문을 직접근거로 단정하는 위험
 *     방향을 차단(§6.3 회계사 보호).
 *   - summary가 긍정형일 때만 T1·T2의 🟡유사사례·⚪참고자료를 🟢직접근거로 승격.
 *   - ⚫폐지는 불변(폐지 사실 자체는 유지).
 *
 * 적용 순서: downgradeT3T4DirectCitations 다음, downgradeVectorLabels 이전.
 *   벡터/확장 검색 결과는 그 후 matchStage 천장으로 다시 하향되므로,
 *   direct 결과의 T1·T2만 최종적으로 🟢 승격된다.
 */
export function upgradeT1T2UnderlabeledCitations(
  citations: Citation[],
  summary: string,
): { citations: Citation[]; upgradedCount: number } {
  // 보수적: summary가 "찾지 못함" 부정형이면 승격 자체를 하지 않는다.
  if (summary.includes('찾지 못했')) {
    return { citations, upgradedCount: 0 }
  }

  let upgradedCount = 0
  const fixedCitations = citations.map((c) => {
    const tier = c.taxLaw.trustTier
    const isT1T2 = tier === 'T1' || tier === 'T2'
    const isUnderlabeled = c.label === '🟡유사사례' || c.label === '⚪참고자료'
    if (isT1T2 && isUnderlabeled) {
      upgradedCount += 1
      return { ...c, label: '🟢직접근거' as CitationLabel }
    }
    return c
  })

  return { citations: fixedCitations, upgradedCount }
}

/**
 * TAX-6A-11 (처방 D): 라벨 결정론화 — LLM 출력 라벨을 신뢰하지 않고
 * Trust Tier로 라벨을 100% 재계산한다.
 *
 * 배경: TAX-6A-10 진단(2026-06-15)에서 G-3 골든셋이 실행마다 V3 PASS/FAIL이
 *       갈리는 근본 원인이 "LLM이 라벨(🟢/🟡)을 비결정적으로 생성"하는 것으로 확정.
 *       (같은 T1 조문에 어떤 실행은 🟢직접근거, 어떤 실행은 🟡유사사례)
 *       temperature=0(처방 F)으로도 추론 서버 배치 변화 탓에 완전 제거 불가
 *       (news.hada.io/topic?id=23038) → 라벨을 LLM 출력에서 아예 분리한다.
 *
 * 해결: lawVerifier의 TIER_ALLOWED_LABELS(단일 진실 원천)와 동일한 매핑을 어댑터가
 *       강제 → checkV3가 검사하는 규칙을 구조적으로 항상 만족 → V3는 영원히 PASS.
 *       korean-law-mcp의 verify_citations 철학(판정은 LLM이 아니라 결정론 레이어)과 정합.
 *
 * 매핑(lawVerifier.TIER_ALLOWED_LABELS와 1:1):
 *   - ⚫폐지: LLM이 폐지로 판단한 경우만 보존(폐지는 드물고 본문 "삭제" 문구 판독 필요).
 *   - T1·T2 → 🟢직접근거
 *   - T3·T4 → 🟡유사사례
 *
 * matchStage(vector·expanded) 천장은 이후 downgradeVectorLabels가 별도 적용한다.
 *
 * 정책 변경(TAX-6A-10 1b 폐기): "summary 부정형이면 T1을 🟡 유지"를 제거.
 *   T1에 🟡는 원래 TIER_ALLOWED_LABELS 위반(V3 FAIL)이었으므로 T1·T2는 무조건 🟢.
 */
export function resolveCitationLabel(
  trustTier: TaxLaw['trustTier'],
  llmLabel: CitationLabel,
): CitationLabel {
  if (llmLabel === '⚫폐지') return '⚫폐지'
  if (trustTier === 'T1' || trustTier === 'T2') return '🟢직접근거'
  return '🟡유사사례'
}

/**
 * TAX-026-G: matchStage 기반 라벨 강제 하향 후처리
 *
 * 벡터/확장 검색 결과는 Trust Tier와 무관하게 최대 라벨을 제한한다 (TAX-026 §0.4).
 *   - matchStage='vector'   → 🟢직접근거 → 🟡유사사례 (T1/T2 출처도 포함)
 *   - matchStage='expanded' → 🟢·🟡 모두 → ⚪참고자료
 *   - ⚫폐지는 변경하지 않음 (폐지 사실 자체는 유지)
 *
 * 이미 downgradeT3T4DirectCitations가 T3/T4→🟢를 차단했으므로,
 * 이 함수는 T1/T2 출처 항목의 라벨만 추가 하향한다.
 */
function downgradeVectorLabels(
  citations: Citation[],
  summary: string,
  matchStage: MatchStage,
): { citations: Citation[]; summary: string } {
  if (matchStage === 'direct') return { citations, summary }

  const ceiling: CitationLabel = matchStage === 'vector' ? '🟡유사사례' : '⚪참고자료'
  const RANK: Record<CitationLabel, number> = {
    '🟢직접근거': 3,
    '🟡유사사례': 2,
    '⚪참고자료': 1,
    '⚫폐지':     0,
  }
  const maxRank = RANK[ceiling]

  const fixedCitations = citations.map((c) => {
    if (c.label === '⚫폐지') return c
    if (RANK[c.label] > maxRank) return { ...c, label: ceiling }
    return c
  })

  let fixedSummary = summary
  if (matchStage === 'expanded') {
    const prefix = '직접 근거를 찾지 못했습니다.'
    if (!summary.startsWith(prefix)) {
      fixedSummary = `${prefix} ${summary}`
    }
  }

  return { citations: fixedCitations, summary: fixedSummary }
}

/**
 * GPT-4o-mini 기반 답변 생성 Adapter (SSOT §3.3 [3]단계)
 *
 * 제공된 TaxLaw[] 원문만을 근거로 라벨링된 LabeledAnswer를 생성합니다.
 * TAX-041 옵션 A: LLM은 focusHint만 결정, 어댑터가 content에서 정확한 substring을 추출.
 * TAX-042C: callOnce + performWithRetry wrapper로 transient 1회 재시도 + maxOutputTokens 2000.
 * TAX-026-G: matchStage='vector'|'expanded' 시 라벨 강제 하향 후처리.
 */
export class OpenAIAnswerGeneratorAdapter implements IAnswerGeneratorPort {
  async generate(
    laws: TaxLaw[],
    question: string,
    temporal: TemporalContext,
    matchStage?: MatchStage,
  ): Promise<LabeledAnswer> {
    // TAX-042F: 입력 컨텍스트 윈도우 보호.
    //   promptLaws는 압축 임시본 — buildLawsContext로 LLM 입력 직렬화에만 사용.
    //   originalRefs는 원본 TaxLaw 객체 참조 — citations.taxLaw 매핑·V1·V2 검증용.
    //   인덱스 1:1 보장: promptLaws[i] ↔ originalRefs[i].
    //   짧은 fixture는 short-circuit으로 원본 객체 그대로 반환 → 회귀 0건.
    const { promptLaws, originalRefs } = truncateForContext(laws, question)

    // TAX-050: temporal.explicit이 false인 경우에도 명시 메시지 주입.
    // LLM이 시행일 메타데이터를 보고 자의적으로 [적용 시점] 라벨을 시도하지 않도록,
    // "회계사가 시점을 명시하지 않음 → [현행] 사용" 지시를 항상 전달한다.
    const temporalDirective = temporal.explicit && temporal.targetDate
      ? `[기준 시점]\n회계사가 ${temporal.targetDate.toISOString().slice(0, 10)} 기준으로 명시함 → 적용 시점 라벨 사용 가능`
      : `[기준 시점]\n회계사가 시점을 명시하지 않음 → 현행 법령 기준으로 답변, temporalLabel은 "[현행]" 사용`

    const userPrompt = [
      `[회계사 질문]\n${question}`,
      temporalDirective,
      `[제공된 법령 조문]\n${buildLawsContext(promptLaws)}`,
    ].join('\n\n')

    const controller = new AbortController()
    const timerId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)

    try {
      const openai = createOpenAI({ apiKey: config.openaiApiKey })

      // TAX-042C 보강: callOnce 헬퍼로 단일 호출을 캡슐화.
      //   - raw error를 도메인 에러로 변환해 performWithRetry가 도메인 에러만 다루도록 격리
      //   - maxOutputTokens=2000으로 출력 길이 상한 → LLM_TIMEOUT_MS 내 응답 압축
      //   - AI SDK v6 기준 옵션명은 maxOutputTokens (v5부터 명칭 변경)
      const callOnce = async (): Promise<{ object: z.infer<typeof answerSchema> }> => {
        try {
          return await generateObject({
            model: openai('gpt-4o-mini'),
            schema: answerSchema,
            system: SYSTEM_PROMPT,
            prompt: userPrompt,
            // TAX-6A-11 (F): 비결정성 최소화. temperature 미설정 시 기본값 1.0이라
            // 매 호출 확률 분포를 굴려 다른 답을 냈다. 0 = 확률 1등만 선택.
            temperature: 0,
            maxOutputTokens: 2_000,
            abortSignal: controller.signal,
          })
        } catch (err) {
          // AbortError·catch-all은 외부 catch에서 처리 — raw 그대로 throw
          if (err instanceof Error && err.name === 'AbortError') throw err
          if (NoObjectGeneratedError.isInstance(err)) throw new LlmSchemaValidationError(err)
          if (APICallError.isInstance(err)) {
            if (err.statusCode === 429) throw new LlmRateLimitError(err)
            if (err.statusCode !== undefined && err.statusCode >= 500) throw new LlmNetworkError(err)
            throw err
          }
          if (isNetworkLikeError(err)) throw new LlmNetworkError(err)
          throw err
        }
      }

      const { object } = await performWithRetry(callOnce, controller)

      // TAX-042F: citations.taxLaw는 originalRefs(원본 객체 참조)로 매핑한다.
      // extractExcerpt가 원본 content를 받아야 V2 인용 무결성(substring) 보장.
      const rawCitations: Citation[] = object.citations
        .filter((c) => c.lawIndex >= 0 && c.lawIndex < originalRefs.length)
        .map((c) => {
          const original = originalRefs[c.lawIndex]
          return {
            taxLaw: original,
            // TAX-6A-11 (D): LLM이 낸 라벨(c.label)을 신뢰하지 않고 Trust Tier로 재계산.
            // 라벨 비결정성을 출력에서 제거해 V3가 구조적으로 항상 PASS하도록 한다.
            label: resolveCitationLabel(original.trustTier, c.label as CitationLabel),
            excerpt: extractExcerpt(original.content, c.focusHint),
            temporalLabel: c.temporalLabel,
          }
        })

      // TAX-051: V3 라벨 안전망 — T3·T4 출처에 🟢직접근거 부여 시 강제 다운그레이드.
      // TAX-6A-11 (D) 이후: resolveCitationLabel이 이미 라벨을 규칙대로 고정하므로
      // 이 안전망은 입력에 위반이 없어 사실상 no-op이다. 2중 방어로 유지한다.
      const { citations: citationsAfterV3, summary: summaryAfterV3 } =
        downgradeT3T4DirectCitations(rawCitations, object.summary)

      // TAX-6A-10 (1b): T1·T2 과소부착 라벨 🟢 승격 (보수적 — summary 긍정형일 때만).
      // downgradeT3T4 다음·downgradeVectorLabels 이전에 적용해, 벡터/확장 결과는
      // 이후 matchStage 천장으로 다시 하향되고 direct 결과만 최종 승격되게 한다.
      const { citations: citationsAfterUpgrade } =
        upgradeT1T2UnderlabeledCitations(citationsAfterV3, summaryAfterV3)

      // TAX-026-G: 벡터/확장 검색 결과는 Trust Tier와 무관하게 라벨 상한 적용.
      const { citations, summary } = matchStage
        ? downgradeVectorLabels(citationsAfterUpgrade, summaryAfterV3, matchStage)
        : { citations: citationsAfterUpgrade, summary: summaryAfterV3 }

      return {
        rawQuestion: question,
        citations,
        summary,
        disclaimer: DISCLAIMER,
        temporalLabel: object.temporalLabel,
        verificationResult: pendingVerification(),
        generatedAt: new Date(),
      }
    } catch (err) {
      // 외부 catch — callOnce/performWithRetry가 던진 도메인 에러는 그대로 전파,
      // 그 외 raw error는 분기. TAX-042A 진단 인프라와 정합.
      if (err instanceof Error && err.name === 'AbortError') throw new LlmTimeoutError()
      if (err instanceof LlmTimeoutError) throw err
      if (err instanceof LlmSchemaValidationError) throw err
      if (err instanceof LlmRateLimitError) throw err
      if (err instanceof LlmNetworkError) throw err
      if (err instanceof LlmEmptyResponseError) throw err
      throw new LlmUnavailableError(err)
    } finally {
      clearTimeout(timerId)
    }
  }
}
