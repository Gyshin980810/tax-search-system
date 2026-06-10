import 'server-only'
import { LlmNetworkError, LlmRateLimitError } from '../domain/errors'

/**
 * TAX-042C — LLM 호출 재시도 정책 헬퍼 (Stage 3 어댑터 안정화)
 *
 * 배경:
 *   TAX-029/040/041 7차 정식 100회 측정에서 E-LLM-TIMEOUT 6건(6%) 발생.
 *   인덱스 65~70 군집 패턴은 OpenAI rate limit / 네트워크 흔들림 의심.
 *
 * 처방 (korean-law-mcp fetch-with-retry.ts 인사이트 적응):
 *   - isTransientNetworkError: LlmNetworkError·LlmRateLimitError·HTTP 5xx/429를 transient로 분류
 *   - detectEmptyResponse: citations=0 AND summary 공백 동시 만족 시 truncation으로 판정 (보강 A)
 *   - getRetryDelay: baseMs + Math.random() * (baseMs/2) jitter 백오프 (보강 B, 썬더링 허드 방지)
 *   - parseRetryAfter: 429 응답의 Retry-After 헤더(초·HTTP-date) 파싱 (보강 D, 상한 10초 클램프)
 *
 * 도메인 무결성 보호 (CLAUDE.md §6.4 V1~V6 절대 무변경):
 *   - 본 모듈은 호출 정책만 담당. 답변 본문·인용·시점 라벨 일체 무영향.
 *   - LlmEmptyResponseError는 LlmTimeoutError·LlmUnavailableError와 동일 export 형식.
 *
 * 인사이트 출처:
 *   korean-law-mcp fetch-with-retry.ts:37 detectBadBody, :156 getRetryDelay, :158 Retry-After
 *   (세법 도메인 한정으로 도메인 에러 기반 분류 + AI SDK ducktype 결합 형태로 적응)
 */

/** Retry-After 헤더 상한 (10초). LLM_TIMEOUT_MS=25s 안에서 재시도 + 응답까지 마진 확보. */
const RETRY_AFTER_MAX_MS = 10_000

/** HTTP 상태 코드 중 transient로 분류할 범위. 429 + 5xx (502/503/504 포함). */
const TRANSIENT_HTTP_STATUS = new Set([429, 500, 502, 503, 504])

/**
 * 일시적 네트워크/서버 오류 여부 판정.
 *
 * - `LlmNetworkError` / `LlmRateLimitError` 인스턴스는 transient
 * - 그 외 객체에 `statusCode` 숫자가 있고 TRANSIENT_HTTP_STATUS에 포함되면 transient (AI SDK ducktype)
 * - `LlmTimeoutError`·`LlmSchemaValidationError`·`AbortError`·`ZodError`는 즉시 throw 대상 → false
 *
 * 재시도 wrapper는 본 판정이 true인 경우에만 1회 재시도를 수행한다.
 */
export function isTransientNetworkError(err: unknown): boolean {
  if (err instanceof LlmNetworkError) return true
  if (err instanceof LlmRateLimitError) return true

  if (typeof err === 'object' && err !== null) {
    const status = (err as { statusCode?: unknown }).statusCode
    if (typeof status === 'number' && TRANSIENT_HTTP_STATUS.has(status)) return true
  }
  return false
}

/**
 * 빈/잘린 응답 감지 (보강 A).
 *
 * citations 5개 우선순위(Stage 2) 정책상 직접 근거 0건은 가능하지만 summary는 항상
 * 채워져야 한다. 둘 다 빈 경우만 truncation으로 판정해 재시도 분기로 보낸다.
 *
 * 위험 5 완화: `summary.trim().length > 0`이면 빈약 케이스도 정상 처리되어
 * CLAUDE.md §6.3 "빈약 시 직접 근거를 찾지 못했습니다 명시" 원칙을 보호한다.
 */
export function detectEmptyResponse(
  obj: { citations: readonly unknown[]; summary: string },
): boolean {
  return obj.citations.length === 0 && obj.summary.trim().length === 0
}

/**
 * Jitter backoff 계산 (보강 B).
 *
 * 500ms 호출 시 500~750ms 범위 jitter — 동시 다발성 클라이언트의 동기 재시도
 * (썬더링 허드)를 회피한다. 결정적 테스트를 위해 호출자가
 * `vi.spyOn(Math, 'random').mockReturnValue(...)`로 제어할 수 있다.
 */
export function getRetryDelay(baseMs: number): number {
  return baseMs + Math.random() * (baseMs / 2)
}

/**
 * OpenAI 429 Retry-After 헤더 파싱 (보강 D).
 *
 * HTTP 스펙: Retry-After는 (a) delta-seconds 정수 또는 (b) HTTP-date 둘 다 허용.
 * 두 형식을 모두 시도하고, 둘 다 실패하면 `null` 반환 → 호출자는 jitter backoff로 fallback.
 *
 * 상한 10초 클램프(위험 6 완화): 악의적·실수 응답의 큰 값(예: 86400)이 P95를 폭증시키지 않도록 보호.
 *
 * @returns 대기 시간(ms) 또는 null (헤더 없음·파싱 실패·과거 시각)
 */
export function parseRetryAfter(err: unknown): number | null {
  if (!(err instanceof LlmRateLimitError)) return null

  const cause = (err as { cause?: unknown }).cause
  if (typeof cause !== 'object' || cause === null) return null

  const headers = (cause as { responseHeaders?: unknown }).responseHeaders
  if (typeof headers !== 'object' || headers === null) return null

  const header = (headers as Record<string, unknown>)['retry-after']
  if (typeof header !== 'string') return null

  const seconds = Number.parseInt(header, 10)
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, RETRY_AFTER_MAX_MS)
  }

  const dateMs = Date.parse(header)
  if (Number.isFinite(dateMs)) {
    const wait = dateMs - Date.now()
    return wait > 0 ? Math.min(wait, RETRY_AFTER_MAX_MS) : null
  }
  return null
}

/** 보강 C — 빈/잘린 응답 에러는 재시도 wrapper와 함께 import할 수 있도록 본 모듈에서 re-export. */
export { LlmEmptyResponseError } from '../domain/errors'
