# [BUG-006] 골든셋 네거티브 케이스 확충 — 의역·잘못된 Tier 라벨·시점 오류 (M-5)

> 본 티켓은 Phase 3(TAX-012) 평가 §6 순위3 'M-5 골든셋 네거티브 확충'을 수행한다.
> BUG-002가 환각 인용 1건(`G-N1`)으로 부분 착수했고, 본 티켓이 의역·Tier·시점 유형을
> 추가해 "틀린 답을 FAIL로 거르는 능력"의 골든셋 회귀 커버리지를 완성한다.
> AI는 작업 시작 전 이 티켓 + `docs/SSOT.md` §13.2 + `docs/PRD.md` §6.3.2·§7.2 +
> 평가 리포트 `docs/reports/PHASE3-EVALUATION_2026-05-18_report.md` §3(M-5)·§6(순위3) +
> `eval/GOLDEN_SET_GUIDE.md`(특히 BUG-002가 추가한 "5-1단계 — 네거티브" 절)을 읽는다.

---

## Metadata

- **Type**: TASK  *(테스트 자산 확충 — 코드 로직 변경 아님, 골든셋 픽스처·가이드)*
- **Severity**: major  *(정확성 시스템 본질("틀린 답 차단")의 회귀 검증 공백)*
- **Layer**: docs  *(보조: eval 픽스처 — `golden_direct.json`, `GOLDEN_SET_GUIDE.md`)*
- **Milestone**: MVP  *(M3 회계사 노출 게이트 권고 조건: 네거티브 케이스 확보 — 리포트 §6)*
- **Estimated Size**: S (2파일: `golden_direct.json` + `GOLDEN_SET_GUIDE.md`, 코드 0)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- 평가 §3 M-5: 골든셋 `eval/golden_direct.json`이 G-1·G-2·G-3·G-4A·G-4B·G-5 **6건 전부 `expectedStatus:"PASS"`**였다. 환각/의역/잘못된 라벨/시점 오류를 FAIL로 거르는 **네거티브 케이스가 0건**.
- BUG-002에서 **`G-N1`(summary 환각 인용, `expectedStatus:"FAIL"`) 1건**을 초안으로 추가해 네거티브를 **최초 도입**(부분 해소). 단 환각 유형만 커버.
- 남은 공백: **의역**(원문을 바꿔 말한 인용), **잘못된 Tier 라벨**(T3/T4를 🟢직접근거로 단정), **시점 오류**(현행이 아닌데 `[현행]`, 또는 형식 위반) 유형의 네거티브가 없다.

### 1.2 기대 동작

- `golden_direct.json`에 다음 3유형의 `expectedStatus:"FAIL"` 네거티브 픽스처를 **각 1건 이상** 추가:
  - **유형 B — 의역**: V2가 잡아야 함 (발췌가 원문 문자 단위와 불일치)
  - **유형 C — 잘못된 Tier 라벨**: V3가 잡아야 함 (T3/T4 출처에 🟢직접근거)
  - **유형 D — 시점 오류/형식 위반**: V4가 잡아야 함 (BUG-003 구현 후 형식 검증에 걸림)
- 골든 러너가 각 픽스처를 의도대로 **FAIL 판정**하는지 회귀로 고정.
- `GOLDEN_SET_GUIDE.md`에 유형 B·C·D 작성 지침을 추가(BUG-002가 만든 "5-1단계 — 네거티브" 절 확장).
- 정답값(`expectedStatus`)은 SSOT §13.2상 **회계사 검수 필수** → `description`에 `[초안 → 회계사 검수 대기]` 표기, AI 임의 확정 금지.

### 1.3 영향·중요도

- 평가 §2 "가장 큰 구조적 리스크": 골든셋이 전부 PASS라 **정확성 시스템의 본질("틀린 답 차단")이 한 번도 회귀 검증된 적 없다**. BUG-002가 회귀로 안 잡힌 근본 원인.
- 본 티켓 완료 시 환각(G-N1)+의역+Tier+시점 4유형이 골든셋 회귀에 포함 → 향후 검증 로직 회귀(BUG-003 등)가 골든셋만으로 탐지 가능. 리포트 §6 "회계사 노출 게이트 권고" 조건(네거티브 확보) 충족에 기여.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `eval/golden_direct.json` (수정 — 유형 B·C·D 네거티브 픽스처 추가, `G-N1` 다음 번호 체계)
- `eval/GOLDEN_SET_GUIDE.md` (수정 — "5-1단계 — 네거티브" 절에 유형 B·C·D 지침 추가)
- `eval/run_golden.test.ts` (참조 — 골든 러너가 `verifier.verify()`를 직접 호출, `expectedStatus` 대조. 러너 로직 변경은 범위 밖)
- `src/adapters/lawVerifier.ts` (참조만 — 각 유형이 어느 V로 잡히는지 확인용, 수정 금지)

