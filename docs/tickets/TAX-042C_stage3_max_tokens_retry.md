# TAX-042C Stage 3 — maxTokens 출력 제한 + 일시적 실패 1회 재시도 (TIMEOUT 6건 해결)

> 작성자: AI(Claude Opus 4.7) / 작성일: 2026-06-07
> 배경: TAX-029/040/041 7차 정식 100회 측정에서 `E-LLM-TIMEOUT` 6건 발생 (인덱스 33, 65, 66, 67, 69, 97). 인덱스 65~70 군집 패턴은 일시적 OpenAI rate limit / 네트워크 흔들림 의심.
> 전략: TAX-042 5단계 처방 중 **Stage 3**. (1) 출력 토큰 한도 명시로 응답 시간 압축 + (2) 일시적 네트워크 실패 시 1회 재시도(지수 백오프 500ms + jitter).
>
> **풀세트 보강 (2026-06-07 갱신, korean-law-mcp 인사이트)**:
> - **A. 빈/잘린 응답 감지** — `generateObject` 성공이지만 citations=0·summary 공백이면 transient로 간주해 재시도 (korean-law-mcp `fetch-with-retry.ts:37 detectBadBody` 적응)
> - **B. Exponential backoff + jitter** — 500ms 고정 → `500 + Math.random() * 250` (썬더링 허드 방지, `fetch-with-retry.ts:156 getRetryDelay` 적응)
> - **C. `LlmEmptyResponseError` 신설** — `LlmNetworkError`·`LlmRateLimitError`·`LlmSchemaValidationError`는 TAX-042A에서 추가됨 → 4번째 신규 타입만 추가
> - **D. OpenAI 429 Retry-After 헤더 존중** — Rate limit 응답의 `retry-after` 헤더를 파싱해 백오프 시간으로 사용 (없으면 jitter backoff fallback)

---

## Metadata

