# [TAX-6B-20-C] 코드 수정 지시서 — R1

> ✅ **코드 결함 없음 — 수정 불필요.** 🔴(치명) 0건 · 🟡(경미) 0건.
> 티켓 사양(결정 ① max=2·minSimilarity=0.5, identityKey 단일 진실 원천화, externalId 우선·caseNumber
> 폴백, rowToTaxLaw 순수함수 export+단위테스트, 해석례 참고 목록의 V검증 비대상 유지)이 코드·테스트에
> 모두 정확히 반영돼 있다. §6.1 원문 보존·§6.3 라벨(T3=🟡)·§7 시크릿 비노출·계층 아키텍처 모두 준수.
> 아래는 **Codex가 고칠 것이 아니라** quality-gate·회계사 참고용 관찰(🟢) 3건뿐이다.

## 이 문서의 사용법 (Codex에게)
**이 라운드에 수정할 코드 항목은 없다.** 아래 "절대 규칙"과 "검증된 사항"을 확인만 하고,
"참고 관찰"은 정보 제공용이므로 별도 지시가 없는 한 손대지 말 것. (섣부른 리팩터가 오히려 회귀 위험.)

## 절대 규칙 (이 프로젝트 불변 제약)
- 법령/판례/예규/해석례 원문 텍스트를 요약·의역·가공하지 말 것. 발췌는 원문과 문자 단위로 일치해야 함.
- 계층 구조 준수: UI → API Route → Usecase → Adapter/Port. Usecase에서 fetch·DB 직접 호출 금지.
- 이 티켓(TAX-6B-20-C) 범위 밖 파일은 수정하지 말 것. 무관한 리팩터 금지.
- API 키·`DATABASE_URL`·`VOYAGE_API_KEY`·주민/사업자번호·회계사 식별자를 코드·로그·에러·URL에 넣지 말 것.
- 기존 테스트를 깨지 말 것. temperature 0·`withRetry`·`Promise.all` 병렬 게이트·try/catch graceful degrade 등
  기존 안전장치를 제거하지 말 것.
- **해석례 참고 목록(references)을 발췌 인용(citations)·V1~V6 검증 경로로 승격하지 말 것** (참고 목록 트랙 유지).

## 티켓 요약
- 목표: 국세청 세법해석례 벡터 검색을 판례·심판례와 **동일 게이트**로 참고 목록에 배선(엔트리 1줄 +
  타입 유니온 확장), externalId 기반 dedup으로 실시간↔벡터 중복만 제거.
- 이번 라운드 최우선(R1): 전체 결함 해소. → **결함 없음이 확인되어 수정 대상 없음.**

## 수정 항목
**(없음 — 코드 결함이 발견되지 않았다.)**

---

## 검증된 사항 (quality-gate가 PASS 판단 시 근거로 사용)

### AC1 — VECTOR_REFERENCE_GATES 해석례 엔트리 + 타입 유니온 2곳 ✅
- `src/usecases/generateAnswer.ts:68` 선언부 유니온 `'판례' | '심판례' | '해석례'`, `:71` 엔트리
  `{ sourceType: '해석례', topK: 5, minSimilarity: 0.5, max: 2 }` — **§4 결정 ①(max=2·minSim=0.5) 그대로 반영**.
- `generateAnswer.ts:284` `fetchVectorReferences` gate 파라미터 유니온도 `'해석례'` 포함(유니온 2곳 확장 완료).

### AC4 — identityKey 단일 진실 원천 + externalId 우선·caseNumber 폴백 ✅
- 티켓 §4-3 권장안(사본 2곳을 각각 고치는 대신 **단일화**) 그대로 구현: `src/domain/searchMerge.ts:18~22`가
  유일한 `identityKey`이며 비법령 키가 `${sourceType}|${externalId?.trim() || (caseNumber ?? '')}` —
  externalId 우선, caseNumber 폴백. `generateAnswer.ts:8`이 이를 `import`해 사용(자체 사본 제거) →
  향후 드리프트 구조적으로 차단. 범위를 식별키 통합에 한정, 광범위 리팩터 없음.
