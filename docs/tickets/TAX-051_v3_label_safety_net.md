# TAX-051 — V3 라벨 안전망 (어댑터 후처리 + 프롬프트 결정 트리)

> 작성자: AI(Claude Opus 4.7) / 작성일: 2026-06-10
> 배경: TAX-029 P95 재측정(2026-06-09, TAX-050 적용 후)에서 V3 라벨 실패 6건(6.1%)이 신규 발생. 실패 패턴 100% 동일: "T3·T4 출처에 🟢직접근거 부여". 그 중 2건은 재시도 후에도 동일 실패 → E-VERIFY-FAIL.
> 전략: **방안 C — 어댑터 후처리(안전망) + 프롬프트 결정 트리 보강(1차 차단)**. V1~V6 검증 로직(`lawVerifier.ts`) 무변경(안전).

---

## Metadata

- **Type**: BUG (정확성 회복 — V3 라벨 LLM 비결정성 6건/100건)
- **Severity**: major (Phase 4 게이트 마무리 + 회계사 보호 직결)
- **Layer**: adapter
- **Milestone**: Post-MVP (Phase 4 게이트 완결)
- **Estimated Size**: S (1파일, 후처리 함수 + 프롬프트 보강)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작 (TAX-029 P95 재측정 2026-06-09 결과)

100회 측정 중 V3 라벨 실패 6건(6.1%) 발생:

| iter | caseId | sourceType | 재시도 결과 | 비고 |
|------|--------|------------|-------------|------|
| 15 | G-S-부가-04 | T3 | 2회 FAIL → E-VERIFY-FAIL | 부가가치세법 제38조(T1) 케이스 |
| 20 | G-S-NL-02 | T4 | 1회 FAIL → 재시도 PASS | 심판례(T3) 케이스 |
| 37 | G-S-종부-01 | T3 | 2회 FAIL → E-VERIFY-FAIL | 종부세법 제8조(T1) 케이스 |
| 77 | G-S-종부-01 | T3 | 1회 FAIL → 재시도 PASS | 종부세법 제8조(T1) 케이스 |

실패 사유 100% 동일: **`V3: 라벨 부적절 — T3(또는 T4) 출처에 '🟢직접근거' 사용`**

### 1.2 근본 원인 분석

`llmAnswerGenerator.ts`의 SYSTEM_PROMPT에는 이미 강력한 규칙이 있음:
- **[라벨 결정 표]** (TAX-042D, 80-91 라인): T3·T4 → 🟢 절대 금지 명시
- **[T1·T2 부재 시 동작 규칙]** (TAX-048, 93-99 라인): "T3밖에 없으니 어쩔 수 없이 🟢는 잘못된 판단" 명시

그럼에도 LLM이 약 6% 확률로 두 규칙을 모두 무시 → **LLM 비결정성(GPT-4o-mini)에 의한 간헐적 실패**.

**단건 진단 검증**: G-S-부가-04 × 3 + G-S-종부-01 × 3 + G-S-NL-02 × 3 = 9회 모두 V3 PASS → 재현 불가. 100회 측정에서만 6% 빈도로 나타남.

### 1.3 영향·중요도

- **회계사 보호 직결**: T3·T4(예규·심판례·판례)를 법령처럼 인용하면 회계사가 의뢰인 보고서에 직접 적용할 위험 → 가산세·법적 분쟁 가능
- **Phase 4 게이트**: V3 재시도 7회(1차 6 + 재시도 1)가 answer P95 약 0.5~1.0s 가산 → 누적 P95 17.74s를 약 16~17s대로 단축 기대
- **E-VERIFY-FAIL 직결**: 재시도 후에도 LLM이 같은 판단 반복 → 회계사에게 "확인 어려움" 안내만 전달

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/adapters/llmAnswerGenerator.ts` (수정 대상 — 후처리 함수 + SYSTEM_PROMPT [T1·T2 부재 규칙] 결정 트리화)
- `src/adapters/lawVerifier.ts` (참조 — V3 정규식·로직 무변경, `TIER_ALLOWED_LABELS` 임포트 가능)
- `src/domain/Citation.ts` (참조 — `CitationLabel` 타입)
- `src/domain/TaxLaw.ts` (참조 — `TrustTier` 타입)
- `docs/reports/TAX-029_p95_baseline_2026-06-09.json` (근거 데이터)

### 2.2 외부 API·리소스

- OpenAI GPT-4o-mini (변경 없음)

### 2.3 아키텍처 힌트

```
generate(laws, question, temporal)
  └─ generateObject() → object.citations
  └─ object.citations.filter().map() → Citation[]
  └─ ★ 신규 후처리: downgradeT3T4DirectCitations(citations, summary) → 강제 보정
  └─ LabeledAnswer 반환