- **Type**: TASK (LLM 호출 안정화)
- **Severity**: major (TIMEOUT 6/100 = 6% 실패)
- **Layer**: adapter (llmAnswerGenerator)
- **Milestone**: Post-MVP (TAX-042 처방 묶음)
- **Estimated Size**: S (1~2 파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

| 인덱스 | 케이스 | 에러 |
|---|---|---|
| 33 | G-S-양도-02 | E-LLM-TIMEOUT |
| 65 | G-S-소득-03 | E-LLM-TIMEOUT |
| 66 | G-S-법인-01 | E-LLM-TIMEOUT |
| 67 | G-S-법인-02 | E-LLM-TIMEOUT |
| 69 | G-S-부가-01 | E-LLM-TIMEOUT |
| 97 | G-S-상증-03 | E-LLM-TIMEOUT |

추정 원인:

- **원인 A (만성)**: 출력 토큰 길이 무제한 → LLM이 길게 응답하다 25s 타임아웃 (`LLM_TIMEOUT_MS`)
- **원인 B (간헐)**: 인덱스 65~70 군집 = 일시적 OpenAI rate limit·5xx (단발성 실패가 그대로 에러)

### 1.2 기대 동작

- `generateObject` 호출 시 `maxTokens: 2_000` 명시 → 출력 길이 상한으로 응답 시간 압축
- 1차 호출 실패가 일시적 네트워크/rate limit이면 **jitter backoff(500~750ms) 후 1회 재시도**
- 1차 호출이 Zod/Timeout/non-transient면 즉시 throw (재시도 안 함)
- **(보강 A)** 1차 호출이 성공했지만 응답이 **빈/잘린 상태**(citations 배열이 빈 배열이고 summary가 공백)면 transient로 간주해 1회 재시도
- **(보강 D)** 1차 실패가 OpenAI 429이고 `retry-after` 헤더가 있으면 헤더 시간만큼 대기 후 재시도 (헤더 없으면 jitter backoff fallback)

### 1.3 영향·중요도

- TIMEOUT 6건 = 6% Pass rate 손실. Stage 3 통과 시 Pass rate 91% → 95% 진입 가능
- ⚠️ **재시도 1회 추가가 누적 P95에 부담 가능** (현재 24.66s) — Stage 5 회귀에서 모니터링 필수

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/adapters/llmAnswerGenerator.ts:23` — `LLM_TIMEOUT_MS = 25_000` (변경 금지)
- `src/adapters/llmAnswerGenerator.ts:225-235` — `generateObject` 호출
- `src/adapters/llmAnswerGenerator.ts:258-264` — catch (Stage 1에서 분기 세분화 완료 가정)
- `src/domain/errors.ts` — **(보강 C)** `LlmEmptyResponseError` 신규 추가 (`LlmNetworkError`·`LlmRateLimitError`·`LlmSchemaValidationError`는 TAX-042A에서 추가 완료)
- `tests/integration/llmAnswerGeneratorRetry.test.ts` — 신규

### 2.2 외부 의존성

- Vercel AI SDK `generateObject` 옵션: `maxTokens` (또는 `maxOutputTokens` — SDK 버전 확인)
- `LlmNetworkError`·`LlmRateLimitError` (Stage 1에서 정의됨)

### 2.3 아키텍처 힌트

```
try {
  callOnce() (1차)
    ├─ 정상 → 결과 반환
    ├─ AbortError → throw (재시도 안 함)
    ├─ ZodError → throw (재시도 안 함)
    └─ Transient (Network·RateLimit·5xx) → 500ms sleep → callOnce() (2차)
                                                              ├─ 정상 → 결과 반환
                                                              └─ 실패 → throw (분기는 Stage 1)
} catch (err) {
  // Stage 1의 분기 세분화
}
```

---

## 3. Scope (작업 범위) ⭐ 가장 중요

### 3.1 허용되는 변경

- [ ] `src/adapters/llmAnswerGenerator.ts:225-235` — `generateObject` 호출에 `maxTokens: 2_000` 옵션 추가
  - SDK 버전에 따라 옵션명이 `maxOutputTokens` 또는 `maxTokens`일 수 있음 — 확정 후 사용
- [ ] `src/adapters/llmAnswerGenerator.ts:215-264` — `callOnce()` 헬퍼로 LLM 호출 분리 + 1회 재시도 wrapper
- [ ] `src/adapters/llmAnswerGenerator.ts` — `isTransientNetworkError(err)` 헬퍼 (Stage 1과 공유 또는 별도)
- [ ] **(보강 A)** `src/adapters/llmAnswerGenerator.ts` — `detectEmptyResponse(object)` 헬퍼: `object.citations.length === 0 && object.summary.trim() === ''` 판정 → 재시도 분기
- [ ] **(보강 B)** `src/adapters/llmAnswerGenerator.ts` — `getRetryDelay(baseMs)` 헬퍼: `baseMs + Math.random() * (baseMs / 2)` (썬더링 허드 방지)
- [ ] **(보강 C)** `src/domain/errors.ts` — `LlmEmptyResponseError extends Error` 신규 정의 (transient 분류)
- [ ] **(보강 D)** `src/adapters/llmAnswerGenerator.ts` — `parseRetryAfter(err)` 헬퍼: 에러 객체에서 `retry-after` 헤더 추출 (초 단위 정수·HTTP date 둘 다 지원) → 헤더 시간(s) × 1000 반환, 미존재 시 `null`
- [ ] `tests/integration/llmAnswerGeneratorRetry.test.ts` — 통합 테스트 **5건** 신규 (기존 3건 + A/D 신설 2건)

### 3.2 금지되는 변경

- ❌ `LLM_TIMEOUT_MS = 25_000` 변경 (TAX-040 정합)
- ❌ AbortController 시그너처 변경
- ❌ `runTwoStage` (`src/usecases/generateAnswer.ts`) 변경 — usecase 레벨 재시도와 충돌 방지
- ❌ 재시도 횟수를 2회 이상으로 늘리기 (P95 폭증)
- ❌ Zod·Timeout 케이스 재시도 (즉시 throw)
- ❌ Stage 1·2·4 처방을 본 티켓에 함께 적용

---

## 4. Strategy (구현 힌트)

1. **callOnce 헬퍼 분리**:
   ```typescript
   const callOnce = async () => {
     const openai = createOpenAI({ apiKey: config.openaiApiKey })
     return generateObject({
       model: openai('gpt-4o-mini'),
       schema: answerSchema,
       system: SYSTEM_PROMPT,
       prompt: userPrompt,
       maxTokens: 2_000,
       abortSignal: controller.signal,
     })
   }
   ```
2. **재시도 wrapper (보강 A·B·D 통합)**:
   ```typescript
   const performWithRetry = async () => {
     let result
     try {
       result = await callOnce()
     } catch (firstErr) {
       if (!isTransientNetworkError(firstErr) || controller.signal.aborted) {
         throw firstErr
       }
       // 보강 D: 429 Retry-After 우선, 없으면 보강 B jitter backoff
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
   ```
   - 재시도 총량은 **최대 1회만** (네트워크 실패 분기 또는 빈 응답 분기 중 하나만 작동). 두 분기 동시 발생 시 무한 루프 방지를 위해 빈 응답 재시도 후에도 빈 응답이면 `LlmEmptyResponseError` throw
3. **isTransientNetworkError 정의**:
   - `LlmRateLimitError` instance
   - `LlmNetworkError` instance
   - `APICallError` with `statusCode in [429, 500, 502, 503, 504]`
   - **제외**: AbortError, ZodError, LlmTimeoutError, LlmEmptyResponseError(별도 분기)
4. **보강 B — getRetryDelay 정의**:
   ```typescript
   const getRetryDelay = (baseMs: number): number =>
     baseMs + Math.random() * (baseMs / 2)
   ```
   - 500ms 호출 시 500~750ms 범위 jitter — 동시 다발성 클라이언트의 동기 재시도(썬더링 허드) 회피
5. **보강 A — detectEmptyResponse 정의**:
   ```typescript
   const detectEmptyResponse = (obj: AnswerObject): boolean =>
     obj.citations.length === 0 && obj.summary.trim().length === 0
   ```
   - citations 5개 우선순위(Stage 2) 정책상 직접 근거 0건은 가능하지만 summary는 항상 채워져야 함 — 둘 다 빈 경우만 truncation으로 판정
6. **보강 D — parseRetryAfter 정의**:
   ```typescript
   const parseRetryAfter = (err: unknown): number | null => {
     if (!(err instanceof LlmRateLimitError)) return null
     const header = err.cause?.responseHeaders?.['retry-after']
     if (!header) return null
     const seconds = Number.parseInt(header, 10)
     if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 10_000)
     const dateMs = Date.parse(header)
     if (Number.isFinite(dateMs)) {
       const wait = dateMs - Date.now()
       return wait > 0 ? Math.min(wait, 10_000) : null
     }
     return null
   }
   ```
   - 상한 10초로 클램프 — `LLM_TIMEOUT_MS=25s` 안에서 재시도 + 응답까지 마진 확보
7. **maxTokens 산정 근거**:
   - citations 5개 × focusHint(20자) + label(10자) + temporalLabel(20자) = ~250자 ≈ 200 tokens
   - summary 500자 ≈ 400 tokens
   - temporalLabel + structural overhead = ~100 tokens
   - 안전 마진 포함 2_000 tokens 충분 (옵션 A에서 excerpt를 LLM이 작성하지 않으므로 크게 줄어듦)
8. **AbortSignal 호환**: 재시도 전 `controller.signal.aborted` 확인 — 이미 abort된 상태면 재시도 안 함

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] 통합 테스트 **5건** 통과:
   - 통합 1: 1차 `LlmNetworkError` → jitter backoff 후 2차 정상 → 정상 LabeledAnswer 반환
   - 통합 2: 1차·2차 모두 `LlmNetworkError` → `LlmNetworkError` throw
   - 통합 3: 1차 `ZodError` → 즉시 `LlmSchemaValidationError` (재시도 안 함)
   - **통합 4 (보강 A)**: 1차 성공이나 `{ citations: [], summary: '' }` → jitter backoff 후 2차 정상 → 정상 반환. 2차도 빈 응답이면 `LlmEmptyResponseError`
   - **통합 5 (보강 D)**: 1차 `LlmRateLimitError`에 `retry-after: '2'` 헤더 → **2초 대기 후** 2차 정상 (jitter backoff 사용 안 함을 측정으로 확인)
2. [ ] 기존 단위·통합 테스트 회귀 없이 통과
3. [ ] `npm run build`·`npm run lint` 통과
4. [ ] TIMEOUT 케이스 (예: G-S-법인-01) 단건 측정 3회 시 3/3 정상 응답 (또는 ≥2/3)
5. [ ] 정상 응답 시 `maxTokens` 제한으로 응답이 잘리지 않음 — citations 5개 + summary 500자 이내에서 정상 완료
6. [ ] **(보강 C)** `LlmEmptyResponseError`가 `src/domain/errors.ts`에 정의되고 `LlmTimeoutError`·`LlmUnavailableError`와 동일 export 형식 유지

---

## 6. Verification (검증 단계)

1. `npm run test` 회귀 없음
2. 단건 측정으로 TIMEOUT 군집 케이스 3개(G-S-법인-01, G-S-법인-02, G-S-부가-01) 각 3회 실행 → 정상률 ≥ 7/9
3. 응답 길이 모니터링: summary 500자 이하 평균, citations 5개 이하 확인
4. 평균 응답 시간 비교: Stage 3 전후 응답 시간 1초 이내 증가 (재시도 영향)

> 100회 회귀 측정은 Stage 5에서 일괄.

---

## 7. Risks / Notes (위험·주의사항)

- **위험 1 (가장 큼)**: ⚠️ 재시도 1회 추가가 누적 P95에 ~25s 증가 가능 (현재 24.66s + α)
  - **완화책**:
    - 재시도는 Transient 케이스에서만 (Zod·Timeout 제외)
    - 백오프 500ms (낭비 최소)
    - Stage 5 회귀에서 P95 > 28s 시 백오프 200ms 또는 재시도 제거 검토
- **위험 2**: `maxTokens=2_000`이 너무 작아 응답 잘림 → V2 (summary 인용 불일치) 또는 V5 (disclaimer 누락) 위반 가능성
  - **완화책**: 단건 측정에서 잘림 확인, 잘리면 3_000으로 완화
- **위험 3**: Vercel AI SDK 옵션명이 `maxTokens` vs `maxOutputTokens` vs `experimental_*` 등으로 SDK 버전에 따라 다름 — 정확한 옵션명 확정 필요
- **위험 4**: `runTwoStage` (usecase)의 재시도와 어댑터 재시도가 중첩되면 최악 시 4회 호출 (Stage 1·2 각 1+1회) → 의도된 동작인지 확인. 일반적으로 어댑터 재시도가 transient만 처리하므로 OK
- **위험 5 (보강 A)**: `detectEmptyResponse` 오탐 — 빈약 케이스(직접 근거 0건 + summary는 짧지만 존재)가 정상 결과인데 transient로 오인 가능
  - **완화책**: 판정 조건을 `citations.length === 0 && summary.trim().length === 0` AND (둘 다 빈 경우만)으로 엄격화. summary가 1자라도 있으면 정상 처리. CLAUDE.md §6.3 "빈약 시 직접 근거를 찾지 못했습니다 명시" 원칙 보호
- **위험 6 (보강 D)**: 악의적 서버가 `retry-after: 86400` 같은 큰 값을 보내면 P95 폭증
  - **완화책**: `parseRetryAfter` 상한 10초 클램프. `LLM_TIMEOUT_MS=25s` 안에서 재시도 + 응답까지 마진 확보
- **위험 7 (보강 B)**: jitter가 `Math.random()`이라 통합 테스트가 비결정적
  - **완화책**: 통합 테스트에서 `vi.spyOn(Math, 'random').mockReturnValue(0)` 사용해 결정적 동작 강제
- **주의**: `clearTimeout(timerId)` 위치 보존 (finally 블록)

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] Vercel AI SDK `maxTokens` 옵션명 확정 (SDK 버전 기준)
- [ ] `callOnce` 헬퍼 + 재시도 wrapper 의사 코드 제시 후 인간 승인
- [ ] `isTransientNetworkError` 판정 기준 명세

→ **인간 승인 후** 코딩 시작

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록
- [ ] 통합 테스트 3건 결과
- [ ] TIMEOUT 케이스 단건 측정 결과
- [ ] 평균 응답 시간 변화 보고
- [ ] 리포트 파일 경로: `docs/reports/TAX-042C_report.md`

---

## 9. Ticket Size Rule

- 변경 파일: 3개 (`llmAnswerGenerator.ts`, `src/domain/errors.ts`, `tests/integration/llmAnswerGeneratorRetry.test.ts`)
- 논리적 변경: 6개 (maxTokens, 재시도, jitter backoff, 빈 응답 감지, Retry-After 파싱, LlmEmptyResponseError 정의)
- 예상 소요: 2~3시간 (보강 4건 추가)

---

## 10. Related Tickets

- **선행**: TAX-042A (Stage 1 catch 분기), TAX-042B (Stage 2 citations.max — maxTokens 산정 의존)
- **후속**: TAX-042D (Stage 4 V3 강화), TAX-042E (Stage 5 회귀)
- **참조**: [[tax029-040-041-complete]] TAX-040 LLM_TIMEOUT_MS=25s 정합

---

## 11. Report Link

Report: `docs/reports/TAX-042C_report.md` (미작성)

---

**작성자**: AI (Claude Opus 4.7)
**작성일**: 2026-06-07
**최종 수정일**: 2026-06-07
