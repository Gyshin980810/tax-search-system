# [BUG-005] 노출 게이트 블랙리스트 + 낡은 PENDING 주석 + V2 빈 발췌 사각지대 (소규모 3건)

> 본 티켓은 Phase 3(TAX-012) PRD·SSOT 정합성 평가에서 발견된 MED M-7, LOW N-1, N-2를
> 한 묶음(소규모·독립)으로 수정한다. 회계사 승인으로 묶음 확정(2026-05-19).
> AI는 작업 시작 전 이 티켓 + `CLAUDE.md` §0·§6.1 + `docs/SSOT.md` §7.1 + 평가 리포트
> `docs/reports/PHASE3-EVALUATION_2026-05-18_report.md` §3(M-7·N-1·N-2)·§6(순위6)를 읽는다.

---

## Metadata

- **Type**: BUG
- **Severity**: major  *(M-7 노출 게이트 안전성 — 정확성 게이트는 화이트리스트가 안전)*
- **Layer**: ui  *(보조: domain 주석, adapter V2 미세 보강)*
- **Milestone**: MVP
- **Estimated Size**: S (3파일 소폭: `AnswerCard.tsx` + `VerificationResult.ts` + `lawVerifier.ts`)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

세 가지 독립적 소규모 결함:

- **M-7 / 노출 게이트 블랙리스트** — `app/components/AnswerCard.tsx:25-41`
  ```ts
  const isPending = answer.verificationResult.status === 'PENDING'
  if (isPending) { return <검증 대기 경고 /> }
  // ↓ PENDING이 아니면 (FAIL 포함) 전부 답변 카드 렌더
  ```
  `PENDING`만 차단하는 **블랙리스트**. `status === 'PASS'`만 통과시키는 화이트리스트가 아니다. 현재 경로상 `generateAnswer`가 FAIL을 `E-VERIFY-FAIL`로 throw해 PASS만 도달하므로 즉시 위험은 아니나, 신규 status·우회 경로 유입 시 그대로 회계사 노출. 정확성 게이트는 "PASS만 통과"가 안전(CLAUDE.md §0).
- **N-1 / 낡은 주석** — `src/domain/VerificationResult.ts:4`, `:31`
  - `:4` — `* M2에서는 항상 status='PENDING' — M3에서 law-verifier 연결 시 활성화됩니다.`
  - `:31` — `/** M2에서 사용하는 PENDING 기본값 생성 헬퍼 */`
  - 이미 M3에서 law-verifier가 통합·활성화됐는데 주석은 옛 상태(M2) 그대로 → 문서·코드 불일치 잔재. 후속 개발자가 "아직 PENDING 고정"으로 오해할 위험.
- **N-2 / V2 빈 발췌 사각지대** — `src/adapters/lawVerifier.ts:77`
  ```ts
  if (excerpt.length > 0 && !content.includes(excerpt)) { checks.v2 = false; ... }
  ```
  `excerpt.length > 0`일 때만 원문 대조. **빈 발췌(`""`)** 면 검사 자체를 건너뛰어 V2 통과. 인용 칸을 비워 무결성 검사를 우회하는 미세 사각지대.

### 1.2 기대 동작

- **M-7**: `AnswerCard`가 `status === 'PASS'`일 때만 답변 카드를 렌더한다. `PENDING`은 기존 "검증 대기" 경고 유지, 그 외(`FAIL` 등 예기치 않은 status)는 답변 본문을 노출하지 않고 "검증 미완료/노출 불가" 안내를 표시한다(화이트리스트).
- **N-1**: `VerificationResult.ts`의 두 주석을 현재(M3 활성화) 사실에 맞게 갱신. `pendingVerification()` 헬퍼의 실제 용도(골든셋 픽스처의 PENDING 초기값 등)를 정확히 기술.
- **N-2**: 빈 발췌가 V2 무결성 검사를 우회하지 못하도록 보강. 빈 발췌가 정상 입력이 아님을 판정 정책으로 명시(승인 단계에서 "빈 발췌 = FAIL" vs "빈 발췌 = citation 자체 부적합으로 별도 처리" 확정).

### 1.3 영향·중요도

