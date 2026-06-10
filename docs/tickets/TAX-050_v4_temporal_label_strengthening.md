# TAX-050 — V4 시점 라벨 강화 (LLM 프롬프트 보강 방안 A2)

> 작성자: AI(Claude Sonnet 4.6) / 작성일: 2026-06-09
> 배경: TAX-029 P95 재측정(2026-06-09, 누적 P95 16.90s)에서 V4 시점 라벨 실패 11건(10.1%)이 answer 재시도 루프를 유발해 누적 P95가 합격선(15s)을 1.90s 초과. V4 만 해결되면 합격선 통과 가능성 높음.
> 전략: **방안 A2 — LLM 프롬프트 보강 + temporal.explicit 동적 메시지 주입**. V4 검증 정규식·V1~V6 로직은 무변경(안전).

---

## Metadata

- **Type**: BUG (정확성 회복 — V4 형식 불일치 11건/100건)
- **Severity**: major (Phase 4 게이트 합격선 1.90s 미달의 직접 원인)
- **Layer**: adapter
- **Milestone**: Post-MVP (Phase 4 게이트 마무리)
- **Estimated Size**: S (1파일, 프롬프트 텍스트 + userPrompt 1줄)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작 (TAX-029 P95 재측정 2026-06-09 결과)

100회 측정 중 V4 시점 라벨 실패 11건(10.1%) 발생:

| 출력 형식 | 횟수 | 비율 | 비고 |
|-----------|------|------|------|
| `[적용 시점: 2025.10.01]` | 8건 | 72.7% | 종료일 누락 |
| `[적용 시점: 2025.10.01~]` | 2건 | 18.2% | `~` 뒤 비움 |
| `[적용 시점: 2026.01.01]` | 1건 | 9.1% | 종료일 누락 |

V4 검증 정규식(`lawVerifier.ts:50`)은 `[적용 시점: YYYY.MM.DD~YYYY.MM.DD]` 양쪽 날짜 필수.

- 9건은 재시도 1회로 PASS (시간 손실 ≈ 3~5초/건)
- 2건(G-4A iter 84, G-S-상증-03 iter 97)은 재시도 후에도 동일 형식 반복 → E-VERIFY-FAIL

### 1.2 근본 원인 분석

`llmAnswerGenerator.ts:101-105` 현재 프롬프트:
```
- 법령(sourceType='법령')의 temporalLabel은 반드시 다음 중 하나:
  "[현행]" | "[적용 시점: YYYY.MM.DD~YYYY.MM.DD]" | "[폐지: YYYY.MM.DD]"
```

빈틈 3가지:
1. **결정 트리 부재**: 언제 `[현행]` vs `[적용 시점]`을 쓸지 의사결정 규칙 없음 → LLM이 시행일 메타데이터(`enforcementDate: 2025.10.01`)를 보고 자동으로 `[적용 시점]` 선택
2. **temporal.explicit 정보 미전달**: `userPrompt`의 `[기준 시점]`은 회계사가 시점을 명시한 경우만 출력됨. 명시 안 한 경우는 정보 자체가 누락
3. **폴백 경로 없음**: 종료일 미확정 시 어떻게 처리할지 가이드 없음 → LLM이 `[적용 시점: YYYY.MM.DD]` 형식 발명

### 1.3 영향·중요도

