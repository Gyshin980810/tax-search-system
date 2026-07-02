# TAX-6B-25 조문 단위 관련도 선별 — relevanceScore가 제목만 평가해 본문 쟁점 조문이 잘리는 문제 해결

> 문서 위계: SSOT > PRD > CLAUDE.md > 티켓. 충돌 시 상위 문서 우선.
> 작성 배경: 검색 정확도 향상 분석(2026-07-02)에서 도출한 문제 P2. 선행 TAX-6B-24가
> "올바른 법령 선택"까지 복구했고, 본 티켓은 그 법령의 **조문 중 관련 조문을 우선 보존**한다.

---

## Metadata

- **Type**: BUG
- **Severity**: major
- **Layer**: adapter
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: S (1 파일 + 테스트)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

`fetchArticles`(`nationalTaxLaw.ts:655`)는 조문번호 힌트가 없으면 선택된 법령의 **모든 조문**을
`TaxLaw[]`로 반환한다. 큰 법령(예: 법인세법 ~130개 조문)은 누적 본문이 수십만 토큰에 달한다.

이 배열은 `truncateForContext`(`contextBudget.ts:187`, `llmAnswerGenerator.ts:536`에서 호출)에서
컨텍스트 윈도우(35K 토큰) 보호를 위해 다음 순서로 정리된다:

1. Trust Tier 정렬(T1→T4)
2. **같은 Tier 안에서 `relevanceScore`로 순위** (`contextBudget.ts:203-207`)
3. 누적 토큰이 `SAFE_INPUT_TOKENS`(35K)를 넘으면 **컷오프**(꼬리를 버림)

문제는 `relevanceScore`(`contextBudget.ts:161-164`)가 **`lawName + articleTitle`(제목)만** 본다:

```ts
export function relevanceScore(law: TaxLaw, keywords: string[]): number {
  const haystack = `${law.lawName} ${law.articleTitle}`   // ← 본문(content) 미포함
  return keywords.filter((k) => haystack.includes(k)).length
}
```

따라서 쟁점 키워드("손금", "접대비")가 **조문 제목엔 없고 본문에만 있는** 조문은 관련도 0으로
평가돼 Tier 내 하위로 밀리고, 큰 법령에서 토큰 컷오프에 걸려 **LLM 입력에서 탈락**한다.
정작 회계사 질문에 답할 근거 조문이 프롬프트에서 사라지는 **재현율 결함**이다.

### 1.2 기대 동작

- 조문 관련도 산정 시 **본문(content)도 반영**한다. 제목 매칭은 강한 신호, 본문 매칭은 약한
  신호로 가중해, 본문에서만 쟁점을 다루는 조문도 Tier 내 상위로 끌어올린다.
- 그 결과 토큰 컷오프에서 **관련 조문이 우선 보존**된다.
- 짧은 fixture short-circuit·최소 1건 보장·Tier 우선순위·인덱스 1:1(promptLaws↔originalRefs)
  등 기존 `truncateForContext` 계약은 **회귀 0건**으로 유지한다.

### 1.3 영향·중요도

- 회계사 복합형 질문("법인세법상 접대비 손금 한도")에서 TAX-6B-24로 올바른 법령을 찾아도,
  그 법령의 **정답 조문이 프롬프트에서 잘리면** 답변 근거가 빈약해진다("직접 근거 없음").
