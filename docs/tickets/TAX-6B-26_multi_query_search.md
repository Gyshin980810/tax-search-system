# TAX-6B-26 다중 쿼리 검색 — 생성된 쿼리 중 queries[0]만 사용해 재현율 손실

> 문서 위계: SSOT > PRD > CLAUDE.md > 티켓. 충돌 시 상위 문서 우선.
> 작성 배경: 검색 정확도 향상 분석(2026-07-02) 문제 P3 인접(다중 쿼리 미사용).
> ✅ **설계 결정: 방안 A 채택 (회계사 승인 2026-07-02)** — 구현 완료. 리포트 `docs/reports/TAX-6B-26_report.md`.

---

## Metadata

- **Type**: BUG / FEAT
- **Severity**: major
- **Layer**: usecase (+ 방안 A 채택 시 adapter/port 일부)
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: 방안 A = M / 방안 B = S (설계 결정에 따라 달라짐)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

`llmQueryRewriter.rewrite`는 서로 다른 검색어를 **최대 3개**까지 반환한다
(`querySchema` `.min(1).max(3)`, `merged`가 hint 쿼리 + LLM 쿼리를 중복제거해 조립).
예: `["법인세법 접대비", "법인세법 기업업무추진비", "소득세법 제70조"(조문힌트)]`.

그러나 `generateAnswer.ts:384`는 **`queries[0]` 하나만** 검색한다:

```ts
const searchResult = await searchPort.search(queries[0])   // ← 나머지 쿼리 폐기
```

- 대체 표현("접대비" vs "기업업무추진비"), 조문번호 힌트, 다른 쟁점축이 **통째로 버려진다**
  → 정답 근거가 queries[1]·queries[2]에 있으면 검색조차 되지 않는 **재현율 손실**.
- V1 재검색(`generateAnswer.ts:425`)도 **같은 `queries[0]`**을 재호출하는데, 어댑터가
  `keyword|hint|targetDate`로 캐시하므로 **동일 결과** 반환 → V1 재검색 복구 효과 0.

### 1.2 기대 동작

- `rewrite`가 반환한 쿼리를 **모두 검색**하고 결과를 **병합·중복제거**해 downstream에 전달.
- 중복제거는 `searchWithFallback.ts:26`의 `identityKey`(법령=lawName+articleNumber /
  비법령=sourceType+caseNumber)와 동일 기준으로 통일.
- V1 재검색은 최소한 다중 쿼리 경로를 재사용(가능하면 캐시 우회 또는 대체 쿼리)해 복구 실효성 확보.
- P95 게이트(누적 <15s) 유지 — 벡터/임베딩 호출이 쿼리 수만큼 증식하지 않도록 설계.

### 1.3 영향·중요도

