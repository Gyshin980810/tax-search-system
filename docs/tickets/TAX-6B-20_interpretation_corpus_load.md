# TAX-6B-20 국세청 세법해석례(ntsCgmExpc) 본문 코퍼스 벡터 적재 — taxlaw.nts.go.kr 크롤링 경로

> 작업 시작 전 `CLAUDE.md` + `docs/SSOT.md`(§7 세법 도메인) + 본 티켓 +
> 메모리 `project_nonlaw_interp_tracks`, `project_tax6b18_tribunal_full_load` 를 읽을 것.
>
> 본 티켓은 **계획서**이며, 회계사 승인 전까지 실제 수집·임베딩·적재는 착수하지 않는다.
> 실제 구현은 Sonnet에게 위임한다(계획 승인 후).

---

## Metadata

- **Type**: FEAT (데이터 인프라)
- **Severity**: major
- **Layer**: infra(수집 스크립트) + adapter(검색 경로) + docs
- **Milestone**: Post-MVP (Phase 6B/7 데이터 인프라)
- **Estimated Size**: L (스크립트 신규 + 검색 배선 + 문서 — 분할 필수, §9 참조)

---

## 0. ⚡ 전제 변천사 (2회 뒤집힘) — 이 티켓의 최종 경로 확정

이 티켓의 본문 확보 경로는 두 번 바뀌었다. 최종 결론은 **taxlaw.nts.go.kr 크롤링**이다.

| 시점 | 판정 | 근거 |
|---|---|---|
| 2026-06-22 | "ntsCgmExpc 본문 API 없음" | 운영키로 lawService.do가 목록만 반환 |
| 2026-07-08 오전 | "공식 본문 API 있음" (스크래핑 폐기) | **공개 테스트키(OC=data)** 로 `lawService.do?target=ntsCgmExpc&type=XML` 12/12 성공 |
| **2026-07-08 오후 (최종)** | **공식 API는 우리 키로 사용 불가 → 크롤링으로 확정** | **운영키 본문 권한 🔒 미신청 + 신청 자체가 막힘**(회계사 확인). 목록은 운영키로 정상, 본문만 막힘 |

**왜 공식 API를 못 쓰나:** 공식 본문 XML API는 **존재하고 작동**하지만(테스트키로 증명), 그 권한이 **공개 데모키(OC=data)에만** 열려 있다. 운영키(`NATIONAL_TAX_API_KEY`)로는 본문 호출 시 "OPEN API 미신청" HTML이 오고, open.law.go.kr에서 **해당 본문 권한을 신청하는 것 자체가 막혀** 있다(회계사 실측). 데모키로 136,280건을 대량 수집하는 것은 남용이라 운영에 쓸 수 없다. → **공식 API 경로는 폐기(단, 향후 권한이 열리면 우선 전환 — §8).**

**대신 크롤링이 실전 검증된 길임을 확인:** 외부 오픈소스 **`korean-law-mcp`**(작성자 chrisryugj, 로컬: `C:\Users\sfami\WorkSpace\korean-law-mcp-main`)가 **동일한 문제**를 만나 동일 해법을 실전 구현해 두었다.
- `src/tools/customs-interpretations.ts:136~151` — 이 MCP도 **국세청 법령해석(ntsCgmExpc)** 은 "법제처 OPEN API 본문 미지원"으로 판정(우리와 동일 결론).
- `src/tools/precedents.ts` — **판례**에 대해 법제처 JSON 본문이 비면 **taxlaw.nts.go.kr HTML로 자동 보강**하는 fallback을 구현(우리 경로 C 프로브 15/15와 완전히 같은 `/action.do` 방식). 이 티켓은 이 패턴을 **세법해석례로 이식**한다.

**⚠️ 함정 (구현 시 반드시 반영):**

