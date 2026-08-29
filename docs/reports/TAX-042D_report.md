# TAX-042D 리포트 — V3 라벨 결정 규칙 강화 (SYSTEM_PROMPT 라벨 결정 표 + 진단 마커)

> 작성일: 2026-06-08
> 티켓: TAX-042D Stage 4 (서브태스크 D-1·D-2·D-3 종합)
> 풀세트 보강 매핑: **E(verifyMarker 3종) · F(tierMatchGrade 3등급) · G(v3Groups 세부 진단)**
> 선행 baseline: TAX-029/040/041 7차 (V3 실패율 13.5%, V6 1%)
> 보호 대상 (CLAUDE.md §6.4): `lawVerifier.checkV3`·`TIER_ALLOWED_LABELS` 값·`runTwoStage`·회계사 화면 라벨 표시 모두 무변경

---

## 1. 변경 사항 요약

### 1.1 파일 변경 목록

| 파일 | 변경 유형 | 주요 변경 |
|---|---|---|
| `src/domain/LabeledAnswer.ts` | 수정 | `VerifyDiagnostics` interface 신규 + `LabeledAnswer.diagnostics?` 옵션 필드 추가 |
| `src/adapters/verifyDiagnostics.ts` | 신규 | `computeVerifyDiagnostics` 순수 함수 + `TIER_ALLOWED_LABELS` 재사용으로 V3 진단 마커 산출 |
| `src/adapters/lawVerifier.ts` | 수정 | `TIER_ALLOWED_LABELS` `export` 키워드 1단어 추가 (값 자체 무변경 — 단일 진실 원천 보장) |
| `src/adapters/llmAnswerGenerator.ts` | 수정 | `SYSTEM_PROMPT`에 `[라벨 결정 표]` 7줄 매트릭스 + 절대 금지 4줄 신규 추가 (기존 6개 섹션 모두 byte-level 보존) |
| `src/usecases/generateAnswer.ts` | 수정 | `computeVerifyDiagnostics` import + `runTwoStage` 종료 직후 `diagnostics` 1줄 부착 |
| `tests/unit/lawVerifierDiagnostics.test.ts` | 신규(4건) | (a) T3+🟡 VERIFIED·(b) T3+🟢 LABEL_MISMATCH·(c) T1+⚪ PARTIAL_VERIFIED·(d) `checkV3` 일치성 회귀 |
| `tests/unit/generateAnswer.test.ts` | 수정(+1건) | T3+🟢 → `verifyMarker=LABEL_MISMATCH` Usecase 음성 단언 |
| `scripts/perf/singleDiagnostics.ts` | 신규 | 단건 측정 + diagnostics 4종 raw 추출 + JSON 누적 저장 (`scripts/perf/single.ts`와 독립) |
| `package.json` | 수정 | `perf:single-diagnostics` 1줄 추가 |

### 1.2 풀세트 보강 매핑 (E·F·G)

| 보강 | 의미 | 구현 위치 |
|---|---|---|
| **E** `verifyMarker` 3종 | `VERIFIED`/`PARTIAL_VERIFIED`/`LABEL_MISMATCH`로 안전/위험 방향 분리 | `verifyDiagnostics.ts` |
| **F** `tierMatchGrade` 3등급 | `exact`(정확)·`loose`(over-cautious)·`mismatch`(위험) 등급화 | `verifyDiagnostics.ts` |
| **G** `v3Groups` 세부 진단 | `labelEnum`·`tierMapping`·`deprecation` 3가지 그룹별 pass/fail | `verifyDiagnostics.ts` |

### 1.3 SYSTEM_PROMPT `[라벨 결정 표]` 신규 섹션

`llmAnswerGenerator.ts`의 `SYSTEM_PROMPT`에 `[라벨링 규칙]` 직후 + `[시점 라벨 규칙]` 직전에 삽입.

```
[라벨 결정 표 — Tier × 사안 적용 정도 (TAX-042D Stage 4 — V3 정확성 강화)]
| 출처 Tier               | 직접 적용 | 유사·간접 적용 | 관련 쟁점만 | 폐지·삭제 |
|-------------------------|-----------|----------------|-------------|------------|
| T1·T2 (법령·시행령·부칙)| 🟢직접근거 | 🟢직접근거     | 🟢직접근거  | ⚫폐지     |
| T3 (예규·심판례·해석례) | 🟡유사사례 | 🟡유사사례     | ⚪참고자료  | ⚫폐지     |
| T4 (판례)               | 🟡유사사례 | 🟡유사사례     | ⚪참고자료  | ⚫폐지     |

⚠️ 라벨 결정 시 절대 금지 (V3 FAIL 직결):
- (T3)·(T4) 출처 → 🟢직접근거 금지 (위험 방향, 회계사가 판례를 법령처럼 인용)
- (T1)·(T2) 출처 → ⚪참고자료로 후퇴 금지 (안전 방향이지만 직접 근거 누락)
```