- 2004년 이전 "재산" 케이스(과잉 제외 회귀) 방지: 같은 caseNumber라도 externalId가 다르면 별도 자료로
  유지됨을 `tests/unit/searchMerge.test.ts:84` + `tests/unit/tribunalReferences.test.ts:284`가 검증.

### AC4 — rowToTaxLaw 순수함수 export + 픽스처 함정 회피 ✅
- `src/adapters/vectorSearch.ts:32` `export function rowToTaxLaw` — 티켓 §4-3a 추천안(비공개 함수를
  Pool 모킹 대신 순수 매핑으로 export)대로. SELECT에 `metadata->>'externalId' AS external_id`(:71) 추가,
  매핑 `...(row.external_id ? { externalId: row.external_id } : {})`(:47).
- **픽스처 함정 3중 방어 확인**(티켓 §4-4가 경고한 "테스트 PASS·라이브 고장" 회피):
  ① 벡터측 매핑 — `tests/unit/vectorSearch.test.ts`가 DB 행 → TaxLaw externalId 매핑을 직접 단위 검증
     (external_id 존재→매핑 / NULL→필드 없음, 하위호환).
  ② 실시간측 채우기 — `tests/integration/nationalTaxLaw.test.ts:494`가 실제 어댑터가
     `externalId='010000000000100201'`을 실제로 산출함을 검증(손으로 넣은 픽스처 아님).
  ③ dedup 로직 — `tests/unit/tribunalReferences.test.ts:269`가 동일 externalId 중복 1건 노출을 검증.

### AC3/AC6 — 보수적 게이트·조용한 폴백·citation 승격 없음 ✅
- `fetchVectorReferences`(generateAnswer.ts:280~297): `minSimilarity` 필터 + `slice(gate.max)` +
  `try/catch` 빈 배열 폴백. `tribunalReferences.test.ts:300` "해석례 벡터 검색 실패는 다른 참고 목록
  경로에 영향 주지 않음" 검증.
- **citation 승격 금지 코드 경로 확인**: `buildReferences`는 `runTwoStage`(검증 V1~V6) **이후**에 호출
  (generateAnswer.ts:522→564). 벡터 해석례는 `buildReferences` 내부 `fetchVectorReferences`에서만
  생성되어 `references`로만 흘러가고, `verifier.verify(answer, split.citable)`(:527)가 받는 `citable`에는
  절대 포함되지 않는다(citable은 검색 결과 `splitResults` 산출물). 실시간 해석례는 content=''라 citable이
  아니고, 벡터 해석례는 검증 경로 밖. → **§6.4·SSOT §7.4 "참고 목록 V검증 비대상·인용 승격 금지" 준수.**

### 실시간 어댑터 externalId 채우기 ✅
- `src/adapters/nationalTaxLaw.ts:973` `externalId: extractNtsExternalId(e.법령해석상세링크)` 추가
  (§4-3b). 로직은 링크에서 `ntstDcmId` 추출(신규 로직 아님, 기존 패턴).

### P95 FAIL 관련 — 이 티켓 코드에 성능 악화 실수 없음 (리포트 주장 사실 확인) ✅
- **리포트의 "벡터 3게이트 병렬 유지" 주장은 코드상 사실.** `generateAnswer.ts:161~163`이
  `Promise.all(VECTOR_REFERENCE_GATES.map((gate) => fetchVectorReferences(...)))` — 게이트가 배열
  순회+`Promise.all`이라 해석례 엔트리 1줄 추가는 **병렬로 확장**될 뿐 직렬 왕복이 쌓이지 않는다.
