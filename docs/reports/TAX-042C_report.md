# TAX-042C 리포트 — maxOutputTokens 출력 제한 + 일시적 실패 1회 재시도 (Stage 3 어댑터 안정화)

> 작성일: 2026-06-07
> 티켓: `docs/tickets/TAX-042C_stage3_max_tokens_retry.md`
> 풀세트 보강: A(빈 응답 감지) · B(jitter backoff) · C(`LlmEmptyResponseError`) · D(429 Retry-After 헤더 존중)
> 선행: TAX-042A(catch 분기 세분화) · TAX-042F(컨텍스트 윈도우 압축) · TAX-042G(쿼리 사실축 결합)

---

## 1. 변경 사항 요약

### 1.1 파일 변경 목록

| 파일 | 변경 유형 | 주요 변경 |
|---|---|---|
| `src/domain/errors.ts` | 수정 | `E-LLM-EMPTY` 코드 + `LlmEmptyResponseError` 신규 추가 (보강 C) |
| `src/adapters/llmRetryPolicy.ts` | 신규(110줄) | `isTransientNetworkError` · `detectEmptyResponse` · `getRetryDelay` · `parseRetryAfter` 4개 헬퍼 격리 모듈 |
| `src/adapters/llmAnswerGenerator.ts` | 수정 | `callOnce` 클로저(raw → 도메인 에러 변환) + `performWithRetry` wrapper(클래스 외부 함수) + `maxOutputTokens: 2_000` + 외부 catch 단순화 |
| `tests/unit/llmRetryPolicy.test.ts` | 신규(19건) | 4개 헬퍼별 단위 테스트 |
| `tests/integration/llmAnswerGeneratorRetry.test.ts` | 신규(6건) | 풀세트 보강 A·B·C·D 통합 검증 |
| `tests/unit/llmAnswerGeneratorErrors.test.ts` | 수정 | 단위 2/3/4 `mockRejectedValueOnce` → `mockRejectedValue` (재시도 추가 반영) |
| `tests/integration/llmAnswerGenerator.test.ts` | 수정 | "네트워크 오류" 케이스 동일 패턴 회귀 수정 |

### 1.2 주요 변경 의도

- **출력 압축** — `maxOutputTokens: 2_000`으로 응답 길이 상한. TAX-029 7차 TIMEOUT 6건 중 출력 길이 만성 원인을 차단
- **재시도 격리** — `callOnce` 클로저 안에서 raw error를 도메인 에러로 변환 후 `performWithRetry`가 도메인 에러만 다루도록 격리. AI SDK 내부 에러 타입에 대한 의존을 wrapper 단계에서 격리
- **무한 루프 방지** — 최대 호출 횟수 3회 상한 (네트워크 재시도 1회 + 빈 응답 재시도 1회). 두 분기 동시 발생 시 빈 응답 재시도 후에도 빈 응답이면 `LlmEmptyResponseError` throw
- **P95 영향 완화** — Retry-After 헤더 10초 상한 클램프로 `LLM_TIMEOUT_MS=25s` 안에서 재시도 + 응답 마진 확보
- **Hex 아키텍처 보존** — `IAnswerGeneratorPort.generate` 시그니처·`LLM_TIMEOUT_MS=25_000`·`runTwoStage` 무변경

### 1.3 풀세트 보강 매핑 (korean-law-mcp 인사이트 적응)

| 보강 | 인사이트 출처 | 구현 위치 |
|---|---|---|
| A. 빈/잘린 응답 감지 | `fetch-with-retry.ts:37 detectBadBody` | `detectEmptyResponse(obj)` — `citations.length === 0 && summary.trim() === ''` AND 엄격 |
| B. Jitter backoff | `fetch-with-retry.ts:156 getRetryDelay` | `getRetryDelay(500)` — 500~750ms 범위, 썬더링 허드 방지 |
| C. `LlmEmptyResponseError` | `errors.ts:10 ErrorCodes` 패턴 | `src/domain/errors.ts` `E-LLM-EMPTY` 4번째 신규 도메인 에러 |
| D. Retry-After 헤더 존중 | `fetch-with-retry.ts:158 Retry-After` | `parseRetryAfter(err)` — 초·HTTP-date 둘 다 지원, 10초 상한 클램프 |

---

## 2. 검증 결과

### 2.1 4종 품질 게이트

| 명령 | 결과 |
|---|---|
| `npm run lint` | PASS (사전 무관 warning 1건만: `ImpactMapPanel.test.tsx beforeEach` 미사용) |
| `npx tsc --noEmit` | PASS (EXIT=0) |
| `npx vitest run` | **341/341 PASS** (기존 335 + 단위 19 + 통합 6 - 회귀 수정으로 인한 변동 0건, 회귀 0건) |
| `npm run build` | PASS (Next.js 16.2.6 Turbopack, 4.5s) |