- **회계사 보호**: 시점 라벨 불일치는 회계사가 답변을 "확인 어려움" 안내로만 받게 함 → 정상 답변 폐기율 증가
- **Phase 4 게이트**: 누적 P95 1.90s 초과의 직접 원인. V4 해결 시 answer 단계 P95 약 9~10s 추정 → 누적 P95 < 15s 가능성 높음
- **CLAUDE.md §6.2 정합**: `[현행]`은 "답변 생성 시점 시행 중"인 법령에 사용하는 1순위 옵션. 현재 LLM이 이 우선순위를 따르지 않음

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/adapters/llmAnswerGenerator.ts` (수정 대상 — SYSTEM_PROMPT의 [시점 라벨 규칙] + userPrompt의 [기준 시점] 부분)
- `src/adapters/lawVerifier.ts` (참조 — 무변경, V4 정규식 라인 48-53)
- `src/domain/TemporalContext.ts` (참조 — `explicit: boolean`, `targetDate?: Date` 필드 존재 확인)
- `docs/reports/TAX-029_p95_baseline_2026-06-09.json` (근거 데이터)

### 2.2 외부 API·리소스

- OpenAI GPT-4o-mini (변경 없음)

### 2.3 아키텍처 힌트

```
generate(laws, question, temporal)
  └─ userPrompt 조립 시 temporal.explicit 정보를 LLM에 명시 주입
  └─ SYSTEM_PROMPT의 시점 라벨 결정 트리에 의해 [현행] 우선 선택
```

---

## 3. Scope (작업 범위) ⭐

### 3.1 허용되는 변경

- [x] `src/adapters/llmAnswerGenerator.ts:101-105` (SYSTEM_PROMPT [시점 라벨 규칙] 섹션 보강 — 결정 트리·금지 예시 추가)
- [x] `src/adapters/llmAnswerGenerator.ts:333-339` (userPrompt [기준 시점] 동적 메시지: explicit=false 시에도 명시 메시지 주입)

### 3.2 금지되는 변경

- ❌ `src/adapters/lawVerifier.ts` V4 정규식·로직 (V1~V6 검증 로직 보호 — CLAUDE.md §6.4)
- ❌ `src/domain/LabeledAnswer.ts`·`Citation.ts` 타입 정의
- ❌ `answerSchema`·`citationItemSchema` zod 스키마
- ❌ 기타 V1·V2·V3·V5·V6 관련 로직
- ❌ `extractExcerpt`·`buildLawsContext` 등 헬퍼 함수
- ❌ 새 의존성 추가

---

## 4. Strategy (구현 힌트)

### 4.1 SYSTEM_PROMPT 시점 라벨 규칙 보강 (101-105 라인)

```
[시점 라벨 규칙 — CLAUDE.md §6.2 / TAX-037·TAX-038·TAX-050]

[법령(sourceType='법령')의 temporalLabel 결정 트리]
1순위: 회계사가 시점을 명시하지 않았고 제공된 법령이 현행이면 → "[현행]"
       (대부분의 경우 이 옵션을 택합니다. 법령 시행일은 본문 인용에서 다루세요.)
2순위: 회계사가 과거 특정 시점(예: "2020년 기준")을 명시했고
       시작일·종료일을 모두 특정할 수 있으면
       → "[적용 시점: YYYY.MM.DD~YYYY.MM.DD]" (양쪽 날짜 8자리 필수, ~ 양옆 공백 없음)
3순위: 조문이 폐지·삭제된 경우 → "[폐지: YYYY.MM.DD]"

[금지 — 자주 발생하는 실수]
- 금지: "[적용 시점: 2025.10.01]" (종료일 없는 단일 일자)
- 금지: "[적용 시점: 2025.10.01~]" (~ 뒤 비움)
- 종료일을 특정할 수 없으면 "[현행]"으로 폴백하세요.

[비법령(sourceType='판례'|'해석례'|'심판례')의 temporalLabel]
- "[결정: YYYY.MM.DD]" — 제공된 '결정일'을 그대로 사용
- 결정일이 '불명'이면 "[현행]" 허용
```

### 4.2 userPrompt 기준 시점 동적 메시지 (333-339 라인)

```typescript
temporal.explicit && temporal.targetDate
  ? `[기준 시점]\n회계사가 ${temporal.targetDate.toISOString().slice(0, 10)} 기준으로 명시함 → 적용 시점 라벨 사용 가능`
  : `[기준 시점]\n회계사가 시점을 명시하지 않음 → 현행 법령 기준으로 답변, temporalLabel은 "[현행]" 사용`,
