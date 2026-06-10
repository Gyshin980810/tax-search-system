# TAX-038 구현 리포트 — 운영 LLM 프롬프트 비법령 [결정] 라벨 학습

> 작성자: AI(Claude Opus 4.7) / 작성일: 2026-06-05
> 선행: TAX-037(V4 4종화), TAX-039(어댑터 매핑 회귀 방지)

---

## 변경 사항 요약

### 파일 변경 목록

| 파일 | 구분 | 내용 |
|---|---|---|
| `src/adapters/llmAnswerGenerator.ts` | 수정 | SYSTEM_PROMPT 시점 라벨 규칙 3종 → 4종(법령/비법령 분기), `buildLawsContext()` 비법령 메타 노출 |
| `tests/integration/llmAnswerGenerator.test.ts` | 수정 | `describe('TAX-038 비법령 [결정] 라벨 학습')` 블록 4건 추가 (프롬프트·응답·법령 회귀·결정일 불명 폴백) |
| `docs/tickets/TAX-038_nonlaw_llm_prompt_decision_label.md` | 수정 | 체크박스 갱신, 테스트 경로 정정(`tests/adapters/` → `tests/integration/`) |

---

## 변경 내용 상세

### 1. SYSTEM_PROMPT 시점 라벨 규칙 4종화 (핵심)

**변경 전 (line 33~34):**

```typescript
[시점 라벨 규칙 — CLAUDE.md §6.2]
- temporalLabel은 반드시 다음 중 하나: "[현행]" | "[적용 시점: YYYY.MM.DD~YYYY.MM.DD]" | "[폐지: YYYY.MM.DD]"
```

**변경 후:**

```typescript
[시점 라벨 규칙 — CLAUDE.md §6.2 / TAX-037·TAX-038]
- 법령(sourceType='법령')의 temporalLabel은 반드시 다음 중 하나:
  "[현행]" | "[적용 시점: YYYY.MM.DD~YYYY.MM.DD]" | "[폐지: YYYY.MM.DD]"
- 비법령(sourceType='판례'|'해석례'|'심판례')의 temporalLabel은:
  "[결정: YYYY.MM.DD]" — 제공된 '결정일'을 그대로 사용. 결정일이 '불명'이면 "[현행]" 허용.
```

### 2. `buildLawsContext()` 비법령 메타 노출

**변경 전 (line 54~59):**

```typescript
function buildLawsContext(laws: TaxLaw[]): string {
  if (laws.length === 0) return '[검색된 법령 없음]'
  return laws.map((law, idx) =>
    `[${idx}] ${law.lawName} ${law.articleNumber} (${law.trustTier})\n시행일: ${law.enforcementDate}\n원문:\n${law.content}`
  ).join('\n\n---\n\n')
}
```

**변경 후 (분기 추가):**

```typescript
function buildLawsContext(laws: TaxLaw[]): string {
  if (laws.length === 0) return '[검색된 법령 없음]'
  return laws.map((law, idx) => {
    const nonlawMeta =
      law.sourceType !== '법령'
        ? `\nsourceType: ${law.sourceType}\n결정일: ${law.decisionDate ?? '불명'}`
        : ''
    return `[${idx}] ${law.lawName} ${law.articleNumber} (${law.trustTier})${nonlawMeta}\n시행일: ${law.enforcementDate}\n원문:\n${law.content}`
  }).join('\n\n---\n\n')
}
```

**법령 출력 byte-level 동일성:** `sourceType==='법령'`이면 `nonlawMeta=''`이라 기존 템플릿과 정확히 동일 (회귀 테스트로 봉인 — §3 검증 결과).

**비법령 출력 예시 (심판례):**

```
[0] 조세심판원 조심 2020부1558  (T3)
sourceType: 심판례
결정일: 2020-06-16
시행일: 
원문:
심판청구를 기각한다.
...
```

### 3. 신규 테스트 4건

