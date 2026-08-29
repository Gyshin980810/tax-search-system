# LR-A0-B 항목별 검색 출처(`retrievalStage`) 메타데이터 신설

> 1층 **선행 티켓 2**. 선행: `LR-A0`(정책 결정) 확정 후 착수.
> 회계사 결정 2026-08-07: "별도 선행 티켓으로 분리" — 도메인 타입 변경을 A1 기능 구현과 섞지 않는다.
> 상위 문서: `docs/SSOT.md` > `docs/PRD.md` > `CLAUDE.md` > 본 티켓

---

## Metadata

- **Type**: REFACTOR / FEAT (도메인 타입)
- **Severity**: critical (미해결 시 LR-A1이 구조적으로 성립 불가)
- **Layer**: domain / adapter / usecase
- **Milestone**: Post-MVP (Phase LR 1층 선행)
- **Estimated Size**: M (4~6파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작 — `matchStage`는 검색 **전체에 하나**다

```ts
// src/usecases/generateAnswer.ts:508
matchStage = searchResult.matchStage        // ← 검색 결과 전체에 단 하나
...
// :518
const answer = await callGenerate(answerGenerator, split.citable, question, temporal, searchResult.matchStage)
```

이 단일 값이 어댑터의 라벨 강제 하향을 좌우한다.

```ts
// src/adapters/llmAnswerGenerator.ts:450~481  (TAX-026-G)
function downgradeVectorLabels(citations, summary, matchStage) {
  if (matchStage === 'direct') return { citations, summary }        // ← 아무 하향 없음
  const ceiling = matchStage === 'vector' ? '🟡유사사례' : '⚪참고자료'
  // T1·T2 출처까지 포함해 일괄 하향
}
```

### 1.2 왜 LR-A1이 이대로는 불가능한가

LR-A1은 **직접검색 법령**과 **벡터 코퍼스 사례**를 같은 `citable` 배열에 합류시킨다.
그러면 `matchStage` 하나로 두 종류를 동시에 표현해야 하는데, 선택지가 둘뿐이고 **둘 다 막힌다**.

| 선택 | 조문(T1·T2) | 벡터 사례(T3·T4) | 판정 |
|---|---|---|---|
| `matchStage='direct'` 유지 | 🟢 유지 ✅ | **벡터 천장 미적용** ❌ | TAX-026-G 안전장치가 사례에 대해 무력화 |
| `matchStage='vector'`로 변경 | **🟢→🟡 하향** ❌ | 천장 적용 ✅ | LR-A1 AC-2(조문 유지)·AC-5(조문 회귀 없음) 정면 위반 |

즉 **검색 출처가 항목별로 구분되지 않는 한, LR-A1의 완료 조건은 논리적으로 충족될 수 없다.**
이는 "추적이 어렵다"는 편의 문제가 아니라 **설계 전제의 결함**이다.

### 1.3 부수 영향

- 운영 로그 `sourceTypes`(`generateAnswer.ts:584`)는 `finalState.citable` 기준이라,
  사례가 합류하면 값이 조용히 바뀌어 **기존 로그와 시계열 비교가 끊긴다**.
- 단계별 성능 집계에서 "직접검색 비용"과 "벡터 사례 비용"을 분리할 수 없다.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

| 파일 | 역할 | 예상 변경 |
|---|---|---|
| `src/domain/TaxLaw.ts` | 검색 결과 도메인 타입 | `retrievalStage?` 선택 필드 추가 |
| `src/domain/SearchResult.ts` | `MatchStage` 정의 | 기존 타입 재사용 여부 판단 |
| `src/adapters/llmAnswerGenerator.ts` | 라벨 후처리 체인 | `downgradeVectorLabels`가 항목별 값을 우선 참조 |
| `src/usecases/generateAnswer.ts` | 오케스트레이션 | 검색 결과에 출처 태깅, 운영 로그 필드 |
| `src/adapters/vectorSearch.ts` | pgvector 조회 | 반환 항목에 출처 표시 |
| `tests/unit/llmAnswerGenerator*.test.ts` | 라벨 회귀 | 혼합 배열 케이스 추가 |

### 2.2 착수 시 반드시 먼저 확인할 것

라벨 후처리는 여러 티켓이 쌓아 올린 **체인**이며 적용 순서에 의미가 있다
(`llmAnswerGenerator.ts:378` 주석 — "downgradeT3T4DirectCitations 다음, downgradeVectorLabels 이전").

착수 시 다음 함수들의 **실제 호출 순서를 코드에서 확인**하고 티켓 §3.1에 확정한다.

| 함수 | 출처 티켓 | 역할 |
|---|---|---|
| `downgradeT3T4DirectCitations` | TAX-051 | T3·T4 → 🟢 차단 |
| `upgradeT1T2UnderlabeledCitations` | TAX-6A-10(1b) | T1·T2 과소 라벨 승격 |
| `applyDeterministicLabels` | TAX-6A-11 | Tier로 라벨 100% 재계산 |
| `downgradeVectorLabels` | TAX-026-G | matchStage 천장 |
| `ensureNoDirectBasisDisclosure` | TAX-6B-28 | 직접 근거 부재 고지 |

**이 체인의 순서와 각 함수의 판정 결과를 바꾸지 않는 것이 본 티켓의 최우선 제약이다.**

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [ ] `src/domain/TaxLaw.ts` — 항목별 검색 출처 필드 추가(**선택 필드**, 미지정 시 기존 동작)
- [ ] `src/adapters/llmAnswerGenerator.ts` — `downgradeVectorLabels`가 항목별 값을 우선 참조하고, 없으면 기존 `matchStage`로 폴백
- [ ] `src/usecases/generateAnswer.ts` — 검색 결과에 출처 태깅 + 운영 로그 필드 보강
- [ ] `src/adapters/vectorSearch.ts` — 반환 항목 출처 표시
- [ ] 관련 단위 테스트

### 3.2 금지되는 변경

- ❌ **기존 라벨 판정 결과 변경** — 사례 미합류 상태에서 현행과 100% 동일해야 한다(무회귀가 본 티켓의 성패)
- ❌ 라벨 후처리 함수의 **적용 순서** 변경
- ❌ `TIER_ALLOWED_LABELS`·V1~V6 판정 로직 변경
- ❌ 벡터 사례를 `citable`에 합류시키는 기능 자체 (**LR-A1 범위** — 본 티켓은 배관만 깐다)
- ❌ SYSTEM_PROMPT 변경 (LR-A2 범위), UI 변경 (LR-A3 범위)
- ❌ 필드를 **필수(required)** 로 추가 — 기존 골든셋 픽스처·테스트 더블이 전부 깨진다

---

## 4. Strategy (구현 계획)

**1단계 — 필드 설계**
`TaxLaw`에 검색 출처를 나타내는 **선택 필드**를 추가한다. 미지정(`undefined`)이면
기존 `matchStage` 기반 동작을 그대로 따르도록 해 하위호환을 보장한다.

**2단계 — 태깅 지점 확정**
직접검색 어댑터 결과와 벡터 조회 결과에 각각 출처를 부여한다.
어느 계층에서 태깅할지(어댑터 vs Usecase)를 결정해 §3.1에 기록한다.

**3단계 — 라벨 천장 적용 규칙 전환**
`downgradeVectorLabels`를 "전체 일괄"에서 "**항목별 우선, 없으면 전체 폴백**"으로 바꾼다.
판정 로직 자체(천장 값·⚫폐지 예외·summary 고지)는 건드리지 않는다.

**4단계 — 무회귀 증명**
사례가 합류하지 않은 상태에서 기존 테스트가 **하나도 바뀌지 않고** 통과해야 한다.
스냅샷 갱신이 필요하면 그 자체가 회귀 신호이므로 원인을 리포트에 기록한다.

**5단계 — 운영 로그 보강**
`sourceTypes`가 사례 합류 후에도 해석 가능하도록 출처 단계를 함께 남긴다.

**6단계 — 리포트 + `ROADMAP.md` §3 갱신** (같은 커밋 — CLAUDE.md §9-9)

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] **AC-1 혼합 배열 정확성** — 직접검색 T1과 벡터 T4가 한 배열에 있을 때, T1은 🟢을 유지하고 벡터 항목만 천장이 적용된다(단위 테스트로 고정).
2. [ ] **AC-2 무회귀** — 출처 필드를 지정하지 않은 기존 입력에서 라벨 결과가 현행과 **완전히 동일**하다.
3. [ ] **AC-3 체인 순서 보존** — §2.2 5개 함수의 적용 순서가 변하지 않는다(코드 diff로 확인).
4. [ ] **AC-4 하위호환** — 골든셋 픽스처·테스트 더블이 필드 없이도 그대로 동작한다.
5. [ ] **AC-5 로그 해석 가능** — 운영 로그에서 직접검색 유래와 벡터 유래를 구분할 수 있다.
6. [ ] **AC-6 기계 게이트** — `npm run lint`, `npm run typecheck` 0에러, `npm run test` 전체 GREEN(스냅샷 무갱신).