1. **본문 회신문 위치** — taxlaw `/action.do` 응답에서 회신은 `ntstDcmCntn`, 요지는 `ntstDcmGistCntn`, 전문(HWP→HTML)은 `dcmHwpEditorDVOList[].dcmFleByte`. **어느 필드가 실질 본문인지 20-A에서 표본으로 확정**(판례에선 HWP가 본문, 회신 필드가 짧은 사례가 있어 MCP는 HWP 우선).
2. **빈 응답(HTTP 200 + 알맹이 없음)** — "내용없음/본문없음/조회된내용이없습니다/자료가없습니다"이거나 20자 미만이면 본문 없음으로 처리해야 오적재를 막는다(MCP `hasSubstantiveTaxlawBody`, `precedents.ts:206`).

**ID 주의 (2종 구분):**

| ID | 출처 | 용도 |
|---|---|---|
| `법령해석일련번호` (예: 83626) | 목록 응답 필드 | 공식 lawService.do API용 (지금은 봉쇄) |
| `ntstDcmId` (18자리) | 목록 응답 `법령해석상세링크` URL의 `ntstDcmId=` | **taxlaw `/action.do` 크롤링용 — 이 티켓이 쓰는 값** |

> **핵심:** 판례(precedents.ts)는 taxlaw ntstDcmId를 얻으려 law.go.kr HTML→iframe→리다이렉트 체인을 3단계 거친다. 그러나 **세법해석례는 목록 응답의 `법령해석상세링크`에 `ntstDcmId`가 이미 노출**되어(우리 프로브가 `ntstDcmId=(\w+)` 정규식으로 추출해 15/15 성공) **iframe 체인이 통째로 불필요**하다. 목록 1콜 → 본문 1콜로 끝난다.

---

## 1. Problem (문제 정의)

### 1.1 현재 동작 (TAX-6B-19 직후)

- 국세청 세법해석례(`ntsCgmExpc`)는 **목록만 조회**해 `content=''`로 참고 목록(references)에만 노출.
  - `searchNtsInterpretations()` (nationalTaxLaw.ts:923) — 본문 미조회, 발췌 인용·V검증 비대상.
  - 검색은 **제목 키워드 매칭** 후 상위 N건만 노출 → 표현 변이·동의어에 취약.
- 심판례(`ttSpecialDecc`)·판례(`prec`)는 pgvector에 적재돼 **의미(semantic) 검색**이 가능(TAX-6B-18/16).
  → 같은 T3 비법령인데 해석례만 의미 검색 사각지대.

### 1.2 기대 동작

- 국세청 세법해석례 본문(136,280건)을 taxlaw 크롤링으로 확보해 pgvector에 적재 → **의미 검색**으로 참고 목록 정확도 향상.
- 심판례(TAX-6B-18)와 **동일한 수집→임베딩→검색 배선** 패턴으로 통일(본문 확보 방식만 크롤링).

### 1.3 영향·중요도

- 법인세 실무(가지급금·부당행위계산부인 등) 핵심 쟁점이 국세청 해석례에 다수 → 참고 목록 정확도 직결.
- ntsCgmExpc는 **세법 전용**이라 expc(법제처, 전 분야)와 달리 노이즈가 없음 → 의미 검색 품질 유리.

---

## 2. Context (기술적 맥락)

### 2.1 소스 규모·성격

| 항목 | 값 |
|---|---|
| target(목록) | `ntsCgmExpc` (국세청 법령해석) via `lawSearch.do` |
| 본문 소스 | `taxlaw.nts.go.kr/action.do` (actionId=`ASIQTB002PR01`) |
| 전체 규모 | **136,280건** (세법 전용, 법인세 6,372건 등) |
| Trust Tier | **T3** (CLAUDE.md §6.2) |
| sourceType | `해석례` (expc와 동일 값, `issuingBody='국세청'`으로 구분) |
| 저장 용량 | 심판례(~3GB)보다 작을 전망 — 해석례 본문은 수십~수백자 수준 |

> ⚠️ **정정 주석 (2026-07-13, TAX-6B-20-D)**: 위 "해석례 본문은 수십~수백자 수준"이라는 전제는
> 실측으로 뒤집혔다. TAX-6B-20-A 방안②(HWP 전문 결합) 채택 후 실측 평균은 **1,869자**, 최장은
> **32,991자**다(TAX-6B-20-B §0.1·리포트). 이 전제 뒤집힘 때문에 20-B에서 `MAX_CONTENT_CHARS`를
> 6,000자 → 30,000자로 상향했다. 원문은 역사 기록 보존을 위해 위 표 값을 그대로 둔다.

