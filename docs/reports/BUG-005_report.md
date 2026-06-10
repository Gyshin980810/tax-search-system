# BUG-005 구현 리포트 — 노출 게이트 화이트리스트 + 낡은 주석 + V2 빈 발췌 사각지대

> 완료일: 2026-05-20
> 관련 티켓: `docs/tickets/BUG-005_gate_whitelist_stale_comment_empty_excerpt.md`
> 선행: TAX-012(Phase 3 law-verifier 통합), BUG-002(V2 summary 검사 — N-2는 V2 잔여 사각지대)
> Severity: major (M-7 노출 게이트 안전성 — 정확성 게이트는 화이트리스트가 안전 기본값)

---

## 1. 근본 원인

서로 독립적인 소규모 3건을 회계사 승인으로 한 묶음 처리(2026-05-19):

- **M-7 / 노출 게이트 블랙리스트** — `AnswerCard.tsx:25-41`
  `if (isPending) return 경고` 한 분기만 두고 PENDING 외 status는 전부 본문 렌더.
  현재 경로상 `generateAnswer`가 FAIL을 throw해 즉시 위험은 없으나, 정확성 게이트는
  "PASS만 통과"가 안전 기본값(CLAUDE.md §0).
- **N-1 / 낡은 주석** — `VerificationResult.ts:4, :31`
  *"M2에서는 항상 PENDING"*, *"M2에서 사용하는 PENDING 기본값 생성 헬퍼"* 잔재. 이미
  M3 통합 완료. 후속 개발자 오해 유발.
- **N-2 / V2 빈 발췌 사각지대** — `lawVerifier.ts:77` (BUG-003 후 라인 변동)
  `if (excerpt.length > 0 && !content.includes(excerpt))` → **빈 발췌면 V2 검사 건너뜀**.
  citation은 있는데 발췌만 비어 있어도 통과하던 우회구.

---

## 2. 회계사 결정 (2026-05-19)

| 결정 | 결과 |
|---|---|
| N-2 빈 발췌 정책 | **(a) citation 존재 + 빈 발췌 = V2 FAIL** (엄격 — 권장안 채택) |
| 기존 테스트 `lawVerifier.test.ts:143-149` | 사양 정합으로 갱신 (결함 동작 추종하던 테스트) |
| M-7 비-PASS·비-PENDING 안내 | "노출 불가" 안내 + 본문 미노출, `data-testid="not-exposable"` |

---

## 3. 파일 변경 목록

| 파일 | 작업 | 내용 |
|---|---|---|
| `app/components/AnswerCard.tsx` | 수정 | `isPending` 단일 분기 → `status` 3분기 화이트리스트(PASS/PENDING/그 외) |
| `src/domain/VerificationResult.ts` | 수정 | `:4`·`:31` "M2" 잔재 주석 2곳 갱신 (타입·로직 0 변경) |
| `src/adapters/lawVerifier.ts` | 수정 | V2 `excerpt.length > 0` 가드 제거 + 빈 발췌 명시적 FAIL 분기 |
| `tests/unit/lawVerifier.test.ts` | 수정 | 기존 "빈 excerpt는 검증을 건너뛴다" 갱신 + `citations:[]` 회귀 가드 추가 |

> 금지 항목(티켓 §3.2) 전부 미변경: V1·V3·V4·V5·V6 로직, V2 비어있지 않은 발췌·
> summary 검사(BUG-002), `VerificationResult` 타입·`pendingVerification()` 동작,
> `generateAnswer` 재시도·throw, 퍼지/유사 매칭, LLM 호출, UI 레이아웃 대개편,
> 폴더 구조·의존성, PRD/SSOT/CLAUDE.md 본문.

---

## 4. 주요 변경 내용

### 4.1 AnswerCard 화이트리스트 (M-7)

```tsx
const status = answer.verificationResult.status

if (status === 'PENDING') return <pending-warning />        // 기존 경고 보존
if (status !== 'PASS')   return <not-exposable />           // 신규 — 노출 불가 안내
// 이하 PASS만 본문(summary·citations·disclaimer) 렌더
```

기존 `data-testid="pending-warning"`·문구·분기 순서 보존 → E2E G-3 영향 없음.
신규 `data-testid="not-exposable"`(빨강 톤)로 향후 테스트·디버깅 식별자 부여.

### 4.2 VerificationResult.ts 주석 갱신 (N-1)

`:4` 인터페이스 JSDoc과 `:31` 헬퍼 JSDoc을 M3 활성화 사실로 교체. `verify()`가
PASS/FAIL을 산출함, PENDING은 검증 미수행 상태(골든셋 픽스처 초기값 등)임,
AnswerCard 화이트리스트가 노출 차단함을 명시. **타입·로직 0 변경**.

### 4.3 V2 빈 발췌 가드 제거 (N-2)

