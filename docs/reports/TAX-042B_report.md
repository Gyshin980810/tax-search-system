# TAX-042B Stage 2 — citations 상한·SYSTEM_PROMPT 가이드·진단 인프라 보강 (구현 리포트)

> 작성자: AI(Claude Opus 4.7) / 작성일: 2026-06-07
> 티켓: [docs/tickets/TAX-042B_stage2_citations_max.md](../tickets/TAX-042B_stage2_citations_max.md)
> 선행: [TAX-042A](./TAX-042A_report.md), [TAX-042-PRE1](./TAX-042-PRE1_report.md)
> 후속: [TAX-042F](../tickets/TAX-042F_input_context_window.md) 신규 — G-S-법인-06 진짜 원인 해결

---

## 1. 변경 사항 요약

### 1.1 파일 변경 목록

| 파일 | 종류 | 변경 내용 |
|---|---|---|
| `src/adapters/llmAnswerGenerator.ts` | 수정 | (a) `answerSchema.citations`에 `.max(5)` 추가, (b) SYSTEM_PROMPT `[citations 선정 규칙]` 4줄 삽입, (c) `answerSchema`·`citationItemSchema` export 추가, (d) catch-all 2곳에 `LlmUnavailableError(err)` cause 보존 |
| `src/adapters/llmQueryRewriter.ts` | 수정 | catch-all 1곳에 `LlmUnavailableError(err)` cause 보존 (양쪽 LLM 단계 진단 정합) |
| `src/domain/errors.ts` | 수정 | `LlmUnavailableError` 생성자에 `cause?: unknown` 매개변수 추가 (Stage 1 Schema/Network/RateLimit 패턴 일관) |
| `tests/unit/llmAnswerGeneratorSchema.test.ts` | 신규 | 단위 테스트 5건 (citations 5개 정상 / NoObjectGenerated 변환 / safeParse 6개 / 5·0개 통과 / citationItemSchema export) |
| `scripts/perf/single.ts` | 신규 | 단일 케이스 N회 진단 측정 임시 스크립트 |
| `package.json` | 수정 | `perf:single` npm script 추가 |

### 1.2 주요 변경

#### (a) Zod 제약 `citations.max(5)` (`llmAnswerGenerator.ts:78`)
```diff
- citations: z.array(citationItemSchema),
+ citations: z.array(citationItemSchema).max(5),
```
LLM이 6개 이상 citation을 반환하면 SDK가 `NoObjectGeneratedError`로 wrap → Stage 1 catch에서 `LlmSchemaValidationError`로 정확 분류.

#### (b) SYSTEM_PROMPT `[citations 선정 규칙]` 4줄 신규 (`llmAnswerGenerator.ts:50-54`)
```
[citations 선정 규칙 — TAX-042B]
- citations 배열은 최대 5개까지. 조문 목록이 5개를 초과하면, 회계사 질문과 가장 직접
  관련된 5개만 선정합니다.
- 선정 우선순위: (1) T1·T2 출처 > (2) 질문 키워드와 직접 매칭되는 조문 > (3) 시행령·시행규칙 본문 > (4) 그 외
```
위치: `[출력 규칙]` 4개 필드 설명 직후, `[라벨링 규칙]` 직전.

#### (c) Schema export 추가 — T2 단위 3을 위해
```diff
- const citationItemSchema = ...
+ export const citationItemSchema = ...
- const answerSchema = ...
+ export const answerSchema = ...
```
사전 grep으로 외부 import 0건 확인 후 안전.

#### (d) catch-all `LlmUnavailableError` cause 보존 (진단 인프라 보강)
TAX-042A에서 Schema/Network/RateLimit 분기는 cause 보존했으나 catch-all `LlmUnavailableError`는 누락. 본 티켓 단건 실측에서 catch-all 폴백의 원인 진단이 불가능해 발견되었고 즉시 보강.

- `llmAnswerGenerator.ts:292·295`: `throw new LlmUnavailableError()` → `throw new LlmUnavailableError(err)`
- `llmQueryRewriter.ts:70`: 동일 패턴 적용 (양쪽 LLM 단계 정합)
- `errors.ts`: `LlmUnavailableError` 생성자에 `cause?: unknown` 매개변수 추가 (Stage 1 패턴 일관)

---

