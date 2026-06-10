# TAX-038 운영 LLM 프롬프트에 비법령 `[결정: ...]` 형식 학습

> 작성자: AI(Claude Opus 4.7) / 작성일: 2026-06-05
> 배경: TAX-037 리포트 §잠재 위험 1 — 운영 LLM 프롬프트가 `[결정: ...]` 형식을 모르면 비법령 답변 생성 시 `[현행]`으로 폴백되어 결정일 맥락이 소실됨

---

## Metadata

- **Type**: TASK
- **Severity**: minor
- **Layer**: adapter (llmAnswerGenerator)
- **Milestone**: Post-MVP
- **Estimated Size**: S (1파일 + 테스트 1파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

`src/adapters/llmAnswerGenerator.ts:34` 시스템 프롬프트가 시점 라벨 3종만 가르치고 있다.

```typescript
// 현재 — 법령 중심 3종
- temporalLabel은 반드시 다음 중 하나:
  "[현행]" | "[적용 시점: YYYY.MM.DD~YYYY.MM.DD]" | "[폐지: YYYY.MM.DD]"
```

또한 `buildLawsContext()`(line 54~59)가 LLM에게 전달하는 조문 컨텍스트는 법령 기준(`lawName + articleNumber + enforcementDate`)만 노출하고, 비법령 메타(`sourceType`·`decisionDate`)는 숨겨져 있다.

결과: 운영 검색 결과에 심판례·해석례·판례가 섞여 들어와도 LLM은 `sourceType`을 알 수 없어 `[결정: ...]`을 생성할 근거가 없다.

### 1.2 기대 동작

1. **시스템 프롬프트**가 4번째 형식 `[결정: YYYY.MM.DD]`를 학습한다 (비법령 전용).
2. **컨텍스트 빌더**가 비법령(`sourceType !== '법령'`) 자료에 한해 `sourceType`·`decisionDate`를 명시 노출한다.
3. LLM이 자료 종류에 따라 올바른 시점 라벨을 자동 선택한다.
   - 법령 → `[현행]` / `[적용 시점]` / `[폐지]`
   - 비법령 → `[결정: YYYY.MM.DD]` (결정일 불명 시 `[현행]` 폴백 허용)

### 1.3 영향·중요도

- **V4 통과는 유지되지만 정보 손실 위험**: lawVerifier V4는 이미 4종 모두 PASS 처리(TAX-037 완료). 다만 LLM이 `[현행]`만 생성하면 회계사가 결정일을 본문에서 다시 찾아야 함.
- **운영 비법령 답변 표면화 시점**: 회계사가 심판례·해석례 질문을 시작하면 즉시 표면화.
- **회귀 위험 낮음**: 법령 답변 경로는 변경 없음(`sourceType==='법령'`이면 기존 분기 그대로).

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/adapters/llmAnswerGenerator.ts` — SYSTEM_PROMPT 수정 (시점 라벨 규칙 4종화) + `buildLawsContext()` 수정 (비법령 메타 노출)
- `tests/adapters/llmAnswerGenerator.test.ts` — 비법령 입력 → `[결정: ...]` 생성 검증 (신규 또는 추가)
- `src/domain/TaxLaw.ts` — 참조 전용(변경 없음). `sourceType`·`decisionDate` 필드 위치 확인용

### 2.2 외부 API·리소스

- 변경 없음. OpenAI GPT-4o-mini 동일.
- Zod 스키마(`citationItemSchema`·`answerSchema`)의 `temporalLabel: z.string()`은 어떤 형식이든 통과시키므로 스키마 변경 불필요.

### 2.3 아키텍처 힌트

```
TaxLaw[] (sourceType·decisionDate 포함)
    ↓
buildLawsContext() ─── 비법령이면 sourceType·decisionDate 추가 노출
    ↓
SYSTEM_PROMPT (4종 라벨 규칙)
    ↓
GPT-4o-mini ─── temporalLabel 자동 선택
    ↓
LabeledAnswer (V4 PASS)
```

---

## 3. Scope (작업 범위) ⭐ 가장 중요

### 3.1 허용되는 변경

- [x] `src/adapters/llmAnswerGenerator.ts` SYSTEM_PROMPT — 시점 라벨 규칙 3종 → 4종 (+ 비법령 분기 명시)
- [x] `src/adapters/llmAnswerGenerator.ts` `buildLawsContext()` — 비법령 메타(`sourceType`·`decisionDate`) 노출 로직 추가
- [x] `tests/integration/llmAnswerGenerator.test.ts` — TAX-038 블록 4건 추가 (경로 정정: `adapters/` → `integration/`)

### 3.2 금지되는 변경

- ❌ Zod 스키마(`citationItemSchema`·`answerSchema`) 구조 변경
- ❌ 법령 분기(`sourceType === '법령'`) 컨텍스트 출력 형식 변경
- ❌ lawVerifier V4 정규식 변경 (TAX-037에서 이미 완료)
- ❌ `LabeledAnswer`·`Citation`·`TaxLaw` 도메인 타입 변경
- ❌ LLM 모델 변경 (`gpt-4o-mini` 유지)
- ❌ 답변 후처리(`normalizeTemporalLabel` 같은 어댑터 사후 교정) 추가 — 책임 분리 위반 (CLAUDE.md §2)

---

## 4. Strategy (구현 힌트)

1. **SYSTEM_PROMPT 시점 라벨 규칙 교체 (line 33~34)**

   변경 전:
   ```typescript
   [시점 라벨 규칙 — CLAUDE.md §6.2]
   - temporalLabel은 반드시 다음 중 하나: "[현행]" | "[적용 시점: YYYY.MM.DD~YYYY.MM.DD]" | "[폐지: YYYY.MM.DD]"
   ```

   변경 후:
   ```typescript
   [시점 라벨 규칙 — CLAUDE.md §6.2 / TAX-037]
   - 법령(sourceType='법령')의 temporalLabel:
     "[현행]" | "[적용 시점: YYYY.MM.DD~YYYY.MM.DD]" | "[폐지: YYYY.MM.DD]"
   - 비법령(sourceType='판례'|'해석례'|'심판례')의 temporalLabel:
     "[결정: YYYY.MM.DD]" — 제공된 decisionDate를 사용. 결정일 불명("불명")이면 "[현행]" 허용.
   ```

2. **`buildLawsContext()` 비법령 메타 노출 (line 54~59)**

   ```typescript
   function buildLawsContext(laws: TaxLaw[]): string {
     if (laws.length === 0) return '[검색된 법령 없음]'
     return laws.map((law, idx) => {
       // TAX-038: 비법령은 sourceType·decisionDate를 LLM에 명시 노출
       const nonlawMeta =
         law.sourceType !== '법령'
           ? `\nsourceType: ${law.sourceType}\n결정일: ${law.decisionDate ?? '불명'}`
           : ''
       return `[${idx}] ${law.lawName} ${law.articleNumber} (${law.trustTier})${nonlawMeta}\n시행일: ${law.enforcementDate}\n원문:\n${law.content}`
     }).join('\n\n---\n\n')
   }
   ```

3. **테스트 추가**
   - 입력: `sourceType='심판례'`, `decisionDate='2012-09-14'` 1건
   - GPT 호출은 `vi.mock('ai')` 또는 기존 모킹 패턴으로 가짜 응답 주입
   - 단언: `temporalLabel === '[결정: 2012.09.14]'` 또는 `[현행]`(폴백 허용)

4. **vitest 회귀 게이트**
   - `npx vitest run` → 기존 40건 + 신규 테스트 PASS

---

## 5. Acceptance Criteria (완료 조건)

1. [x] SYSTEM_PROMPT가 `[결정: YYYY.MM.DD]` 형식과 비법령 분기 규칙을 명시한다.
2. [x] `buildLawsContext()`가 비법령에 한해 `sourceType`·`decisionDate`를 컨텍스트에 노출한다.
3. [x] 법령(`sourceType==='법령'`) 컨텍스트 출력은 변경 전과 byte-level 동일하다 (회귀 테스트 PASS).
4. [x] `tests/integration/llmAnswerGenerator.test.ts`에 비법령 케이스 4건 추가되어 PASS.
5. [x] `npx vitest run` 전체 PASS (253/253, 기존 249건 + 신규 4건).
6. [x] lawVerifier V4 정규식 변경 없음.

---

## 6. Verification (검증 단계)

1. `npx vitest run tests/adapters/llmAnswerGenerator.test.ts` → 신규 비법령 케이스 PASS
2. `npx vitest run` → 전체 PASS (기존 40건 포함)
3. `npm run golden:status` → 불일치 0건 유지
4. SYSTEM_PROMPT diff 리뷰 — 법령 규칙 분기와 비법령 규칙 분기가 명확히 구분되어 있는지
5. `buildLawsContext()` diff 리뷰 — 법령 케이스 출력 형식이 byte-level 동일한지

---

## 7. Risks / Notes (위험·주의사항)

- **법령 컨텍스트 출력 회귀**: `nonlawMeta` 분기를 잘못 작성하면 법령 케이스에 빈 문자열이 들어가도 출력 형식이 달라질 수 있음. 변경 후 법령 단독 입력 케이스로 기존 출력과 비교 권장.
- **LLM 비결정성**: GPT-4o-mini가 항상 `[결정: ...]`을 생성한다고 보장할 수 없음. V4가 `[현행]`도 허용하므로 폴백 자체는 안전하지만, 회계사 표면 UX에서는 결정일이 안 보일 수 있음.
- **운영 데이터로 표면화 테스트**: 실 API 호출 검증은 비용 발생 → 모킹 기반 단위 테스트 우선. 회계사가 운영 환경에서 비법령 질문을 던져 표면 확인 권장.
- **decisionDate 부재**: TAX-039(어댑터 매핑 회귀 방지)와 짝지어 진행하면 더 안전. TAX-039 미진행 시 `decisionDate`가 비어 있으면 "불명" 출력 후 `[현행]` 폴백.

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] 영향받는 파일 목록 (2파일)
- [ ] SYSTEM_PROMPT 변경 전후 diff 제시
- [ ] `buildLawsContext()` 변경 전후 diff 제시
- [ ] 법령 케이스 출력이 byte-level 동일함을 보이는 비교 예시

→ **회계사 승인 후** 코딩 시작

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록
- [ ] SYSTEM_PROMPT diff
- [ ] `buildLawsContext()` diff (법령·비법령 각 출력 예시 포함)
- [ ] vitest 결과 (`npx vitest run`)
- [ ] `npm run golden:status` 결과
- [ ] 리포트: `docs/reports/TAX-038_report.md`

---

## 9. Related Tickets (관련 티켓)

- 선행: `TAX-037_nonlaw_v4_temporal_label_spec.md` (lawVerifier V4 4종화 — 완료 2026-06-05)
- 병행 권장: `TAX-039_nonlaw_adapter_mapping_regression_guard.md` (decisionDate 매핑 회귀 방지)
- 후속: (없음)
- 참조: `src/adapters/llmAnswerGenerator.ts`, `CLAUDE.md §6.2`, `docs/SSOT.md §7.2`

---

## 10. Report Link

Report: `docs/reports/TAX-038_report.md` ✅ 완료

---

**작성자**: AI(Claude Opus 4.7) + 회계사 검토 필요
**작성일**: 2026-06-05
**최종 수정일**: 2026-06-05
