# TAX-015B 본문 미제공 판례 참고 목록 노출

> TAX-015에서 제외된 "본문 없는 국세 출처 판례"를 회계사에게 ⚪참고 목록으로 노출한다.
> 선행: **TAX-015 완료 필수**.

---

## Metadata
- **Type**: FEAT
- **Severity**: minor
- **Layer**: domain | usecase | adapter | ui
- **Milestone**: Post-MVP
- **Estimated Size**: M

---

## 1. Problem
### 1.1 현재 동작 (TAX-015 완료 시점)
- 본문이 제공되지 않는 국세법령정보시스템 출처 판례는 발췌 인용이 불가능하여 검색 결과에서 **제외**됨.
- 실무상 양도소득세 등 핵심 세법 판례가 다수 국세 출처라, 회계사가 "관련 판례가 있다"는 사실조차 못 봄.

### 1.2 기대 동작
- 본문 없는 판례를 **인용(citation)이 아닌 "참고 목록(references)"** 으로 분리해, 사건명·선고일·원문 링크만 ⚪참고로 노출.
- 참고 목록은 발췌가 없으므로 V2 대상이 아니며, 검색 결과 원본이라 환각 위험이 없다.

---

## 2. Context
### 2.1 관련 파일
- `src/domain/LabeledAnswer.ts` — `references?: TaxLaw[]` 추가
- `src/usecases/generateAnswer.ts` — 본문 없는 비법령 자료를 references로 분리, LLM에는 본문 있는 자료만 전달
- `src/adapters/nationalTaxLaw.ts` — 본문 없는 판례 제외 필터 완화(참고용으로 반환)
- `app/components/AnswerCard.tsx` — 참고 목록 섹션 표시
- `src/adapters/lawVerifier.ts` — references 무검증(검색결과 원본) 또는 V1 유사 존재 확인(환각 방지)

### 2.2 배경
- TAX-015 진단: 국세 출처 판례는 목록 메타만 제공, 본문 미제공. (리포트 `docs/reports/TAX-015_report.md` §1단계 진단)

---

## 3. Scope
### 3.1 허용되는 변경
- [ ] `LabeledAnswer`에 `references?: TaxLaw[]`
- [ ] `generateAnswer`에서 references 분리·주입
- [ ] `nationalTaxLaw` 판례 필터 정책 조정
- [ ] `AnswerCard` 참고 목록 UI
- [ ] 검증/테스트 정합

### 3.2 금지되는 변경
- ❌ 참고 목록 항목을 발췌 인용(citation)으로 승격 (V2 우회 금지)
- ❌ 원문 의역·요약 저장

---

## 4. Strategy
1. `generateAnswer`에서 `searchResult.items`를 `citable`(법령+본문 있는 판례)와 `references`(본문 없는 비법령)로 분리.
2. LLM에는 `citable`만 전달 → 발췌 인용 정상.
3. `references`는 answer에 그대로 첨부(검색결과 원본).
4. 검증: references는 어댑터 검색 결과이므로 환각 불가 → V 무검증. (선택) V1 유사 "검색결과 존재" 확인만.
5. UI: "관련 참고자료(원문 확인)" 섹션에 사건명·선고일·링크 표시.

---

## 5. Acceptance Criteria
1. [ ] 본문 없는 국세 출처 판례가 ⚪참고 목록으로 노출(발췌 없음).
2. [ ] 참고 목록 항목은 citation V1~V6 검증을 우회하지 않음(애초에 citation 아님).
3. [ ] TAX-015 동작(법령·법원 판례 인용) 회귀 없음.

---

## 10. Related Tickets
- 선행: `TAX-015_precedent_search_vertical_slice.md`
- 참조: `docs/reports/TAX-015_report.md`

---

**작성자**: AI 초안 (회계사 검토 대기)
**작성일**: 2026-05-20