---

## 6. Verification (검증 단계)

1. `npm run lint` / `npm run typecheck` → 0에러
2. `npm run test` → 전체 GREEN. **스냅샷 갱신이 발생하면 실패로 간주**하고 원인을 규명한다
3. 혼합 배열 단위 테스트: (직접 T1 + 벡터 T4) → T1=🟢, T4=🟡 확인
4. 폴백 단위 테스트: 필드 미지정 + `matchStage='vector'` → 기존과 동일하게 전체 하향
5. `git diff src/adapters/llmAnswerGenerator.ts` → 후처리 호출 순서 무변경 육안 확인

> 본 티켓은 mock Port 기반이라 유료 LLM·임베딩 호출이 0이다.

---

## 7. Risks / Notes (위험·주의사항)

| # | 위험 | 영향 | 완화 |
|---|---|---|---|
| 1 | **도메인 타입 파급** — `TaxLaw`는 어댑터·검증기·골든셋·UI가 모두 참조한다 | 광범위 컴파일 오류 | 선택 필드로 추가(§3.2). typecheck를 1단계 게이트로 |
| 2 | **라벨 체인 미세 변경** — 순서·조건을 건드리면 과거 티켓(TAX-026-G·051·6A-11) 결함이 되살아난다 | V3 회귀 | AC-3 diff 확인 + 기존 테스트 무갱신 통과 |
| 3 | **골든셋 픽스처 붕괴** — 필수 필드로 만들면 66건이 일제히 깨진다 | 평가 불가 | AC-4로 고정 |
| 4 | **A1 선반영 유혹** — 배관을 깔면서 사례 합류까지 해버리기 쉽다 | 범위 이탈 | §3.2 명시. 본 티켓 완료 시점에 사례는 **여전히 참고 목록에만** 있어야 한다 |

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] 라벨 후처리 5개 함수의 **실제 호출 순서** 확인 결과 (§2.2)
- [ ] 필드명·타입 제안과 태깅 계층(어댑터 vs Usecase) 결정안
- [ ] `TaxLaw` 참조 지점 영향 조사 결과
- [ ] 구현 계획 3~5단계

