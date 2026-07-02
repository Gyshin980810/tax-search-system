# TAX-6B-24 법령 검색 시 법리축 분리 — 결합 키워드가 정확매칭(TAX-031)을 무력화하는 문제 해결

> 문서 위계: SSOT > PRD > CLAUDE.md > 티켓. 충돌 시 상위 문서 우선.
> 작성 배경: 검색 정확도 향상 분석(2026-07-02)에서 도출한 문제 P1.

---

## Metadata

- **Type**: BUG
- **Severity**: major
- **Layer**: adapter / domain
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: S (1~2 파일 + 테스트)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

TAX-042G에서 검색어를 **법리축(어떤 법령) + 사실축(어떤 쟁점)** 결합 형태로 강제한다.
`enforceAxisCombination`(`queryAxisGuard.ts:179`)이 `llmQueryRewriter.ts:96`에서 쿼리
반환 직전에 적용되어, 예를 들어 "법인세법"은 "법인세법 손비"로 바뀐다.

이 결합 키워드가 **그대로 법령명 검색에 사용**된다:

1. `nationalTaxLaw.ts:657` — `normalizeLawName("법인세법 손비")` → 사전(LAW_ALIASES)에 없으니
   그대로 통과.
2. `nationalTaxLaw.ts:602-607` — `searchLaws("법인세법 손비")` → `lawSearch.do`의 `query`
   파라미터(법령명 매칭)에 "법인세법 손비"가 들어감. **"법인세법 손비"라는 법령명은 없으므로
   결과 0건**일 수 있고, 0건이면 `fetchArticles`가 line 659에서 즉시 빈 결과 반환.
3. `nationalTaxLaw.ts:665` — 결과가 있어도 `selectBestLaw(laws, "법인세법 손비")`는
   어떤 법령명과도 완전·접두·부분일치할 수 없어 **항상 fallback(laws[0] 무조건 채택)** 으로
   추락 → TAX-031이 고친 동음이의 오매칭("지방세법" → "지방교부세법")이 결합 키워드에서 재발.

즉, TAX-031(정확매칭)과 TAX-042G(축 결합)가 **서로 충돌**한다. 축 결합은 벡터/전문(全文)
검색 재현율을 위해 도입됐지만, 법령명 매칭 경로에서는 정밀도·재현율을 동시에 해친다.

### 1.2 기대 동작

- 법령명 검색(`searchLaws`)과 법령 선택(`selectBestLaw`)에는 **법리축만** 사용한다.
  → "법인세법 손비" 입력 시 "법인세법"으로 법령을 정확히 찾고, `selectBestLaw`가
    exact/prefix 매칭에 성공한다.
- 사실축("손비")은 **버리지 않고** 후속 조문 선별(TAX-6B-25)에서 활용할 수 있도록
  반환 경로에 보존한다(본 티켓에서는 조문 선별 로직은 구현하지 않음 — 범위 밖).
- 결합되지 않은 순수 법령명("소득세법")·순수 사실축("접대비")·힌트가 있는 경우 등
  **기존 동작은 회귀 0건**으로 유지한다.

### 1.3 영향·중요도

- 회계사 질문 상당수가 "법령 + 쟁점" 복합형이며, TAX-042G 안전망이 이를 결합 키워드로
  만들기 때문에 **자주 발생하는 경로**다.
- "틀린 답은 없는 답보다 나쁘다"(CLAUDE.md §2). fallback 오매칭은 T1 직접 근거를
  잘못된 법령으로 오염시키는 정확성 위험이다.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/adapters/nationalTaxLaw.ts` — `fetchArticles`(655), `searchLaws`(602). 진입점.
- `src/domain/lawAliases.ts` — `normalizeLawName`, `selectBestLaw`, `LAW_ALIASES`(6개).
- `src/adapters/queryAxisGuard.ts` — `LEGAL_SUFFIX_PATTERN`, `LEGAL_AXIS_BROAD`,
  `LEGAL_AXIS_NOISE`(재사용 후보).
- `tests/unit/` — 신규 단위 테스트.

### 2.2 외부 API·리소스

- 국세법령정보시스템 `lawSearch.do` (target=law, query=법령명). 응답: `LawSearch.law[]`.
- **주의**: `query` 파라미터의 다중 토큰("법인세법 손비") 매칭 동작은 미검증.
  구현 착수 시 프로브로 실측 확정 필요(§4 참조).

### 2.3 아키텍처 힌트

법리축 분리는 **순수 함수(도메인)** 로 구현해 단위 테스트로 검증한다. 외부 I/O·부수효과 없음.

```
queries[0].keyword ("법인세법 손비")
   → splitLegalAxis(keyword) → { legalAxis: "법인세법", factAxis: "손비" }
   → searchLaws(legalAxis) + selectBestLaw(laws, legalAxis)   ← 본 티켓
   → (factAxis는 조문 선별용으로 보존 — TAX-6B-25에서 소비)