### 2.2 외부 API·리소스

- 없음. 골든 러너는 실 API·LLM 없이 `verifier.verify(answer, sourceLaws)`만 직접 호출한다(결정성·재현성 보장 — verifier는 규칙 기반 순수 함수).

### 2.3 아키텍처 힌트

```
golden_direct.json (픽스처: answer + sourceLaws + expectedStatus)
   → run_golden.test.ts → LawVerifierAdapter.verify() → status 비교
유형 B(의역)→V2 FAIL / 유형 C(Tier)→V3 FAIL / 유형 D(시점)→V4 FAIL 이 되도록 설계
```

- **BUG-003 의존성 주의**: 유형 D(시점 형식 위반)는 BUG-003(V4 형식 검증) 구현 전에는 FAIL이 아닐 수 있다. §7 참조 — 픽스처 설계를 BUG-003 머지 상태에 맞춰 분기(승인 단계에서 확정).

---

## 3. Scope (작업 범위) ⭐ 가장 중요

### 3.1 허용되는 변경

- [ ] `eval/golden_direct.json` — 유형 B(의역)·C(잘못된 Tier 라벨)·D(시점 오류) `expectedStatus:"FAIL"` 픽스처 각 1건 이상 추가
- [ ] `eval/GOLDEN_SET_GUIDE.md` — 유형 B·C·D 작성 지침 추가(기존 "5-1단계 — 네거티브" 절 확장)

### 3.2 금지되는 변경

- ❌ `src/adapters/lawVerifier.ts` 등 검증 로직 변경 (본 티켓은 테스트 자산만 — 로직은 BUG-003/005 범위)
- ❌ `eval/run_golden.test.ts` 러너 로직 변경 (픽스처만 추가)
- ❌ 기존 G-1~G-5·G-N1 픽스처의 정답값·내용 변경
- ❌ 법령 원문 임의 가공 — `sourceLaws[].content`는 실제 조문 표현을 따르되 네거티브용 변형은 **answer 측**에서만(원문은 진본 유지, CLAUDE.md §6.1)
- ❌ `expectedStatus`를 AI가 최종 확정 (SSOT §13.2 — 회계사 검수 전까지 `[초안 → 회계사 검수 대기]`)
- ❌ PRD/SSOT 본문, `eval/README.md` 합격선 표현 수정 (별도 문서 세션 — BUG-002 리포트 §5.2와 동일)

---

## 4. Strategy (구현 힌트 — 권장안, 강제 아님)

1. **유형 B (의역 → V2 FAIL)**: `sourceLaws[].content`에 실제 조문 문장을 두고, `answer.citations[].excerpt`(또는 summary 인용)에 **같은 뜻이나 다른 표현**(예: "면제한다" → "부과하지 않는다")을 넣어 `content.includes()`가 false가 되도록 구성.
2. **유형 C (잘못된 Tier → V3 FAIL)**: `sourceLaws`에 `trustTier: 'T3'`(예규) 또는 `'T4'`(판례) 출처를 두고 `citations[].label`을 `🟢직접근거`로 설정 → `TIER_ALLOWED_LABELS`(T3/T4는 🟡⚪⚫만 허용) 위반.
3. **유형 D (시점 → V4 FAIL)**: `answer.temporalLabel`을 형식 위반(예: `"옛날 법"`, `"[적용 시점: 2020]"`)으로 설정. **BUG-003 미머지 상태에서는 현행 V4(빈 값만 검사)가 FAIL을 못 낼 수 있음** → (a) BUG-003 머지 후 추가, 또는 (b) `temporalLabel`을 빈 문자열로 둬 현행 V4로도 FAIL — 어느 경로로 갈지 승인 단계에서 확정(임의 결정 금지).
4. 픽스처 ID는 `G-N1` 다음 체계로 일관(`G-N2`/`G-N3`/`G-N4` 등). `description`에 유형·기대 위반 V·`[초안 → 회계사 검수 대기]` 명기.
5. `GOLDEN_SET_GUIDE.md`에 유형 B·C·D 각각 "무엇을 비틀어 어느 V가 FAIL을 내는지" 표/예시 추가.
6. 골든 러너 실행 → 각 신규 픽스처가 의도한 V로 FAIL인지 확인(우연히 다른 V로 FAIL이면 픽스처 정밀화).

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] 의역 네거티브 1건 이상 — 골든 러너에서 `expectedStatus:"FAIL"`, 실제 V2로 FAIL
2. [ ] 잘못된 Tier 라벨 네거티브 1건 이상 — `expectedStatus:"FAIL"`, 실제 V3로 FAIL
3. [ ] 시점 오류 네거티브 1건 이상 — `expectedStatus:"FAIL"`, 확정 경로(BUG-003 머지 후 V4 형식 / 또는 빈 값 V4)대로 FAIL
4. [ ] 기존 G-1~G-5(PASS)·G-N1(FAIL) 픽스처 정답값·판정 불변(회귀 0건)
5. [ ] `npm run test`(골든 러너 포함) 전부 그린 — 신규 네거티브가 의도대로 FAIL 판정
6. [ ] 신규 픽스처 `description`에 유형·`[초안 → 회계사 검수 대기]` 표기 존재
7. [ ] `GOLDEN_SET_GUIDE.md`에 유형 B·C·D 작성 지침 추가됨
8. [ ] 코드 로직(`lawVerifier.ts` 등) 0 변경 — diff가 `eval/` 2파일에 한정