### 2.2 데이터 경로 (실호출 확정)

```
[1] 목록 (운영키 사용 — 목록 권한 정상):
    GET lawSearch.do?OC={운영키}&target=ntsCgmExpc&type=JSON&display=100&page={n}
    → CgmExpc.cgmExpc[] : {안건명, 안건번호, 해석일자, 법령해석일련번호, 법령해석상세링크}
    → 법령해석상세링크에서 ntstDcmId 추출 (정규식 /ntstDcmId=(\w+)/)

[2] 본문 (키 불필요 — 크롤링):
    POST https://taxlaw.nts.go.kr/action.do
      body: actionId=ASIQTB002PR01 & paramData={"dcmDVO":{"ntstDcmId":"{ntstDcmId}"}}
      headers: content-type=application/x-www-form-urlencoded,
               origin=https://taxlaw.nts.go.kr, referer={상세링크}, x-requested-with=XMLHttpRequest
    → JSON: data.ASIQTB002PR01.dcmDVO = {ntstDcmTtl, ntstDcmGistCntn(요지), ntstDcmCntn(회신), ...}
            + dcmHwpEditorDVOList[].dcmFleByte (HWP→HTML 전문)
```

### 2.3 재사용 자산

**심판례 TAX-6B-18 패턴 (수집 골격):**

| 파일 | 재사용 방식 |
|---|---|
| `scripts/collectTribunal.ts` | **구조 템플릿**(목록→본문 resume→finalize, runPool·checkpoint·scrubOc). 본문 조회부만 taxlaw 크롤링으로 교체 |
| `scripts/embed.ts` | **무변경 재사용** — `npm run embed -- --input {산출물}` (voyage-4, content_hash dedup) |
| `scripts/embedQuality.ts` | **재사용** — caseNumber 중복·누락 게이트(적재 전 차단) |
| `src/adapters/vectorSearch.ts` | **무변경** — `searchSimilar(vec, topK, '해석례')`가 이미 sourceType 필터 지원(TAX-6B-14) |
| `src/usecases/generateAnswer.ts` | `VECTOR_REFERENCE_GATES`(67행)에 해석례 엔트리 **1줄 추가**(타입 확장) |

**korean-law-mcp 크롤링 패턴 (본문 회수 — 로컬 `korean-law-mcp-main`에서 이식):**

| 자산 | 위치 | 이식 방식 |
|---|---|---|
| `fetchTaxlawAction` | `src/tools/precedents.ts:271` | action.do 호출 규격(actionId·paramData·헤더) **참고 이식** |
| `extractTaxlawBody` / `extractTaxlawEditorBody` | `precedents.ts:218~235` | HWP전문 우선 → `ntstDcmCntn` 폴백 로직 **참고** |
| `hasSubstantiveTaxlawBody` | `precedents.ts:206` | 빈본문(20자 미만·"내용없음"류) 가드 **이식** |
| `external-https-proxy.ts` | `src/lib/external-https-proxy.ts` | 사내망 SSL inspection 대비 프록시·TLS 옵션(선택) |
| `fetch-with-retry.ts` | `src/lib/fetch-with-retry.ts` | 대량·장시간 수집 재시도(우리 `withRetry`와 정합) |

> ⚠️ **그대로 복사 금지 부분:** MCP의 `normalizeHtmlText`/`cleanHtml`(`precedents.ts:~196`)은 **화면 표시용 HTML 가공**(태그 제거·공백 정돈)이다. §6.1 저장 정책은 §4.3에서 별도로 정한다.

### 2.4 선행 게이트 (크롤링 경로에서는 대부분 해소됨)

