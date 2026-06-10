# TAX-040 LLM 타임아웃 정합 (10초 → 25초)

> 작성자: AI(Claude Opus 4.7) / 작성일: 2026-06-05
> 배경: TAX-029 P95 측정 결과 90% 실패 — 답변 생성 LLM_TIMEOUT_MS(10초)가 PRD §7.1 합격선(15초)·PRD §13 E-LLM-TIMEOUT(30초)와 모두 정합 깨짐
> 게이트 역할: TAX-029-2 재측정 → Phase 4 게이트 해제 경로의 선행 작업

---

## Metadata

- **Type**: BUG (사양 정합 깨짐)
- **Severity**: major (Phase 4 게이트 차단)
- **Layer**: adapter
- **Milestone**: Post-MVP (Phase 4 진입 게이트)
- **Estimated Size**: S (2파일 + 회귀 테스트)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

두 LLM 어댑터의 타임아웃 상수가 **10초**로 박혀 있어 PRD 사양과 정합이 깨져 있습니다.

```typescript
// src/adapters/llmAnswerGenerator.ts:17
const LLM_TIMEOUT_MS = 10_000

// src/adapters/llmQueryRewriter.ts:12
const LLM_TIMEOUT_MS = 10_000
```

**정합 깨짐 매트릭스:**

| 위치 | 값 | 관련 PRD 정의 | PRD 값 | 정합 |
|---|---|---|---|---|
| `llmAnswerGenerator.ts:17` | 10초 | PRD §13 E-LLM-TIMEOUT | 30초 | ❌ |
| `llmAnswerGenerator.ts:17` | 10초 | PRD §7.1 누적 P95 | 15초 | ❌ |
| `llmQueryRewriter.ts:12` | 10초 | (동일) | (동일) | ❌ |

### 1.2 측정으로 드러난 영향 (TAX-029)

`docs/reports/TAX-029_p95_baseline_2026-06-05.json`:

| 단계 | 평균 | P50 | P95 | Max | 진단 |
|---|---|---|---|---|---|
| rewrite | 1.74s | 1.50s | 3.38s | **10.01s** | Max가 정확히 타임아웃에 박힘 |
| answer | 8.84s | **10.00s** | **10.02s** | **10.02s** | P50부터 전부 타임아웃에 박힘 |

**100회 중 90건이 답변 생성 단계에서 10초 타임아웃에 걸려 측정 무효**.

### 1.3 기대 동작

1. 두 어댑터의 `LLM_TIMEOUT_MS`를 **25초**로 상향한다.
2. PRD §7.1 합격선(15초) 안전 측정 가능 + PRD §13(30초) 한도 내 + 사용자 대기 시간 합리.
3. `npm run perf:p95` 재측정 시 정상 표본 ≥ 90건 + 누적 P95의 자연 분포 산출 가능.

### 1.4 영향·중요도

