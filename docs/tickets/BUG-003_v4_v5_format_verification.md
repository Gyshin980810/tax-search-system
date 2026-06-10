# [BUG-003] V4 시점 라벨·V5 면책 고지가 "비어있지 않음"만 검사 — 형식·문구 미검증

> 본 티켓은 Phase 3(TAX-012) PRD·SSOT 정합성 평가에서 발견된 MED 결함 M-1·M-2를 수정한다.
> AI는 작업 시작 전 이 티켓 + `CLAUDE.md` §6.2·§6.4 + `docs/SSOT.md` §14.1 + `docs/PRD.md` §6.5를 읽는다.
> 평가 리포트: `docs/reports/PHASE3-EVALUATION_2026-05-18_report.md` §3(M-1·M-2)·§6(순위4).

---

## Metadata

- **Type**: BUG
- **Severity**: major  *(검증 형해화 — "있으면 통과"라 왜곡·축약 라벨/면책이 회계사 노출)*
- **Layer**: adapter  *(보조: tests 단위 회귀)*
- **Milestone**: MVP  *(M3 검증 실효성 게이트 구성요소)*
- **Estimated Size**: S (1~2파일: `lawVerifier.ts` + 단위 테스트)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

V4(시점 라벨)·V5(면책 고지) 검증이 **"필드가 비어있지 않은지"만** 확인한다.

- **M-1 / V4** — `src/adapters/lawVerifier.ts:111-115`
  ```ts
  if (!answer.temporalLabel || answer.temporalLabel.trim() === '') {
    checks.v4 = false
    failReasons.push('V4: 시점 라벨 미부착 — temporalLabel이 비어 있음')
  }
  ```
  `temporalLabel`에 임의 문자열(예: `"옛날 법"`, `"2020년쯤"`)이 들어 있어도 비어있지만 않으면 통과. `[현행]` / `[적용 시점: YYYY.MM.DD ~ YYYY.MM.DD]` / `[폐지: YYYY.MM.DD]` **3종 형식 검증이 없다**.
- **M-2 / V5** — `src/adapters/lawVerifier.ts:117-121`
  ```ts
  if (!answer.disclaimer || answer.disclaimer.trim() === '') {
    checks.v5 = false
    failReasons.push('V5: 면책 고지 미부착 — disclaimer가 비어 있음')
  }
  ```
  `disclaimer`에 짧게 축약·왜곡된 면책(예: `"참고용입니다"`)이 들어 있어도 통과. `src/domain/disclaimer.ts`의 표준 상수 `DISCLAIMER`와 **문구 일치 검증이 없다**.

### 1.2 기대 동작

- **V4**: `answer.temporalLabel`이 다음 3종 형식 중 하나와 정확히 일치할 때만 통과(CLAUDE.md §6.2).
  - `[현행]`
  - `[적용 시점: YYYY.MM.DD ~ YYYY.MM.DD]` (날짜는 4자리.2자리.2자리)
  - `[폐지: YYYY.MM.DD]`
  - 형식 불일치 시 `checks.v4 = false` + `failReasons` 기록.
- **V5**: `answer.disclaimer`가 `DISCLAIMER` 표준 상수와 **문자 단위로 일치**할 때만 통과(SSOT §14.1 "표준 문구 고정"). 불일치 시 `checks.v5 = false`.
  - 단, **BUG-001의 V5 자동 부착 경로와 충돌하지 않아야 한다** — `generateAnswer.ts`의 `[4-a]` 블록은 V5 실패 시 `DISCLAIMER` 상수를 그대로 주입하므로, 본 강화 후에도 자동 부착 → 재검증 시 V5 PASS가 보장되어야 한다(§7 참조).

### 1.3 영향·중요도

- 시점 오류·면책 왜곡은 PRD §0 "틀린 답 < 없는 답"·CLAUDE.md §6.2 시점 라벨 의무가 막으려던 핵심 위험이다. 회계사가 시점을 오해하거나 면책 범위가 축소되면 가산세·법적 분쟁 직결.
- 현재 V4·V5는 "존재 여부"만 보므로 검증이 형해화되어 있다. 평가 리포트 §2 핵심 결론("내용·형식 정확성 검증이 느슨")의 대표 사례.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/adapters/lawVerifier.ts` (수정 — V4 `:111-115`, V5 `:117-121` 블록)
- `src/domain/disclaimer.ts` (참조 — `DISCLAIMER` 표준 상수, 수정 금지)
- `src/domain/LabeledAnswer.ts` (참조 — `temporalLabel`·`disclaimer` 필드)
- `src/usecases/generateAnswer.ts` (참조만 — BUG-001 `[4-a]` 자동 부착 경로 회귀 확인, 수정 금지)
- `tests/unit/lawVerifier.test.ts` (수정 — V4 형식·V5 문구 FAIL/PASS 회귀 테스트 추가)

### 2.2 외부 API·리소스

- 없음. 순수 내부 규칙 검증(LLM·외부 API 호출 없음 — law-verifier는 규칙 기반 유지, CLAUDE.md §6.4).

### 2.3 아키텍처 힌트

```
V4: temporalLabel 비어있음?  → FAIL (기존)
  + 3종 정규식 중 하나와 매칭 안 됨 → FAIL (신규)