- M-7: 회계사 노출 게이트의 마지막 방어선. 화이트리스트가 정확성 시스템의 안전 기본값(CLAUDE.md §0 "틀린 답은 없는 답보다 나쁘다").
- N-1: 정확성에 직접 영향은 없으나 코드·문서 정합(SSOT §9.3) 잔재 — 오해 유발 제거.
- N-2: 환각 차단 경로(V2)의 미세 우회구. BUG-002가 summary 인용을 막았으나 `excerpt` 빈 값 경로는 잔존.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `app/components/AnswerCard.tsx` (수정 — `:25-41` 게이트를 화이트리스트로)
- `src/domain/VerificationResult.ts` (수정 — `:4`, `:31` 주석 갱신, 로직 불변)
- `src/adapters/lawVerifier.ts` (수정 — V2 `:77` 빈 발췌 처리, 최소 변경)
- `tests/unit/lawVerifier.test.ts` (수정 — 빈 발췌 케이스 회귀 테스트)
- `tests/e2e/` 또는 컴포넌트 테스트 (해당 시 — 게이트 화이트리스트 동작 확인, 기존 PENDING 테스트 회귀 유지)

### 2.2 외부 API·리소스

- 없음. 순수 내부 표현·규칙 변경.

### 2.3 아키텍처 힌트

```
AnswerCard:  status === 'PASS' ? <답변카드> : status === 'PENDING' ? <대기경고> : <노출불가안내>
V2:          excerpt 빈 값 → (정책 확정) FAIL 또는 부적합 처리  (기존 비어있지않은 검사 불변)
주석:        M2 잔재 → M3 활성화 사실로 갱신 (로직 0 변경)
```

---

## 3. Scope (작업 범위) ⭐ 가장 중요

### 3.1 허용되는 변경

- [ ] `app/components/AnswerCard.tsx` — 노출 분기를 화이트리스트(`PASS`만 본문)로 전환, 비-PASS·비-PENDING 안내 추가
- [ ] `src/domain/VerificationResult.ts` — `:4`·`:31` 주석을 M3 활성화 사실로 갱신 (타입·로직 변경 금지)
- [ ] `src/adapters/lawVerifier.ts` — V2 빈 발췌 사각지대 보강 (확정된 정책대로 최소 변경)
- [ ] `tests/unit/lawVerifier.test.ts` — 빈 발췌 V2 회귀 테스트
- [ ] (필요 시) 게이트 화이트리스트 동작 컴포넌트/E2E 테스트 보강

### 3.2 금지되는 변경

- ❌ V1·V3·V4·V5·V6 로직, V2의 비어있지 않은 발췌·summary 검사(BUG-002) 약화
- ❌ `VerificationResult` 타입·`pendingVerification()` 동작 변경 (주석만 갱신)
- ❌ `generateAnswer` 재시도 정책·throw 동작 변경
- ❌ 퍼지/유사 매칭 도입, LLM 호출 추가
- ❌ UI 레이아웃 대개편 (게이트 분기 최소 변경만)
- ❌ 폴더 구조·의존성 변경, PRD/SSOT/CLAUDE.md 본문 수정

---

## 4. Strategy (구현 힌트 — 권장안, 강제 아님)

1. **M-7**: `AnswerCard`에서
   ```ts
   const status = answer.verificationResult.status
   if (status === 'PENDING') return <기존 대기 경고 유지 />
   if (status !== 'PASS')     return <노출 불가 안내 (data-testid="not-exposable") />
   // 이하 PASS만 답변 카드 렌더
   ```
   기존 `data-testid="pending-warning"` 등 테스트 식별자·문구는 보존(회귀 최소화).