- ✅ **목록 API** — 운영키로 정상 작동(권한 있음). 본문 권한 미신청과 무관.
- ✅ **본문 크롤링** — taxlaw `/action.do`는 **키·쿠키·워밍업 불필요**(프로브 15/15). 게이트 없음.
- ⚠️ **남은 확인(회계사·20-A 착수 전):**
  - (1) 회계사망(사내 프록시/SSL inspection)에서 taxlaw.nts.go.kr 직접 POST가 되는지 1건 확인. 막히면 `external-https-proxy` 옵션 사용.
  - (2) `taxlaw.nts.go.kr/robots.txt` 재확인 — 현재 `Disallow`는 `/is/USEISA001M.do`·`/is/USEISA003M.do` 2개뿐, `/action.do`는 비대상. 대량 수집이므로 **throttle·야간·동시성 상한 준수**(§7).

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경 (단계별, §9 분할대로)

- [x] (20-A) `scripts/collectNtsInterpretations.ts` 신규 — 목록 전수(ntstDcmId 추출) → **taxlaw 크롤링** 본문 수집(resume) → finalize
- [x] (20-B) 임베딩 적재 — `embed.ts` 재사용(무변경), `embedQuality` 게이트 통과 후 pgvector 적재 — 실제로는 `sanitizeDate` 등 국소 보강 후 135,907건 실적재 완료(2026-07-12)
- [x] (20-C) 검색 배선 — `generateAnswer.ts` `VECTOR_REFERENCE_GATES`에 `해석례` 엔트리 추가(타입 확장)
- [x] (20-D) 문서 정합 — SSOT/PRD/CLAUDE.md + TAX-6B-19의 "본문 API 없음" 기록 정정 (2026-07-13)

### 3.2 금지되는 변경

- ❌ 본문(회신·요지·전문) 임의 요약·의역 저장 (§6.1 — 원문 보존; 저장 형태는 §4.3 결정 따름)
- ❌ V1~V6 검증 로직 변경 (§6.4). 해석례 벡터는 **참고 목록(references)** 트랙 — **발췌 인용·citation 승격 금지**
- ❌ Usecase에서 fetch/DB 직접 호출 (Port만)
- ❌ API 키(OC)·`DATABASE_URL`을 로그·sourceUrl·에러에 노출 (scrubOc 적용)
- ❌ **실시간 어댑터(`searchNtsInterpretations`)에 본문 크롤링 N+1 부활** — content='' 유지(P95 보호). 본문은 오프라인 코퍼스 전용
- ❌ 한 번에 전량(136,280건) 무제한·고동시성 크롤링 (throttle·resume·checkpoint·동시성 상한 필수 — §7)

---

## 4. Strategy — taxlaw 크롤링 단일 경로 (2026-07-08 최종 재설계)

> 이전 재설계(공식 API 단일 경로)는 운영키 권한 봉쇄로 **폐기.** 본문은 taxlaw.nts.go.kr 크롤링으로
> 확보하되, 심판례와 동일한 수집→임베딩→검색 골격은 그대로 유지한다.

### 4.1 수집기 구조 (collectTribunal.ts 미러링 + 본문부 크롤링 교체)

1. **1단계 목록** — `lawSearch.do?target=ntsCgmExpc&display=100&page=n` 전수 페이징 →
   각 항목에서 `{법령해석일련번호, 안건번호, 안건명, 해석일자}` + **`법령해석상세링크`에서 `ntstDcmId` 추출** →
   `scripts/ntsExpc/list.json`에 저장(resume). ntstDcmId 추출 실패 항목은 별도 로깅(스킵 집계).
2. **2단계 본문** — 각 `ntstDcmId`로 `taxlaw.nts.go.kr/action.do` POST(§2.2) →
   `dcmDVO`에서 회신·요지·전문 회수(§4.2) → `hasSubstantiveTaxlawBody` 통과분만 `records.jsonl`에 append(resume 안전).
3. **3단계 finalize** — `records.jsonl` → `scripts/ntsExpc_full.json`(TaxLaw[]) → `embedQuality` 게이트 → embed 입력.