```

---

## 3. Scope (작업 범위) ⭐

### 3.1 허용되는 변경

- [x] `src/adapters/llmAnswerGenerator.ts` 신규 헬퍼 함수 `downgradeT3T4DirectCitations` 추가
- [x] `src/adapters/llmAnswerGenerator.ts` `generate()` 메서드 내 후처리 호출 삽입 (citations.map() 직후)
- [x] `src/adapters/llmAnswerGenerator.ts` SYSTEM_PROMPT [T1·T2 부재 시 동작 규칙] 섹션을 결정 트리·체크리스트 형태로 재구성

### 3.2 금지되는 변경

- ❌ `src/adapters/lawVerifier.ts` V3 정규식·로직 (V1~V6 검증 로직 보호 — CLAUDE.md §6.4)
- ❌ `src/domain/LabeledAnswer.ts`·`Citation.ts` 타입 정의
- ❌ `answerSchema`·`citationItemSchema` zod 스키마
- ❌ 기타 V1·V2·V4·V5·V6 관련 로직
- ❌ 새 의존성 추가

---

## 4. Strategy (구현 힌트)

### 4.1 후처리 함수 `downgradeT3T4DirectCitations` (신규)

```typescript
/**
 * TAX-051: V3 라벨 안전망 — LLM이 T3·T4 출처에 🟢직접근거를 잘못 부여한 경우
 * 어댑터가 강제로 🟡유사사례로 다운그레이드한다.
 *
 * - LLM 비결정성에 대한 100% 차단 보장 (회계사가 판례를 법령처럼 인용해
 *   가산세 위험에 노출되지 않도록 보호 — CLAUDE.md §6.3)
 * - 검증 V3는 다운그레이드된 결과를 본 후 PASS 처리
 * - summary는 T1·T2가 하나도 없는 경우에만 첫 문장 자동 보정
 *   (TAX-048 [T1·T2 부재 시 동작 규칙] 사양 정합)
 */
