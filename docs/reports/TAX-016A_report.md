# TAX-016A 구현 리포트 — 법령해석례(expc) 검색 추가

- **티켓:** `docs/tickets/TAX-016A_interpretation_search.md`
- **작업일:** 2026-05-21
- **상태:** 구현 완료 (회계사 수동 검증 대기 — §검증 결과 하단)
- **선행:** TAX-015/015B/015C (완료)

---

## 배경

TAX-016(자료 3종 일괄)을 실호출로 조사한 결과, **현재 키(law.go.kr OC)로 즉시 가능한 자료는 법령해석례(`expc`)뿐**이었다. 국세청 해석례·예규는 data.go.kr 별도 키, 조세심판원 결정례는 target 미확정이라 각각 후속(TAX-016B/016C)으로 분리했다. 본 티켓은 법령해석례 슬라이스만 구현한다.

---

## 사전 검증 (실호출 — API target·구조·본문 확정)

law.go.kr DRF를 현재 키로 호출해 확정. **API 키 미출력.**

| 자료 | target | 결과 |
|---|---|---|
| 법령해석례 | `expc` | ✅ 목록 `{Expc:{expc:[...]}}` + 본문 `{ExpcService:{...}}` 제공 |
| 조세심판원 | `tt`/`ttc`/`taxt`/`josim`/`ttSed` 등 9종 | ❌ 전부 빈 응답(무효 target) → TAX-016C |
| 국세청 해석례 | (law.go.kr 부재) | ❌ data.go.kr 별도 API·키 → TAX-016B |

**법령해석례 응답 구조:**
- 목록 `lawSearch.do?target=expc`: `안건명`, `안건번호`, `회신기관명`, `질의기관명`, `회신일자`, `법령해석례일련번호`, `법령해석례상세링크`(⚠️OC 포함)
- 본문 `lawService.do?target=expc&ID=…`: `질의요지`, `회답`, `이유`(전문 수천 자), `해석기관명`, `해석일자`, `안건번호`, `안건명`, `질의기관명`
- 공개 뷰어 URL: `https://www.law.go.kr/LSW/expcInfoP.do?expcSeq=…` (실호출 200·키 없이 정상 확인)

---

## 변경 사항 요약

### 파일 변경 목록

**어댑터 (수정)**
- `src/adapters/nationalTaxLaw.ts`
  - 타입 `RawExpc`·`RawExpcSearch`·`RawExpcService` 추가.
  - `searchInterpretations()` — expc 목록 조회 → 각 본문 병렬 조회 → `질의요지\n회답\n이유` 원문 결합.
  - `fetchInterpretationBody()` — 본문 조회, 실패 시 빈 문자열(부분 실패 허용).
  - `toInterpretationTaxLaw()` — expc → `TaxLaw`(sourceType='해석례', T3). caseNumber=안건번호, issuingBody=회신기관명.
  - `toExpcSourceUrl()` — OC 제거 공개 링크(`/LSW/expcInfoP.do?expcSeq=`).
  - `sortPrecedents` → `sortByDecisionDate`로 일반화(판례·해석례 공유, 날짜↓→식별자↑).
  - `search()` — 법령+해석례+판례 **병렬** 검색, **Trust Tier 순 병합(법령→해석례T3→판례T4)**, 비법령 실패 시 폴백.

**UI (수정)**
- `app/components/AnswerCard.tsx` — 비법령 일자 문구를 자료유형별로 분기(`dateLabel`): 판례=선고일, 해석례=회신일, 심판례=결정일. 인용·참고목록 양쪽 적용.

**검증 (변경 없음 — 의도)**
- `src/adapters/lawVerifier.ts` — `matchesIdentity`가 이미 비법령을 caseNumber로 대조하므로 해석례(caseNumber=안건번호)도 코드 변경 없이 V1 동작. 단위 테스트로 확인.

**테스트 (추가)**
- `tests/integration/nationalTaxLaw.test.ts` — expc MSW 목 + 3건:
  1. 해석례 본문·메타·T3·키없는 링크.
  2. 병합 순서 법령→해석례→판례.
  3. 해석례 검색 실패해도 법령·판례 반환(부분 실패).
