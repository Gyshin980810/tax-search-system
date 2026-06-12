# TAX-6A-4 리포트: SearchQuery.targetDate 추가 + 시점 검색 로직

> 작성일: 2026-06-11  
> 작성자: Claude Code  
> 상태: **완료**

---

## 변경 사항 요약

**파일 변경 목록:**
- `src/domain/SearchQuery.ts` (수정)
- `src/adapters/llmQueryRewriter.ts` (수정)
- `src/adapters/nationalTaxLaw.ts` (수정)
- `tests/unit/temporalFilter.test.ts` (신규)

**주요 변경:**

### 1. SearchQuery.targetDate 필드 추가
```typescript
// src/domain/SearchQuery.ts
targetDate?: Date  // 과거 시점 기준 날짜 (FR-15, TAX-6A-4)
```
- 선택 필드 — 미설정 시 기존 현행 기준 동작 완전 유지
- `articleNumberHint` 선례와 동일한 선택 필드 패턴

### 2. llmQueryRewriter → targetDate 전파
- LLM 생성 쿼리(`object.queries`) + `lookupArticleHints` 반환 쿼리 양쪽에 `temporal.targetDate` 전파
- `temporal.targetDate` 없으면(현행 질문) 전파 안 함 → 객체 크기 최소화

### 3. nationalTaxLaw.ts 시점 필터
- **캐시 키**: `keyword|articleNumberHint|targetDate(YYYY-MM-DD)` 형식으로 확장
- **fetchArticles 시그니처**: `(keyword, articleNumberHint?, targetDate?)` 추가
- **클라이언트 필터**: `조문시행일자 ≤ targetDate` — YYYYMMDD 문자열 직접 비교
  ```typescript
  const targetYmd = targetDate.toISOString().slice(0, 10).replace(/-/g, '')
  hinted.filter(it => !it.revisionDate || it.revisionDate.replace(/-/g, '') <= targetYmd)
  ```
- `revisionDate` 없는 조문은 시점 무관 포함(방어적 처리)

---

## 검증 결과

1. `vitest run` — **459/459 PASS** (기존 450 + 신규 9건)
2. `tsc --noEmit` — 오류 0건
3. 시점 필터 경계값 테스트 (2020-06-15, 2022-01-01, 2017-12-31, 2030-01-01) 전부 통과

---

## 설계 결정 사항 (Gate B 반영)

- **API 시점 파라미터 미지원 확정** (TAX-6A-1 진단): 서버측 필터 불가 → 클라이언트 필터 채택
- `toISOString()` UTC 기반: 한국 세법 날짜는 시간 없는 날짜(YYYY-MM-DD)이므로 UTC 기준 날 비교로 충분
- `TemporalContext.targetDate` → `SearchQuery.targetDate` 전파: generateAnswer.ts 수정 불필요 (queryRewriter가 이미 temporal을 전달받아 처리)

---

## 잠재 위험

- **현행 텍스트 한계**: API는 현행 최신 조문만 반환. targetDate 이후 개정된 조문의 경우 과거 텍스트가 아닌 현행 텍스트를 노출하게 됨. 이 제약은 Phase 6A 범위 내 알려진 한계이며, 시점 라벨(`[적용 시점: ...]`)에 "현행 조문 기준" 안내 포함 예정(TAX-6A-5 UI에서 처리).

---

## 다음 단계

- **TAX-6A-5**: 시점 검색 UI + 연도 입력 + E-TEMPORAL 모호성 확인 팝업
