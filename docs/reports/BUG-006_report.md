# BUG-006 구현 리포트 — 골든셋 네거티브 확충 (의역·잘못된 Tier·시점 오류)

> 완료일: 2026-05-20
> 관련 티켓: `docs/tickets/BUG-006_golden_negative_expansion.md`
> 선행: TAX-012(골든셋·러너), BUG-002(G-N1 네거티브 최초 도입), BUG-003(V4 형식검증 — G-N4 의존)
> Severity: major (정확성 시스템 본질 "틀린 답 차단"의 골든셋 회귀 공백)

---

## 1. 근본 원인

평가 §3 M-5: 골든셋 `eval/golden_direct.json`이 G-1~G-5 **6건 전부 PASS**였고,
BUG-002가 `G-N1`(summary 환각, V2 FAIL) 1건을 도입했으나 **의역·잘못된 Tier
라벨·시점 오류** 유형의 네거티브가 없었다. "틀린 답을 FAIL로 거르는 능력"이
이 세 유형에 대해 골든셋으로 한 번도 회귀 검증된 적이 없었다(평가 §2 최대
구조 리스크).

---

## 2. 파일 변경 목록

| 파일 | 작업 | 내용 |
|---|---|---|
| `eval/golden_direct.json` | 수정 | G-N1 뒤에 네거티브 픽스처 **G-N2·G-N3·G-N4 초안** 3건 추가 |
| `eval/GOLDEN_SET_GUIDE.md` | 수정 | "5-1단계" 유형 B(의역)·C(Tier)·D(시점) 작성 절 + 유형 E 표 추가 |

> 금지 항목(티켓 §3.2) 전부 미변경: `lawVerifier.ts` 등 검증 로직 0 변경,
> `run_golden.test.ts` 러너 로직 불변, 기존 G-1~G-5·G-N1 정답값·내용 불변,
> 법령 원문(`sourceLaws[].content`)은 진본 유지(틀림은 answer 측에서만),
> PRD/SSOT 본문·`eval/README.md` 합격선 표현 미변경.

---

## 3. 추가 픽스처 (한 픽스처 = 한 V 위반으로 격리)

| ID | 유형 | 비튼 곳 (answer 측) | 기대 FAIL | 나머지 V |
|---|---|---|---|---|
| **G-N2** | 의역 | `citations[].excerpt` = `"거주자 본인에 대해 150만원씩 일괄 공제한다"`(원문에 없음) | **V2** | V1·V3·V4·V5·V6 정상 |
| **G-N3** | 잘못된 Tier | `sourceLaws.trustTier:"T3"` + `label:"🟢직접근거"` | **V3** | V1·V2·V4·V5·V6 정상 |
| **G-N4** | 시점 오류 | `answer.temporalLabel:"옛날 법"`(형식 위반) | **V4** | V1·V2·V3·V5·V6 정상 |

- **G-N2**: `lawName`·`articleNumber`는 sourceLaws와 맞춰 V1 통과, excerpt만 의역 →
  `content.includes(excerpt)` false → V2 FAIL. summary는 따옴표 없는 서술이라
  BUG-002 summary 검사와 무관.
- **G-N3**: excerpt는 content와 일치(V2 통과), label만 T3에 🟢직접근거 → V3 FAIL.
  🟡유사사례가 아니므로 V6(단정형) 검사는 작동 안 함(통과).
- **G-N4**: citations는 전부 정상, `answer.temporalLabel`만 형식 위반 → **BUG-003의
  V4 형식 정규식**에 걸려 V4 FAIL. BUG-003 구현 완료로 의존성 충족됨.

> 모든 신규 픽스처 `description`에 `[네거티브·초안 → 회계사 검수 대기]` + 유형·
> 기대 V 명기. 원문 진본 유지(CLAUDE.md §6.1): "틀림"은 answer 측(excerpt/label/
> temporalLabel)에서만 만들고 `sourceLaws[].content`는 변형하지 않음.

---

## 4. 검증 결과

| 단계 | 명령 | 결과 |
|---|---|---|
| 골든 러너 | `npx vitest run tests/golden/run_golden.test.ts` | ✅ **10 passed** (6 PASS + G-N1~N4 4 FAIL) |
| 전체 테스트 | `npm run test` | ✅ **92 passed (92)** — 직전 89 + 골든 네거티브 3 |
| 회귀 | (vitest 7 파일 전체) | ✅ 기존 G-1~G-5·G-N1·단위·통합 그린 유지 |