## 2. 검증 결과

### 2.1 정적 검증

| 검증 단계 | 결과 |
|---|---|
| `npm run lint` | ✅ PASS (0 errors, 1 사전 warning — 본 티켓 무관) |
| `npm run typecheck` | ✅ **PASS (0 errors)** |
| `npm run test` (전체) | ✅ **280/280 PASS** (Test Files 15, 신규 단위 5건 + 기존 275건, Duration 6.57s) |
| `npm run build` | ✅ **PASS** (Compiled 4.3s + TypeScript 4.1s + Static 3/3 + 라우트 5개) |
| law-verifier V1~V6 | ✅ 무변경 (CLAUDE.md §6.4 절대 준수) |
| 정상 경로 (try 블록 215-257) | ✅ 무변경 |
| `citationItemSchema` 필드 | ✅ 무변경 |
| `extractExcerpt`·`buildLawsContext` | ✅ 무변경 |

### 2.2 단위 테스트 5건 결과 (`tests/unit/llmAnswerGeneratorSchema.test.ts`)
- 단위 1: citations 5개 정상 응답 → adapter.generate() 정상 종료, length === 5 ✅
- 단위 2: `NoObjectGeneratedError` → `LlmSchemaValidationError` + code `E-LLM-SCHEMA` ✅
- 단위 3: `answerSchema.safeParse(6개)` → `success === false` ✅
- 단위 3 보강: 5개·0개 모두 통과 (.max는 상한만 강제) ✅
- 단위 3 보강 2: `citationItemSchema` export로 외부 검증 가능 ✅

### 2.3 단건 실측 결과 (`scripts/perf/single.ts`)

#### G-1 회귀 확인 (1회)
```
[1/1] G-1 PASS citations=3 time=22.24s verify=PASS
Summary: 1/1 PASS, avg citations=3.00, avg time=22.24s
```
✅ 회귀 0 — Stage 2 변경이 정상 케이스에 악영향 없음.

#### G-S-법인-06 진단 측정 (3회, cause 보존 후)
```
[1/3] G-S-법인-06 FAIL E-API-UNAVAILABLE time=2.28s
         detail: 국세법령 API에 연결할 수 없습니다.
[2/3] G-S-법인-06 FAIL E-LLM-UNAVAILABLE time=3.50s
         detail: ... | cause=AI_APICallError: Your input exceeds the context window of this model.
[3/3] G-S-법인-06 FAIL E-LLM-UNAVAILABLE time=2.28s
         detail: ... | cause=AI_APICallError: Your input exceeds the context window of this model.
Summary: 0/3 PASS, 3 FAIL, avg time=2.69s
```

---

## 3. ⚠️ 핵심 진단 — 본 티켓의 한계와 후속 작업 권고

### 3.1 진단 결과

G-S-법인-06의 진짜 실패 원인은 **출력 토큰 폭주가 아니라 입력 컨텍스트 윈도우 초과**:
- `AI_APICallError: Your input exceeds the context window of this model.`
- `APICallError.isInstance === true`였으나 statusCode가 429·5xx 아님 (400 Bad Request 추정) → catch-all `LlmUnavailableError`로 정상 폴백
- 입력 측면 결함 → 출력 측면 처방인 Stage 2 `.max(5)`로 해결 불가
- 마찬가지로 Stage 3(maxTokens·retry)도 출력 측면 처방 → 효과 0

### 3.2 본 티켓 처방의 실제 가치

| 변경 | G-S-법인-06 직접 해결 | 일반 가치 |
|---|---|---|
| `citations.max(5)` | ❌ 출력 제어로는 입력 초과 불해결 | ✅ 다른 거대 출력 케이스(시행령 다조항류)에 예방 효과 |
| SYSTEM_PROMPT 우선순위 가이드 | ❌ 동일 | ✅ 일반적 답변 품질 개선·환각 방지 |
| catch-all cause 보존 | — 진단 인프라 | ✅✅ **큰 부가가치** — 향후 모든 LLM 진단의 기반 |

### 3.3 후속 티켓 신규 — TAX-042F

진짜 해결책: **입력 컨텍스트 축소**. 별도 티켓으로 분리해 작성 완료.
- 파일: `docs/tickets/TAX-042F_input_context_window.md`
- 범위: 검색 결과 콘텐츠 사이즈 추정 + 임계 초과 시 사전 축약/발췌 또는 조문 단위 분할 전송
- 1티켓=1PR 원칙 준수

