# TAX-6B-26 리포트 — 다중 쿼리 검색 (방안 A)

**작업일**: 2026-07-02
**티켓**: `docs/tickets/TAX-6B-26_multi_query_search.md`
**설계 결정**: 방안 A (direct 계층 병합 후 벡터 fallback 1회) — 회계사 승인 2026-07-02
**상태**: 구현 완료 (회계사 검토 대기)

---

## 1. 근본 원인

`llmQueryRewriter.rewrite`는 서로 다른 검색어를 **최대 3개**까지 반환한다(대체 표현·조문 힌트·
다른 쟁점축). 그러나 `generateAnswer.ts:384`는 **`queries[0]` 하나만** 검색했다:

```ts
const searchResult = await searchPort.search(queries[0])   // ← 나머지 쿼리 폐기
```

- 정답 근거가 `queries[1]`·`queries[2]`에 있으면 **검색조차 되지 않는 재현율 손실**.
- V1 재검색(425)도 **같은 `queries[0]`**을 재호출 → 어댑터가 `keyword|hint|targetDate`로
  캐시하므로 동일 결과 반환 → 재검색 복구 효과 0.

---

## 2. 채택안 — 방안 A (direct 병합 후 벡터 fallback 1회)

쿼리별로 `FallbackSearchPort`를 반복 호출하면(방안 B) 쿼리마다 `matchStage`(direct/vector/
expanded)가 뒤섞여 라벨 하향 정책이 꼬이고(과대주장 위험), 임베딩이 쿼리 수만큼 증식한다.
그래서 **병합을 포트 내부의 direct 단계에서 먼저** 하고, 그 병합본에 벡터 fallback을 **딱 1회**
적용한다.

- 재현율↑: 모든 쿼리의 근거가 검색된다.
- P95 보호: 병합으로 direct content가 THRESHOLD(3)를 넘길 확률↑ → **벡터 호출이 오히려 감소**.
  벡터 진입 시에도 임베딩은 대표 쿼리(queries[0]) **1회만**.
- 라벨 안전: 병합은 direct끼리 → `matchStage` 하나로 유지 → 하향 정책 무손상.

---

## 3. 변경 사항

### 파일 변경 목록
- `src/domain/searchMerge.ts` (**신규**) — `identityKey` + `mergeSearchItems` 순수 함수
- `src/ports/taxLawSearchPort.ts` (수정) — `ISearchPort`에 선택적 `searchMany` 추가
- `src/usecases/searchWithFallback.ts` (수정) — `searchMany` 구현, `search`는 위임, 로컬 `identityKey` 제거·도메인 재사용
- `src/adapters/nationalTaxLaw.ts` (수정) — `searchMany`(직접 어댑터 다중 쿼리 병렬 병합) 추가
- `src/usecases/generateAnswer.ts` (수정) — `runSearch` 헬퍼로 전체 쿼리 검색, V1 재검색도 전체 쿼리
- `tests/unit/searchMerge.test.ts` (신규, 8건)
- `tests/unit/searchWithFallbackMultiQuery.test.ts` (신규, 5건)

### 주요 변경 요지
- **단일 진실 원천 통일**: `identityKey`를 `searchWithFallback` 로컬 함수에서 `domain/searchMerge`로
  이동해, 다중 쿼리 병합과 벡터 병합이 **같은 중복 기준**을 공유한다.
- **선택적 `searchMany`**: `matchStage` 일관성을 스스로 보장하는 포트만 구현한다. 미구현 포트
  (테스트 더블 등)는 `runSearch`가 `search(queries[0])`로 안전 폴백 → 기존 동작·테스트 무회귀.
- **`search`는 `searchMany([query])` 위임**: 단일 쿼리 경로 동작이 이전과 동일함을 테스트로 고정.

### 원문 무결성(§6.1)
`mergeSearchItems`는 `TaxLaw` 객체 참조만 재배열하며 `content`를 읽거나 변형하지 않는다.
살아남은 조문의 원문·`originalRefs` 계약이 유지되므로 V1·V2 인용 무결성에 무영향(테스트로 단언).

---

## 4. 검증 결과

1. `npx tsc --noEmit` — **오류 0**
2. `npx vitest run` (전체) — **655/655 PASS** (기존 642 + 신규 13)
   - `searchMerge`: 식별 키 3 + 병합 5 (순서 보존·first-wins·비법령 중복·빈 입력·원본 무변형)
   - `searchWithFallbackMultiQuery`: 병합 direct 충족 시 벡터 미호출 / 임베딩 1회 / 어댑터
     searchMany 위임 / 병합 중복 제거 / 단일 쿼리 위임 동작 동일
3. 기존 `fallbackSearchVectorLabels`·`generateAnswer` 테스트 전부 PASS (라벨 하향·트랙 분리 무회귀)

---

## 5. 기대효과

- 복합형 질문에서 대체 용어("접대비"↔"기업업무추진비")·조문 힌트·다른 쟁점축이 모두 검색에
  반영 → RAG [2] 단계 재현율 상승. TAX-6B-24(법령 선택)·TAX-6B-25(조문 관련도 정렬)와 시너지.
- 병합으로 direct가 THRESHOLD를 넘기는 케이스에서는 오히려 벡터 호출이 줄어 P95에 유리.

---

## 6. 잠재 위험·제한 (정직 고지)

- **V1 재검색의 실효성은 여전히 제한적이다.** 초기 검색이 이미 전체 쿼리를 쓰므로, V1 재검색이
  같은 쿼리 집합을 재호출하면 캐시로 동일 결과가 나온다. 즉 이번 변경의 진짜 재현율 이득은
  **초기 검색**에 있고, V1 재검색은 "queries[0]만 반복하던 협소함"을 초기 검색과 **일관되게**
  넓힌 것이다. temperature 0(결정론)이므로 재생성만으로 V1을 뒤집기는 어렵다 — 인용이 검색
  풀에 없을 때의 진짜 복구는 검색 확장뿐인데, 그 확장은 초기 단계에서 이미 최대화된다.
  → 별도의 "재검색 시 벡터 강제 확장" 같은 정책은 `matchStage` 의미를 건드리므로 본 티켓 범위 밖
  (필요 시 별도 티켓·회계사 결정).
- P95는 논증 기반(벡터 호출 비증식)이며, 정량 실측은 별도 측정 스크립트로 확인 권장.

---

## 7. 관련
- 선행: TAX-6B-24(법리축 분리), TAX-6B-25(조문 관련도), TAX-026-F(FallbackSearchPort·matchStage)
- 인접: P3(THRESHOLD 관련성 미반영 — 별도), P4(라벨 프롬프트 사문화 — TAX-6B-28)
- 근거: 검색 정확도 향상 분석(2026-07-02) 문제 P3 인접
