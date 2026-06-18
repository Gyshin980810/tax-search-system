# TAX-6B-11 비법령 후보 확대 + 관련도 기반 본문 선별

---

## Metadata

- **Type**: FEAT
- **Severity**: major
- **Layer**: adapter (+ domain)
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: M (3~4파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

TAX-6B-10(참고 목록 점수·컷오프)으로 정렬·거름은 개선됐으나, 검색 단계의 두 결함이 남았다:

1. **유실**: 심판례(`searchTribunal`)·해석례(`searchInterpretations`)가 `display=5`로 목록을 좁게 가져온다. 관련 자료가 6위면 아예 검색되지 않는다.
2. **P95 부담**: 두 트랙은 후보를 **전수 본문 조회(N+1)** 한다. 후보를 늘리면 본문 조회가 비례 증가해 P95(현행 9.67s)를 위협한다.
3. **관련도 순서 소실**: `search()`가 비법령 결과를 `sortByDecisionDate`(날짜순)로 재정렬해, 외부 API가 준 관련도 순서를 날짜순으로 덮는다.

### 1.2 기대 동작

- 목록은 넓게(12건) 가져와 유실을 막는다.
- 사건명 관련도 상위 5건만 본문 조회한다(본문 조회 건수는 기존과 동일 → P95 영향 최소).
- 결정론성(SSOT §7.7)을 위해 외부 API 순서를 신뢰하지 않고, **우리 관련도 점수 + 보조키(날짜↓·식별자↑)** 로 정렬한다.

### 1.3 영향·중요도

회계사 피드백("심판례 관련성 낮아 업무에 못 씀")의 근본(검색 단계) 대응. TAX-6B-10의 후속(방향 B).

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/domain/nonLawRelevance.ts` (신규) — 관련도 점수 함수(usecase·adapter 공유 단일 진실 원천)
- `src/adapters/nationalTaxLaw.ts` — `searchTribunal`·`searchInterpretations` 후보 확대·본문 선별, `search()` 정렬 조정
- `src/usecases/generateAnswer.ts` — 점수 함수를 domain으로 추출(동작 동일)
- `tests/unit/nonLawRelevance.test.ts` (신규), `tests/integration/nationalTaxLaw.test.ts` (신규 테스트 2건)

### 2.2 결정 사항(회계사 2026-06-17)

- 본문 조회 건수 K = **현 수준 유지(상위 5건)** — P95 안전.
- 적용 범위 = **심판례 + 해석례(expc)**.

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [x] `src/domain/nonLawRelevance.ts` 신규
- [x] `src/adapters/nationalTaxLaw.ts` — `searchTribunal`·`searchInterpretations`·`search()` 정렬
- [x] `src/usecases/generateAnswer.ts` — 점수 함수 domain 추출(리팩터, 동작 동일)
- [x] 테스트 추가

### 3.2 금지되는 변경

- ❌ 판례(prec)·NTS해석 검색 로직 변경(이미 display=10·본문 부담 적음)
- ❌ law-verifier V1~V6 변경(참고 목록은 V검증 비대상)
- ❌ 법령 원문 가공·요약(점수 계산은 읽기만 — §6.1)
- ❌ 벡터 검색 도입(방향 C 별도)

---

## 4. Strategy (구현 힌트)

1. `nonLawRelevance.ts`: `extractTerms`, `scoreRelevance(title, body, terms)`. 목록 단계는 본문 미조회이므로 `body=''`로 제목만 평가.
2. `rankByRelevance`(어댑터 헬퍼): 점수↓ → 날짜↓ → 식별자↑로 결정론적 정렬.
3. 각 트랙: display 12 → `rankByRelevance` → 상위 `NONLAW_BODY_FETCH_LIMIT`(5)만 본문 조회, 나머지 content=''.
4. `search()`: 어댑터가 관련도순으로 준 심판례·해석례는 재정렬하지 않음(NTS·판례만 `sortByDecisionDate` 유지).

---

## 5. Acceptance Criteria (완료 조건)

1. [x] 목록 8건 입력 시 전부 반환되며 본문 조회는 상위 5건만(N+1 제어).
2. [x] 본문 조회 5건은 관련(점수 높은) 항목, 무관 항목은 content=''.
3. [x] 동일 쿼리 재호출 시 동일 순서(결정론성).
4. [x] `npm run test` 전체 통과, `tsc --noEmit` 통과.

---

## 7. Risks / Notes

- 본문 없는 비법령은 발췌 인용 불가 → 참고 목록(⚪) 후보. 최종 관련도 컷오프는 generateAnswer(TAX-6B-10)에서 수행.
- P95는 본문 조회 건수가 동일해 영향 최소 예상이나, 운영 측정 권장(현행 9.67s 기준).
- 정렬 책임이 일부는 어댑터(심판례·해석례), 일부는 search()(NTS·판례)로 나뉜다 — 주석으로 명시.

---

## 10. Related Tickets

- 선행: `TAX-6B-10`(참고 목록 점수·컷오프 — 방향 A), `TAX-015B/C/D`, `TAX-043`
- 후속: (방향 C) 심판례 본문 벡터(의미) 검색 — 별도 티켓 검토

---

## 11. Report Link

Report: `docs/reports/TAX-6B-11_report.md` (완료)

---

**작성자**: AI (회계사 승인)
**작성일**: 2026-06-17
