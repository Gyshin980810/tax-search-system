# TAX-048 T1·T2 부재 시 🟢직접근거 금지 명문화 (Track 2A)

> 선행 진단: TAX-029 P95 100회 측정 보고서 + 단건 진단 (G-S-소득-03 · G-S-상증-01) 2026-06-08
> 후속: TAX-049 (조문번호 매핑 사전, Track 1A)

---

## Metadata

- **Type**: FEAT (정확성 강화)
- **Severity**: major
- **Layer**: adapter
- **Milestone**: M3 정확성
- **Estimated Size**: S (1파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- TAX-029 P95 100회 측정에서 V3 라벨 부적절 9건(8.7%) 잔존.
- 단건 진단(G-S-소득-03 · G-S-상증-01) 결과: 검색이 T1·T2 법령 본문을 찾지 못하고 T3(예규·심판례·해석례)만 반환되는 경우, LLM이 그 중 하나에 🟢직접근거 라벨을 부여하는 변동성 발생.
- G-S-소득-03 단건 3회: PASS 1 / FAIL 2 (citations 3개일 때 재현률 ~67%).
- 현재 `SYSTEM_PROMPT`(`src/adapters/llmAnswerGenerator.ts`)에는 "T3·T4 출처에 🟢 금지" 규칙은 있으나, **"T1·T2 자체가 검색 결과에 없는 경우" 특수 시나리오 가이드가 빠져있음.**

### 1.2 기대 동작

- 검색 결과에 T1·T2가 하나도 없고 T3·T4만 있는 경우, LLM이 어떤 출처에도 🟢직접근거를 부여하지 않음.
- summary 첫 문장에 "직접 근거(법령 본문)를 찾지 못했습니다." 명시.
- 모든 citations 라벨은 🟡유사사례 또는 ⚪참고자료만 사용.
- 단정형 표현 금지.

### 1.3 영향·중요도

- V3 라벨 부적절 9건(8.7%) → 0건 목표.
- Phase 4 게이트 진입 조건 중 V3 정량 잔여 결함 해소.
- 회계사가 T3 자료를 법령처럼 인용해 가산세 위험에 노출되는 사고 차단.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/adapters/llmAnswerGenerator.ts` — SYSTEM_PROMPT (라벨 결정 표 직후 1블록 추가)

### 2.2 무변경 대상 (CLAUDE.md §6.4 V3 판정 로직 보호)

- `src/adapters/lawVerifier.ts` (V1~V6 판정 코드) — **무변경**
- `src/adapters/verifyDiagnostics.ts` — **무변경**
- `TIER_ALLOWED_LABELS` 상수 — **무변경**
- 골든셋 데이터 — **무변경**

### 2.3 아키텍처 힌트

```
질문 → queryRewriter → searchPort → [T3만 반환] → llmAnswerGenerator (SYSTEM_PROMPT 강화) → V3 PASS
```

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [ ] `src/adapters/llmAnswerGenerator.ts` SYSTEM_PROMPT에 `[T1·T2 부재 시 동작 규칙]` 1블록(~7줄) 추가

### 3.2 금지되는 변경

- ❌ V1~V6 판정 로직 (`lawVerifier.ts`·`verifyDiagnostics.ts`)
- ❌ `TIER_ALLOWED_LABELS` 상수
- ❌ 골든셋 데이터·답변 스키마
- ❌ 검색 어댑터·usecase

---

## 4. Strategy (구현 힌트)

1. 라벨 결정 표 직후, "절대 금지" 블록 직전에 신규 `[T1·T2 부재 시 동작 규칙]` 블록 삽입.
2. 규칙 내용:
   - 검색된 조문 전체가 T3·T4만이면 🟢 절대 금지.
   - 모든 citations은 🟡 또는 ⚪.
   - summary 첫 문장에 "직접 근거(법령 본문)를 찾지 못했습니다." 강제.
   - 단정형 표현 금지.
3. summary 규칙 블록의 "검색 결과가 없으면" 항목과 정합 유지.

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `npm run typecheck` PASS
2. [ ] `npm run test` (vitest 전체) PASS
3. [ ] `npm run perf:single-diagnostics -- G-S-소득-03 5` V3 PASS 5/5
4. [ ] `npm run perf:single-diagnostics -- G-S-상증-01 3` V3 PASS 3/3 (회귀 없음)
5. [ ] 추가 골든셋 표본 3건(G-1, G-S-법인-01, G-S-부가-01) V3 PASS 회귀 확인
6. [ ] V1·V2·V4·V5·V6 검증은 기존 PASS 유지 (회귀 없음)
7. [ ] 리포트 `docs/reports/TAX-048_report.md` 작성

---

## 6. Verification (검증 단계)

1. `npm run typecheck`
2. `npm run test`
3. `npm run perf:single-diagnostics -- G-S-소득-03 5`
4. `npm run perf:single-diagnostics -- G-S-상증-01 3`
5. 표본 회귀: `npm run perf:single-diagnostics -- G-1 1`, `-- G-S-법인-01 1`, `-- G-S-부가-01 1`

---

## 7. Risks / Notes

- LLM 변동성으로 1회 측정에서 우연히 통과할 수 있어 5회 표본 확보 필요.
- 회귀 표본 3건은 T1 검색이 성공하는 케이스로 선정 — T1·T2 부재 분기에 영향 받지 않아야 함.
- SYSTEM_PROMPT 토큰 ~25 증가 (영향 무시 가능, 비용·시간 영향 미미).

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [x] 근본 원인 분석 (단건 진단 결과)
- [x] 영향받는 파일 목록 (단 1개)
- [x] 구현 계획 — 회계사 승인 완료 2026-06-08

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록
- [ ] 변경 요약
- [ ] 검증 단계별 결과 (PASS/FAIL)
- [ ] 리포트: `docs/reports/TAX-048_report.md`

---

## 10. Related Tickets

- 선행: TAX-029 (P95 100회 측정) · TAX-042D (V3 라벨 강화 1차)
- 후속: TAX-049 (Track 1A 조문번호 매핑 사전 — 근본 검색 정확도 개선)

---

## 11. Report Link

Report: `docs/reports/TAX-048_report.md` (작성중)

---

**작성자**: AI(Claude Opus 4.7)
**작성일**: 2026-06-08
**최종 수정일**: 2026-06-08