> **본문 조회부를 함수로 분리**한다(`fetchBody(ntstDcmId) → BodyResult`). 향후 공식 API 권한이 열리면
> 이 함수만 lawService.do(XML)로 교체하면 되도록 **경로 교체 가능한 구조**로 설계(§8).

### 4.2 본문 회수 (korean-law-mcp 패턴 이식)

- action.do 호출 규격은 `precedents.ts:271`(`fetchTaxlawAction`)을 따른다(actionId·paramData·origin/referer/x-requested-with 헤더).
- 응답 `data.ASIQTB002PR01.dcmDVO`에서 회수:
  - `ntstDcmTtl`(제목), `ntstDcmGistCntn`(요지), `ntstDcmCntn`(회신), `dcmHwpEditorDVOList[].dcmFleByte`(HWP→HTML 전문).
- **실질 본문 필드 확정은 20-A 표본 조사로** — 표본 N건에서 `ntstDcmCntn`(회신)만으로 실질 회신문이 충분한지, 아니면 HWP전문이 필요한지 판정(판례에선 HWP가 본문인 사례 존재).
- **빈본문 가드**(`hasSubstantiveTaxlawBody`) 필수 — 200 OK인데 알맹이 없는 항목 스킵.
- `fetchBody`는 **순수 함수 parseBody(actionJson)로 분리** → vitest 단위 테스트(실제 응답 fixture 대조).

### 4.3 §6.1 저장 형태 — 회계사 결정 필요 (핵심)

> **참고 목록(references) 트랙 특성:** 이 코퍼스는 **의미 검색 매칭에만** 쓰이고, 답변에 **발췌 인용되지 않는다**
> (§6.4·§3.2 — references는 V1~V6 비대상·인용 승격 금지). 사용자에겐 제목+링크만 노출된다.
> 따라서 "원문 문자 단위 인용"의 대상이 아니며, §6.1 리스크는 **저장 텍스트가 원문을 왜곡하지 않는 것**에 한정된다.

**두 가지 저장 방식 중 결정 (추천안 먼저):**

| 방안 | 장점(한 줄) | 단점(한 줄) |
|---|---|---|
| **① 평문 필드만 저장 (추천)** | `ntstDcmCntn`·`ntstDcmGistCntn`은 이미 평문 → HTML 가공 0, 왜곡 리스크 0 | 회신 필드가 짧은 사례에선 본문 정보량이 적을 수 있음 |
| **② HWP전문까지 포함(태그 제거 정규화)** | 전문 확보로 의미 검색 재현율↑ | HTML→text 정규화가 원문을 손대므로 §6.1 보수적 원칙과 마찰(references라 인용은 안 하지만) |

> 추천: **①로 시작**하고, 20-A 표본에서 회신 필드가 빈약하다고 확인되면 ②를 **원문 HTML은 raw로 별도 보관 + 임베딩은 정규화 텍스트** 방식으로 승격. 회계사가 20-A 착수 전 택1.

### 4.4 매핑 (기존 `toNtsInterpretationTaxLaw` 규칙 재사용)

- `sourceType='해석례'`, `trustTier='T3'`, `issuingBody='국세청'`, `caseNumber=안건번호`,
  `articleTitle=안건명`, `decisionDate=해석일자(ISO)`, `sourceUrl=법령해석상세링크`(키 미포함 공개 링크).
- 차이는 **content만** 채워진다는 점(실시간 어댑터는 여전히 content='').

---

## 5. Acceptance Criteria (단계별)

**20-A (수집기):**
1. [x] 목록 전수 페이징이 totalCnt(≈136,280)까지 안정 수집, `--list-only`로 연결·ntstDcmId 추출률 확인 가능
2. [x] 본문 크롤링에서 회신·요지(·필요 시 전문)가 §4.3 결정대로 회수됨, `hasSubstantiveTaxlawBody`로 빈본문 스킵, scrubOc로 키·URL 미노출
3. [x] resume(records.jsonl append) 동작 — 중단 후 재실행 시 미완료 ntstDcmId만 이어받음
4. [x] throttle·동시성 상한 적용(§7), finalize 시 `embedQuality` 게이트(caseNumber 중복·누락) 리포트
5. [x] 순수 함수(parseListPage·extractNtstDcmId·parseBody·mapToTaxLaw)에 vitest 단위 테스트 추가, 전건 그린

