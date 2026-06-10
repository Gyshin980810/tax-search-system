# [BUG-001] V5 면책 고지 "자동 부착" 사양 미구현 — 재생성 경로로 잘못 처리됨

> 본 티켓은 Phase 3(TAX-012) PRD·SSOT 정합성 평가에서 발견된 HIGH-1 결함을 수정한다.
> AI는 작업 시작 전 이 티켓 + `CLAUDE.md` + `docs/SSOT.md` + `docs/PRD.md` §6.5.1을 읽는다.

---

## Metadata

- **Type**: BUG
- **Severity**: critical  *(정확성 직결 — PRD §0 "틀린 답 < 없는 답" 원칙 위반)*
- **Layer**: usecase  *(보조: adapter, docs)*
- **Milestone**: MVP  *(M3 회계사 노출 게이트 구성요소)*
- **Estimated Size**: S (1~2파일 + 골든셋 픽스처)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

면책 고지(`disclaimer`)가 비어 있어 **V5만 단독 실패**할 경우, 시스템은 사양과 달리 **답변 전체를 LLM으로 재생성**한다.

- `src/adapters/lawVerifier.ts:90-94` — `disclaimer`가 비면 `checks.v5 = false`만 설정
- `src/usecases/generateAnswer.ts:49-66` — FAIL 분기에서 `if (!verifyResult.checks.v1)` 로만 갈래를 나눔. V5만 실패 시 `checks.v1 === true`이므로 **else(재생성) 경로**로 빠짐 → 면책 고지를 끼워 넣는 대신 LLM 재호출
- 재생성된 답변이 다시 면책 고지를 누락하면 `AppError('E-VERIFY-FAIL')` → 답변 폐기

### 1.2 기대 동작

PRD·SSOT·CLAUDE.md·eval/README.md **4개 문서가 일관되게** "V5 실패 → 자동 부착(재생성 불필요)"으로 규정한다.

- PRD §6.5.1: `V5. 면책 고지 ... FAIL → 자동 부착 (재생성 불필요)`
- SSOT §7.4: `V5. 면책 고지 ... 자동 부착 (재생성 불필요)`
- CLAUDE.md §6.4: `V5. 면책 고지 ... 자동 부착`
- `eval/README.md` V1~V6 표: `V5 면책 고지 ... 자동 부착`

기대 동작:
- 검증 결과 `checks.v5 === false`이면, **재생성 없이** `src/domain/disclaimer.ts`의 `DISCLAIMER` 상수를 답변에 주입한 뒤 재검증한다.
- V5는 다른 항목(V1~V4·V6)과 동시 실패하더라도 독립적으로 자동 부착이 선행되어야 한다(면책 고지는 고정 상수이므로 LLM 판단 불필요).

### 1.3 영향·중요도

- `DISCLAIMER`는 이미 코드에 존재하는 **고정 문장 한 줄**이다. 빠졌으면 끼우면 되는 것을, LLM 재생성에 의존하면 다음 위험이 발생한다.
  - 재생성이 또 면책 고지를 누락 → 정답을 보유하고도 `E-VERIFY-FAIL`로 답변 폐기 → PRD §0 "틀린 답은 없는 답보다 나쁘다" 원칙 위반(정답을 없는 답으로 만듦)
  - 불필요한 LLM 재호출 → 응답시간(P95 < 15초, PRD §7.1) 악화 + 비용 증가(PRD §17.3.1)
- M3 "회계사 노출 시작" 게이트의 신뢰성에 직접 영향.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/usecases/generateAnswer.ts` (수정 — FAIL 분기 로직)
- `src/adapters/lawVerifier.ts` (참조 — V5 판정 로직 `:90-94`, 변경 불필요 가능)
- `src/domain/disclaimer.ts` (참조 — `DISCLAIMER` 상수)
- `src/domain/LabeledAnswer.ts` (참조 — `disclaimer` 필드)
- `tests/unit/generateAnswer.test.ts` (수정 — V5 자동 부착 케이스 추가)
- `eval/golden_direct.json` (수정 — V5 자동 부착 픽스처 추가, 회계사 검수 대상)

### 2.2 외부 API·리소스

- 없음. 본 수정은 순수 내부 로직(LLM·외부 API 호출 없음).

### 2.3 아키텍처 힌트

```
[3] 답변 생성 → [4] verify() → checks.v5 == false?
                                  │ yes → DISCLAIMER 주입(재생성 없음) → 재검증
                                  │ no  → 기존 V1/V2~V6 재시도 정책 유지