2. **N-1**: `:4` 주석을 "law-verifier(M3) 통합 완료 — `verify()`가 PASS/FAIL을 산출. `PENDING`은 검증 미수행(골든셋 픽스처 초기값 등) 표현용." 류로 갱신. `:31`은 `pendingVerification()`의 실제 사용처에 맞게 정정. **로직 0 변경**.
3. **N-2**: 빈 발췌 정책을 승인 단계에서 확정 — 권장안은 "빈 `excerpt`는 인용으로서 무효 → `checks.v2 = false`"(엄격, 정확성 우선). citation 구조상 빈 발췌가 정상일 수 있는지 `LabeledAnswer`/생성 로직 확인 후 결정(STOP & ASK).
4. 세 변경은 독립적이므로 작은 커밋으로 분리하되 **1 PR**(SSOT §8.3, 묶음은 회계사 승인됨).

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `status === 'PASS'`일 때만 답변 본문(summary·citations·disclaimer) 렌더
2. [ ] `status === 'PENDING'`은 기존 "검증 대기" 경고 그대로(기존 테스트 회귀 0건)
3. [ ] `status`가 PASS·PENDING이 아닌 값일 때 답변 본문 미노출 + "노출 불가" 안내 표시
4. [ ] `VerificationResult.ts` 주석에 "M2" 잔재 표현 없음, 현재 동작과 일치 / 타입·로직 불변
5. [ ] 빈 발췌(`excerpt === ""`)가 확정 정책대로 처리됨(권장: V2 FAIL) — 비어있지 않은 발췌·summary 검사(BUG-002) 동작 불변
6. [ ] `npm run test` — 기존 83건 + 신규 전부 그린
7. [ ] `npm run lint`, `npm run typecheck` 무오류
8. [ ] 동작이 CLAUDE.md §0(화이트리스트 안전) / SSOT §7.1·§9.3과 일치

---

## 6. Verification (검증 단계 — 회계사 확인)

1. `npm run test` → 게이트 화이트리스트·빈 발췌 케이스 PASS/FAIL 확인
2. `npm run dev` → PENDING 답변(테스트 픽스처)이 기존처럼 "검증 대기" 경고로 표시되는지 육안 확인
3. (코드 리뷰) `AnswerCard`가 `PASS`만 본문 렌더하는지, `VerificationResult.ts` 주석에 M2 잔재 없는지 확인
4. `docs/reports/BUG-005_report.md` 검토

---

## 7. Risks / Notes (위험·주의사항)

- 화이트리스트 전환 시 기존 PENDING 경고 테스트(`data-testid="pending-warning"`)가 깨지지 않도록 식별자·분기 순서 보존.
- 빈 발췌 정책을 "FAIL"로 하면, 정당하게 발췌 없이 조문 메타만 인용하는 케이스가 있는지 `LabeledAnswer` 생성 로직 확인 필요(없다고 단정 금지 — 확인 후 진행).
- N-1은 주석만 변경이라 위험 낮음. 단 주석이 사양(CLAUDE.md §6.4)과 모순되지 않도록 표현 검토.
- 본 묶음은 성격이 다른 3건이나 모두 소규모·독립이며 회계사가 1티켓으로 승인(2026-05-19). 추후 분할 필요 시 회계사 확인 후 조정.

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] 근본 원인 분석 (M-7 블랙리스트 / N-1 잔재 주석 / N-2 빈 발췌 우회)
- [ ] 영향받는 파일 목록
- [ ] 빈 발췌(N-2) 처리 정책 제안 (FAIL vs 부적합 — 승인 항목)
- [ ] 구현 계획 (3~5단계)

→ **인간(회계사) 승인 후 코딩 시작** (CLAUDE.md 행동 9계명 #8, #10)

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록 / 변경 요약
- [ ] 검증 단계별 결과 (PASS/FAIL)
- [ ] 발견된 위험·제한사항
- [ ] 리포트 파일 경로: `docs/reports/BUG-005_report.md`

---

## 9. Ticket Size Rule

- 3파일 소폭 변경, 각각 독립 소규모(게이트 분기 / 주석 / 빈 발췌 가드) → 규칙 내(S). 회계사 승인으로 1티켓 확정.

---

## 10. Related Tickets (관련 티켓)

- 선행: `TAX-012` (Phase 3 law-verifier 통합)
- 병행: `BUG-003`(M-1·M-2), `BUG-006`(M-5 골든셋 네거티브) — 각 별도 PR(SSOT §8.3)
- 연계: `BUG-002`(V2 summary 인용 — N-2는 V2 잔여 사각지대)
- 참조: 평가 리포트 §3(M-7·N-1·N-2)·§6(순위6), CLAUDE.md §0·§6.4, SSOT §7.1·§9.3

---

## 11. Report Link (리포트 연결)

Report: `docs/reports/BUG-005_report.md` (완료 — 2026-05-20, N-2 정책 (a)·M-7 화이트리스트로 구현)

---

**작성자**: Claude (Phase 3 평가 기반 초안)
**작성일**: 2026-05-19
**최종 수정일**: 2026-05-19