**20-B (임베딩 적재):**
6. [x] `npm run embed -- --input scripts/ntsExpc_full.json` 실행, content 보유분만 적재 — `sanitizeDate` 등 국소 보강 후 135,907건 실적재(2026-07-12)
7. [x] pgvector에 `source_type='해석례'`(issuingBody='국세청') 행 적재 확인(smokeVector)

**20-C (검색 배선):**
8. [x] `VECTOR_REFERENCE_GATES`에 `해석례` 엔트리 추가(타입 `'판례'|'심판례'` → `'판례'|'심판례'|'해석례'` 확장)
9. [x] 해석례 의미 검색이 참고 목록에 합류, 보수적 게이트(minSimilarity·max) 적용, 실패 시 조용히 폴백 — 라이브 검증 PASS(2026-07-12)
10. [x] `npm run typecheck` 0에러, vitest 전건 통과 — **단, P95 합격선(15s)은 미달**(25.37s 실측, 주원인은 이 티켓과 무관한 기존 LLM tail, 회계사 결정으로 기록만 하고 종료. 상세 `docs/reports/TAX-6B-20-C_report.md`)

**20-D (문서):**
11. [x] SSOT/PRD/CLAUDE.md에 국세청 해석례 본문 **크롤링 확보**·벡터 적재 정책 명문화(공식 API 봉쇄 경위 포함) (2026-07-13)
12. [x] TAX-6B-19 티켓·리포트·본 티켓 §2.1의 "본문 없음"류 기록을 정정 주석(원문 보존 방식)으로 정정 (2026-07-13)

---

## 6. Verification (회계사 확인 순서)

1. (완료) 공식 본문 API는 테스트키 12/12 작동하나 **운영키 미신청·신청 봉쇄 확정** → 크롤링 경로로 전환.
2. 회계사망에서 taxlaw `/action.do` 1건 POST 성공 확인(사내 프록시 필요 여부 판단, §2.4).
3. 수집기 `--list-only` → 목록 totalCnt·ntstDcmId 추출률 로그 확인(실적재 전).
4. 본문 샘플 3건을 taxlaw.nts.go.kr 실제 페이지와 육안 대조(회수 텍스트가 원문과 부합하는지).
5. 소량(`--max 200`) 수집 → embed → `npm run dev`에서 해석례 키워드 검색 시 의미 검색 결과·링크 정상.
6. 전량 적재 후 P95·정확도 회귀 확인(회계사 판단 — 심판례 TAX-6B-18은 정확도>속도로 P95 재측정 생략한 선례 있음).

---

## 7. Risks / Notes

- ⚠️ **비공식 엔드포인트 변경 위험**: `/action.do`·actionId·필드명은 taxlaw 내부 규격이라 예고 없이 바뀔 수 있음. parseBody를 순수 함수로 격리해 변경 시 국소 수정. 공식 API 권한이 열리면 즉시 전환(§8).
- ⚠️ **대량 크롤링 매너/부하**: 136K POST는 서버 부하 유발 가능 → **동시성 상한(예: 3~5)·요청 간 지연·야간 수행·resume**로 완만하게. robots.txt 준수(§2.4). 실패 급증 시 자동 backoff.
- ⚠️ **§6.1 저장 형태**: §4.3 결정 준수. references 트랙이라 발췌 인용은 없으나, 저장 텍스트가 원문을 왜곡하지 않도록(특히 방안 ② 정규화 시 raw 병행 보관).
- ⚠️ **빈본문 함정**: 200 OK + 알맹이 없음을 본문으로 오적재하지 말 것(`hasSubstantiveTaxlawBody`).
- ⚠️ **caseNumber 품질**: 안건번호가 식별자(V1). 심판례처럼 중복 가능성 → embedQuality 게이트가 방어.
- ⚠️ **사내망 TLS**: SSL inspection 환경이면 `external-https-proxy` 옵션 필요(진단용 `TLS_REJECT_UNAUTHORIZED`는 운영 금지).
- ℹ️ **sourceType 공유**: expc(법제처)도 '해석례'지만 expc는 코퍼스 미적재(목록만)라 벡터 검색엔 국세청 해석만 존재.
- ℹ️ **실시간 P95 안전**: 어댑터는 content='' 유지 → 실시간 크롤링 N+1 부활 없음. 본문은 오프라인 코퍼스 전용(TAX-6B-19 설계 계승).

