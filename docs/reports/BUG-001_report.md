# BUG-001 구현 리포트 — V5 면책 고지 "자동 부착" 사양 구현

> 완료일: 2026-05-18
> 관련 티켓: `docs/tickets/BUG-001_v5_disclaimer_auto_attach.md`
> 선행: TAX-012 (Phase 3 law-verifier 통합), Phase 3 재평가 H-1
> Severity: critical (정확성 직결 — PRD §0 "틀린 답 < 없는 답" 위반 차단)

---

## 1. 근본 원인

`src/usecases/generateAnswer.ts`의 FAIL 분기가 `if (!verifyResult.checks.v1)` **단일 조건**이었다.
면책 고지 누락으로 **V5만 단독 실패**하면 `checks.v1 === true`이므로 `else`(LLM 재생성)
경로로 빠졌고, `generateAnswer.ts`에 `DISCLAIMER` import 자체가 없어 자동 부착 코드가 부재했다.

→ 고정 상수 한 줄이면 채울 면책을 LLM 재생성에 의존 → 재생성이 또 면책을 누락하면
`E-VERIFY-FAIL`로 **정답 폐기** + 불필요한 LLM 비용·지연.

---

## 2. 파일 변경 목록

| 파일 | 작업 | 내용 |
|---|---|---|
| `src/usecases/generateAnswer.ts` | 수정 | `DISCLAIMER` import 추가 + V5 자동 부착 블록 `[4-a]`를 재시도 분기 `[4-b]` 앞에 삽입 |
| `tests/unit/generateAnswer.test.ts` | 수정 | `FAIL_V5_RESULT`·`FAIL_V2_V5_RESULT` 픽스처 + "V5 면책 고지 자동 부착" 테스트 3건 추가 |

> 금지 항목(티켓 §3.2) 전부 미변경: V1~V4·V6 로직, `DISCLAIMER` 문구, 재시도 횟수
> 정책, UI·API Route, 법령 원문, 폴더구조·의존성, PRD/SSOT 본문.

---

## 3. 주요 변경 내용

### 3.1 자동 부착 블록 (재시도 분기보다 앞)

```ts
// [4] law-verifier V1~V6 검증
let verifyResult = await verifier.verify(answer, searchResult.items)

// [4-a] V5 면책 고지 자동 부착 — 고정 상수이므로 재생성 없이 코드가 직접 주입
if (!verifyResult.checks.v5) {
  answer = { ...answer, disclaimer: DISCLAIMER }
  verifyResult = await verifier.verify(answer, searchResult.items)
}

// [4-b] 잔여 FAIL(V1·V2~V6)에 대해 기존 재시도 정책 적용 (변경 없음)
if (verifyResult.status === 'FAIL') { ... }
```

**순서가 핵심**: 자동 부착을 `[4-b]` 재시도 분기 *앞*에 배치 → V1과 V5가 동시
실패해도 V5는 먼저 채워지고 V1만 재검색 경로로 진입 (티켓 §7 위험 해소).

### 3.2 테스트 3건 (사양 강제 안전망 — 재평가 M-6 해소)

| 테스트 | 검증 | AC |
|---|---|---|
| V5 단독 실패 | `generate` 재호출 0회, `verify` 2회, status PASS, `disclaimer === DISCLAIMER` | AC1 |
| V5+V2 동시 실패 | V5 자동 부착 선처리, `generate` 2회(재생성 1회), status PASS | AC2 |
| 자동 부착 후 V2 지속 FAIL | `E-VERIFY-FAIL` throw (V5 탓 폐기 아님) | AC3 |

---

## 4. 검증 결과

| 단계 | 명령 | 결과 |
|---|---|---|
| 타입 체크 | `npm run typecheck` | ✅ 오류 없음 |
| 린트 | `npm run lint` | ✅ 오류 없음 |
| 테스트 | `npm run test` | ✅ **78 passed (78)** — 기존 75 + 신규 3 |
| 골든러너 | (vitest 포함) | ✅ 골든셋 6건 그대로 PASS (미변경) |

### Acceptance Criteria 대응

- [x] AC1 — `disclaimer` 빈 답변 + 그 외 통과 시 generate 재호출 없이 DISCLAIMER 주입 후 PASS
- [x] AC2 — V5+V2 동시 실패 시 V5 자동 부착 선처리, 잔여만 재생성 1회
- [x] AC3 — 자동 부착 후에도 다른 항목 FAIL이면 기존대로 E-VERIFY-FAIL
- [x] AC4 — 기존 75건 그린 유지 + 신규 테스트 통과 (78건)
- [x] AC5 — lint·typecheck 무오류
- [x] AC6 — 골든러너 전체 PASS
- [x] AC7 — 코드 동작이 PRD §6.5 / SSOT §7.4 / CLAUDE.md §6.4 "V5 실패 → 자동 부착(재생성 불필요)"과 일치

---

## 5. 잔여·위험·회계사 결정 사항

### 5.1 골든셋 픽스처 제외 (회계사 확인 요청)

티켓 §3.1은 `eval/golden_direct.json`에 V5 자동 부착 PASS 픽스처 1건 추가를 허용하나,
**골든러너(`tests/golden/run_golden.test.ts:34`)는 `verifier.verify()`만 직접 호출**하고
`generateAnswer`를 거치지 않는다. 자동 부착 로직은 `generateAnswer`(Usecase) 계층에
있으므로, `disclaimer:""` + `expectedStatus:"PASS"` 픽스처는 골든러너에서 V5 FAIL로
판정되어 **테스트가 깨진다**.

→ 자동 부착 검증은 단위 테스트(§3.2) 3건으로 완전 커버. 골든셋 픽스처는 이번 PR에서
**제외**(회계사 사전 승인 완료). 골든셋 정답값은 SSOT §13.2상 회계사 검수 필수이므로
AI 임의 추가하지 않음.

### 5.2 범위 밖 (별도 처리)

- PRD/SSOT 본문의 면책 자동 부착 위치 표기(`searchTaxLaw.ts`) 불일치(재평가 발견 Y) —
  문서 갱신 세션에서 별도 처리 (SSOT §9.3).
- BUG-002(V2 summary 미검사)는 별도 PR — SSOT §8.3 1티켓 1PR.

---

## 6. 결론

V5 면책 고지가 사양대로 **재생성 없이 자동 부착**되도록 수정 완료. 정답을 보유한
답변이 면책 누락만으로 `E-VERIFY-FAIL` 폐기되던 경로를 차단했다. 재평가 H-1·M-6
해소. M3 회계사 노출 게이트 잔여 항목 중 BUG-001 종결, **BUG-002는 미해소**.

---

**작성자**: Claude (BUG-001 구현)
**작성일**: 2026-05-18