### Acceptance Criteria 대응 (티켓 §5)

- [x] AC1 — 의역 네거티브(G-N2) `expectedStatus:"FAIL"`, V2로 FAIL
- [x] AC2 — 잘못된 Tier 네거티브(G-N3) `expectedStatus:"FAIL"`, V3로 FAIL
- [x] AC3 — 시점 오류 네거티브(G-N4) `expectedStatus:"FAIL"`, V4(BUG-003 형식검증)로 FAIL
- [x] AC4 — 기존 G-1~G-5(PASS)·G-N1(FAIL) 정답값·판정 불변(회귀 0)
- [x] AC5 — `npm run test`(골든 러너 포함) 전부 그린(92)
- [x] AC6 — 신규 픽스처 `description`에 유형·`[초안 → 회계사 검수 대기]` 표기
- [x] AC7 — `GOLDEN_SET_GUIDE.md`에 유형 B·C·D 작성 지침 추가
- [x] AC8 — 코드 로직 0 변경 — diff가 `eval/` 2파일에 한정

---

## 5. 잔여·위험·회계사 결정 사항

### 5.1 정답값 회계사 검수 필수 (SSOT §13.2)

G-N2·G-N3·G-N4는 **초안**이다. `expectedStatus:"FAIL"` 및 (특히 G-N3의 T3
예규) `sourceLaws[].content` 표현의 타당성을 회계사가 검수한 뒤 확정한다.
검수 완료 시 `description`의 `[초안 → 회계사 검수 대기]` 표기를 제거한다.

> **G-N3 주의**: T3 예규 `content`는 실제 예규 원문을 정확히 확정하지 못해
> 일반적 표현으로 작성했다(V3 판정은 trustTier↔label만 보므로 content 표현과
> 무관하나, 골든셋 진본성 차원에서 회계사 검수 권장).

### 5.2 골든 러너의 V-격리 미검증 (개선 권고 — 범위 밖)

`run_golden.test.ts`는 `expectedStatus`(PASS/FAIL)와 `result.status`만 대조하고
**"어느 V로 FAIL인지"는 검증하지 않는다**. 본 PR의 "한 픽스처=한 V" 격리는
설계·코드 분석으로 보장했으나 자동 회귀로는 status까지만 고정된다.
→ 권고: 러너가 `expectedFailCheck`(예: `"v3"`) 필드를 받아 `result.checks`까지
대조하도록 강화하는 별도 티켓. 본 티켓 §3.2(러너 로직 불변)상 범위 밖.

### 5.3 eval/README.md 표현 모순 (별도 문서 세션)

`eval/README.md`의 "6건 100% PASS"류 표현이 G-N1~N4 추가로 더 어긋난다.
BUG-002 리포트 §5.2와 동일 — 본 PR 범위 밖, 문서 갱신 세션에서 회계사
결정에 따라 처리(SSOT §9.3).

### 5.4 범위 밖 (별도 처리)

- BUG-004(M-3·M-4) — Phase 4 보류.
- 사양↔코드 시점 라벨 표기 불일치 — 별도 정합 티켓(BUG-003 리포트 §7.1).

---

## 6. 결론

골든셋이 환각(G-N1)에 더해 **의역(V2)·잘못된 Tier(V3)·시점 오류(V4)** 네거티브를
갖추어, "틀린 답을 FAIL로 거르는 능력"이 4유형에 걸쳐 회귀 검증되기 시작했다.
평가 **M-5 해소**(부분 → 충실). 향후 검증 로직 회귀가 골든셋만으로 탐지된다.

> **M3 회계사 노출 게이트(평가 §6) 진행**: HIGH 2건(BUG-001·002) + MED
> (BUG-003·005) 구현 완료 + 네거티브 확보(BUG-006). 잔여 = ① 골든셋
> 정답값(G-N1~N4) 회계사 검수 ② 골든셋 30건 작성 ③ P95 재측정. 최종
> 통과 판단은 회계사 몫.

---

**작성자**: Claude (BUG-006 구현)
**작성일**: 2026-05-20