---

## 8. 공식 API 경로 (봉쇄 — 향후 권한 시 우선 전환)

공식 본문 API는 **존재하고 작동**한다(테스트키 12/12): `lawService.do?target=ntsCgmExpc&ID={법령해석일련번호}&type=XML` → `<CgmExpcService>`(질의요지·회답·이유·관련법령, XML CDATA). 다만 운영키 본문 권한이 미신청이고 신청이 봉쇄돼 지금은 못 쓴다.

- **회계사가 open.law.go.kr에서 ntsCgmExpc 본문 권한을 확보하면** 이 XML 경로가 크롤링보다 우월(공식·안정·구조화). 그때는 20-A의 `fetchBody`만 lawService.do(XML, `fast-xml-parser`)로 교체하면 된다(§4.1의 교체 가능 설계).
- 재확인 명령: `node --env-file=.env.local scripts/diagnostics/probe-operational-key.mjs` → `✅ OK`면 공식 경로 승격 검토.
- XML 파싱 결정(권한 확보 시): `fast-xml-parser`(CDATA·중첩 안전 처리, 정규식 대비 엣지케이스 방어).

---

## 9. 티켓 분할 (L 크기 → 4개)

- **TAX-6B-20-A**: `scripts/collectNtsInterpretations.ts` 신규 — 목록 전수(ntstDcmId 추출) + **taxlaw 크롤링** 본문 수집(resume) + finalize ⭐ 먼저
- **TAX-6B-20-B**: 임베딩 적재 — `embed.ts` 재사용(무변경) + `embedQuality` 게이트
- **TAX-6B-20-C**: 검색 배선 — `generateAnswer.ts` `VECTOR_REFERENCE_GATES` 해석례 엔트리 추가(타입 확장)
- **TAX-6B-20-D**: SSOT/PRD/CLAUDE.md 정합 + TAX-6B-19·메모리 "본문 없음" 기록 정정

> 순서: **20-A 먼저 단독 머지**(수집·검증) → 20-B → 20-C → 20-D. 1티켓=1논리변경(§8.2).

---

## 10. Related Tickets / References

- 형제(같은 적재 패턴): **TAX-6B-18**(심판례 전량 적재 — 수집 골격 템플릿), TAX-6B-16(판례 전량), TAX-6B-15(voyage-4)
- 선행: TAX-6B-19(해석례 목록 전용 — 이 티켓이 "본문 없음" 전제를 정정), TAX-016B(ntsCgmExpc 목록 도입)
- 외부 참고 구현: **`korean-law-mcp`**(로컬 `C:\Users\sfami\WorkSpace\korean-law-mcp-main`) — `src/tools/precedents.ts`(taxlaw fallback), `src/tools/customs-interpretations.ts`(ntsCgmExpc 본문 미지원 판정), `src/lib/external-https-proxy.ts`
- 참조 메모리: `project_nonlaw_interp_tracks`(2026-07-08 재검증), `project_tax6b18_tribunal_full_load`

---

## 11. Report Link

Report: `docs/reports/TAX-6B-20_report.md` (미작성 — 구현 후 작성 + ROADMAP §3 갱신)

---

**작성자**: AI (회계사 조사 의뢰)
**작성일**: 2026-06-22
**최종 수정일**: 2026-07-08 — 운영키 본문 권한 봉쇄 확인으로 공식 API 경로 폐기, **taxlaw.nts.go.kr 크롤링 경로(korean-law-mcp 패턴 이식)로 최종 재설계**. 공식 API는 §8에 향후 전환용으로 보존.
