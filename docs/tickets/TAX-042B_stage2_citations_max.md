# TAX-042B Stage 2 — citations 상한(max 5) + SYSTEM_PROMPT 가이드 (G-S-법인-06 결정적 결함 해결)

> 작성자: AI(Claude Opus 4.7) / 작성일: 2026-06-07
> 배경: TAX-029/040/041 7차 정식 100회 측정에서 G-S-법인-06(법인세법 시행령 제19조 손비의 범위)이 3회 시행 중 3회 모두 `E-LLM-UNAVAILABLE`로 실패. 거대 콘텐츠(~4000자, 24개 호 + 50개+ 하위) 입력 시 GPT-4o-mini가 모든 호를 citation으로 시도 → 출력 토큰 한도 초과 → Zod schema validation 실패 추정.
> 전략: TAX-042 5단계 처방 중 **Stage 2 (가장 큰 임팩트)**. citations 상한과 SYSTEM_PROMPT 가이드로 결정적 결함 해소.

---

## Metadata

- **Type**: TASK (답변 품질 결정적 결함 해결)
- **Severity**: major (100% 재현되는 실패 케이스)
- **Layer**: adapter (llmAnswerGenerator)
- **Milestone**: Post-MVP (TAX-042 처방 묶음)
- **Estimated Size**: S (1~2 파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

100회 측정에서 G-S-법인-06 발생 3건이 모두 `E-LLM-UNAVAILABLE`로 실패:

| 인덱스 | 케이스 | 에러 |
|---|---|---|
| 14 | G-S-법인-06 | E-LLM-UNAVAILABLE |
| 54 | G-S-법인-06 | E-LLM-UNAVAILABLE |
| 94 | G-S-법인-06 | E-LLM-UNAVAILABLE |

**원인 추정 (Stage 1 분기 세분화 후 확정 가능)**: 시행령 제19조 거대 콘텐츠로 GPT-4o-mini가 24개 호 모두에 citation을 시도 → 구조화 출력의 출력 토큰 한도 초과 → 응답 truncation → Zod schema validation 실패 → catch-all로 `LlmUnavailableError` 변환.

### 1.2 기대 동작

- LLM이 핵심 5개 호만 citation으로 선정 → 출력 토큰 절감 → schema 통과 → V1~V6 정상 진행
- citation 6개 이상 응답이 들어오면 Zod가 즉시 `ZodError` throw → Stage 1의 `LlmSchemaValidationError`로 분류
- SYSTEM_PROMPT에 "조문이 많을 경우 핵심 5개를 우선 선정" 명시

### 1.3 영향·중요도

- G-S-법인-06 = 골든셋 40건 중 1건이지만 **100% 재현 실패** → 회계사가 이 패턴 발견 시 신뢰도 큰 타격
- 시행령 제19조류 거대 콘텐츠가 향후 골든셋에 추가될 가능성 (법인세법·소득세법 시행령 내 다수 존재)
- Pass rate 88% → 91% 즉시 개선 (3건 회복)

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/adapters/llmAnswerGenerator.ts:32-62` — SYSTEM_PROMPT 정의
- `src/adapters/llmAnswerGenerator.ts:64-75` — `citationItemSchema`·`answerSchema` Zod schema
- `eval/golden_direct.json:764+` — G-S-법인-06 케이스 정의 (참조)
- `tests/unit/llmAnswerGeneratorSchema.test.ts` — 신규

### 2.2 외부 데이터

- 법인세법 시행령 제19조 손비의 범위
  - content: 약 4000자
  - 1호~24호 (24개 호) + 가/나/다 하위 50개+
  - Trust Tier: T1 (시행령 본문)

### 2.3 아키텍처 힌트

```
LLM 응답 (citations 배열)
   ↓
answerSchema 검증
   ├─ citations.length ≤ 5 → 통과
   └─ citations.length > 5 → ZodError throw
                              ↓
                         Stage 1 catch 분기
                              ↓
                         LlmSchemaValidationError
```

---

## 3. Scope (작업 범위) ⭐ 가장 중요

### 3.1 허용되는 변경

- [ ] `src/adapters/llmAnswerGenerator.ts:71-75` — `answerSchema`의 `citations`에 `.max(5)` 추가
- [ ] `src/adapters/llmAnswerGenerator.ts:32-62` — SYSTEM_PROMPT `[출력 규칙]`에 다음 추가:
  - "citations는 최대 5개"
  - "조문이 많을 경우 핵심 5개를 회계사 질문에 가장 직접 관련된 순으로 우선 선정"
- [ ] `tests/unit/llmAnswerGeneratorSchema.test.ts` — citations 5개/6개 단위 테스트 2건

### 3.2 금지되는 변경

- ❌ `citationItemSchema` 필드 변경 (lawIndex·label·focusHint·temporalLabel 보존)
- ❌ `extractExcerpt`·`findSentenceBoundaries` 로직 변경 (옵션 A 패턴 보존)
- ❌ buildLawsContext 출력 형식 변경 (회귀 위험)
- ❌ `summary`·`temporalLabel` schema 변경
- ❌ Stage 1·3·4 처방을 본 티켓에 함께 적용

---

## 4. Strategy (구현 힌트)

1. **Zod 제약 추가 (1줄)**: `citations: z.array(citationItemSchema).max(5)`
2. **SYSTEM_PROMPT 보강 (3~5줄)**: `[출력 규칙]` 섹션 끝에 우선순위 가이드 추가
   ```
   - citations는 최대 5개까지. 조문 목록이 5개 초과일 경우, 회계사 질문에 가장 직접
     관련된 5개만 선정합니다.
   - 선정 우선순위: (1) T1·T2 출처 > (2) 회계사 질문 키워드와 직접 매칭 > (3) 시행령 본문 > (4) 그 외
   ```
3. **단위 테스트 추가**:
   - citations 5개 → 정상 통과
   - citations 6개 → ZodError throw → (Stage 1 적용 후) LlmSchemaValidationError
4. **단건 회귀 측정**: `npx tsx scripts/perf/single.ts G-S-법인-06` 3회 실행 (스크립트가 없으면 임시 작성)

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `tests/unit/llmAnswerGeneratorSchema.test.ts` 단위 테스트 2건 통과
   - 단위 1: citations 5개 응답 → 정상 통과
   - 단위 2: citations 6개 응답 → `ZodError` throw
2. [ ] 기존 `tests/integration/llmAnswerGenerator.test.ts` 5건 회귀 없이 통과
3. [ ] G-S-법인-06 단건 측정 3회 시행 시 3/3 정상 응답 (V1~V6 통과)
4. [ ] 기존 다른 케이스(G-1, G-2 등) 단건 측정 1회 시 V1 출처 존재 정상 (5개 상한이 정상 케이스에 영향 없음)
5. [ ] `npm run build`·`npm run lint` 통과

---

## 6. Verification (검증 단계)

1. `npm run test` 전체 회귀 없음
2. 단건 측정 스크립트로 G-S-법인-06 3회 실행 → 3/3 통과 확인
3. 단건 측정 스크립트로 G-1, G-2, G-N1, G-S-법인-01 각 1회 실행 → 정상 응답
4. 응답의 `citations.length ≤ 5` 확인 (모든 측정 케이스)

> 100회 회귀 측정은 Stage 5에서 일괄. 본 티켓은 단건 측정으로 충분.

---

## 7. Risks / Notes (위험·주의사항)

- **위험 1**: 5개 상한이 너무 빡빡할 가능성. 일부 케이스에서 정상적으로 6~7개 citation이 필요한데 누락되면 V1 (출처 존재 — V1은 인용된 출처가 검색결과에 있는지 확인이므로 직접 영향 없으나, summary가 다른 출처를 참조해 V2 위반 가능성)
  - **완화책**: 단건 측정에서 다른 케이스 영향 확인. Stage 5 100회 회귀에서 V1 실패율 모니터링. 5개로 부족하면 7개로 완화 후 재측정
- **위험 2**: SYSTEM_PROMPT 길이 증가로 입력 토큰 비용 미미하게 ↑ (수익 무관)
- **위험 3**: G-S-법인-06 외 다른 거대 콘텐츠 케이스(예: 소득세법 시행령)에서도 효과 확인 필요 → Stage 5에서
- **주의**: `citationItemSchema`는 변경하지 않음. `answerSchema`의 `citations` 필드만 `.max(5)` 추가.
- **주의**: SYSTEM_PROMPT 변경은 Stage 4의 V3 라벨 강화와 충돌 가능 → Stage 4에서 보강 시 본 티켓 추가분 보존 확인

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] 변경 후 `answerSchema` + SYSTEM_PROMPT 의사 코드 제시 후 인간 승인
- [ ] 단건 측정 방법 결정 (기존 스크립트 활용 vs 임시 스크립트 작성)

→ **인간 승인 후** 코딩 시작

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록 (`llmAnswerGenerator.ts`, `tests/unit/...`)
- [ ] G-S-법인-06 3회 단건 측정 결과
- [ ] 다른 케이스 1회 단건 측정 결과 (회귀 확인)
- [ ] 리포트 파일 경로: `docs/reports/TAX-042B_report.md`

---

## 9. Ticket Size Rule

- 변경 파일: 2개 (`llmAnswerGenerator.ts`, `tests/unit/...`)
- 논리적 변경: 1개 (citations 상한 + prompt 가이드)
- 예상 소요: 1~2시간

---

## 10. Related Tickets

- **선행**: TAX-042A (Stage 1 catch 분기 세분화) — Zod 실패를 `LlmSchemaValidationError`로 정확히 분류해야 효과 측정 가능
- **후속**: TAX-042C (Stage 3 maxTokens·retry), TAX-042D (Stage 4 V3 강화), TAX-042E (Stage 5 회귀)
- **참조**: [[tax029-040-041-complete]] 옵션 A 패턴, `eval/golden_direct.json:764+` G-S-법인-06

---

## 11. Report Link

Report: `docs/reports/TAX-042B_report.md` (미작성)

---

**작성자**: AI (Claude Opus 4.7)
**작성일**: 2026-06-07
**최종 수정일**: 2026-06-07
