# TAX-042-PRE1 — 사전 type 결함 정리 (구현 리포트)

> 작성자: AI(Claude Opus 4.7) / 작성일: 2026-06-07
> 선행: [TAX-042A_report.md](./TAX-042A_report.md) §5에서 분리 권고된 사전 결함
> 다음 단계: TAX-042B Stage 2 (citations.max(5) + SYSTEM_PROMPT 가이드)

---

## 1. 배경

TAX-042A 완료 리포트 §5에서 분리 권고한 사전 결함을 정리.
Stage 5(100회 회귀 측정)를 돌리기 위해 `npm run build`의 TypeScript 단계가 깨끗해야 하므로 우선 처리.

본 작업은 진단 인프라가 아니라 **잔류 타입 결함 청소**이며, 런타임 동작은 무변경.

---

## 2. 변경 사항 요약

### 2.1 파일 변경 목록

| 파일 | 종류 | 변경 내용 |
|---|---|---|
| `scripts/perf/measureP95.ts` | 수정 | `TemporalContext` 객체 리터럴에 필수 `requestedAt: Date` 추가 |
| `tests/unit/llmAnswerGeneratorErrors.test.ts` | 수정 | `NoObjectGeneratedError` 픽스처 `usage`에 `inputTokenDetails`·`outputTokenDetails`(내부 필드 모두 `undefined` 명시) 추가 |

### 2.2 주요 변경

#### (a) `scripts/perf/measureP95.ts:223`
```diff
- const temporal: TemporalContext = { explicit: false }
+ const temporal: TemporalContext = { requestedAt: new Date(), explicit: false }
```

`TemporalContext` 정의(`src/domain/TemporalContext.ts`)는 `requestedAt: Date` 필수.
기본값(현행 기준, 명시 시점 없음) 의미는 `requestedAt = new Date()` + `explicit = false`로 동일 표현.

#### (b) `tests/unit/llmAnswerGeneratorErrors.test.ts:74`
Vercel AI SDK v6의 `LanguageModelUsage` 타입이 `inputTokenDetails`·`outputTokenDetails` 객체를 **필수**로 요구.
내부 필드(`noCacheTokens`·`cacheReadTokens`·`cacheWriteTokens`·`textTokens`·`reasoningTokens`)는 `number | undefined`라서 `undefined`로 명시.

테스트의 검증 의도(catch 분기 — Schema/Network/RateLimit 분류) 무변경.
픽스처 형식만 SDK 타입에 정합화.

---

## 3. 검증 결과

| 검증 단계 | 결과 |
|---|---|
| `npm run lint` | ✅ PASS (0 errors, 1 warning — 사전 unused import, 본 티켓 무관) |
| `npm run typecheck` | ✅ **PASS (0 errors)** — 사전 결함 모두 해소 |
| `npm run test` (전체) | ✅ **275/275 PASS** (Test Files 14, Duration 6.27s) |
| `npm run build` | ✅ **PASS** — Compiled 4.2s + TypeScript 3.5s + Static 3/3 + 라우트 5개 정상 빌드 |
| law-verifier V1~V6 | ✅ 무변경 |
| 정상 경로 | ✅ 무변경 (런타임 동작 영향 0) |

---

## 4. 잠재 위험

| 위험 | 평가 | 완화책 |
|---|---|---|
| `measureP95.ts`의 `requestedAt = new Date()`가 반복 실행 간 미세 차이 발생 | 없음 — 시점 라벨은 `explicit=false`이므로 어댑터는 `requestedAt`을 [현행] 표기에 사용 (회귀 측정 의미 무변경) | — |
| 테스트 픽스처의 `undefined` 명시는 SDK 타입 호환을 위한 형식적 보강 | 없음 — 테스트가 검증하는 catch 분기 동작에 영향 0 | — |

---

## 5. 다음 단계 인입 조건

- ✅ 회귀 0건 (275/275 PASS)
- ✅ 빌드 깨끗 (TypeScript·정적 생성 완전 PASS)
- ✅ 정상 경로 무변경
- ✅ V1~V6 무변경

**TAX-042B Stage 2 진입 가능** + **Stage 5(100회 회귀 측정) 인프라 정상**.

---

## 6. CLAUDE.md §10 표준 보고 블록

### 변경 사항 요약
- **파일 변경 목록**: §2.1 표 참조 (2개 파일)
- **주요 변경**: SDK v6 `LanguageModelUsage`·도메인 `TemporalContext`의 필수 필드 정합 (런타임 동작 무변경)
- **검증 결과**: lint·typecheck·test·build 모두 PASS, 275/275, 사전 결함 0건
- **잠재 위험**: 없음 (형식적 보강)
- **리포트**: docs/reports/TAX-042-PRE1_report.md (본 파일)

---

**작성자**: AI (Claude Opus 4.7)
**작성일**: 2026-06-07