```

---

## 3. Scope (작업 범위) ⭐

### 3.1 허용되는 변경

- [ ] `src/domain/lawAliases.ts` **또는** 신규 `src/domain/legalAxis.ts`:
      키워드에서 법리축을 분리하는 순수 함수 `splitLegalAxis` 추가.
- [ ] `src/adapters/nationalTaxLaw.ts` `fetchArticles`: `searchLaws`·`selectBestLaw`에
      법리축만 전달하도록 수정.
- [ ] 위 함수의 단위 테스트 신규(`tests/unit/`).

### 3.2 금지되는 변경

- ❌ 조문 단위 관련도 선별 로직 구현 (→ TAX-6B-25 별도 티켓)
- ❌ 다중 쿼리 검색 (→ TAX-6B-26 별도 티켓)
- ❌ `enforceAxisCombination` / queryRewriter 프롬프트 수정 (→ 벡터/전문 검색엔 결합이 유익, 건드리지 않음)
- ❌ `LAW_ALIASES`·`ARTICLE_NUMBER_HINTS` 사전 항목 추가 (회계사 승인 필요)
- ❌ 법령 원문 가공·요약 (CLAUDE.md §6.1)
- ❌ 비법령 검색 경로 수정 (별도 트랙)

---

## 4. Strategy (구현 힌트)

1. **프로브 먼저(실측 확정)**: 스크립트로 `lawSearch.do`에 "법인세법 손비" 등 결합 키워드와
   "법인세법" 단독을 각각 던져 결과 건수·1위 법령·`selectBestLaw` matchType을 실측.
   문제가 "0건"인지 "fallback"인지 확정하고 리포트에 근거로 남긴다.
2. **`splitLegalAxis(keyword)` 순수 함수**:
   - 공백으로 토큰화. `LEGAL_SUFFIX_PATTERN`(`~법 [시행령|시행규칙]`) 또는 `LAW_ALIASES` 키에
     해당하는 토큰(들)을 **법리축**으로, 나머지를 **사실축**으로 분리.
   - 법령명이 여러 단어일 수 있음("상속세 및 증여세법") → LAW_ALIASES 확장형·연속 토큰 병합 고려.
   - 법리축 토큰을 못 찾으면 `{ legalAxis: keyword, factAxis: '' }`로 **원본 그대로 통과**
     (회귀 0건 보장).
3. **`fetchArticles` 수정**: `const { legalAxis } = splitLegalAxis(keyword)` 후
   `normalizeLawName(legalAxis)` → `searchLaws` → `selectBestLaw`. 사실축은 반환 구조에
   보존하되 본 티켓에서는 소비하지 않는다.
4. **테스트**: 결합 키워드 분리 / 순수 법령명 무변경 / 다단어 법령명 / 약칭 / 법리축 부재 →
   원본 통과 / 순수 사실축("접대비") → legalAxis 비법령이면 원본 통과.

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `splitLegalAxis("법인세법 손비")` → `{ legalAxis: "법인세법", factAxis: "손비" }`
2. [ ] `splitLegalAxis("소득세법")` → `{ legalAxis: "소득세법", factAxis: "" }` (무변경)
3. [ ] `splitLegalAxis("상속세 및 증여세법 상속공제")` → legalAxis에 "상속세 및 증여세법" 보존
4. [ ] `splitLegalAxis("접대비")` (법령명 없음) → 원본 그대로 통과 (회귀 0건)
5. [ ] `fetchArticles` 경로에서 결합 키워드 입력 시 `selectBestLaw` matchType이
       fallback → exact/prefix로 복귀 (프로브로 실측 확인)
6. [ ] 기존 단위 테스트 전부 PASS (회귀 0건), typecheck 0 오류
7. [ ] 법령 원문 무변형(§6.1)

---

## 6. Verification (검증 단계)

1. `npm run test` — 신규 + 기존 vitest 전부 PASS
2. `npx tsc --noEmit` — 타입 오류 0
3. 프로브 스크립트 실행 → 결합 키워드 matchType 개선 실측(리포트 첨부)
4. `npm run dev` → 복합형 질문("법인세법상 접대비 손금 한도") 검색 → 올바른 법령(법인세법) 선택 확인

---

## 7. Risks / Notes

- `lawSearch.do` `query` 다중 토큰 동작 미검증 → 프로브로 선(先)확정. 만약 결합 키워드가
  의외로 정상 매칭된다면 본 티켓의 전제가 약해지므로, 프로브 결과에 따라 범위 재조정.
- 다단어 법령명("상속세 및 증여세법", "조세특례제한법") 토큰 병합 로직 주의 —
  과분리 시 법령명 손실 위험. LAW_ALIASES 값·LEGAL_AXIS_BROAD를 우선 참조.
- 사실축을 본 티켓에서 소비하지 않으므로, 완료 후에도 법령 전체 조문 반환은 유지된다
  (조문 선별은 TAX-6B-25). 즉 본 티켓 단독 효과는 "올바른 법령 선택"에 한정.

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출 (완료)
- 근본 원인: 결합 키워드가 법령명 매칭(searchLaws·selectBestLaw)을 무력화
- 영향 파일: `lawAliases.ts`(또는 신규 `legalAxis.ts`), `nationalTaxLaw.ts`, 테스트
- 구현 계획: §4 1~4단계

### 8.2 코딩 후 제출
- [ ] 변경 파일 목록 / 변경 요약 / 검증 결과(PASS·FAIL) / 위험
- [ ] 리포트: `docs/reports/TAX-6B-24_report.md`

---

## 10. Related Tickets

- 선행: TAX-031(정확매칭·약칭), TAX-042G(축 결합) — 본 티켓이 둘의 충돌을 해소
- 후속: TAX-6B-25(조문 단위 관련도 선별 — 사실축 소비), TAX-6B-26(다중 쿼리 검색)
- 참조: 검색 정확도 향상 분석(2026-07-02) 문제 P1

---

**작성자**: AI (회계사 검토 대기)
**작성일**: 2026-07-02
**최종 수정일**: 2026-07-02

---

## 11. Report Link

Report: `docs/reports/TAX-6B-24_report.md` (미작성)