### 1.4 V3 PASS/FAIL 판정 로직 무변경 보장 (CLAUDE.md §6.4)

- `lawVerifier.ts` `checkV3` 함수 본문·`TIER_ALLOWED_LABELS` 값 byte-level 무변경 (`export` 키워드만 1단어 추가).
- `runTwoStage`·`VerifyState`·`TwoStageSpec` 무변경. `diagnostics`는 `runTwoStage` **종료 직후** 1지점에서만 부착 — Stage 1 `preRetry`·Stage 2 `recover` 중간 verify에는 부착 없음.
- `IAnswerGeneratorPort`·`ILawVerifierPort`·`answerSchema`·`citationItemSchema`·`CitationLabel`·`TrustTier` enum 모두 무변경.
- 회계사 화면 라벨 표시 변경 없음 — `diagnostics`는 운영·로그 전용 옵션 필드(`diagnostics?: VerifyDiagnostics`).

---

## 2. 측정 결과

### 2.1 단건 측정 9회 raw (3 케이스 × 3회)

측정 일시: 2026-06-08 04:42:22 ~ 04:43:56 (UTC). 측정 도구: `npm run perf:single-diagnostics`. raw 로그: `docs/reports/_data/TAX-042D/*.json` (3개 파일 보관).

| # | 케이스 | 회차 | 시간(s) | outcome | cit | verify | V1 | V2 | V3 | V4 | V5 | V6 | verifyMarker | grade |
|---|---|---|---:|---|---:|---|---|---|---|---|---|---|---|---|
| 1 | G-S-소득-03 | 1 | 11.45 | PASS | 2 | PASS | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | VERIFIED | exact |
| 2 | G-S-소득-03 | 2 | 15.34 | **FAIL** | - | - | - | - | - | - | - | - | - | - |
| 3 | G-S-소득-03 | 3 | 8.72 | PASS | 5 | PASS | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | VERIFIED | exact |
| 4 | G-S-부가-02 | 1 | 10.48 | PASS | 5 | PASS | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | VERIFIED | exact |
| 5 | G-S-부가-02 | 2 | 9.63 | PASS | 5 | PASS | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | VERIFIED | exact |
| 6 | G-S-부가-02 | 3 | 8.91 | PASS | 2 | PASS | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | VERIFIED | exact |
| 7 | G-5 | 1 | 5.56 | PASS | 2 | PASS | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | VERIFIED | exact |
| 8 | G-5 | 2 | 4.96 | PASS | 2 | PASS | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | VERIFIED | exact |
| 9 | G-5 | 3 | 3.48 | PASS | 0 | PASS | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | VERIFIED | exact |