function downgradeT3T4DirectCitations(
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

  // T1·T2가 하나도 없고 다운그레이드가 발생한 경우만 summary 보정
  // (T1·T2가 섞여 있으면 그 직접 근거가 summary에서 다뤄지므로 보정 불필요)
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
```

### 4.2 `generate()` 메서드 내 후처리 호출

```typescript
const citations: Citation[] = object.citations
  .filter((c) => c.lawIndex >= 0 && c.lawIndex < originalRefs.length)
  .map((c) => { ... })

// TAX-051: V3 라벨 안전망 — T3·T4 출처에 🟢직접근거 부여 시 강제 다운그레이드
const { citations: safeCitations, summary: safeSummary } =
  downgradeT3T4DirectCitations(citations, object.summary)

return {
  rawQuestion: question,
  citations: safeCitations,
  summary: safeSummary,
  ...
}
```

### 4.3 SYSTEM_PROMPT [T1·T2 부재 규칙] 결정 트리화 (93-99 라인)

**변경 전 (7줄, 서술형):**
```
[T1·T2 부재 시 동작 규칙 — TAX-048]
검색된 조문 목록 전체가 (T3) 또는 (T4)만 있고 (T1)·(T2)가 하나도 없는 경우:
- 어떤 출처에도 🟢직접근거 절대 부여 금지. ...
```

**변경 후 (체크리스트 + 결정 트리):**
```
[라벨 결정 체크리스트 — TAX-048·TAX-051 (citation 생성 직전 반드시 수행)]

Step 1: 현재 citation의 출처 Tier가 (T1) 또는 (T2)인가?
  → YES: 🟢직접근거 / 🟡유사사례 / ⚪참고자료 / ⚫폐지 중 선택 (사안 적용 정도 기반)
  → NO (T3 또는 T4): Step 2로 이동

Step 2: 출처 Tier가 (T3) 또는 (T4)이다.
  → 🟢직접근거 절대 금지 (예외 없음, 회계사 보호 의무)
  → 허용 라벨: 🟡유사사례 / ⚪참고자료 / ⚫폐지 중 선택만 가능

⚠️ 자주 발생하는 실수 (TAX-051 — V3 FAIL 직결):
- 실수: "T1·T2가 없으니 T3에 🟢직접근거 부여" → V3 FAIL, E-VERIFY-FAIL 위험
- 실수: "심판례가 사안에 정확히 일치하니 🟢" → V3 FAIL, 판례는 무조건 🟡 이하
- 올바른 처리: 검색결과 전체가 T3·T4만 있어도 모든 라벨은 🟡 또는 ⚪로 한정
  + summary 첫 문장에 "직접 근거(법령 본문)를 찾지 못했습니다." 명시
```

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `src/adapters/llmAnswerGenerator.ts` 한 파일만 수정
2. [ ] V3 검증 정규식·로직(`lawVerifier.ts:141-150`) 무변경
3. [ ] zod 스키마(`citationItemSchema`, `answerSchema`) 무변경
4. [ ] `npm run test` 전체 통과 (vitest 회귀 없음)
5. [ ] G-S-부가-04 × 3 단건 진단 V3 PASS 3/3
6. [ ] G-S-종부-01 × 3 단건 진단 V3 PASS 3/3
7. [ ] G-S-NL-02 × 3 단건 진단 V3 PASS 3/3
8. [ ] 리포트 `docs/reports/TAX-051_report.md` 작성

---

## 6. Verification (검증 단계)

1. `npm run test` — vitest 전체 통과 확인
2. `npm run perf:single-diagnostics G-S-부가-04 3` — V3 PASS 3/3 확인
3. `npm run perf:single-diagnostics G-S-종부-01 3` — V3 PASS 3/3 확인
4. `npm run perf:single-diagnostics G-S-NL-02 3` — V3 PASS 3/3 확인
5. (선택) `npm run perf:p95` 100회 재측정 — V3 실패율 ≤ 1% + 누적 P95 < 15s 목표 (별도 후속 작업)

---

## 7. Risks / Notes (위험·주의사항)

- **회귀 위험 (낮음)**: 후처리 함수는 LLM 응답을 받은 직후 라벨만 보정. citations 구조·summary 기타 부분 무변경.
- **summary 보정 부작용**: T1·T2가 하나도 없고 다운그레이드가 발생한 경우만 보정. T1·T2가 섞여 있으면 보정 안 함 (이미 직접 근거 다뤄지므로).
- **단정형 표현(V6) 잔존 위험**: 어댑터는 라벨만 다운그레이드. LLM이 작성한 summary 본문이 단정형일 경우 V6 실패 가능 — 하지만 V3가 PASS되면 재시도 트리거되지 않으므로 영향 한정. V6는 별도 케어 사안.
- **LLM 비결정성**: 프롬프트 보강만으로는 0% 보장 불가하므로 어댑터 후처리가 핵심 안전망 역할.

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것 (완료)

- [x] 근본 원인 분석 — V3 실패 6건 100% 동일 패턴(T3·T4 → 🟢) + LLM 비결정성
- [x] 영향받는 파일 목록 — `src/adapters/llmAnswerGenerator.ts` 1파일
- [x] 구현 계획 — 후처리 함수 + 프롬프트 결정 트리 → 회귀 테스트 → 단건 진단

→ 회계사 승인 완료 (2026-06-10 "방안 C로 진행해줘")

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록
- [ ] 변경 요약
- [ ] 검증 단계별 결과 (PASS/FAIL)
- [ ] 발견된 위험·제한사항
- [ ] 리포트: `docs/reports/TAX-051_report.md`

---

## 9. Ticket Size Rule

- 수정 파일: 1개 (`src/adapters/llmAnswerGenerator.ts`)
- 논리적 변경: 2개 (후처리 함수 + 프롬프트 결정 트리)
- 예상 소요: 30분 (코드 수정) + 10분 (테스트) + 20분 (단건 진단·리포트)

---

## 10. Related Tickets

- 선행: TAX-042D (V3 라벨 강화 — [라벨 결정 표] 단일 진실원천)
- 선행: TAX-048 (T1·T2 부재 시 동작 규칙)
- 선행: TAX-050 (V4 시점 라벨 강화 — 동일한 어댑터 보강 패턴)
- 선행: TAX-029 (P95 측정 인프라)
- 참조: `docs/reports/TAX-029_p95_baseline_2026-06-09.json` (실패 6건 근거)
- 참조: CLAUDE.md §6.3 (라벨링 시스템)

---

## 11. Report Link

Report: `docs/reports/TAX-051_report.md` (작성중)

---

**작성자**: AI(Claude Opus 4.7)
**작성일**: 2026-06-10
**최종 수정일**: 2026-06-10
