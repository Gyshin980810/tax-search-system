# TAX-6B-30 빈약 판정(THRESHOLD)에 관련도 반영

> 문서 위계: SSOT > PRD > CLAUDE.md > 티켓. 충돌 시 상위 문서 우선.
> 작성 배경: 검색 정확도 향상 분석(2026-07-02) 문제 P3.
> 설계 결정: 방안 A(점수 > 0 게이트) — 회계사 승인 2026-07-02.

---

## Metadata

- **Type**: BUG (재현율 결함)
- **Severity**: major (검색 fallback이 엉뚱한 결과로 조기 종료)
- **Layer**: usecase (`searchWithFallback.ts`)
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: S

---

## 1. Problem (문제 정의)

`searchWithFallback.ts`의 빈약 판정 함수 `contentCount`는 `content.trim().length > 0`,
즉 **"본문이 채워졌는가"만** 센다. **"질문과 관련 있는가"는 보지 않는다.**

```ts
function contentCount(items: TaxLaw[]): number {
  return items.filter((i) => i.content.trim().length > 0).length
}
```

그 결과, 질문과 **무관한** 조문이라도 본문만 있으면 3개(THRESHOLD)로 카운트되어
`matchStage='direct'`로 조기 확정되고, **벡터 fallback이 발동하지 않는다**. 정작 질문에
맞는 조문이 벡터 검색에만 있어도 도달하지 못한다.

> 비유: 시험 채점을 "답을 썼는가"로만 하고 정답 여부를 안 보는 것. 백지만 아니면 통과.

---

## 2. 설계 결정 — 방안 A (점수 > 0 게이트)

빈약 판정에서 **관련도가 있는 본문 보유 항목**만 센다. THRESHOLD=3은 회계사가 정한
숫자이므로 **그대로 유지**하고, 세는 "대상"만 의미 있게 바꾼다.

- 도메인 단일 진실 원천 `extractTerms` + `scoreRelevance`(`nonLawRelevance.ts`,
  제목 가중 2·본문 가중 1) **재사용**(usecase→domain 의존은 계층 규칙 부합).
- 관련도 기준: **점수 > 0**(term 1개라도 제목/본문에 걸리면 관련). 회귀 위험 최소·
  벡터 호출 급증 방지.
- 대안(점수 ≥ 2 제목급)은 벡터 호출·P95·비용↑ + 표기변이 조문 탈락 위험 → 미채택.

---

## 3. Scope

### 3.1 허용된 변경
- [x] `src/usecases/searchWithFallback.ts`
  - `relevantContentCount(items, terms)` 신규 + 게이트 두 곳(direct·vector) 교체.
  - 쿼리 키워드에서 term 추출(전 쿼리 union, dedupe).
- [x] `tests/unit/searchWithFallbackRelevance.test.ts` 신규.
- [x] `tests/unit/searchWithFallbackMultiQuery.test.ts` 목 데이터 정비(의도적 동작 변경
  대응) — 병합·단일 임베딩·중복제거 **의도는 보존**하고, 목 조문 본문에 쿼리 키워드를
  포함시켜 "관련 있는" 데이터로 만든다(로직 변경 아님).

### 3.2 금지된 변경
- ❌ `THRESHOLD` 값 변경(회계사 결정 3 유지)
- ❌ 병합 규칙(FR-19 direct 우선 보존)·matchStage 라벨 정책 변경
- ❌ `scoreRelevance`·`extractTerms` 로직 변경(단일 진실 원천)
- ❌ 원문 변형(§6.1) — content는 `includes`로 읽기만

---

## 4. Acceptance Criteria

1. [ ] 무관하지만 본문 있는 항목 3개 → direct로 조기 확정되지 **않는다**(fallback 진입).
2. [ ] 관련 있는 본문 항목이 THRESHOLD 이상이면 direct로 확정된다(기존 정상 케이스 유지).
3. [ ] 쿼리 term이 전부 불용어·1글자면 옛 `contentCount`로 폴백(회귀 0).
4. [ ] 기존 테스트 전부 PASS, typecheck 0, matchStage/라벨 정책 불변.

---

## 5. Verification

1. `npx tsc --noEmit` — 0
2. `npx vitest run` — 신규 테스트 + 기존 전부 PASS
3. (회계사, 일회성) 골든셋 회귀로 재현율·오확정 감소 정량 확인 — LLM 과금

---

## 6. Risks / Notes

- 게이트가 관련도를 보게 되면 일부 케이스에서 벡터 fallback 발동이 늘 수 있음
  (임베딩 호출 → P95·비용). 빈 term 가드 + TAX-6B-26 다중 쿼리 병합(direct content
  증가)으로 위험 완화. 실제 빈도·정확도 효과는 골든셋 회귀로만 확인 가능(일회성).
- 관련도는 부분문자열 휴리스틱이라 표기변이("양도소득세"↔"양도세")를 놓칠 수 있음.
  본문(content)도 보므로 제목만 볼 때보다 낫고, 놓쳐도 점수>0 기준이라 완전 배제 위험 낮음.

---

## 7. Report Link

Report: `docs/reports/TAX-6B-30_report.md`