```

- 면책 고지 주입은 "비즈니스 정책 결정"이므로 **Usecase 계층**이 담당(SSOT §3.2 — Adapter는 비즈니스 판단 금지). `lawVerifier` Adapter는 판정만 유지.

---

## 3. Scope (작업 범위) ⭐ 가장 중요

### 3.1 허용되는 변경

- [ ] `src/usecases/generateAnswer.ts` — V5 단독/동반 실패 시 `DISCLAIMER` 자동 주입 후 재검증 로직 추가
- [ ] `tests/unit/generateAnswer.test.ts` — V5 자동 부착(재생성 미발생) 회귀 테스트 추가
- [ ] `eval/golden_direct.json` — V5 누락→자동 부착 PASS 픽스처 1건 추가 (회계사 최종 검수)
- [ ] (선택) `src/adapters/lawVerifier.ts` — V5 판정 주석 보강만, 로직 변경은 지양

### 3.2 금지되는 변경

- ❌ V1·V2·V3·V4·V6 판정 로직 변경 (BUG-002 및 별도 티켓 범위)
- ❌ `DISCLAIMER` 문구 자체 수정 (SSOT §14.1 표준 문구 고정)
- ❌ 재시도 횟수 정책(V1 재검색 1회 / V2~V6 재생성 1회) 변경 (PRD §13.2)
- ❌ UI·API Route 변경
- ❌ 법령 원문(`content`)·발췌(`excerpt`) 가공
- ❌ 폴더 구조·`package.json` 의존성 변경
- ❌ PRD/SSOT 본문 수정 (문서 정합은 별도 갱신 세션 — SSOT §9.3)

---

## 4. Strategy (구현 힌트 — 권장안, 강제 아님)

1. `generateAnswer.ts`에서 1차 `verify()` 직후, **재시도 분기보다 먼저** V5 단독 처리:
   ```
   if (!verifyResult.checks.v5) {
     answer = { ...answer, disclaimer: DISCLAIMER }   // 상수 주입, 재생성 없음
     verifyResult = await verifier.verify(answer, searchResult.items)
   }
   ```
   - 이후 남은 실패(V1/V2~V6)에 대해서만 기존 재검색/재생성 분기 적용.
2. V5 자동 부착으로 status가 PASS가 되면 그대로 반환(불필요한 LLM 호출 0회).
3. 단위 테스트: `disclaimer: ''`인 `MOCK_LABELED_ANSWER` + 검증 스텁이 1차 `v5:false` → 자동 부착 후 PASS 반환하도록 구성. `answerGenerator.generate` 호출 횟수가 **1회(재생성 없음)** 임을 단언.
4. 골든셋: `disclaimer: ""`로 시작하고 `expectedStatus: "PASS"`인 케이스를 추가하되, **골든셋 정답값은 회계사 검수**(SSOT §13.2 — AI 임의 수정 금지, 본 티켓에서는 초안만 제시하고 회계사 승인 표시).

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `disclaimer`가 빈 답변 + 그 외 V1~V4·V6 통과 시 → `answerGenerator.generate` **재호출 없이** `DISCLAIMER` 주입 후 status `PASS` 반환
2. [ ] V5와 V2(또는 V3/V4/V6)가 동시 실패 시 → V5는 자동 부착으로 선처리되고, 잔여 항목만 재생성 1회 정책 적용
3. [ ] 자동 부착 후에도 다른 항목이 FAIL이면 기존대로 `E-VERIFY-FAIL` (V5 때문에 정답이 폐기되지 않음)
4. [ ] `npm run test` — 기존 75건 전부 그린 유지 + V5 자동 부착 신규 테스트 통과
5. [ ] `npm run lint`, `npm run typecheck` 무오류
6. [ ] 골든셋 러너(`tests/golden/run_golden.test.ts`) 전체 PASS
7. [ ] 코드 동작이 PRD §6.5.1 / SSOT §7.4 / CLAUDE.md §6.4 문구와 일치

---

## 6. Verification (검증 단계 — 회계사 확인)

1. 저장소 루트에서 `npm run test` 실행 → 신규 V5 자동 부착 테스트 PASS 확인
2. `npm run dev` 실행 후 정상 질의 1건 → 답변 하단 면책 고지 정상 표시 확인
3. (코드 리뷰) `generateAnswer.ts`에서 V5 실패 시 `answerGenerator.generate` 호출이 추가로 발생하지 않음을 테스트 단언으로 확인
4. `docs/reports/BUG-001_report.md` 검토

---

## 7. Risks / Notes (위험·주의사항)

- V5 자동 부착을 재시도 분기보다 **앞에** 두지 않으면, V1 동반 실패 시 재검색 경로로 빠져 자동 부착이 누락될 수 있음 — 순서가 핵심.
- 골든셋 픽스처의 정답값(`expectedStatus`)은 SSOT §13.2에 따라 **회계사 검수 필수**. AI는 초안만 제시.
- 본 수정으로 코드는 사양과 일치하나, PRD/SSOT 본문의 호출 위치 표기(`searchTaxLaw.ts`) 불일치(MED-2)는 본 티켓 범위 밖 — 문서 갱신 세션에서 별도 처리.

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] 근본 원인 분석 (FAIL 분기에서 V5가 else로 빠지는 경로)
- [ ] 영향받는 파일 목록
- [ ] 구현 계획 (3~5단계)

→ **인간(회계사) 승인 후 코딩 시작** (CLAUDE.md 행동 9계명 #8)

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록
- [ ] 변경 요약
- [ ] 검증 단계별 결과 (PASS/FAIL)
- [ ] 발견된 위험·제한사항
- [ ] 리포트 파일 경로: `docs/reports/BUG-001_report.md`

---

## 9. Ticket Size Rule

- 수정 파일 1~2개(`generateAnswer.ts` + 테스트) + 골든셋 픽스처 1건 → 규칙 내(S). 분할 불필요.

---

## 10. Related Tickets (관련 티켓)

- 선행: `TAX-012` (Phase 3 law-verifier 통합 — 본 결함의 발생 지점)
- 병행: `BUG-002_v2_summary_citation_integrity.md` (HIGH-2, 별도 처리 — 동시 머지 금지: 1티켓 1PR, SSOT §8.3)
- 참조: PRD §6.5.1, SSOT §7.4, CLAUDE.md §6.4, `eval/README.md`, Phase 3 평가(HIGH-1)

---

## 11. Report Link (리포트 연결)

Report: `docs/reports/BUG-001_report.md` (미작성)

---

**작성자**: Claude (Phase 3 평가 기반 초안)
**작성일**: 2026-05-18
**최종 수정일**: 2026-05-18