| 테스트 | 검증 항목 |
|---|---|
| `[프롬프트] 비법령 입력 시 LLM 컨텍스트에 sourceType·결정일이 노출된다` | `prompt.toContain('sourceType: 심판례')`·`prompt.toContain('결정일: 2020-06-16')` |
| `[응답] LLM이 [결정: YYYY.MM.DD] 형식을 반환하면 그대로 통과된다` | `result.temporalLabel === '[결정: 2020.06.16]'` (V4 PASS 보장) |
| `[회귀 방지] 법령 입력 시 컨텍스트에 sourceType·결정일 메타가 노출되지 않는다` | `prompt.not.toContain('sourceType:')`·기존 형식 보존 단언 |
| `[결정일 불명] 비법령에 decisionDate 없으면 "불명"으로 노출되어 [현행] 폴백 허용` | `prompt.toContain('결정일: 불명')` |

---

## 검증 결과

### 1. TAX-038 신규 테스트 PASS

```
npx vitest run tests/integration/llmAnswerGenerator.test.ts
Test Files  1 passed (1)
Tests       13 passed (13)
Duration    1.22s
```

기존 9건 + 신규 4건 = 13건 모두 PASS.

### 2. 전체 vitest 회귀 게이트

```
Test Files  12 passed (12)
Tests       253 passed (253)
Duration    7.94s
```

249 → 253 (TAX-039 4건 + TAX-038 4건 누적). 기존 모든 테스트 회귀 없음.

### 3. 골든셋 사전 점검

```
확정까지 남은 수: 0건 (목표 30)
사전 점검 불일치(기대≠실제): 0건
```

40건 V1~V6 모두 통과 유지.

### 4. lawVerifier V4 정규식 무변경 확인

`src/adapters/lawVerifier.ts` `TEMPORAL_LABEL_PATTERNS` 4종(TAX-037 완료 상태) 그대로. 본 티켓은 LLM 프롬프트만 변경, 검증 로직 무변경.

---

## 정책·결정 사항

| 결정일 | 항목 | 내용 |
|---|---|---|
| 2026-06-05 | LLM 프롬프트 분기 방식 | sourceType 기반 분기를 SYSTEM_PROMPT + 컨텍스트 양쪽에 명시 (옵션 B 채택, B안 §1 추천) |
| 2026-06-05 | 결정일 불명 폴백 | 컨텍스트에 "결정일: 불명" 출력, LLM이 `[현행]` 폴백 |
| 2026-06-05 | 어댑터 후처리(`normalizeTemporalLabel`) 도입 | 거부 — 책임 분리 위반(CLAUDE.md §2)·디버깅 어려움 |

---

## 잠재 위험

| 위험 | 수준 | 대응 |
|---|---|---|
| GPT-4o-mini가 비결정적으로 `[현행]`을 반환할 수 있음 | 저 | V4가 `[현행]`도 허용하므로 폴백 자체는 안전. 운영 표면 UX에서만 결정일 손실 — 실 운영에서 비율 모니터링 권장 |
| 운영 비법령 답변 자연어 표면 검증 | 저 | 모킹 기반 단위 테스트 통과. 회계사가 실 운영 환경에서 심판례 질문 1회 던져 표면 라벨 확인 권장 |
| `buildLawsContext` 출력에 `\n시행일: `(빈 enforcementDate) 노출 | 저 | 비법령 enforcementDate가 빈 문자열이지만 기존 동작과 동일. 별도 정리는 별도 티켓에서 |

---

## 후속 작업

- (선택) 운영 환경에서 비법령 질문 1회 표면 검증 → 회계사 표면 UX 확인
- (선택) `enforcementDate` 빈 값 노출 정리 — 비법령 sourceType일 때 "시행일:" 줄 자체 생략하는 별도 티켓 검토

---

## 참조

- `docs/tickets/TAX-038_nonlaw_llm_prompt_decision_label.md` — 구현 티켓
- `src/adapters/llmAnswerGenerator.ts` SYSTEM_PROMPT(line ~33), `buildLawsContext`(line ~55)
- `tests/integration/llmAnswerGenerator.test.ts` — TAX-038 블록 (line ~169)
- 선행: `docs/reports/TAX-037_report.md`(V4 4종화), `docs/reports/TAX-039_report.md`(어댑터 매핑 회귀 방지)