- "정확성 > 완전성"이지만, 관련 조문을 **정렬로 살리는** 것은 정밀도·재현율을 동시에 높인다.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/adapters/contextBudget.ts` — `relevanceScore`(161), `truncateForContext`(187). **수정 대상**.
- `src/domain/nonLawRelevance.ts` — `scoreRelevance(title, body, terms)`(36): 제목(가중 2) +
  본문(가중 1) 단일 진실 원천. **재사용 후보**.
- `src/adapters/llmAnswerGenerator.ts:536` — `truncateForContext(laws, question)` 호출부(무변경).
- `tests/unit/contextBudget.test.ts` — 기존 회귀 표면 + 신규 테스트.

### 2.2 아키텍처 힌트

`relevanceScore` 강화는 **순수 함수** 변경이며 외부 I/O가 없다. `nonLawRelevance.scoreRelevance`가
이미 "제목 강신호 + 본문 약신호"를 구현하므로, 도메인의 단일 진실 원천을 재사용해 중복을 없앤다.
(비법령 참고목록과 법령 조문 선별이 같은 관련도 기준으로 동작 — 일관성 확보.)

### 2.3 원문 무결성(§6.1)

`content`는 **읽기만** 한다(`includes`). 정렬·컷오프는 배열 순서만 바꾸며, 살아남은 조문의
`content` 원문은 그대로 보존된다. `truncateForContext`가 압축본은 promptLaws에만 적용하고
`originalRefs`로 원본을 보존하는 기존 계약을 유지하므로 V1·V2 검증에 무영향.

---

## 3. Scope (작업 범위) ⭐

### 3.1 허용되는 변경

- [ ] `src/adapters/contextBudget.ts`:
      - `relevanceScore`가 본문(content)도 가중 반영하도록 강화(제목 강신호 + 본문 약신호).
        `nonLawRelevance.scoreRelevance` 재사용 우선.
      - `truncateForContext`에서 관련도를 **조문당 1회 사전 계산**(comparator 내 반복 본문 스캔 제거).
- [ ] `tests/unit/contextBudget.test.ts`: 강화된 `relevanceScore` 기대치 갱신 + 본문 매칭 조문이
      컷오프에서 보존되는 회귀 테스트 신규.

### 3.2 금지되는 변경

- ❌ **조문을 능동적으로 버리는(cutoff) 로직** — 재현율 위험. 본 티켓은 **정렬로 우선 보존**만 한다.
      (능동 컷오프가 필요하면 별도 결정·티켓)
- ❌ `fetchArticles`의 조문 반환 개수 변경 (검색 단계 후보 확대·축소는 별도 트랙)
- ❌ `SAFE_INPUT_TOKENS` 값 변경 (TAX-6B-17에서 회계사 승인된 값)
- ❌ 다중 쿼리 검색 (→ TAX-6B-26)
- ❌ 법령 원문 가공·요약 (§6.1)
- ❌ `generateAnswer.ts`의 별도 `relevanceScore`(비법령 참고목록용) 수정

---

## 4. Strategy (구현 힌트)

1. **`relevanceScore` 강화**: `scoreRelevance(\`${law.lawName} ${law.articleTitle}\`, law.content, keywords)`
   위임. 제목·본문 양쪽에 있는 term은 강신호 1회만 계산(scoreRelevance 기본 동작).
2. **사전 계산**: `truncateForContext`의 comparator가 매 비교마다 본문을 스캔하지 않도록,
   Tier 정렬 전에 `Map<law, score>`로 관련도를 1회 계산해 두고 정렬에서 참조.
3. **컷오프 로직 무변경**: 누적 토큰 초과 시 break, 최소 1건 보장은 그대로. 순서만 개선.
4. **테스트**: (a) 강화된 relevanceScore 가중치 검증 (b) 제목엔 없고 본문에만 쟁점이 있는 조문이
   제목 매칭 없는 조문보다 앞서 정렬돼 컷오프에서 살아남음(핵심 회귀) (c) short-circuit·최소 1건·
   Tier 우선순위 기존 테스트 유지.

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `relevanceScore`가 본문 매칭을 반영한다(제목 강신호 > 본문 약신호, 양쪽 중복은 1회).
2. [ ] 큰 법령에서 **본문에만 쟁점이 있는 조문**이 토큰 컷오프에서 보존된다(신규 회귀 테스트 PASS).
3. [ ] `truncateForContext`의 short-circuit·최소 1건·Tier 우선순위·인덱스 1:1 계약 유지.
4. [ ] 기존 단위 테스트 전부 PASS(필요 시 relevanceScore 기대치만 의미에 맞게 갱신), typecheck 0.
5. [ ] 법령 원문 무변형(§6.1), V1·V2 무영향.

---

## 6. Verification (검증 단계)

1. `npx vitest run tests/unit/contextBudget.test.ts` — 신규 + 기존 PASS
2. `npx vitest run` (전체) — 회귀 0건
3. `npx tsc --noEmit` — 타입 오류 0
4. (선택) 큰 법령 대상 truncateForContext 동작을 스크래치패드 스크립트로 정렬 순서 육안 확인

---

## 7. Risks / Notes

- 본문을 관련도에 반영하면 **거의 모든 조문이 어떤 term은 본문에 포함**해 변별력이 떨어질 수 있다.
  → 제목 강신호(가중 2)로 우선순위를 유지하고, 정렬은 Tier 내 **상대** 순위만 결정하므로
    영향은 제한적. 실측으로 확인.
- 본 티켓은 **정렬 개선(보존)** 이지 **능동 컷오프(폐기)** 가 아니다. 관련 없는 조문도 토큰 예산이
  허용하는 만큼은 남는다(재현율 안전). 정밀도를 더 높이려면 별도 결정 필요.
- `content`가 매우 긴 조문의 `includes` 비용 → 조문당 1회 사전 계산으로 O(n)에 억제.

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출
- 근본 원인: `relevanceScore`가 제목만 평가 → 본문 쟁점 조문이 토큰 컷오프에서 탈락
- 영향 파일: `contextBudget.ts`, `contextBudget.test.ts`
- 구현 계획: §4 1~4단계
- 결정 필요: **정렬만(안전, 추천)** vs **정렬 + 능동 컷오프(공격적)** — §3.2는 정렬만으로 확정

### 8.2 코딩 후 제출
- [ ] 변경 파일 목록 / 변경 요약 / 검증 결과 / 위험
- [ ] 리포트: `docs/reports/TAX-6B-25_report.md`

---

## 10. Related Tickets

- 선행: TAX-6B-24(법리축 분리 — 올바른 법령 선택), TAX-042F(contextBudget 도입)
- 후속: TAX-6B-26(다중 쿼리 검색)
- 참조: 검색 정확도 향상 분석(2026-07-02) 문제 P2

---

**작성자**: AI (회계사 검토 대기)
**작성일**: 2026-07-02
**최종 수정일**: 2026-07-02

---

## 11. Report Link

Report: `docs/reports/TAX-6B-25_report.md` (미작성)
