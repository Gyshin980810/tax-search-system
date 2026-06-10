# TAX-015 구현 리포트 — 판례(prec) 검색 수직 슬라이스

- **티켓:** `docs/tickets/TAX-015_precedent_search_vertical_slice.md`
- **작업일:** 2026-05-20
- **상태:** 구현 완료 (회계사 수동 검증 대기 — §6)

---

## 변경 사항 요약

### 파일 변경 목록

**도메인 (수정)**
- `src/domain/TaxLaw.ts` — `SourceType('법령'|'판례'|'해석례'|'심판례')` 추가, `TaxLaw`에 자료유형 구분자(`sourceType`)와 비법령 선택 필드(`caseNumber?`, `issuingBody?`, `decisionDate?`) 추가. 기존 법령 필드는 이름·의미 그대로 유지(하위호환).

**어댑터 (수정)**
- `src/adapters/nationalTaxLaw.ts`
  - `search()`가 법령 + 판례를 **병렬 검색·병합**. 판례 검색 실패 시 빈 배열 폴백(부분 실패 허용).
  - `searchPrecedents()` 신규 — 판례 목록(`target=prec`) 조회 후 **법원 출처만 본문 조회**.
  - `fetchPrecedentBody()` 신규 — 판례 본문(`판시사항`+`판결요지`) 원문 그대로 수집. 미제공·실패 시 빈 문자열.
  - `toPrecedentTaxLaw()` 신규 — 판례 → `TaxLaw`(sourceType='판례', T4). 본문 없는 판례는 결과에서 제외(필터).
  - `toPrecSourceUrl()` 신규 — **API 키(OC) 제거한 공개 링크** 생성 (CLAUDE.md §7).
  - `fetchWithTimeout`에 **User-Agent 헤더 추가** — 정부 API의 봇 차단(ECONNRESET) 회피. 법령·판례 호출 공통.
  - 정렬: 법령은 기존 `sortTaxLaws`(조문번호 순) 유지, 판례는 `sortPrecedents`(선고일↓). 병합 순서는 **법령(직접 근거) → 판례(유사 사례)**.

**검증 (수정)**
- `src/adapters/lawVerifier.ts` — V1 식별자 매칭을 자료유형별로 분기(`matchesIdentity`): 법령=법령명+조문번호, 비법령=사건번호. `sourceType` 미지정 레거시 데이터는 법령으로 간주(하위호환). V2~V6 로직 불변.

**UI (수정)**
- `app/components/AnswerCard.tsx` — 자료유형 배지(법령/판례/해석례/심판례) 추가, 빈 조문번호 처리, 비법령 메타(생산기관·선고일) 표기.
- `app/components/CitationCopy.tsx` — 인용 복사 머리말을 자료유형별로 분기(법령=조문번호, 판례=선고일).

**테스트 (수정/추가)**
- `tests/unit/lawVerifier.test.ts` — `makeTaxLaw`에 sourceType 기본값, 판례 검증 5건 추가(V1 통과/환각 FAIL, V2 의역 FAIL, V3 라벨 FAIL, 법령+판례 혼합).
- `tests/integration/nationalTaxLaw.test.ts` — 판례 병합 4건 추가(병합 순서, 메타·키없는 링크, 본문 미제공 제외, 부분 실패 폴백).
- `tests/unit/generateAnswer.test.ts`, `tests/integration/llmAnswerGenerator.test.ts` — 목 데이터에 sourceType 추가(타입 정합).

**문서**
- `docs/tickets/TAX-015_…md` — §2.2를 실호출 진단 결과로 갱신.

### 주요 변경
- 법령 조문만 검색하던 시스템에 **판례(T4) 검색을 추가**하여 비법령 자료 파이프라인을 개통.
- 통합 서랍(`TaxLaw` 확장) 방식으로 모양이 다른 자료를 단일 그릇에 수용.

---

## 1단계 진단 결과 (Acceptance #1 — 판례 API 응답 샘플·필드 매핑)

실제 호출(`NATIONAL_TAX_API_KEY`)로 확정. **키 값은 출력·저장하지 않음.**

