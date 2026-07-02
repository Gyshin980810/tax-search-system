# TAX-6B-25 리포트 — 조문 단위 관련도 선별(본문 반영)

**작업일**: 2026-07-02
**티켓**: `docs/tickets/TAX-6B-25_article_relevance_selection.md`
**상태**: 구현 완료 (회계사 검토 대기)

---

## 1. 근본 원인

`relevanceScore`(`contextBudget.ts:161`)가 조문 관련도를 **제목(lawName + articleTitle)만** 보고
산정했다. `truncateForContext`는 Trust Tier 정렬 후 이 점수로 순위를 매기고, 누적 35K 토큰
(`SAFE_INPUT_TOKENS`)을 넘으면 꼬리를 컷오프한다.

따라서 쟁점 키워드("손금", "접대비")가 **조문 제목엔 없고 본문에만 있는** 조문은 관련도 0으로
평가돼 Tier 내 하위로 밀리고, 큰 법령(법인세법 ~130조문)에서 토큰 컷오프에 걸려 **LLM 입력에서
탈락**했다. 선행 TAX-6B-24로 "올바른 법령"을 찾아도, 그 안의 "정답 조문"이 프롬프트에서 사라지는
재현율 결함이다.

---

## 2. 변경 사항

### 파일 변경 목록
- `src/adapters/contextBudget.ts` (수정)
- `tests/unit/contextBudget.test.ts` (수정)

### 주요 변경
- **`relevanceScore` 강화**: 도메인 단일 진실 원천 `nonLawRelevance.scoreRelevance`
  (제목=강신호 2, 본문=약신호 1, 양쪽 중복은 강신호 1회)를 **재사용**하도록 위임.
  제목만 보던 것을 본문까지 반영하되, 제목 우선순위는 가중치로 유지한다.
  비법령 참고목록(TAX-6B-10~12)과 **같은 관련도 기준으로 통일**.
- **관련도 사전 계산**: `truncateForContext`가 comparator에서 매 비교마다 본문을 스캔하지 않도록,
  Tier 정렬 전에 `Map<TaxLaw, number>`로 조문당 1회 산정(O(n) 산정 + O(n log n) 비교).
- **컷오프 로직 무변경**: 누적 토큰 초과 시 break, 최소 1건 보장, short-circuit, 인덱스 1:1
  (promptLaws↔originalRefs) 계약 그대로. **정렬 순서만 개선**(능동 폐기 없음 — 회계사 결정
  2026-07-02: "정렬만(보존)").

### 원문 무결성(§6.1)
`content`는 `includes`로 **읽기만** 한다. 정렬·컷오프는 배열 순서만 바꾸고, 살아남은 조문의
`content` 원문·`originalRefs` 보존 계약이 유지되므로 V1·V2 인용 무결성에 무영향.

---

## 3. 검증 결과

1. `npx vitest run tests/unit/contextBudget.test.ts` — **20/20 PASS** (기존 16 + 신규 4)
   - 신규: 제목 강신호(2점) / 본문 약신호(1점) / 제목·본문 중복 1회 / 무관 0점 /
     **본문에만 쟁점 있는 조문이 컷오프에서 보존**(핵심 회귀)
2. `npx tsc --noEmit` — **본 티켓 변경 파일(contextBudget.ts) 타입 오류 0**
3. `npx vitest run` (전체) — **642/642 PASS** (TAX-6B-25 무관 실패 1건은 §5 참조)

---

## 4. 기대효과

- 복합형 질문("법인세법상 접대비 손금 한도")에서 TAX-6B-24가 올바른 법령을 찾은 뒤,
  본 티켓이 **정답 조문(본문에만 쟁점 존재)을 Tier 상위로 끌어올려** 토큰 컷오프에서 보존.
  → RAG [2]→[3] 단계로 넘어가는 근거 조문의 재현율 상승.
- 법령 조문과 비법령 참고목록이 동일한 관련도 기준(`scoreRelevance`)으로 동작 → 일관성.

---

## 5. 잠재 위험·제한

- **정렬 개선(보존)이지 능동 컷오프(폐기)가 아니다.** 관련 없는 조문도 토큰 예산이 허용하는
  만큼은 남는다(재현율 안전, 회계사 결정). 정밀도를 더 높이려면 별도 결정 필요.
- 본문을 반영하면 변별력이 다소 희석될 수 있으나, 제목 강신호(2점)와 Tier 우선순위가
  상위 순위를 지킨다. 정렬은 Tier 내 **상대** 순위만 결정.
- ⚠️ **본 티켓과 무관한 기존 실패**: `tests/unit/embed.test.ts`(untracked)가 `scripts/embed.ts`의
  `parseArrayLine`·`iterateLaws`·`truncateContent`·`sha256` export를 참조하나, 해당 export는
  현재 `embed.ts`에 없어 import 에러로 실패한다. 이는 앞선 세션 조작 사고로 `embed.ts`의
  미커밋 변경분(TAX-6B-18 심판례 수집기)이 유실된 여파이며, TAX-6B-25 변경과 무관하다.
  → 별도 처리 필요(회계사 판단 대기).

---

## 6. 관련
- 선행: TAX-6B-24(법리축 분리 — 올바른 법령 선택), TAX-042F(contextBudget 도입), TAX-6B-10~12(scoreRelevance)
- 후속: TAX-6B-26(다중 쿼리 검색)
- 근거: 검색 정확도 향상 분석(2026-07-02) 문제 P2