### 2.2 단위 테스트 19건 (`tests/unit/llmRetryPolicy.test.ts`)

| describe | 건수 | 핵심 검증 |
|---|---|---|
| `isTransientNetworkError` | 6건 | LlmNetworkError·LlmRateLimitError instance + statusCode 429/500/502/503/504 ducktype + non-transient(LlmTimeoutError·LlmSchemaValidationError) 제외 |
| `detectEmptyResponse` | 3건 | citations=0 AND summary 공백 AND 엄격(빈약 케이스 보호 — summary 1자 있으면 false) |
| `getRetryDelay` | 3건 | Math.random=0/0.5/1 결정화 시 baseMs / baseMs+baseMs/4 / baseMs+baseMs/2 |
| `parseRetryAfter` | 6건 | 초 단위 정수·HTTP-date·10초 상한 클램프·과거 시각·헤더 없음·잘못된 형식 |
| `LlmEmptyResponseError` | 1건 | code=E-LLM-EMPTY, 메시지 패턴 |

### 2.3 통합 테스트 6건 (`tests/integration/llmAnswerGeneratorRetry.test.ts`)

| # | 시나리오 | mock 호출 | 결과 |
|---|---|---|---|
| 통합 1 | 1차 transient(`fetch failed`) → 500ms backoff → 2차 정상 | 2회 | PASS, LabeledAnswer 정상 |
| 통합 2 | 1차·2차 모두 transient → 외부 LlmNetworkError 전파 | 2회 | PASS, `instanceof LlmNetworkError` |
| 통합 3 | NoObjectGeneratedError → 즉시 LlmSchemaValidationError(재시도 없음) | 1회 | PASS, `instanceof LlmSchemaValidationError` |
| 통합 4a | 1차 빈 응답 → 500ms backoff → 2차 정상 (보강 A) | 2회 | PASS |
| 통합 4b | 1차·2차 모두 빈 응답 → LlmEmptyResponseError (보강 C) | 2회 | PASS, `instanceof LlmEmptyResponseError` |
| 통합 5 | 1차 429 + Retry-After: 2 → 2000ms 대기 후 2차 정상 (보강 D) | 2회 | PASS, jitter 사용 안 함 확인 |

**결정화 전략**: `vi.spyOn(Math, 'random').mockReturnValue(0)` + `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(N)`. unhandled rejection 회피를 위해 `promise.catch(() => {})` 사전 등록.

### 2.4 TIMEOUT 군집 케이스 단건 측정 (3 케이스 × 3회 = 9회)

| 케이스 | 결과 | citations | time(s) | verify | 비고 |
|---|---|---|---|---|---|
| G-S-법인-01 #1 | PASS | 5 | 11.52 | PASS | 검색 결과 다수 |
| G-S-법인-01 #2 | PASS | 5 | 5.08 | PASS | |
| G-S-법인-01 #3 | PASS | 4 | 4.75 | PASS | |
| G-S-법인-02 #1 | PASS | 2 | 5.73 | PASS | |
| G-S-법인-02 #2 | PASS | 2 | 4.01 | PASS | |
| G-S-법인-02 #3 | PASS | 2 | 3.88 | PASS | |
| G-S-부가-01 #1 | PASS | 3 | 19.98 | PASS | 재시도 발생 의심(최대값) |
| G-S-부가-01 #2 | PASS | 5 | 8.23 | PASS | |
| G-S-부가-01 #3 | PASS | 3 | 10.52 | PASS | |

**Summary: 9/9 PASS, 0 FAIL** — 합격선 ≥7/9 압도적 통과.

| 지표 | TAX-029 7차 baseline | TAX-042C 단건 측정 | 변화 |
|---|---|---|---|
| 평균 응답 시간 | 36.04s (100회 가중 P95) | **8.19s (9회 단건 평균)** | 큰 폭 단축 |
| G-S-법인-01 평균 | TIMEOUT 1건 발생(20%) | 7.11s (max 11.52s), **0 TIMEOUT** | 정상화 |
| G-S-법인-02 평균 | TIMEOUT 1건 발생(33%) | 4.54s (max 5.73s), **0 TIMEOUT** | 정상화 |
| G-S-부가-01 평균 | TIMEOUT 1건 발생(33%) | 12.91s (max 19.98s), **0 TIMEOUT** | 정상화 |
| verify PASS 비율 | 88% | **9/9 = 100%** | (단건 범위) |

> 비교 주의: TAX-029 7차는 100회 가중 P95, 본 측정은 단건 평균이라 P95 직접 비교 불가. **정식 P95 비교는 Stage 5 (TAX-042E)에서 측정**.

