# TAX-6B-30 리포트 — 빈약 판정(THRESHOLD)에 관련도 반영

**작업일**: 2026-07-02
**티켓**: `docs/tickets/TAX-6B-30_threshold_relevance.md`
**설계 결정**: 방안 A(점수 > 0 게이트) — 회계사 승인 2026-07-02
**상태**: 구현 완료 (골든셋 회귀는 회계사 일회성 검증)
**브랜치**: `feat/tax-6b-30-threshold-relevance`

---

## 1. 근본 원인 (P3)

`searchWithFallback.ts`의 빈약 판정 `contentCount`는 `content.trim().length > 0`,
즉 **"본문이 채워졌는가"만** 셌다. **"질문과 관련 있는가"는 보지 않았다.** 그 결과
질문과 무관한 조문이라도 본문만 있으면 3개(THRESHOLD)로 카운트되어 `matchStage='direct'`로
조기 확정되고, 정작 질문에 맞는 조문이 벡터 검색에만 있어도 **벡터 fallback이 발동하지
못했다**(재현율 결함).

---

## 2. 변경 사항

### 파일 변경 목록
- `src/usecases/searchWithFallback.ts` (수정)
  - **신규** `relevantContentCount(items, terms)` — 본문 보유 **그리고** 관련도 점수 > 0
    인 항목만 카운트. 관련도는 도메인 단일 진실 원천 `scoreRelevance`(제목 2·본문 1) 재사용,
    content는 `includes`로 읽기만(원문 무변형 §6.1).
  - **신규** `collectQueryTerms(queries)` — 전 쿼리 키워드에서 `extractTerms` 결과를
    union·dedupe(다중 쿼리 TAX-6B-26 병합 결과를 하나의 관련도 기준으로 판정).
  - 게이트 두 곳(`direct`·`vector`) `contentCount` → `relevantContentCount`로 교체.
  - **회귀 방지 가드**: term이 비면(전부 불용어·1글자) `relevantContentCount`가 기존
    `contentCount`로 폴백 → 채점 불가일 때 옛 동작 보존.
- `tests/unit/searchWithFallbackRelevance.test.ts` (신규, 5건)
- `tests/unit/searchWithFallbackMultiQuery.test.ts` (수정) — 병합·단일 임베딩·중복제거
  **의도 보존**, 목 조문 본문에 쿼리 키워드를 포함시켜 "관련 있는" 데이터로 정비
  (로직 변경 아님, 의도적 동작 변경 대응).

### 보존한 것 (계약 불변)
- `THRESHOLD = 3` **값 무변경**(회계사 결정 2026-05-23 유지) — 세는 "대상"만 의미화.
- 병합 규칙(FR-19 direct 우선 보존)·`matchStage`·라벨 하향 정책 **불변**.
- `scoreRelevance`·`extractTerms` 로직 **무변경**(단일 진실 원천).

---

## 3. 검증 결과

1. `npx tsc --noEmit` — **오류 0**
2. `npx vitest run` (전체) — **670/670 PASS** (기존 665 + 신규 5)
   - (1) 무관 본문 3건 → direct 아님·벡터 진입 / (2) 관련 본문 3건 → direct 유지 /
     (3) 1글자 쿼리 → contentCount 폴백 / (4) 무관 direct + 관련 벡터 → vector /
     (5) 다중 쿼리 term union 판정
   - 기존 multi-query 5건 무회귀(목 데이터 관련도 보강 후 의도 그대로 PASS)

---

## 4. 잠재 위험·제한 (정직 고지)

- **실제 재현율·오확정 감소 효과는 골든셋 회귀로만 정량 검증 가능**(회계사 키·과금,
  **일회성**). 본 리포트의 vitest는 카운트 로직만 검증한다.
- 게이트가 관련도를 보게 되어 일부 케이스에서 벡터 fallback 발동이 늘 수 있음
  (임베딩 호출 → P95·비용). 빈 term 가드 + TAX-6B-26 다중 쿼리 병합(direct content 증가)
  으로 위험을 완화했다.
- 관련도는 부분문자열 휴리스틱이라 표기변이("양도소득세"↔"양도세")를 놓칠 수 있다.
  제목뿐 아니라 본문도 보므로 제목만 볼 때보다 낫고, 점수 > 0 기준이라 완전 배제 위험은 낮다.

---

## 5. 관련
- 근거: 검색 정확도 향상 분석(2026-07-02) 문제 P3
- 계약 정합: TAX-026-F(3단 fallback), TAX-6B-26(다중 쿼리 병합),
  TAX-6B-25(relevanceScore 본문 반영), TAX-6B-10/11(nonLawRelevance 단일 진실 원천)