- 벡터 3게이트 기여분(4.52s)은 20-B 적재로 `taxlaw_embeddings` 테이블이 ~146K→~282K행으로 커져
  **전수 스캔이 함께 느려진** 결과(HNSW 미도입, TAX-6B-18 회계사 결정)이지, 20-C 배선의 직렬화·병렬
  파괴 실수가 아니다. 주원인 LLM tail(17.91s)은 티켓 무관 선행 이슈로 리포트가 정확히 분리했다.
- `metadata->>'externalId'` SELECT 1컬럼 추가는 판례·심판례 기존 행에서 NULL→caseNumber 폴백으로
  하위호환이며 성능 회귀 요인 아님.

### 스코프 ✅
- 코드 커밋 `d8abb85`가 건드린 파일(generateAnswer.ts·searchMerge.ts·vectorSearch.ts·nationalTaxLaw.ts +
  4개 테스트 + 스냅샷 + 리포트·티켓)은 모두 티켓 §3.1·§4 구현순서에 명시된 범위 내. 범위 밖 코드 변경 없음.

---

## 참고 관찰 (🟢 정보 제공 — Codex 수정 대상 아님, quality-gate·회계사 판단용)

### (관찰 1) externalId 추출 함수가 두 곳에 별개 구현 — 현 데이터에서는 동치
- 벡터 적재 경로: `scripts/collectNtsInterpretations.ts:152` `extractNtstDcmId` = 정규식 `/ntstDcmId=(\w+)/`.
- 실시간 어댑터: `src/adapters/nationalTaxLaw.ts:426` `extractNtsExternalId` = `URL.searchParams.get('ntstDcmId')`.
- dedup은 이 둘이 **같은 문자열**을 내야 성립한다. ntstDcmId는 18자리 숫자(문서 주석 명시)라 두 방식 결과가
  동일 → **현 데이터에서 dedup 정상 동작**(코드 결함 아님). 다만 개념상 같은 ID를 두 구현이 파싱하므로
  향후 ID 형식이 바뀌면 드리프트 가능성만 존재. `scripts/`는 `src/`에서 import 불가라 물리적 공유가
  어려운 구조적 제약도 있음. **지금 고칠 필요 없음** — 후속 정리 여지로만 기록.

### (관찰 2) 문서 커밋(99ec231)이 형제 20-B 리포트 정정 + 대용량 P95 JSON 추가
- `docs/reports/TAX-6B-20-B_report.md` "최장 26,886자" → "30,000자 초과 2건" 정정(원문은 §6.1대로
  content에 보존, 임베딩만 절단). 20-C 라이브 적재 중 발견한 **사실 정정**이며 브랜치가
  `feat/tax-6b-20-b-c-...`(20-B+20-C 결합)라 스코프 위반으로 보기 어렵다.
- `docs/reports/TAX-029_p95_baseline_2026-07-12.json`(2,916줄) 신규 추가 — AC5 P95 측정 증거 산출물.
  대용량 생성물을 git에 커밋할지는 회계사 판단 사항(코드 결함 아님).

### (관찰 3) AC5가 [x]인데 실제 결과는 P95 FAIL(25.37s ≥ 15s)
- 티켓 §5 AC5·리포트 §3가 **"미달 확인"을 명시**하고 회계사 결정(2026-07-12 "기록만 하고 종료")까지
  기재 → 은폐 없이 투명. [x]는 "측정·기록 완료"의 뜻으로 해석됨. quality-gate가 완료 판정 시,
  AC5는 "합격"이 아니라 "회계사 승인 하에 미달 기록 후 종료"임을 인지할 것. **코드 수정 불필요.**

## 완료 확인 체크리스트 (수정 항목이 없으므로 확인만)
- [x] 🔴·🟡 결함 0건 — 수정할 코드 없음
- [x] `npm run typecheck` 0에러 (리포트 검증 결과 PASS)
- [x] `npm run test` 전건 통과 (리포트 822/822, 대상 61/61)
- [x] 해석례 참고 목록이 V1~V6 검증 경로에 미포함(citation 승격 없음) — 코드 경로 확인
- [x] 티켓 범위 밖 코드 파일 미변경