### 3.4 1차 시도 E-API-UNAVAILABLE에 대한 별도 노트

3회 중 1번씩 첫 시도에 `E-API-UNAVAILABLE`이 나옴 (국세법령 API 외부 검색 단계). 본 티켓·TAX-042F 모두 범위 밖. 외부 API 안정성·재시도 정책은 별도 분석 필요(권고: Stage 5 100회 회귀에서 빈도 모니터링 후 필요 시 검색 어댑터 재시도 티켓 분리).

---

## 4. 잠재 위험

| 위험 | 평가 | 완화책 |
|---|---|---|
| `.max(5)`가 정상 케이스에서도 제약 발생 | 낮음 — G-1 회귀 PASS(citations=3) | Stage 5 100회 회귀에서 V1 출처 존재 실패율 모니터링 |
| SYSTEM_PROMPT 길이 증가로 입력 토큰 ~30 토큰 증가 | 무시 | 비용 영향 없음 |
| `answerSchema`·`citationItemSchema` export 추가 | 0 — 외부 import 0건 사전 확인 | 향후 다른 모듈에서 의도적으로 활용 가능 |
| `LlmUnavailableError` 생성자 시그니처 변경 | 낮음 — `cause`는 optional, 기존 호출부 모두 호환 | typecheck·test PASS로 검증 |
| 단건 측정 스크립트가 OpenAI 비용 발생 | 무시 — 1회 ~$0.005, 임시 진단 도구 | — |
| **G-S-법인-06 직접 해결 못함** | **중간** — 회계사가 같은 패턴 마주칠 가능성 | **TAX-042F로 즉시 분리·우선 처리 권고** |

---

## 5. 다음 단계 인입 조건

- ✅ 회귀 0건 (280/280 PASS)
- ✅ V1~V6 무변경, 정상 경로(try 블록) 무변경
- ✅ 빌드 깨끗 (TypeScript·Static 모두 PASS)
- ✅ 진단 인프라 보강으로 향후 분석 정확도 ↑
- ⚠️ G-S-법인-06 직접 해결은 TAX-042F로 분리 (본 티켓 처방은 출력 측면, 진짜 원인은 입력 측면)

**다음 권고 순서:**
1. **TAX-042F 우선 진행** (G-S-법인-06 결정적 결함 직접 해결)
2. TAX-042C Stage 3 (출력 maxTokens·retry — 본 진단으로는 효과 미지수, 보류 가능)
3. TAX-042D Stage 4 (V3 라벨 강화 — 일반 품질 개선)
4. TAX-042E Stage 5 (100회 회귀 — 모든 처방 후 일괄)

---

## 6. 추후 검토 사항 (별도 티켓 후보)

- **TAX-042F**: 입력 컨텍스트 윈도우 초과 처리 (본 진단으로 신규 작성 완료)
- **외부 API 안정성**: 1차 시도 `E-API-UNAVAILABLE` 빈도·원인 분석 → 검색 어댑터 재시도 정책 (Stage 5 모니터링 후)
- **메트릭 라벨링**: 신규 ErrorCode 3개(Schema·Network·RateLimit) + cause를 운영 로그·`measureP95.ts`의 verifyLog에 통합 (Stage 5 분포 분석 정확도)

---

## 7. CLAUDE.md §10 표준 보고 블록

### 변경 사항 요약
- **파일 변경 목록**: §1.1 표 참조 (코드 3, 테스트 1 신규, 스크립트 1 신규, package.json 1)
- **주요 변경**: citations 상한 .max(5) + SYSTEM_PROMPT 우선순위 가이드 + 진단 인프라 보강(catch-all cause 보존)
- **검증 결과**: lint·typecheck·test 280/280·build 모두 PASS / G-1 회귀 PASS / G-S-법인-06 진단으로 진짜 원인(입력 컨텍스트 초과) 확정
- **잠재 위험**: §4 표 참조. 핵심 = G-S-법인-06은 TAX-042F로 분리 필요
- **리포트**: docs/reports/TAX-042B_report.md (본 파일)

---

**작성자**: AI (Claude Opus 4.7)
**작성일**: 2026-06-07
