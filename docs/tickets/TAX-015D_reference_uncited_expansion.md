# TAX-015D 참고 목록 확장 — 인용 안 된 비법령 자료 노출 + 개수 상향

> 본문이 있어도 LLM이 인용하지 않은 비법령 자료(해석례·판례)를 참고 목록에 노출하고, 상한을 5→10으로 올린다.
> 선행: TAX-015B/015C/016A 완료.

---

## Metadata
- **Type**: FEAT
- **Severity**: minor
- **Layer**: usecase | ui
- **Estimated Size**: S (2파일)

---

## 1. Problem
### 1.1 현재 동작
- 참고 목록(references)은 **본문 없는 비법령 자료**만 담음(TAX-015B).
- 법령해석례(TAX-016A)는 본문이 있어 citable로 가는데, LLM이 인용하지 않으면 **어디에도 안 보임**(인용 카드에도, 참고 목록에도 없음).
- 상한이 5건이라 관련 자료가 잘릴 수 있음.

### 1.2 기대 동작
- 참고 목록 = 본문 없는 비법령 자료 **+ 검색됐지만 인용 안 된 본문 있는 비법령(해석례·판례)**.
- 상한 5→10.
- 발췌 없이 메타·링크만(참고 목록 성격 유지, V검증 비대상).

### 1.3 영향
- 검색된 해석례·판례가 LLM 인용에서 빠져도 회계사가 "관련 자료 존재"를 인지. 메모리 `feedback_similar_cases`(모른다보다 유사 사례 제시 선호)와 정합.

---

## 2. Context
- `src/usecases/generateAnswer.ts` — `splitResults` 분리 단순화 + 답변 생성 후 `buildReferences` 신규.
- `app/components/AnswerCard.tsx` — 참고 목록 안내 문구 정정.

---

## 3. Scope
### 3.1 허용
- [ ] `splitResults`가 citable + 본문없는 풀(contentlessRefs)만 반환(상한·정렬은 뒤로).
- [ ] `buildReferences()` — 본문없는 자료 + 인용 안 된 비법령 합산, 관련도순(TAX-015C) 정렬, 상위 MAX_REFERENCES.
- [ ] `MAX_REFERENCES` 5→10.
- [ ] AnswerCard 안내 문구.
- [ ] 테스트 정합/추가.

### 3.2 금지
- ❌ 참고 목록 항목에 발췌(excerpt) 부여(V2 우회 금지 — citation 승격 금지).
- ❌ citable의 LLM 전달 자체 변경(인용 후보는 그대로 본문 있는 자료 전부).
- ❌ 원문 의역·요약 저장.

---

## 4. Strategy
1. `splitResults(items)` → `{ citable, contentlessRefs }`.
2. 답변 생성·검증 완료 후, `answer.citations`의 식별자 집합으로 citable 중 **인용 안 된 비법령** 추출.
3. `contentlessRefs + 인용안된비법령`을 관련도순 정렬 후 상위 10건.
4. 인용 자료는 식별자(법령=조문번호, 비법령=사건/안건번호)로 제외해 중복 방지.

---

## 5. Acceptance Criteria
1. [ ] 검색됐지만 인용 안 된 본문 있는 비법령(해석례·판례)이 참고 목록에 노출.
2. [ ] 인용된 비법령은 참고 목록에 중복 노출되지 않음.
3. [ ] 본문 없는 비법령(기존 TAX-015B)도 계속 노출.
4. [ ] 상한 10건, 관련도순(TAX-015C) 유지.
5. [ ] 참고 목록은 발췌 없음·V검증 비대상(TAX-015B 원칙).
6. [ ] 기존 동작 회귀 없음.

---

## 6. Verification
1. `npm run test`/`typecheck`/`lint`.
2. `npm run dev` → 양도세 등 해석례 있는 주제 검색 → 인용 안 된 해석례가 참고 목록에 노출 확인.

---

## 7. Risks / Notes
- 가지급금 등 법령해석례 자체가 없는 주제는 본 변경으로도 해석례가 안 보임(데이터 부재 — TAX-016B 영역).
- 참고 목록이 길어지면 화면 길이 증가 — 10건은 회계사 결정.

---

## 10. Related Tickets
- 선행: TAX-015B/015C, TAX-016A
- 참조: `docs/reports/TAX-015B_report.md`, `docs/reports/TAX-015C_report.md`

## 11. Report Link
Report: `docs/reports/TAX-015D_report.md` (완료)

---

**작성자**: AI 초안 (회계사 승인 완료)
**작성일**: 2026-05-21