- **Phase 4 진입 게이트 차단 해제의 필수 선행 작업**.
- 운영 환경에서도 동일 문제: 답변 생성이 10초 넘으면 사용자에게 무조건 에러 노출 — 사용 경험·정확성 모두 저하.
- 변경 반경 최소: 두 파일의 상수 1개씩 + 주석.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/adapters/llmAnswerGenerator.ts` (수정) — 라인 16~17, 주석 + 상수
- `src/adapters/llmQueryRewriter.ts` (수정) — 라인 11~12, 주석 + 상수
- `tests/integration/llmAnswerGenerator.test.ts` (참조 전용, 변경 없음 예상) — AbortError → LlmTimeoutError 변환 테스트는 타임아웃 값과 독립

### 2.2 PRD 정의 (변경 없음)

- **PRD §7.1**: "RAG 응답 시간 (LLM 2회 + 검증) < 15초 (P95)"
- **PRD §13 E-LLM-TIMEOUT**: "LLM 응답 시간 초과 (30초) — 1회 재시도 후 실패 처리"
- **PRD §15.2**: "응답시간 P95 < 15초, n=100"

### 2.3 타임아웃 값 결정 근거 (25초)

| 후보 | 분석 |
|---|---|
| 15초 | PRD §7.1 합격선과 동일 — **누적이 아니라 답변 생성 단독 한도에 사용하면 안전 마진 없음**. 14~15s 케이스도 잘림. ❌ |
| 25초 | PRD §13(30초)보다 짧고, P95 합격선(15초) 안전 측정 가능 + 사용자 대기 한도. ✅ |
| 30초 | PRD §13 E-LLM-TIMEOUT과 일치하지만 사용자 대기 시간 과다. △ |

**권장 25초** — 답변 생성 단독 분포(평균 8.84s, P95 ~10~14s 추정)에서 99% 이상 자연 완료 가능 + PRD §13 한도 내.

---

## 3. Scope (작업 범위) ⭐ 가장 중요

### 3.1 허용되는 변경

- [x] `src/adapters/llmAnswerGenerator.ts:16~17` — `LLM_TIMEOUT_MS = 10_000` → `25_000`, 주석 정합 + TAX-029·TAX-040 참조 명시
- [x] `src/adapters/llmQueryRewriter.ts:11~12` — 동일
- [x] (없으면) 회귀 테스트 추가 검토 — 단, 기존 LlmTimeoutError 변환 테스트가 이미 동작 검증 중이라 신규 추가 불필요

### 3.2 금지되는 변경

- ❌ PRD §7.1·§13 사양 값 변경 (15초·30초는 사양 — 본 티켓은 코드 정합만)
- ❌ AbortController·timer 로직 구조 변경 (값만 변경)
- ❌ 다른 어댑터(`nationalTaxLaw.ts` fetch 래퍼 5초 등) 타임아웃 변경 — 본 티켓 범위 밖
- ❌ 재시도 정책(usecase의 V1·V2~V6 복구) 변경
- ❌ LLM 모델 변경
- ❌ `package.json` 의존성 추가

---

## 4. Strategy (구현 힌트)

1. **`src/adapters/llmAnswerGenerator.ts` 수정**

   변경 전(16~17):
   ```typescript
   /** LLM API 응답 타임아웃 (10초) */
   const LLM_TIMEOUT_MS = 10_000
   ```

   변경 후:
   ```typescript
   /**
    * LLM API 응답 타임아웃 (25초)
    *
    * PRD §7.1 누적 P95 < 15초·PRD §13 E-LLM-TIMEOUT 30초와 정합.
    * 25초 = (P95 합격선 15s) + 안전 마진 10s, PRD §13 한도 내.
    * TAX-029 측정에서 10초 박힘이 90% 실패를 유발해 TAX-040으로 상향.
    */
   const LLM_TIMEOUT_MS = 25_000
   ```

2. **`src/adapters/llmQueryRewriter.ts` 수정** — 위와 동일한 패턴.

3. **회귀 게이트**: `npx vitest run` → 253/253 PASS 유지

4. **재측정 (TAX-029-2)**: `npm run perf:p95` 재실행 → 정상 표본 ≥ 90건, 누적 P95 산출

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `src/adapters/llmAnswerGenerator.ts` 의 `LLM_TIMEOUT_MS = 25_000` + 주석 정합
2. [ ] `src/adapters/llmQueryRewriter.ts` 의 `LLM_TIMEOUT_MS = 25_000` + 주석 정합
3. [ ] `npx vitest run` → 253/253 PASS (회귀 없음)
4. [ ] `npm run perf:p95` 재실행 → 정상 표본 ≥ 90건
5. [ ] 누적 P95 < 15초 측정 확인 (Phase 4 게이트 해제 조건)
6. [ ] TAX-029 리포트 §3 갱신 + 새 baseline JSON 저장
7. [ ] 다른 src 파일 무변경 (`git diff src/` 두 어댑터만 출현)

---

## 6. Verification (검증 단계)

1. 두 어댑터 파일 diff 검토 — 상수 + 주석만 변경됐는지
2. `npx vitest run` → 253/253 PASS
3. `npm run perf:p95` 재실행
4. 결과 출력에서:
   - 정상 응답 ≥ 90/100
   - 답변 생성 단계 P95가 더 이상 10초에 박혀 있지 않음 (자연 분포)
   - 누적 P95 < 15초 (PASS) 또는 ≥ 15초 (FAIL → 별도 최적화 티켓 분기)
5. `docs/reports/TAX-029_p95_baseline_2026-06-05.json` 갱신 또는 `_v2` 백업 생성

---

## 7. Risks / Notes (위험·주의사항)

| 위험 | 수준 | 대응 |
|---|---|---|
| 사용자 체감 응답 시간 증가 | 중 | PRD §7.1 P95 합격선(15s) 내라면 허용. UI 진행 표시 강화는 별도 티켓 |
| 재측정에서도 P95 > 15s 가능성 | 중 | 그 경우 답변 생성 자체 최적화 티켓 분기(별도) |
| OpenAI rate limit | 저 | 100회 측정 도중 일시 장애 가능. 재측정 시 결과로 판단 |
| 회귀 테스트 영향 | 저 | 기존 LlmTimeoutError 변환 테스트는 AbortError를 직접 던지는 모킹 — 타임아웃 값과 무관 |

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [x] 영향 파일 2개 + diff 미리보기
- [x] PRD §7.1·§13 정합 근거
- [x] 회귀 테스트 영향 분석 (AbortError 모킹 → 영향 없음)

→ **회계사 §9 결정 후** 코딩 시작

### 8.2 코딩 후 제출할 것

- [ ] 두 파일 diff
- [ ] vitest 결과 (253/253)
- [ ] 재측정 결과 (정상 비율·누적 P95)
- [ ] Phase 4 게이트 판단
- [ ] 리포트: TAX-029 리포트 §3 갱신 또는 TAX-040 신규 리포트

---

## 9. 회계사 결정점 (구현 전 확정)

| # | 결정 항목 | 권장 | 영향 |
|---|---|---|---|
| ① | `LLM_TIMEOUT_MS` 값 | **25초** | 15초는 마진 부족, 30초는 사용자 대기 과다. 25초는 PRD §7.1·§13 모두 정합 |
| ② | 두 어댑터 모두 정합 | **예** | rewrite도 Max=10.01s로 박힌 케이스 존재 — 대칭성 권장 |
| ③ | 재측정 즉시 진행 | **예** | TAX-029-2 별도 티켓 없이 본 티켓에서 재측정·리포트 갱신 |

> 회계사 회신: ① **25초** ② **예** ③ **예** (사용자 "A로 진행해줘" 2026-06-05) — **승인됨**

---

## 10. Related Tickets (관련 티켓)

- 선행: `TAX-029_p95_response_time_measurement.md` (1차 측정 — FAIL)
- 후속: TAX-029 리포트 §3 갱신 (재측정 결과 반영)
- 게이트 해제 대상: `TAX-026_vector_db_phase4.md` (TAX-026-B~ 코딩 실착수)
- 참조: PRD §7.1, §13.2, §15.2

---

## 11. Report Link

Report: TAX-029 리포트 §3·§7 갱신으로 갈음 (별도 리포트 미생성, 본 티켓 §6 검증 결과 직접 반영)

---

**작성자**: AI(Claude Opus 4.7) — 회계사 §9 승인 완료 (2026-06-05)
**작성일**: 2026-06-05
**최종 수정일**: 2026-06-05