---

## 6. Verification (검증 단계 — 회계사 확인)

1. `npm run test` → 신규 네거티브 픽스처가 의도한 V(V2/V3/V4)로 FAIL인지 골든 러너 출력 확인
2. `eval/golden_direct.json`의 신규 픽스처 `description`·`expectedStatus` 회계사 검수
   → 타당하면 `[초안 → 회계사 검수 대기]` 표기 제거(별도 확정 커밋 또는 본 PR 내 회계사 지시 시)
3. (코드 리뷰) diff가 `eval/` 2파일에 한정, 검증 로직·기존 픽스처 불변 확인
4. `docs/reports/BUG-006_report.md` 검토

---

## 7. Risks / Notes (위험·주의사항)

- **BUG-003 의존(중요)**: 유형 D(시점 형식 위반)는 BUG-003 머지 전 현행 V4(빈 값만 검사)로는 FAIL이 안 날 수 있다. 머지 순서·픽스처 설계 경로를 승인 단계에서 확정(추정 금지 — STOP & ASK). BUG-003 미머지면 "빈 `temporalLabel`로 현행 V4 FAIL" 경로 권장.
- **정답값 회계사 검수 필수**(SSOT §13.2): `expectedStatus`는 AI가 확정하지 않는다. 모든 신규 픽스처는 `[초안 → 회계사 검수 대기]`.
- **원문 진본 유지**(CLAUDE.md §6.1): 네거티브를 만들 때 `sourceLaws[].content`(원문)는 실제 조문 표현을 따르고, "틀림"은 `answer` 측(excerpt/label/temporalLabel)에서만 만든다. 원문을 가짜로 비틀지 말 것.
- `eval/README.md` "6건 100% PASS"류 표현이 G-N1·신규 추가와 더 어긋남 — 본 티켓 범위 밖(BUG-002 리포트 §5.2와 동일, 별도 문서 세션, SSOT §9.3).
- 오탐 방지: 한 픽스처가 여러 V를 동시에 FAIL시키면 "어느 V를 검증하는 케이스인지" 불명확 → 가능한 한 **한 픽스처 = 한 V 위반**으로 격리.

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] 동기 (M-5 네거티브 공백 — 의역·Tier·시점)
- [ ] 영향받는 파일 목록 (eval/ 2파일 한정)
- [ ] 유형 D(시점) FAIL 경로 제안 + BUG-003 머지 순서 의존성 (승인 항목)
- [ ] 픽스처 설계 계획 (유형별 1건, 어느 V로 FAIL인지)

→ **인간(회계사) 승인 후 작성 시작** (CLAUDE.md 행동 9계명 #8, #10)

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록 / 변경 요약
- [ ] 골든 러너 결과 (각 신규 픽스처 FAIL 판정 + 의도한 V)
- [ ] 회계사 검수 대기 항목 명시 (`expectedStatus` 초안)
- [ ] 리포트 파일 경로: `docs/reports/BUG-006_report.md`

---

## 9. Ticket Size Rule

- `eval/` 2파일, 코드 로직 0 변경, 단일 논리(네거티브 확충) → 규칙 내(S). 분할 불필요.

---

## 10. Related Tickets (관련 티켓)

- 선행: `TAX-012` (골든셋·러너 도입), `BUG-002` (G-N1 네거티브 최초 도입 — 본 티켓이 유형 확장)
- 의존: `BUG-003`(V4 형식 검증) — 유형 D 시점 픽스처 FAIL 경로가 머지 순서에 의존
- 병행: `BUG-005`(M-7·N-1·N-2) — 별도 PR(SSOT §8.3)
- 참조: 평가 리포트 §3(M-5)·§6(순위3), SSOT §13.2, PRD §6.3.2·§7.2, `eval/GOLDEN_SET_GUIDE.md`

---

## 11. Report Link (리포트 연결)

Report: `docs/reports/BUG-006_report.md` (완료 — 2026-05-20, G-N2/N3/N4 초안 추가, 회계사 검수 대기)

---

**작성자**: Claude (Phase 3 평가 기반 초안)
**작성일**: 2026-05-19
**최종 수정일**: 2026-05-19
