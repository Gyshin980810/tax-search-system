# TAX-042A Stage 1 — LLM 어댑터 catch 분기 세분화 (진단 인프라)

> 작성자: AI(Claude Opus 4.7) / 작성일: 2026-06-07
> 배경: TAX-029/040/041 7차 정식 100회 측정에서 비정상 응답 12건 발생. 그중 3건이 `E-LLM-UNAVAILABLE`로 분류되었으나, catch-all 패턴 때문에 실제 원인(ZodError·NetworkError·RateLimit 등)을 구별할 수 없음.
> 전략: TAX-042 5단계 처방 중 **Stage 1 (필수 선행)**. Stage 2~4 효과 측정의 정확도를 보장한다.

---

## Metadata

- **Type**: TASK (진단 인프라 / 에러 분류 세분화)
- **Severity**: minor (정상 경로 무변경, 분류 라벨만 추가)
- **Layer**: adapter (llmAnswerGenerator) + domain (errors)
- **Milestone**: Post-MVP (TAX-042 처방 묶음 진입 단계)
- **Estimated Size**: S (2~3 파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

`src/adapters/llmAnswerGenerator.ts:258-264` catch 블록이 catch-all 패턴:

```typescript
} catch (err) {
  if (err instanceof Error && err.name === 'AbortError') throw new LlmTimeoutError()
  if (err instanceof LlmTimeoutError) throw err
  throw new LlmUnavailableError()   // ← Zod·Network·API·Rate limit 전부 동일 라벨
}
```

100회 측정에서 발생한 3건의 `E-LLM-UNAVAILABLE` (인덱스 14, 54, 94, 모두 G-S-법인-06)의 진짜 원인이 무엇인지(`ZodError`인지 OpenAI 5xx인지) 식별 불가.

### 1.2 기대 동작

OpenAI 호출 실패 시 원인별로 다른 도메인 에러를 throw:

- `ZodError` (구조화 출력 schema 검증 실패) → `LlmSchemaValidationError`
- `APICallError(statusCode=429)` (rate limit) → `LlmRateLimitError`
- `APICallError(statusCode>=500)` (서버 오류) → `LlmNetworkError`
- `fetch` 네트워크 에러 (ECONNRESET, ENOTFOUND 등) → `LlmNetworkError`
- 그 외 진짜 알 수 없는 에러 → `LlmUnavailableError` (cause에 원본 보존)

### 1.3 영향·중요도

- Stage 2~4 처방의 효과 측정 정확도를 결정하는 **선행 인프라**.
- Stage 2 (citations.max(5))가 Zod 오류로 인한 실패였는지 검증하려면 본 작업이 선행되어야 함.
- 본 작업 없이 Stage 2 진행 시 "왜 효과가 있는지 모르는 상태"가 됨.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/domain/errors.ts:1-50` — ErrorCode union·AppError 클래스
- `src/adapters/llmAnswerGenerator.ts:14` — errors import
- `src/adapters/llmAnswerGenerator.ts:258-264` — catch 블록
- `tests/unit/llmAnswerGeneratorErrors.test.ts` — 신규

### 2.2 외부 의존성

- `ai` 패키지 (Vercel AI SDK)의 `APICallError` 클래스
  - import 경로 확인 필요 (현재 사용 중인 SDK 버전 기준)
  - 만약 SDK가 에러를 한 번 wrap하면 `err.cause`까지 검사 로직 필요
- `zod` 패키지의 `ZodError`

### 2.3 아키텍처 힌트

```
generateObject() throw
   ↓
catch (err)
   ├─ AbortError → LlmTimeoutError (기존)
   ├─ ZodError → LlmSchemaValidationError (신규)
   ├─ APICallError(429) → LlmRateLimitError (신규)
   ├─ APICallError(5xx) → LlmNetworkError (신규)
   ├─ Network-like → LlmNetworkError (신규)
   └─ else → LlmUnavailableError (기존, cause에 원본 첨부)
```

---

## 3. Scope (작업 범위) ⭐ 가장 중요

### 3.1 허용되는 변경

- [ ] `src/domain/errors.ts` — `ErrorCode` union에 `E-LLM-SCHEMA`·`E-LLM-NETWORK`·`E-LLM-RATELIMIT` 3개 추가
- [ ] `src/domain/errors.ts` — `LlmSchemaValidationError`·`LlmNetworkError`·`LlmRateLimitError` 클래스 추가 (`cause` 보존)
- [ ] `src/adapters/llmAnswerGenerator.ts:14` — 신규 에러 클래스 import
- [ ] `src/adapters/llmAnswerGenerator.ts:258-264` — catch 블록 분기 세분화
- [ ] `src/adapters/llmAnswerGenerator.ts` — `isTransientNetworkError(err)`·`isNetworkLikeError(err)` 헬퍼 추가
- [ ] `tests/unit/llmAnswerGeneratorErrors.test.ts` — 단위 테스트 4건 신규

### 3.2 금지되는 변경

- ❌ `LlmTimeoutError`·`LlmUnavailableError` 클래스 시그니처 변경 (회귀 위험)
- ❌ 정상 경로(try 블록 내부) 동작 변경 — catch만 수정
- ❌ `lawVerifier`·`generateAnswer` 영향
- ❌ `package.json` 의존성 추가
- ❌ Stage 2~4 처방을 본 티켓에 함께 적용 (별도 티켓)

---

## 4. Strategy (구현 힌트)

1. **도메인 먼저**: `errors.ts`에 3개 에러 코드 + 3개 클래스 추가. 사용자 메시지는 한국어, `cause` 파라미터로 원본 에러 보존.
2. **APICallError 위치 확인**: `node_modules/ai` 또는 `node_modules/@ai-sdk/openai`에서 export 경로 확인.
   - `import { APICallError } from 'ai'` 또는 `'@ai-sdk/provider'`
   - 만약 export가 없으면 `err.name === 'AI_APICallError'` 또는 `'statusCode' in err`로 duck typing
3. **catch 블록 재작성**: 위 §2.3 분기 트리대로 우선순위 명시.
4. **네트워크 에러 판정 헬퍼**: `ECONNRESET`·`ENOTFOUND`·`ETIMEDOUT`·`ECONNREFUSED` 코드 또는 `fetch failed` 메시지 검사.
5. **단위 테스트**: `vi.fn()`으로 `generateObject` mock → 다양한 에러 throw → 분류된 에러 클래스 확인.

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `npm run test tests/unit/llmAnswerGeneratorErrors.test.ts` 4건 모두 통과
   - 단위 1: ZodError → `LlmSchemaValidationError`
   - 단위 2: APICallError(429) → `LlmRateLimitError`
   - 단위 3: APICallError(503) → `LlmNetworkError`
   - 단위 4: `Error('ECONNRESET')` → `LlmNetworkError`
2. [ ] 기존 `tests/integration/llmAnswerGenerator.test.ts` 5건 회귀 없이 통과
3. [ ] `npm run build` 타입 에러 없음
4. [ ] `npm run lint` 통과
5. [ ] 정상 경로(LLM 응답 성공 시) 동작 무변경 — 기존 통합 테스트로 확인
6. [ ] 에러 인스턴스의 `cause` 필드에 원본 에러 보존 (단위 테스트로 확인)

---

## 6. Verification (검증 단계)

1. `npm run test` — 전체 테스트 회귀 없음
2. `npm run build` — 빌드 통과
3. `npm run dev` — 정상 시작
4. 브라우저에서 임의 검색어 입력 → 정상 응답 (정상 경로 무변경 확인)

> 측정 회귀(100회 perf:p95)는 본 티켓에서 **불필요**. 정상 경로 무변경 + 에러 분류만 추가하기 때문.

---

## 7. Risks / Notes (위험·주의사항)

- **위험 1**: Vercel AI SDK가 `APICallError`를 직접 export하지 않을 경우 → duck typing으로 대체 (`'statusCode' in err && typeof err.statusCode === 'number'`)
- **위험 2**: SDK가 에러를 wrap한다면 `err.cause`도 검사해야 함 — 구현 중 실제 에러 객체 구조 확인
- **위험 3**: 새로 추가하는 `LlmRateLimitError`의 message가 사용자에게 노출될 때 너무 기술적이지 않게 ("AI 답변 생성 요청량이 일시 초과되었습니다. 잠시 후 다시 시도해 주세요.")
- **주의**: `cause`는 ES2022 `Error.cause` 표준 사용 (`new Error(msg, { cause: original })`)
- **유지**: catch 블록 끝의 finally `clearTimeout(timerId)` 보존

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] Vercel AI SDK 버전 확인 + `APICallError` import 경로 확정
- [ ] 변경 후 catch 블록 의사 코드 1차 제시 후 인간 승인
- [ ] 단위 테스트 4건 케이스 명세 제시 후 인간 승인

→ **인간 승인 후** 코딩 시작

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록 (`errors.ts`, `llmAnswerGenerator.ts`, `tests/unit/...`)
- [ ] 검증 단계별 결과 (PASS/FAIL)
- [ ] 발견된 위험·제한사항 (예: SDK API 차이)
- [ ] 리포트 파일 경로: `docs/reports/TAX-042A_report.md`

---

## 9. Ticket Size Rule

- 변경 파일: 3개 (errors.ts, llmAnswerGenerator.ts, tests/unit/...)
- 논리적 변경: 1개 (catch 분기 세분화)
- 예상 소요: 30분~1시간

---

## 10. Related Tickets

- **선행**: 없음
- **후속**: TAX-042B (Stage 2 citations.max), TAX-042C (Stage 3 maxTokens·retry), TAX-042D (Stage 4 V3 강화), TAX-042E (Stage 5 회귀 측정)
- **참조**: [[tax029-040-041-complete]] 메모리 — 100회 측정 raw 로그, [[feedback_pipeline_steps]] 검증 우회 금지

---

## 11. Report Link

Report: `docs/reports/TAX-042A_report.md` (미작성)

---

**작성자**: AI (Claude Opus 4.7)
**작성일**: 2026-06-07
**최종 수정일**: 2026-06-07
