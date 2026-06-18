# TAX-6B-10 참고 목록 관련도 점수 강화 — 무관한 심판례 노출 차단

---

## Metadata

- **Type**: FEAT
- **Severity**: major
- **Layer**: usecase
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: S (1파일 + 테스트)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

회계사 피드백: "유사 사례로 나타나는 심판례들이 너무 관련성이 낮고 업무에 쓸 수 있는 자료가 아예 없다."

진단 결과, 참고 목록(`LabeledAnswer.references`)의 관련도 산정이 허술하다:

1. **`relevanceScore`(generateAnswer.ts:43)** 가 검색어 단어가 **사건명(articleTitle)·명칭(lawName)에 글자 그대로 포함되는지만** 센다. 본문(content)은 보지 않는다. 사건명이 "법인세부과처분취소"처럼 추상적이면 "가지급금" 같은 핵심어가 글자로 안 겹쳐 **점수 0**이 된다.
2. 검색어 토큰에 불용어("관련", "여부")가 섞여 **헛매칭**을 만든다.
3. **`buildReferences`(generateAnswer.ts:92)** 에 컷오프가 없어, 점수 0(무관)이어도 빈자리가 있으면 상위 10건을 무조건 채운다.

### 1.2 기대 동작

- 본문(content)까지 보고 관련도를 산정한다. 사건명·명칭 매칭은 강한 신호(가중치 2), 본문 매칭은 약한 신호(가중치 1).
- 검색어 토큰에서 불용어를 제거해 헛매칭을 줄인다.
- 관련도 점수 1 미만(무관) 자료는 참고 목록에서 제외한다. **검색된 자료가 전부 무관하면 참고 목록을 비운다(엄격 컷오프 — 회계사 결정 2026-06-17).**

### 1.3 영향·중요도

회계사가 의뢰인 보고서에 인용할 자료의 신뢰성 문제. 무관한 심판례가 "유사 사례"로 노출되면 회계사가 옥석을 가리는 시간을 낭비하고, 시스템 신뢰를 떨어뜨린다.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/usecases/generateAnswer.ts` — `relevanceScore`, `buildReferences` (수정)
- `src/domain/nonLawQueryNormalize.ts` — `NONLAW_STOPWORDS` 재활용(import)
- `tests/unit/generateAnswer.test.ts` — 참고 목록 테스트 갱신

### 2.2 아키텍처 힌트

Usecase 계층 내부 순수 함수 변경. 외부 I/O·Port 변경 없음. 검색 어댑터(nationalTaxLaw.ts)는 이번 범위 밖(방향 B로 분리).

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [x] `src/usecases/generateAnswer.ts` — `relevanceScore` 정교화, `buildReferences` 컷오프 추가
- [x] `tests/unit/generateAnswer.test.ts` — 새 정책 반영 테스트 갱신

### 3.2 금지되는 변경

- ❌ `src/adapters/nationalTaxLaw.ts` 검색 로직 변경 (방향 B 별도 티켓)
- ❌ law-verifier V1~V6 로직 변경 (참고 목록은 V검증 비대상 — SSOT §7.4)
- ❌ 발췌 인용(citable) 경로 변경
- ❌ 벡터 검색 도입 (방향 C 별도)

---

## 4. Strategy (구현 힌트)

1. `relevanceScore`: 제목·명칭 매칭(2점) + 본문 매칭(1점). 한 term이 양쪽 다 있으면 강한 신호로만 1회 계산.
2. 토큰 추출 헬퍼: `length >= 2` 필터 + `NONLAW_STOPWORDS` 제거.
3. `buildReferences`: 점수 계산 1회 → 점수 ≥ 1 컷오프 → 점수↓·선고일↓·사건번호↑ 정렬 → 상위 MAX_REFERENCES.

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] 검색어가 사건명에도 본문에도 없는 자료는 참고 목록에서 제외된다.
2. [ ] 검색어가 본문에만 있는 자료도 참고 목록에 포함된다(본문 신호 반영).
3. [ ] 검색된 비법령 자료가 전부 무관하면 references는 빈 배열이다.
4. [ ] 사건명 매칭(2점)이 본문 매칭(1점)보다 위로 정렬된다.
5. [ ] 불용어("관련" 등)만으로는 점수가 오르지 않는다.
6. [ ] `npm run test` 전체 통과(기존 회귀 포함).

---

## 6. Verification (검증 단계)

1. `npm run test` — 전체 통과
2. `npm run build` — 타입 통과
3. 단위 테스트로 본문 매칭·컷오프·정렬 동작 확인

---

## 7. Risks / Notes (위험·주의사항)

- **엄격 컷오프 부작용**: 전부 무관하면 참고 목록이 빈다. 회계사 평소 선호("모른다보다 유사 사례라도")와 상충할 수 있으나, 이번 불만("무관한 건 빼라")을 우선해 결정함(2026-06-17). UI는 "관련 자료를 찾지 못함" 안내로 대응.
- 검색 단계 자체의 관련도 손실(어댑터가 날짜순 재정렬, display=5)은 **이 티켓 범위 밖**. 방향 B 후속 티켓 필요.
- 참고 목록은 law-verifier V검증 비대상이므로 검증 로직 영향 없음(SSOT §7.4).

---

## 10. Related Tickets

- 선행: `TAX-015C`(관련도 정렬), `TAX-015D`(참고 목록 확장), `TAX-043`(비법령 정규화·불용어 사전)
- 후속: (방향 B) 심판례 검색 관련도 보존·후보 확대 — 별도 티켓 검토

---

## 11. Report Link

Report: `docs/reports/TAX-6B-10_report.md` (작성중)

---

**작성자**: AI (회계사 승인)
**작성일**: 2026-06-17
**최종 수정일**: 2026-06-17