### 목록 조회 `GET /DRF/lawSearch.do?target=prec&type=JSON&query=…`
```json
{ "PrecSearch": { "prec": [
  { "사건번호": "2020다288436", "사건명": "손해배상(기)", "선고일자": "2026.03.12",
    "법원명": "대법원", "데이터출처명": "대법원", "판례일련번호": "618543",
    "판례상세링크": "/DRF/lawService.do?OC=<키>&target=prec&ID=618543&type=HTML", "사건종류명": "민사" }
] } }
```

### 본문 조회 `GET /DRF/lawService.do?target=prec&ID=<판례일련번호>&type=JSON`
```json
{ "PrecService": { "판시사항": "…", "판결요지": "…", "참조판례": "…",
  "법원명": "대법원", "사건번호": "2020다288436", "선고일자": "20260312" } }
```

### 필드 매핑 (판례 → TaxLaw)
| 판례 API | TaxLaw | 비고 |
|---|---|---|
| 사건번호 | `caseNumber` | V1 식별자 |
| 사건명 | `articleTitle` | |
| 법원명 | `issuingBody` | 목록의 국세 출처는 빈 값 |
| 선고일자 | `decisionDate` | `YYYY.MM.DD`/`YYYYMMDD` → `YYYY-MM-DD` 정규화 |
| 판시사항+판결요지 | `content` | 원문 보존(HTML 태그 포함) |
| 판례일련번호 | (본문 조회 ID, sourceUrl precSeq) | |
| (조문번호 없음) | `articleNumber=''` | |
| — | `trustTier='T4'`, `sourceType='판례'` | |

### 핵심 발견
1. **데이터출처별 본문 제공 차이**: `대법원`(법원) 출처 = 본문 제공 ✅ / `국세법령정보시스템` 출처 = 목록만, 본문 "없음" ❌.
2. **응답 링크에 API 키(OC) 노출** → sourceUrl 재구성으로 차단.
3. **본문에 HTML 태그(`<br/>`) 포함** → 원문 보존, 화면 렌더링은 후속 과제.
4. (조사 완료) 국세청 자체 공식 OpenAPI의 판례 본문 경로 없음 — 비공식 스크래핑 비채택.

---

## 검증 결과

| 항목 | 결과 |
|---|---|
| `npm run typecheck` (tsc) | ✅ 에러 0 |
| `npx vitest run` (unit/integration/golden) | ✅ **101개 전부 통과** |
| `npm run lint` (eslint) | ✅ 경고/에러 0 |
| 골든셋 G-1~G-5, G-N1~G-N4 회귀 | ✅ 회귀 없음 (하위호환 방어) |
| V1 판례 환각 케이스 FAIL (Acceptance #4) | ✅ 단위 테스트로 확인 |
| V2 판례 의역 FAIL | ✅ |
| V3 판례 T4에 🟢 라벨 FAIL | ✅ |
| 판례 메타·키없는 링크·본문 미제공 제외 (Acceptance #2·#3) | ✅ 통합 테스트(MSW)로 확인 |

> **실 API end-to-end 검증**은 `server-only`·LLM 비용 때문에 자동 테스트에서 제외. 회계사 수동 검증(§6 `npm run dev`)으로 확인 필요.

---

## 잠재 위험 / 한계

- **국세 출처 판례 본문 미노출**: 양도소득세 등 핵심 세법 쟁점의 판례가 다수 국세 출처라, 본문 없는 판례는 이번 범위에서 결과에서 제외됨. 회계사 참고 목록 노출은 **후속 TAX-015B** 필요.
- **공개 링크(`precInfoP.do?precSeq=`) 실제 동작**은 회계사 브라우저 검증 권장(§6).
- **판례 시점 라벨**: 판례에 `[현행]`이 다소 어색(형식 검증은 통과). 의미적 개선은 후속 과제.
- **호출 수 증가**: 판례 본문은 법원 출처마다 추가 호출(display=3). 응답 지연·요청 한도는 모니터링 필요.

---

## 후속 작업
- **TAX-015B**: 본문 미제공(국세 출처) 판례를 ⚪참고 목록으로 노출 (`LabeledAnswer.references` 등 답변 구조 확장).
- **TAX-016**: 국세청 해석례·기재부 회신·조세심판원 결정례 추가.

**리포트:** `docs/reports/TAX-015_report.md`