V5: disclaimer 비어있음?     → FAIL (기존)
  + disclaimer.trim() !== DISCLAIMER → FAIL (신규)
```

- 시점 형식은 SSOT §7.1·CLAUDE.md §6.1 "문자 단위 일치" 정신에 맞춰 **엄격 정규식**(퍼지·유사 매칭 금지). `.trim()` 외 정규화 도입 금지.

---

## 3. Scope (작업 범위) ⭐ 가장 중요

### 3.1 허용되는 변경

- [ ] `src/adapters/lawVerifier.ts` — V4 블록에 시점 라벨 3종 형식 정규식 검증 추가
- [ ] `src/adapters/lawVerifier.ts` — V5 블록에 `DISCLAIMER` 상수와 문구 일치 검증 추가
- [ ] `tests/unit/lawVerifier.test.ts` — V4 형식 위반/적합, V5 문구 위반/적합 회귀 테스트 추가

### 3.2 금지되는 변경

- ❌ V1·V2·V3·V6 판정 로직 변경 (BUG-002 및 별도 티켓 범위)
- ❌ `src/domain/disclaimer.ts`의 `DISCLAIMER` 상수 문구 수정 (표준 문구는 SSOT §14.1 — 변경은 별도 문서 세션)
- ❌ `generateAnswer.ts` 재시도 정책·`[4-a]` 자동 부착 블록 변경 (BUG-001 완료 범위)
- ❌ 퍼지/유사도 매칭 도입 (정확성 우선)
- ❌ LLM 호출 추가 (law-verifier 순수 규칙 기반 유지 — CLAUDE.md §6.4)
- ❌ UI·API Route 변경, 폴더 구조·의존성 변경
- ❌ PRD/SSOT/CLAUDE.md 본문 수정 (문서 정합은 별도 갱신 세션)

---

## 4. Strategy (구현 힌트 — 권장안, 강제 아님)

1. **모듈 스코프 상수**로 시점 라벨 정규식 정의(BUG-002의 `extractQuotedSpans` 헬퍼 배치 패턴과 일관):
   ```ts
   // CLAUDE.md §6.2 시점 라벨 3종 형식
   const TEMPORAL_LABEL_PATTERNS: RegExp[] = [
     /^\[현행\]$/,
     /^\[적용 시점: \d{4}\.\d{2}\.\d{2} ~ \d{4}\.\d{2}\.\d{2}\]$/,
     /^\[폐지: \d{4}\.\d{2}\.\d{2}\]$/,
   ]
   ```
   (구분자·공백·물결표(`~`) 표기는 CLAUDE.md §6.2 예시와 **문자 단위로 일치**하도록 확정 — 승인 단계에서 실제 답변 생성 코드가 출력하는 표기와 대조 후 고정.)
2. V4 블록: 빈 값 검사(기존) 유지 + 비어있지 않으면 `TEMPORAL_LABEL_PATTERNS.some(p => p.test(answer.temporalLabel.trim()))` 가 false면 `checks.v4 = false`.
3. V5 블록: 빈 값 검사(기존) 유지 + `answer.disclaimer.trim() !== DISCLAIMER`면 `checks.v5 = false`. `import { DISCLAIMER } from '../domain/disclaimer'` 추가(또는 BUG-001이 generateAnswer에만 import했으면 lawVerifier에 신규 import).
4. `failReasons` 메시지는 기존 형식·어투 유지(예: `V4: 시점 라벨 형식 불일치 — "<앞 30자>"`).
5. **BUG-001 회귀 확인**: `generateAnswer.ts` `[4-a]`가 주입하는 값이 `DISCLAIMER` 상수 그 자체이므로 강화 후에도 자동 부착 → V5 PASS 유지됨을 단위/통합 테스트로 확인.

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `temporalLabel`이 3종 형식과 불일치(예: `"옛날 법"`, `"[적용 시점: 2020]"`)면 `checks.v4 === false`
2. [ ] `temporalLabel`이 `[현행]` / `[적용 시점: 2024.01.01 ~ 2024.12.31]` / `[폐지: 2023.06.30]` 각각이면 V4 통과
3. [ ] `disclaimer`가 `DISCLAIMER` 상수와 1자라도 다르면(축약·공백 차이 포함) `checks.v5 === false`
4. [ ] `disclaimer`가 `DISCLAIMER` 상수와 정확히 일치하면 V5 통과
5. [ ] 기존 V1·V2·V3·V6 단위 테스트 전부 그린(회귀 0건)
6. [ ] BUG-001 V5 자동 부착 경로 회귀 그린 — 자동 부착 후 재검증 시 V5 PASS (E-VERIFY-FAIL 오작동 없음)
7. [ ] `npm run test` — 기존 83건 + 신규 테스트 전부 그린
8. [ ] `npm run lint`, `npm run typecheck` 무오류
9. [ ] 코드 동작이 CLAUDE.md §6.2(시점 3종) / SSOT §14.1(면책 표준 문구 고정)과 일치

---

## 6. Verification (검증 단계 — 회계사 확인)

1. `npm run test` → V4 형식 위반·V5 문구 위반 케이스가 실제 FAIL로 잡히는지 확인
2. `npm run test` → BUG-001 V5 자동 부착 테스트가 여전히 PASS(자동 부착 후 V5 통과)인지 확인
3. (코드 리뷰) V4가 3종 정규식 전부를, V5가 `DISCLAIMER` 상수 일치를 검사하는지 확인
4. `docs/reports/BUG-003_report.md` 검토

---

## 7. Risks / Notes (위험·주의사항)

- **BUG-001 상호작용(중요)**: V5를 "DISCLAIMER 정확 일치"로 강화하면, 답변 생성 측이 `DISCLAIMER` 상수를 그대로 주입하지 않고 변형하면 자동 부착 후에도 V5 FAIL → `E-VERIFY-FAIL`. 구현 전 `generateAnswer.ts` `[4-a]`가 **상수 자체**를 주입함을 재확인하고, 회귀 테스트로 고정할 것.
- **시점 라벨 표기 일치**: 정규식의 공백·구분자·물결표가 답변 생성 코드의 실제 출력과 1자라도 다르면 정상 답변이 V4 FAIL. 승인 단계에서 답변 생성 측 출력 표본과 대조 후 정규식 확정(임의 추정 금지 — STOP & ASK).
- 시점 라벨 형식이 향후 확장(예: 시·분 표기)될 경우 정규식 보완은 별도 티켓.
- 골든셋 정답값에 영향 시 SSOT §13.2상 회계사 검수 필요 — 본 티켓은 단위 테스트 중심, 골든셋 픽스처 변경은 BUG-006 범위.

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] 근본 원인 분석 (V4·V5가 빈 값만 검사)
- [ ] 영향받는 파일 목록
- [ ] 시점 라벨 정규식 표기 확정안 + BUG-001 자동 부착 회귀 영향 분석 (승인 항목)
- [ ] 구현 계획 (3~5단계)

→ **인간(회계사) 승인 후 코딩 시작** (CLAUDE.md 행동 9계명 #8, #10)

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록
- [ ] 변경 요약
- [ ] 검증 단계별 결과 (PASS/FAIL)
- [ ] BUG-001 자동 부착 회귀 결과
- [ ] 리포트 파일 경로: `docs/reports/BUG-003_report.md`

---

## 9. Ticket Size Rule

- 수정 파일 1~2개(`lawVerifier.ts` + 단위 테스트), 단일 논리 변경(V4·V5 형식 강화) → 규칙 내(S). 분할 불필요.

---

## 10. Related Tickets (관련 티켓)

- 선행: `TAX-012` (Phase 3 law-verifier 통합 — 결함 발생 지점)
- 의존: `BUG-001_v5_disclaimer_auto_attach.md` (완료 — V5 강화 시 자동 부착 경로 회귀 필수 확인)
- 병행: `BUG-005`(M-7·N-1·N-2), `BUG-006`(M-5 골든셋 네거티브 확충) — 각 별도 PR(SSOT §8.3 1티켓 1PR)
- 참조: 평가 리포트 §3(M-1·M-2)·§6(순위4), CLAUDE.md §6.2·§6.4, SSOT §14.1, PRD §6.5

---

## 11. Report Link (리포트 연결)

Report: `docs/reports/BUG-003_report.md` (완료 — 2026-05-19, 회계사 결정 옵션 A로 구현)

---

**작성자**: Claude (Phase 3 평가 기반 초안)
**작성일**: 2026-05-19
**최종 수정일**: 2026-05-19