- `tests/unit/lawVerifier.test.ts` — 해석례 4건: V1 통과/환각 FAIL, V2 의역 FAIL, V3 T3에 🟢 FAIL.

### 주요 변경
- 법령(T1·T2)·판례(T4)만 있던 검색에 **법령해석례(T3) 추가** — 실무 판단 순서(조문→해석례→판례) 보조.
- 판례와 동일한 "목록→본문 2단계" 패턴이라 기존 구조에 최소 변경으로 수렴.

---

## 필드 매핑 (해석례 → TaxLaw)

| expc | TaxLaw | 비고 |
|---|---|---|
| 안건번호 | `caseNumber` | V1 식별자 (예: "12-0368") |
| 안건명 | `articleTitle` | |
| 회신기관명 | `issuingBody` | 해석 회신 기관(예: 법제처) |
| 질의요지+회답+이유 | `content` | 원문 보존(문자 단위 결합) |
| 회신일자 | `decisionDate`·`revisionDate` | `YYYY.MM.DD`→`YYYY-MM-DD` |
| 법령해석례일련번호 | (본문 조회 ID·sourceUrl seq) | URL에서 OC 제거 |
| — | `trustTier='T3'`, `sourceType='해석례'` | |

---

## 검증 결과

| 항목 | 결과 |
|---|---|
| `npm run typecheck` (tsc) | ✅ 에러 0 |
| `npm run test` (vitest) | ✅ **115개 전부 통과** (TAX-015C 108 + 신규 7) |
| `npm run lint` (eslint) | ✅ 경고/에러 0 |
| AC#1 해석례 T3·식별자·기관·회신일·키없는 링크 | ✅ 통합 테스트 + 실데이터 |
| AC#2 해석례 본문 발췌 V1·V2 (환각/의역 FAIL) | ✅ 단위 테스트 |
| AC#3 해석례 🟡/⚪만(V3), 단정 금지(V6) | ✅ V3 단위 테스트 |
| AC#4 병합 순서 법령→해석례→판례(결정론적) | ✅ 통합 테스트 |
| AC#5 법령·판례(TAX-015) 회귀 없음 | ✅ 전체 통과 |
| AC#6 원문 보존·OC 미노출 | ✅ 실데이터(content 2,690자, OC 없음) |

### 실 API end-to-end 확인 (스폿 체크, 키 미출력)
"양도소득세 비과세" 검색 → 법령해석례 2건이 어댑터 매핑대로 정규화:
- 예) `법제처 10-0413` / 안건명 "기획재정부 - 혼인으로 1세대 2주택이 된…양도소득세 비과세 여부" / 회신일 2010-12-09 / 본문 2,690자 / sourceUrl `expcInfoP.do?expcSeq=313396` **OC 없음**.
- 기재부 질의 법령해석이 expc에 포함됨을 실데이터로 확인(안건명 "기획재정부 - …").

> **실 API end-to-end(LLM 포함) 검증**은 비용·`server-only` 때문에 자동 테스트 제외. 회계사 수동 검증(`npm run dev` → 해석례 풍부한 쟁점 검색 → 해석례 표기·🟡/⚪ 라벨·원문 링크) 권장.

---

## 잠재 위험 / 한계

- **issuingBody = 회신기관(법제처):** 질의기관(기재부 등)은 안건명에 포함되나 별도 필드로 표기하지 않음. 필요 시 후속 개선.
- **호출 수 증가:** 해석례 본문도 항목마다 추가 호출(display=5). 응답 지연·요청 한도 모니터링 필요. 정부 API 간헐적 ECONNRESET 관찰됨(재시도로 회복).
- **공개 뷰어 URL:** `/LSW/expcInfoP.do?expcSeq=`로 실호출 200 확인. 회계사 브라우저 최종 확인 권장.

---

## 후속 작업
- **TAX-016B (보류):** 국세청 해석례·예규 — data.go.kr(ID 15140313) 별도 키 확보 후. 환경변수 추가 전 회계사 확인(CLAUDE.md §7.1).
- **TAX-016C (보류):** 조세심판원 결정례 — law.go.kr 표준 target 부재. 다른 엔드포인트·접근 경로 추가 조사 필요.

**리포트:** `docs/reports/TAX-016A_report.md`
