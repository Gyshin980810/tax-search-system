/** 도메인 에러 코드 */
export type ErrorCode =
  | 'E-PII-DETECTED'          // 주민번호·사업자번호 감지 → 입력 거부 (CLAUDE.md §7)
  | 'E-API-TIMEOUT'           // 외부 API 응답 시간 초과 (5초)
  | 'E-API-UNAVAILABLE'       // 외부 API 서비스 불가
  | 'E-LLM-TIMEOUT'           // Gemini API 응답 시간 초과
  | 'E-LLM-UNAVAILABLE'       // Gemini API 서비스 불가
  | 'E-LLM-SCHEMA'            // LLM 구조화 출력의 Zod 검증 실패 (TAX-042A 진단 인프라)
  | 'E-LLM-NETWORK'           // LLM 네트워크/서버 오류 (5xx·ECONNRESET 등, TAX-042A)
  | 'E-LLM-RATELIMIT'         // LLM 호출 요청량 초과 (HTTP 429, TAX-042A)
  | 'E-LLM-EMPTY'             // LLM 응답이 빈/잘린 상태 — citations=0 AND summary 공백 (TAX-042C 보강 A)
  | 'E-VERIFY-FAIL'           // law-verifier V1~V6 실패 (Phase 3 이후)
  | 'E-TEMPORAL-AMBIGUOUS'    // 시점 모호 표현 감지 — 회계사에게 날짜 지정 요청 (CLAUDE.md §6.2, TAX-6A-5)
  | 'INTERNAL_ERROR'          // 내부 예기치 않은 오류

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class PiiDetectedError extends AppError {
  constructor() {
    super('E-PII-DETECTED', '개인정보(주민번호·사업자번호)가 포함된 검색어는 처리할 수 없습니다.')
  }
}

export class ApiTimeoutError extends AppError {
  constructor() {
    super('E-API-TIMEOUT', '국세법령 API 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.')
  }
}

export class ApiUnavailableError extends AppError {
  constructor() {
    super('E-API-UNAVAILABLE', '국세법령 API에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.')
  }
}

export class LlmTimeoutError extends AppError {
  constructor() {
    super('E-LLM-TIMEOUT', 'AI 답변 생성 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.')
  }
}

export class LlmUnavailableError extends AppError {
  constructor(cause?: unknown) {
    super('E-LLM-UNAVAILABLE', 'AI 답변 생성 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.')
    if (cause !== undefined) (this as Error).cause = cause
  }
}

/** LLM 구조화 출력의 Zod 검증 실패. SDK가 NoObjectGeneratedError로 wrap한 원본을 cause로 보존. */
export class LlmSchemaValidationError extends AppError {
  constructor(cause?: unknown) {
    super('E-LLM-SCHEMA', 'AI 답변의 형식 검증에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    if (cause !== undefined) (this as Error).cause = cause
  }
}

/** LLM 호출 중 네트워크 또는 5xx 서버 오류. 진단을 위해 원본을 cause로 보존. */
export class LlmNetworkError extends AppError {
  constructor(cause?: unknown) {
    super('E-LLM-NETWORK', 'AI 답변 생성 서비스 연결이 일시적으로 불안정합니다. 잠시 후 다시 시도해 주세요.')
    if (cause !== undefined) (this as Error).cause = cause
  }
}

/** LLM 호출 요청량 초과(HTTP 429). 진단을 위해 원본을 cause로 보존. */
export class LlmRateLimitError extends AppError {
  constructor(cause?: unknown) {
    super('E-LLM-RATELIMIT', 'AI 답변 생성 요청량이 일시 초과되었습니다. 잠시 후 다시 시도해 주세요.')
    if (cause !== undefined) (this as Error).cause = cause
  }
}

/**
 * LLM이 응답을 반환했으나 citations 0개 + summary 공백인 빈/잘린 상태.
 * TAX-042C 보강 A: 토큰 잘림·SDK truncation을 transient로 분류해 1회 재시도 후
 * 여전히 빈 응답이면 본 에러를 throw.
 */
export class LlmEmptyResponseError extends AppError {
  constructor() {
    super('E-LLM-EMPTY', 'AI 답변이 비어 있거나 잘렸습니다. 잠시 후 다시 시도해 주세요.')
  }
}