- 회계사 복합형 질문에서 대체 용어·조문 힌트가 자주 생성되므로 재현율 손실이 **상시 발생**.
- 다만 검색·라벨 하향(matchStage) 경로를 건드리므로 **정확성 보증 모델과 직접 맞닿음**
  → 설계를 잘못하면 과대주장(틀린 라벨) 위험. §2 "틀린 답은 없는 답보다 나쁘다".

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/usecases/generateAnswer.ts` — `queries[0]` 검색(384), V1 재검색(425). **진입점**.
- `src/adapters/llmQueryRewriter.ts` — `rewrite` 최대 3개 쿼리 생성(52~117).
- `src/usecases/searchWithFallback.ts` — `FallbackSearchPort`(direct→vector→expanded,
  matchStage 설정), `identityKey`(26, 중복제거 기준·재사용 후보), `THRESHOLD`(12).
- `src/adapters/nationalTaxLaw.ts` — `search`(551, keyword 캐시), 쿼리당 5개 API 병렬.
- `app/api/answer/route.ts:71-73` — **주입 결정**: `DATABASE_URL` 있으면 `searchPort =
  FallbackSearchPort`, 없으면 `NationalTaxLawAdapter` 직접.

### 2.2 핵심 제약 — matchStage 혼재 문제

`matchStage`는 **결과 단위**(result-level) 신뢰도(direct/vector/expanded)이며,
`downgradeVectorLabels`(llmAnswerGenerator.ts:473~)가 이 값으로 답변 라벨을 일괄 하향한다
(vector→🟡 천장, expanded→⚪ 천장). 프로덕션 `searchPort=FallbackSearchPort`이므로,
**다중 쿼리를 각각 이 포트로 돌리면** 쿼리마다 matchStage가 달라져(예: q0=direct, q1=vector)
병합 시 하나의 라벨 정책으로 뭉갤 수 없다. vector 항목을 direct로 취급하면 **과대주장**,
전부 vector로 낮추면 **과소주장**.

---

## 3. 설계 결정 (⚠️ 착수 전 승인 필요)

### 방안 A — direct 계층에서 병합 후 fallback 1회 (**권장**)

모든 쿼리를 **직접 매칭(direct)**으로 병렬 검색 → 병합·중복제거 → 그 병합본에 벡터 fallback을
**1회만** 적용.

- 장점:
  1. 재현율↑ (모든 쿼리 반영)
  2. 병합으로 direct 콘텐츠가 `THRESHOLD`(3)를 넘길 확률↑ → **벡터 호출이 오히려 감소**(P95 유리)
  3. matchStage 일관(병합은 direct끼리 → 라벨 하향 정책 안전)
- 단점: `FallbackSearchPort`가 다중 쿼리를 direct 단계에서 병합하도록 흐름 수정 필요(중간 규모 M).
  포트/usecase에 "여러 쿼리 → 하나의 병합 결과" 경로 추가.

### 방안 B — generateAnswer에서 쿼리별 루프 후 병합 (최소 변경)

`searchPort.search(q)`를 각 쿼리로 병렬 호출 → items만 병합·중복제거.

- 장점: 변경 최소(S), generateAnswer 몇 줄.
- 단점(치명적): 프로덕션 `searchPort=FallbackSearchPort`이므로 쿼리마다 벡터 fallback 발동
  → 임베딩 최대 3회(비용·P95↑) + **matchStage 혼재**로 라벨 하향 꼬임(과대주장 위험).
  정확성 규칙(§6.3·§6.4)과 상충 가능 → **비권장**.

> 추천: **방안 A**. 재현율·비용·정확성 모두 우위. 구현 규모만 중간.

---

## 4. Scope (작업 범위) — 방안 A 기준 (승인 후 확정)

### 4.1 허용되는 변경 (방안 A)

- [ ] `src/domain/`: 검색 결과 병합·중복제거 순수 함수(`mergeSearchResults` + `identityKey` 추출·공유).
- [ ] `src/usecases/searchWithFallback.ts`: direct 단계가 다중 쿼리를 병렬 검색·병합하도록 확장.
- [ ] `src/usecases/generateAnswer.ts`: 전체 쿼리를 검색 경로에 전달, V1 재검색 실효화.
- [ ] 위 변경의 단위/통합 테스트.

### 4.2 금지되는 변경

- ❌ `THRESHOLD` 값 변경 (P3 별도 — 회계사 승인된 값)
- ❌ `enforceAxisCombination`·queryRewriter 프롬프트·`MAX_LLM_QUERIES` 수정
- ❌ 라벨 하향 정책(matchStage 의미) 변경 — 병합은 정책을 **깨지 않는** 방식으로만
- ❌ 법령 원문 가공 (§6.1)
- ❌ `SAFE_INPUT_TOKENS` 등 컨텍스트 예산 변경 (TAX-6B-25에서 처리)

---

## 5. Acceptance Criteria (방안 A 기준)

1. [ ] `rewrite`가 2~3개 쿼리를 반환하면 **모두** 검색에 반영된다.
2. [ ] 병합 결과가 `identityKey` 기준으로 중복 없이 구성된다.
3. [ ] matchStage 라벨 하향 정책이 훼손되지 않는다(병합은 direct끼리, 벡터 fallback 1회).
4. [ ] V1 재검색이 초기 검색과 동일 결과만 반복하지 않는다(복구 실효성).
5. [ ] 기존 단위/통합 테스트 전부 PASS, typecheck 0, 법령 원문 무변형.
6. [ ] P95 회귀 없음(벡터 호출 증식 방지) — 실측 또는 논증.

---

## 6. Verification

1. `npx vitest run` — 신규 + 기존 PASS
2. `npx tsc --noEmit` — 0
3. 다중 쿼리 병합 단위 테스트(중복제거·순서·matchStage 일관)
4. (선택) P95 측정 스크립트로 벡터 호출 수·지연 확인

---

## 7. Risks / Notes

- 검색·라벨 하향은 정확성 보증의 심장부 → 설계 승인 없이 착수 금지(§9 8번·10번).
- 방안 B는 구현이 쉬우나 matchStage 혼재로 과대주장 위험 → 원칙상 채택 지양.
- 다중 쿼리로 후보가 늘면 TAX-6B-25(조문 관련도 정렬)와 시너지(관련 조문이 컷오프에서 보존).

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출
- 근본 원인: `queries[0]`만 검색 → 나머지 쿼리 재현율 폐기 + V1 재검색 캐시로 무의미
- 영향 파일: §2.1
- **설계 결정 대기**: 방안 A(권장) vs B — 회계사 승인 후 §4 범위 확정
- 구현 계획: 방안 A 기준 §4

### 8.2 코딩 후 제출
- [ ] 변경 파일 목록 / 요약 / 검증 결과 / 위험
- [ ] 리포트: `docs/reports/TAX-6B-26_report.md`

---

## 10. Related Tickets

- 선행: TAX-6B-24(법리축 분리), TAX-6B-25(조문 관련도), TAX-026-F(FallbackSearchPort·matchStage)
- 인접: P3(THRESHOLD 관련성 미반영 — 별도), P4(라벨 프롬프트 사문화 — TAX-6B-28)
- 참조: 검색 정확도 향상 분석(2026-07-02) 문제 P3 인접

---

**작성자**: AI (설계 결정·회계사 승인 대기)
**작성일**: 2026-07-02
**최종 수정일**: 2026-07-02

---

## 11. Report Link

Report: `docs/reports/TAX-6B-26_report.md` (미작성)