**승인 항목 (착수 전 회계사 확정 필요)**

| 항목 | 선택지 | 기본 제안 |
|---|---|---|
| 태깅 계층 | ① 어댑터에서 부여 / ② Usecase에서 부여 | **①** — 출처를 아는 주체가 어댑터라 자연스럽고, Usecase의 분기 로직이 늘지 않는다 |
| 폴백 정책 | ① 미지정이면 기존 matchStage / ② 미지정이면 direct 간주 | **①** — 기존 동작 100% 보존이 본 티켓의 목적 |

→ **회계사 승인 후** 코딩 시작

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록 / 변경 요약 / 검증 단계별 PASS·FAIL
- [ ] 라벨 체인 순서 무변경 증거(diff)
- [ ] 리포트: `docs/reports/LR-A0-B_report.md`
- [ ] `ROADMAP.md` §3 갱신 (같은 커밋)

---

## 9. Related Tickets

- 선행: `LR-A0`(정책 결정)
- 후속: `LR-A0-C`(평가 계약) → `LR-A1`(사례 컨텍스트 합류)
- 참조: TAX-026-G(matchStage 라벨 하향), TAX-051(V3 안전망), TAX-6A-11(라벨 결정론화)
- 참조: `docs/tickets/_TEMP_LR_TICKET_REVISION_AND_REEVALUATION.md` §3.3

---

## 10. Report Link

Report: `docs/reports/LR-A0-B_report.md` (미작성)

---

**작성자**: Claude (회계사 지시 — 임시 지시서 재평가 반영)
**작성일**: 2026-08-07
**최종 수정일**: 2026-08-07