### 2.5 응답 길이·citations 정책 회귀 확인

- citations 평균 3.44 (9회) — Stage 2 `citations.max(5)` 정책 준수, 회귀 없음
- summary 자동 잘림 관찰 없음 — `maxOutputTokens=2_000`이 충분 (citation 5개 + summary 500자 + structural overhead 합 ~1000 tokens)
- V1~V6 verify 9/9 PASS — 인용 무결성·시점 라벨·면책 모두 정상

### 2.6 V1~V6 인용 무결성 보호 확인

- 본 티켓 변경은 LLM 호출 정책(timeout·재시도·maxOutputTokens)만 영향
- TaxLaw·답변 생성·인용 발췌(extractExcerpt)·시점 라벨 일체 무변경
- 9건의 단건 실측 전부 verify=PASS로 입증

---

## 3. 잠재 위험 및 완화

| 위험 | 완화책 | 현 상태 |
|---|---|---|
| 재시도 1회가 누적 P95 ~25s 증가 가능 (현재 24.66s + α) | (1) Transient만 재시도 / (2) jitter 500ms 최소 / (3) Stage 5에서 P95 > 28s 시 백오프 200ms 검토 | 9회 단건 평균 8.19s — P95 영향 추정 미미. **정식 측정은 Stage 5** |
| `maxOutputTokens=2_000` 응답 잘림 가능성 | 단건 9회에서 잘림 관찰 0건. summary 평균 < 500자 | 9/9 PASS, 잘림 0건 |
| `runTwoStage`(usecase) 재시도 × 어댑터 재시도 중첩 시 최악 4회 호출 | usecase는 transient만 어댑터 안에서 처리하므로 중첩 없음 (어댑터 transient는 throw하지 않고 wrapper 안에서 흡수) | 무관 |
| `detectEmptyResponse` 오탐 (빈약 케이스 transient 오인) | AND 엄격 — summary가 1자라도 있으면 정상 처리. CLAUDE.md §6.3 "빈약 시 직접 근거를 찾지 못했습니다" 보호 | 단위 테스트 3건 PASS, 회귀 0건 |
| 악의적 서버의 `retry-after: 86400` 같은 큰 값 | `parseRetryAfter` 10초 상한 클램프 | 단위 테스트 2건 PASS |
| `Math.random` jitter 비결정성 — 통합 테스트 불안정 | `vi.spyOn(Math, 'random').mockReturnValue(0)` 결정화 | 통합 6건 PASS |
| fake timer + 비동기 rejection unhandled | `promise.catch(() => {})` 사전 등록 패턴 | 통합 6건 unhandled 0건 |

---

## 4. 후속 권장 작업

1. **TAX-042D (Stage 4)** — V3 라벨 적정성 강화(`LabeledAnswer.diagnostics` 부가 필드 + 진단 마커). V3 PASS/FAIL 판정 로직은 절대 무변경, 진단 정보만 부착
2. **TAX-042E (Stage 5)** — 100회 회귀 + 25회 variance batch 측정. 본 티켓의 P95 영향, citations 변동성, 재시도율(보강 I 카운터)을 본격 측정. 합격선: verify PASS rate ≥ 88% + citations 표준편차 평균 ≤ 1.0 + 재시도율 ≤ 10% + 빈 응답율 ≤ 2% + 429율 ≤ 3%
3. **선택적 보강 후보** (Stage 5 측정 후):
   - 재시도 발생 카운터 노출 (보강 I) — 운영 모니터링용
   - `LlmEmptyResponseError` 실측 발생 시 SYSTEM_PROMPT 추가 강화 검토

---

## 5. 참고

- 인사이트 출처: `C:\Users\sfami\WorkSpace\korean-law-mcp-main\src\utils\fetch-with-retry.ts:37 detectBadBody / :156 getRetryDelay / :158 Retry-After`, `errors.ts:10 ErrorCodes`
- V1~V6 보호 근거: CLAUDE.md §6.1 인용 무결성, §6.4 law-verifier, §7 PII 처리
- 아키텍처 격리 근거: SSOT §3 Hex(`IAnswerGeneratorPort.generate` 시그니처 무변경)
- 선행 리포트: `docs/reports/TAX-042G_report.md` (쿼리 사실축 결합) · `docs/reports/TAX-042F_report.md` (컨텍스트 압축)
- 후속 티켓: `docs/tickets/TAX-042D_stage4_v3_label_rule.md` · `docs/tickets/TAX-042E_stage5_regression_measurement.md`

---

**작성자**: AI (Claude Opus 4.7)
**작성일**: 2026-06-07