```

(빈 문자열 분기를 제거 — 항상 명시 메시지 주입)

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `src/adapters/llmAnswerGenerator.ts` 두 군데(101-105, 333-339)만 수정
2. [ ] V4 검증 정규식(`lawVerifier.ts:48-53`) 무변경
3. [ ] zod 스키마(`citationItemSchema`, `answerSchema`) 무변경
4. [ ] `npm run test` 전체 통과 (기존 vitest 회귀 없음)
5. [ ] G-S-상증-03 단건 진단 3회 실행 시 V4 PASS 3/3
6. [ ] G-4A 단건 진단 3회 실행 시 V4 PASS 3/3
7. [ ] 리포트 `docs/reports/TAX-050_report.md` 작성

---

## 6. Verification (검증 단계)

1. `npm run test` — vitest 전체 통과 확인
2. `npm run perf:single-diagnostics G-S-상증-03 3` — V4 PASS 3/3 확인
3. `npm run perf:single-diagnostics G-4A 3` — V4 PASS 3/3 확인
4. (선택) `npm run perf:p95` 100회 재측정 — V4 실패율 ≤ 1% 목표, 누적 P95 < 15s 합격선 도달 여부 (별도 후속 작업)

---

## 7. Risks / Notes (위험·주의사항)

- **회귀 위험 (낮음)**: 프롬프트 텍스트 + userPrompt 1줄만 수정. SYSTEM_PROMPT 다른 섹션(라벨 결정 표, T1·T2 부재 시 동작 등)은 무변경.
- **LLM 비결정성**: 프롬프트 변경 후 다른 케이스에서 회귀 가능성 — 단위 테스트 + 단건 진단으로 보호.
- **temporal.explicit 의존성**: `TemporalContext` 도메인 타입 변경 없이 기존 필드 사용 — 안전.
- **CLAUDE.md §6.2와의 정합**: 본 변경은 §6.2의 "[현행]은 답변 생성 시점 시행 중"이라는 정의를 LLM이 1순위로 채택하도록 강제. 사양과 더 강하게 정합.

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것 (완료)

- [x] 근본 원인 분석 — V4 실패 11건 분포 + 프롬프트 빈틈 3가지
- [x] 영향받는 파일 목록 — `src/adapters/llmAnswerGenerator.ts` 1파일
- [x] 구현 계획 — SYSTEM_PROMPT 보강 + userPrompt 1줄 → 회귀 테스트 → 단건 진단

→ 회계사 승인 완료 (2026-06-09 "A2로 구현 진행해")

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록
- [ ] 변경 요약
- [ ] 검증 단계별 결과 (PASS/FAIL)
- [ ] 발견된 위험·제한사항
- [ ] 리포트: `docs/reports/TAX-050_report.md`

---

## 9. Ticket Size Rule

- 수정 파일: 1개 (`src/adapters/llmAnswerGenerator.ts`)
- 논리적 변경: 1개 (V4 시점 라벨 결정 트리 명시)
- 예상 소요: 30분 (코드 수정) + 10분 (테스트) + 20분 (단건 진단·리포트)

---

## 10. Related Tickets

- 선행: TAX-037 (비법령 V4 `[결정:YYYY.MM.DD]` 3단 체인 완결)
- 선행: TAX-029 (P95 측정 인프라)
- 선행: TAX-042D (V3 라벨 강화 — 본 티켓의 V4판)
- 참조: `docs/reports/TAX-029_p95_baseline_2026-06-09.json` (실패 11건 근거)
- 참조: CLAUDE.md §6.2 (시점 라벨 사양)

---

## 11. Report Link

Report: `docs/reports/TAX-050_report.md` (작성중)

---

**작성자**: AI(Claude Sonnet 4.6)
**작성일**: 2026-06-09
**최종 수정일**: 2026-06-09
