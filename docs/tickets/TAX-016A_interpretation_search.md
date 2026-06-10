# TAX-016A 법령해석례(expc) 검색 추가 — 비법령 자료 확장 1/3

> TAX-016을 자료원별로 분할한 첫 슬라이스. 현재 키(law.go.kr OC)로 즉시 가능한 **법령해석례(`target=expc`)**만 추가한다.
> 선행: **TAX-015/015B/015C 완료**. 후속(보류): TAX-016B(국세청 해석례·data.go.kr 별도 키), TAX-016C(조세심판원 결정례·target 추가 조사).

---

## Metadata
- **Type**: FEAT
- **Severity**: major
- **Layer**: adapter | ui
- **Milestone**: Post-MVP
- **Estimated Size**: M (3~5파일)

---

## 1. Problem

### 1.1 현재 동작
- 검색 결과에 법령(T1·T2)·판례(T4)는 포함되나 **법령해석례(T3)**가 없음.

### 1.2 기대 동작
- 검색 시 법령해석례가 포함되어 T3로 분류, 🟡유사사례/⚪참고자료로 제시.
- 본문(이유·질의요지·회답) 발췌 인용이 V1·V2를 통과해 노출.
- 안건번호·해석기관·질의기관·회신일자·키없는 원문 링크 표기.

### 1.3 영향·중요도
- 실무 판단 순서(조문→해석례→판례)를 보조. 기재부 질의 법령해석이 expc에 포함됨(질의기관명=기획재정부).

---

## 2. Context (실호출 검증 — 2026-05-21)

### 2.1 검증 결과 (현재 키로 확인, 키 미출력)
- **목록** `lawSearch.do?target=expc&type=JSON&query=…` → `{ Expc: { expc: [...] } }`
  - 항목 키: `안건명`, `안건번호`, `회신기관명`, `질의기관명`, `회신일자`, `법령해석례일련번호`, `법령해석례상세링크`(⚠️OC 포함)
- **본문** `lawService.do?target=expc&ID=법령해석례일련번호&type=JSON` → `{ ExpcService: {...} }`
  - 본문 키: `질의요지`, `회답`, `이유`(전문 수천 자), `해석기관명`, `해석일자`, `안건번호`, `안건명`, `질의기관명`
- 본문 제공됨 → 발췌 인용(citation) 가능. 판례와 동일 패턴(목록→본문 2단계 조회).

### 2.2 관련 파일
- `src/adapters/nationalTaxLaw.ts` (수정 — expc 검색·본문·정규화·병합)
- `app/components/AnswerCard.tsx` (수정 — 비법령 메타 표기 문구를 자료유형별로: 판례=선고일/해석례=회신일)
- `tests/integration/nationalTaxLaw.test.ts` (수정 — expc MSW 목·테스트)
- `tests/unit/lawVerifier.test.ts` (확인 — 해석례 V1, 로직 변경 없으면 테스트만 추가)

### 2.3 필드 매핑 (해석례 → TaxLaw)
| expc | TaxLaw | 비고 |
|---|---|---|
| 안건번호 | `caseNumber` | V1 식별자 (회계사 표시용) |
| 안건명 | `articleTitle` | |
| 해석기관명(본문)/회신기관명(목록) | `issuingBody` | 해석을 내린 기관(예: 법제처) |
| 질의요지+회답+이유 | `content` | 원문 보존(문자 단위) |
| 해석일자(본문)/회신일자(목록) | `decisionDate`,`revisionDate` | `YYYY.MM.DD`→`YYYY-MM-DD` |
| 법령해석례일련번호 | (본문 조회 ID·sourceUrl seq) | URL에서 OC 제거 |
| (조문번호 없음) | `articleNumber=''` | |
| — | `trustTier='T3'`, `sourceType='해석례'` | |

---

## 3. Scope

### 3.1 허용되는 변경
- [ ] `nationalTaxLaw.ts` — `searchInterpretations()`·`fetchInterpretationBody()`·`toInterpretationTaxLaw()`·`toExpcSourceUrl()`·`sortInterpretations()` 추가, `search()` 병렬 병합(법령→해석례T3→판례T4), 부분 실패 허용.
- [ ] `AnswerCard.tsx` — 비법령 메타 문구 자료유형별 분기(판례=선고일, 해석례=회신일).
- [ ] 테스트 정합/추가.

### 3.2 금지되는 변경
- ❌ 국세청 해석례(data.go.kr)·조세심판원(target 미확정) — 별도 티켓.
- ❌ 벡터 DB·임베딩.
- ❌ T3를 단독으로 🟢직접근거 단정 (T1·T2 우선).
- ❌ 원문 의역·요약 저장.
- ❌ TAX-015 구조 광범위 리팩터.

---

## 4. Strategy
1. expc 목록 조회 → 상위 N건 → 각 본문 조회(병렬) → `질의요지\n회답\n이유` 원문 결합.
2. `TaxLaw`(sourceType='해석례', T3)로 정규화. 본문 없으면 빈 문자열(→ TAX-015B 참고 목록으로 자동 처리).
3. 병합 정렬: 법령(T1·T2) → 해석례(T3) → 판례(T4). 각 그룹 내부는 날짜↓.
4. V1: `matchesIdentity`가 비법령을 caseNumber로 대조하므로 코드 변경 불필요(해석례 caseNumber=안건번호). 단위 테스트로 확인.
5. 원문 링크: OC 제거한 공개 뷰어 URL. 패턴은 구현 중 실제 200 확인.

---

## 5. Acceptance Criteria
1. [ ] 검색 결과에 해석례(T3)가 포함되고 안건번호·기관·회신일·키없는 링크를 가진다.
2. [ ] 해석례 본문 발췌가 V1·V2를 통과(환각/의역 케이스 각 FAIL 확인).
3. [ ] 해석례는 🟡/⚪ 라벨만(V3 통과), 단정형 없음(V6).
4. [ ] 병합 정렬: 법령→해석례→판례 순서, 결정론적.
5. [ ] 법령·판례(TAX-015) 기존 동작 회귀 없음.
6. [ ] 원문 문자 단위 보존, 링크에 OC 미노출.

---

## 6. Verification
1. `npm run test`/`typecheck`/`lint` 통과.
2. `npm run dev` → 해석례 풍부한 쟁점 검색 → 해석례 표기·라벨·링크 확인.
3. 해석례 환각 인용으로 V1 FAIL → 미노출 확인.

---

## 7. Risks / Notes
- **공개 뷰어 URL 패턴**: 판례(precInfoP.do)와 유사한 expc 뷰어 URL을 구현 중 실호출로 확정. 회계사 브라우저 확인 권장.
- **호출 수 증가**: 해석례 본문도 항목마다 추가 호출 → display 수 보수적 설정.
- **issuingBody 의미**: 해석기관(법제처)이 해석 주체. 질의기관(기재부 등)은 별도 표기 검토.

---

## 10. Related Tickets
- 선행: TAX-015/015B/015C
- 후속(보류): TAX-016B(국세청 해석례), TAX-016C(조세심판원)
- 상위: TAX-016(엄브렐러)

## 11. Report Link
Report: `docs/reports/TAX-016A_report.md` (완료)

---

**작성자**: AI 초안 (회계사 검토 대기)
**작성일**: 2026-05-21