(#2 FAIL은 `E-VERIFY-FAIL` 도메인 에러 — 재시도 후에도 검증 실패해 `runTwoStage`가 throw. verify 분기에 도달했으나 PASS 상태로 수렴 못함 → 회계사에 답변 노출 안 됨, 안전 측 동작 정상.)

### 2.2 합격선 대비

| 지표 | 목표 | 측정값 | 결과 |
|---|---|---|---|
| **단건 PASS 비율** | ≥ 7/9 (77.8%) | **8/9 (88.9%)** | ✓ 통과 |
| **V3 PASS 비율** | (집계만) | 8/9 (88.9%) — 도달한 verify 중 V3 LABEL_MISMATCH 0건 | ✓ |
| **`verifyMarker` 분포** | (집계만) | `VERIFIED` × 8, N/A × 1 | ✓ |
| **`tierMatchGrade` 분포** | (집계만) | `exact` × 8, N/A × 1 | ✓ |
| **`v3Groups` 전 항목 pass** | (집계만) | 8/8 (labelEnum·tierMapping·deprecation 모두) | ✓ |

### 2.3 TAX-029 7차 baseline 13.5% 대비 추정

- TAX-029 7차 baseline: 100회 가중 순회 기준 **V3 실패율 13.5%** (V3 LABEL_MISMATCH 군집 13/100 추정).
- TAX-042D-3 단건 9회 표본: V3 LABEL_MISMATCH **0/8** (PASS 도달분 기준), `tierMatchGrade=mismatch` 0건.
- **통계 한계**: 표본 9건은 13.5% 단건 직접 비교가 통계적으로 불가능(95% CI ±15%p 수준). SYSTEM_PROMPT 강화로 라벨 결정이 결정론에 가까워졌다는 **정성적 신호**로만 해석하고, 본 검증은 **TAX-042E (Stage 5 100회 회귀)로 위임**.
- 응답 시간 평균: 8.72s (FAIL 1건 포함). PASS 8건 평균: 7.95s — TAX-029 7차 LLM 단계 평균 9.6s 대비 약 17% 단축 추정(SYSTEM_PROMPT 명시 가이드로 LLM 결정 비용 감소 추정).

### 2.4 품질 게이트 (D-1·D-2 통합)

| 명령 | 결과 |
|---|---|
| `npm run lint` | PASS (사전 무관 warning 1건만: `beforeEach` 미사용) |
| `npx tsc --noEmit` | 본 티켓 무관 사전 회귀 3건(`tests/integration/llmAnswerGeneratorRetry.test.ts:128-130` `NoObjectGeneratedError` strict, Task #72로 분리) |
| `npx vitest run` | **346/346 PASS** (D-1 +4 단위, D-2 +1 Usecase 음성 단언) |

---

## 3. 잠재 위험

1. **SYSTEM_PROMPT 길이 증가 → 토큰 비용**: `[라벨 결정 표]` 신규 7줄 매트릭스 + 절대 금지 4줄 = 약 +400 tokens 추정. GPT-4o-mini input 0.15$/1M × 100회 회귀 시 +0.006$/100회 — 무시 가능 수준이나 응답 시간에 +50~100ms 가산 가능.
2. **강화 가이드의 보수화 우려**: T3·T4 출처에서 🟢→🟡 보수화 가능 → 회계사가 직접 근거를 더 적게 보는 부작용. 측정 8건 모두 `tierMatchGrade=exact`로 over-cautious 신호 없음(`PARTIAL_VERIFIED` 0건).
3. **`diagnostics` V3 판정 오용 위험**: `diagnostics`는 운영·로그 전용이며 V3 PASS/FAIL은 `lawVerifier.checkV3`가 단독 판정. 향후 UI에서 `diagnostics`를 직접 사용해 회계사 화면 라벨을 가공하면 보호 깨짐 — `diagnostics` 필드 JSDoc에 명시.
4. **G-S-소득-03 FAIL 1건**: 회차 2에서 `E-VERIFY-FAIL`. 재시도 후에도 검증 실패 → 회계사에 답변 미노출(안전 측 정상 동작). 다만 SYSTEM_PROMPT 강화로도 잡지 못한 케이스가 있음을 시사 → TAX-042E 100회 회귀에서 군집 여부 확인 필요.
5. **사전 회귀 3건 잔여**: `NoObjectGeneratedError` 생성자 strict 타입 위반(Task #72) — 본 D-2가 만진 4개 파일과 무관, 별도 PR로 분리.

---

## 4. 후속 권고

| 권고 | 우선순위 | 근거 |
|---|---|---|
| **TAX-042E** Stage 5 100회 회귀 측정 | High | 단건 9건은 통계 의미 제한. SYSTEM_PROMPT 강화 + 보강 E·F·G 효과를 100회 가중 순회로 V3 실패율 13.5% 대비 정량 검증 필요 |
| ~~TAX-042F~~ `NoObjectGeneratedError` strict 보정 (Task #72) | **완결 (부록 A 참조, 2026-06-08)** | 사전 회귀 1건. 옵션 A 결정으로 본 리포트 부록 A에 통합 — 명명 충돌(TAX-042F는 별도 작업 점유)로 별도 티켓 미부여 |
| **`deprecation` sourceType 강화** | Low | 측정 표본에 폐지 조문 없어 검증 미실시. 별도 티켓 후보 |
| **`diagnostics` 운영 로그 적재** | Low | Stage 5 회귀에서 `verifyMarker` 분포 추적 → 골든셋 회귀 메트릭 후보 |

---

## 5. 메모리 업데이트 권고

- `MEMORY.md`에 `project_tax042d` 신규 entry 1줄 추가 권고:
  - 내용: "TAX-042D Stage 4 완결(2026-06-08): SYSTEM_PROMPT [라벨 결정 표] + 진단 마커 3종(verifyMarker·tierMatchGrade·v3Groups), 단건 8/9 PASS·V3 LABEL_MISMATCH 0건, 100회 회귀는 TAX-042E로 위임. V3 PASS/FAIL 판정·회계사 화면 라벨 무변경."
  - 참조: 본 리포트 + raw 로그 `docs/reports/_data/TAX-042D/*.json` 3개

---

## 부록 A — 발견된 사전 회귀 1건 정리 (`NoObjectGeneratedError` strict 보정)

> 작업 시점: 2026-06-08
> 추가 경위: TAX-042D-3 진행 중 단일 파일 tsc 검증에서 발견된 사전 회귀 3건 중 1건. 본 D-1·D-2·D-3 본체와 코드 의존성 없음. 명명 충돌(`TAX-042F`는 입력 컨텍스트 윈도우 처리 작업이 이미 점유)로 별도 티켓 미부여, 본 리포트 부록으로 통합(회계사 옵션 A 결정).

### A.1 변경 사항 요약

**파일 변경:** `tests/integration/llmAnswerGeneratorRetry.test.ts` (1곳, 통합 3 mock)

**주요 변경:**

Vercel AI SDK v6 `NoObjectGeneratedError` 생성자 옵션 타입 정의(`node_modules/ai/src/error/no-object-generated-error.ts:44~58`)에서 `response`/`usage`/`finishReason`은 **필수 필드**(`| undefined` 불가). 기존 테스트에서 세 필드에 `undefined`를 넘기고 있어 strict 타입 검사 거부.

테스트 의도는 "`NoObjectGeneratedError` 발생 시 어댑터가 `LlmSchemaValidationError`로 분류·전파하는가"만 검증하므로, 객체 내용은 무관. **타입 정합 minimal mock**으로 교체:

| 필드 | 기존 | 변경 후 |
|---|---|---|
| `response` | `undefined` | `{ id: 'mock-id', timestamp: new Date(), modelId: 'mock-model' }` (`LanguageModelResponseMetadata` 필수 3필드 충족) |
| `usage` | `undefined` | 7필드 모두 `undefined` 채운 null usage 구조 (`createNullLanguageModelUsage` 출력 형태와 동일) |
| `finishReason` | `undefined` | `'error'` (`FinishReason` union 중 의미 부합 값) |

**보호 재확인:**
- ❌ `OpenAIAnswerGeneratorAdapter` 본체 수정 — **무변경** (테스트 mock만 손봄)
- ❌ 검증 로직·재시도 wrapper·도메인 에러 분류 — **무변경**
- 본 수정은 런타임 동작과 무관, **타입 검사 통과**만이 목적

### A.2 검증 결과

| 검증 | 결과 |
|---|---|
| `npx tsc --noEmit` | **EXIT_CODE=0** (이 1건 사전 회귀 해소) |
| `npx vitest run tests/integration/llmAnswerGeneratorRetry.test.ts` | **6/6 PASS** (통합 1·2·3·4a·4b·5 전건) |
| `npx vitest run` (전체) | **346/346 PASS** (회귀 0건) |

통합 3 자체가 그대로 PASS — 런타임 동작은 사전과 동일하고 타입 검사만 통과하도록 보강.

### A.3 잠재 위험

- AI SDK 메이저 버전 업데이트 시 `LanguageModelResponseMetadata`·`LanguageModelUsage`·`FinishReason` 타입이 깨지면 본 mock도 동기화 필요. 다만 검증 로직과 무관한 테스트 mock이므로 영향 범위는 본 파일 1곳에 한정.
- `as never` 타입 단언 우회가 아니라 **실제 타입에 부합하는 minimal valid 객체**로 채워 의도 명확.

### A.4 미해결 사전 회귀

- 본 부록으로 사전 회귀 3건 중 1건 해소. 나머지 2건은 본 PR과 무관(추적 필요 시 별도 티켓).

---

**변경 범위 (CLAUDE.md §6.4 보호 재확인):**
- ❌ `lawVerifier.checkV3` 본문 수정 — **무변경**
- ❌ `TIER_ALLOWED_LABELS` 값 수정 — **무변경** (`export` 1단어 추가만)
- ❌ `runTwoStage`·`VerifyState`·`TwoStageSpec` 수정 — **무변경**
- ❌ 회계사 화면 라벨 표시 수정 — **무변경**
- ❌ `CitationLabel`·`TrustTier` enum 수정 — **무변경**
- ✅ `diagnostics`는 옵션 필드, 운영·로그 전용 — 회계사 답변 본문에 영향 없음

**리포트:** `docs/reports/TAX-042D_report.md`
**raw 로그:** `docs/reports/_data/TAX-042D/G-S-소득-03_*.json`·`G-S-부가-02_*.json`·`G-5_*.json` (3개)