```ts
if (excerpt.length === 0) {
  checks.v2 = false
  failReasons.push(`V2: 발췌가 비어 있음 — ${lawName} ${articleNumber}`)
} else if (!content.includes(excerpt)) {
  // 기존 의역 검사 (불변)
}
```

`citations: []`(직접 근거 못 찾음)는 루프 자체를 안 돌아 V2 영향 없음 — 회귀 가드
테스트로 명문화. summary 큰따옴표 검사(BUG-002)의 `quoted.length > 0` 가드는
"빈 따옴표 인용"이라는 별 의미 없는 케이스라 의도적 보존(BUG-005 범위 밖).

---

## 5. 검증 결과

| 단계 | 명령 | 결과 |
|---|---|---|
| 타입 체크 | `npm run typecheck` | ✅ 오류 없음 |
| 린트 | `npm run lint` | ✅ 오류 없음 |
| 테스트 | `npm run test` | ✅ **89 passed (89)** — 직전 88 + 순증 1 |
| 회귀 | (vitest 7 파일 전체) | ✅ 기존 V1~V6·골든셋·BUG-001/002/003 그린 유지 |

### Acceptance Criteria 대응 (티켓 §5)

- [x] AC1 — `status === 'PASS'`일 때만 답변 본문 렌더
- [x] AC2 — `status === 'PENDING'`은 기존 "검증 대기" 경고 그대로(G-3 e2e 분기 보존)
- [x] AC3 — PASS·PENDING이 아닌 status에서 본문 미노출 + 노출 불가 안내(`not-exposable`)
- [x] AC4 — `VerificationResult.ts` 주석에서 "M2" 잔재 제거, 현재 동작과 일치 / 타입·로직 불변
- [x] AC5 — 빈 발췌 → V2 FAIL (확정 정책 (a)). 비어있지 않은 발췌·summary 검사 동작 불변
- [x] AC6 — `npm run test` 기존 + 신규 전부 그린(89)
- [x] AC7 — lint·typecheck 무오류
- [x] AC8 — 동작이 CLAUDE.md §0(화이트리스트) / SSOT §7.1(빈 발췌도 무결성 위반)·§9.3과 일치

### E2E 회귀 (권장 — 별도 실행)

- `tests/e2e/g3-pending-block.spec.ts`: PENDING 분기·`pending-warning` testid·미노출 검증.
  본 PR은 PENDING 분기를 **보존** → 회귀 영향 없음 예상.
- 권장: CI 또는 로컬에서 `npx playwright test tests/e2e/g3-pending-block.spec.ts`로
  최종 확인. 본 리포트의 unit/통합/골든 89건 그린으로 핵심 회귀는 확인됨.

---

## 6. 잔여·위험·후속

### 6.1 범위 밖 잔재 (별도 처리 권고)

`src/adapters/llmAnswerGenerator.ts:65`에 *"M2에서 verificationResult는 항상
PENDING — M3에서 law-verifier 연결 시 활성화"* 잔재 주석이 추가로 발견됐다. 단
BUG-005 티켓 §3.1 허용 범위는 `VerificationResult.ts`로 한정되어 있어 본 PR에서는
손대지 않음. N-1 후속 또는 별도 정리 티켓으로 처리 권고(임의 확대 안 함 —
CLAUDE.md 9계명 #6).

### 6.2 BUG-002 summary 검사와의 정합

BUG-002의 summary 큰따옴표 검사는 `quoted.length > 0` 가드를 그대로 둠. "빈
따옴표(`""`)" 자체가 인용으로서 의미 없는 케이스라 V2 추가 분기로 다룰 가치가
낮고, BUG-005 티켓 범위(citation.excerpt 사각지대)와도 별개. 일관성에 의문이
생기면 별도 티켓으로 처리.

### 6.3 범위 밖 (별도 처리)

- BUG-006(M-5 골든셋 네거티브 확충) — 본 승인 묶음의 다음 PR로 곧이어 진행.
- BUG-004(M-3·M-4) — Phase 4 보류.
- 사양↔코드 시점 라벨 표기 불일치 — 별도 정합 티켓(BUG-003 리포트 §7.1).

---

## 7. 결론

회계사 노출 게이트가 블랙리스트("PENDING만 차단")에서 **화이트리스트("PASS만 노출")**로
전환되어 정확성 안전 기본값을 확보했다. V2의 빈 발췌 우회구를 봉쇄해
인용 무결성 검사 사각지대를 제거했다. `VerificationResult.ts`의 M2 잔재 주석을
현행에 맞게 정리했다. 89건 테스트 그린·회귀 0건으로 안전 확인.

> **다음 PR**: BUG-006(골든셋 의역·Tier·시점 네거티브 확충) 곧이어 진행. M3
> 회계사 노출 게이트 권고 조건(평가 §6) 중 "네거티브 확보"가 본 시리즈로 완성됨.

---

**작성자**: Claude (BUG-005 구현)
**작성일**: 2026-05-20
