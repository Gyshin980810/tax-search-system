# [TAX-6B-36] 판례 수집기 — 인용 원천 필드 보존 (참조판례·판례내용)

> 회계사 승인·즉시 착수 (2026-07-06): "그래프 엣지 설계 분석" 보고에 대해 "티켓에 반영해두고
> 수집기 확장도 진행하자"로 승인. 별도 계획 승인 라운드 없이 본 분석을 계획서로 갈음한다.

---

## Metadata

- **Type**: FEAT (수집기 확장, 데이터 보존만)
- **Severity**: minor
- **Layer**: infra (scripts)
- **Milestone**: Post-MVP (Phase 6B) — TAX-6B-31 선행 준비
- **Estimated Size**: S (1파일 + 테스트)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- `scripts/collectPrecedent.ts`의 `parsePrecBody`는 본문 API 응답(`PrecService`)에서
  **판시사항·판결요지만** 취해 `TaxLaw.content`(검색·답변용)로 저장하고, 나머지 필드는 버린다.
- 그런데 같은 응답에는 인용 그래프(TAX-6B-31)에 쓸 수 있는 구조화 필드가 이미 들어있다:
  - **`참조판례`** — 대법원 판례에 존재, "법원명 + 선고일 + 사건번호"가 정리된 인용 목록(정규식보다 정밀, 날짜 대조 가능).
  - **`판례내용`** — 판결 전문(하급심도 보유). API 본문(판시사항+판결요지)의 인용 밀도는
    **0.2%(8,366건 중 19건)**로 사실상 무용하지만, 판례내용 전문에는 문서당 평균 ~4건의
    인용이 들어있다(2026-07-06 실측: 광주고법 2024누11197 전문 7,851자·인용 4건 등).
- 즉, 지금 방식으로 수집한 신규 판례 1만여 건은 **거의 전부가 인용 그래프에서 고립**된다.

### 1.2 기대 동작

- 본문 조회 시 이미 받아온 같은 JSON 응답에서 `참조판례`·`판례내용`도 함께 파싱해
  **별도 산출 파일**(`precedent_citation_source_<date>.json`)로 저장한다.
- **추가 API 호출 0건** — 이미 호출 중인 `bodyUrl` 응답을 재사용만 한다(과금·요청 수 불변).
- `TaxLaw.content`(검색·답변 경로, §6.1 대상)는 **완전히 그대로 유지** — 이 필드들은
  검색·답변 파이프라인에 노출되지 않는, TAX-6B-31 인용 엣지 추출 전용 원천이다.

### 1.3 영향·중요도

- TAX-6B-31(엣지 적재)이 신규 수집 판례에서도 엣지를 뽑을 수 있게 하는 **전제 데이터**.
- 대법원은 `참조판례`(구조화·고정밀), 하급심은 `판례내용`(전문·정규식 보완)으로 이원화해
  엣지 원천을 확보한다.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `scripts/collectPrecedent.ts` — `parsePrecBody`(기존, 무변경) 옆에 파서 2개 추가,
  `main()`의 본문 조회 지점에서 같은 응답을 재사용.
- `src/domain/TaxLaw.ts` — **무변경**. 이 필드들은 TaxLaw 그릇에 담지 않는다(§6.1 content 의미
  오염 방지 + 기존 임베딩·검색·답변 경로 무회귀 보장).
- `tests/unit/collectPrecedent.test.ts` — 신규 파서 테스트 추가.

### 2.2 왜 TaxLaw에 안 담고 별도 파일인가

- `TaxLaw.content`는 "검색·답변에 노출되는 원문"이라는 명확한 계약이 있고(§6.1),
  기존 vitest·embed.ts·law-verifier가 전부 이 계약을 전제로 짜여 있다.
- 참조판례·판례내용을 content에 섞으면 임베딩 텍스트가 오염되고, 계약을 어기면서까지
  얻는 이득이 없다(엣지 추출은 오프라인 배치이므로 별도 파일로 충분).

---

## 3. Scope (작업 범위) ⭐

### 3.1 허용되는 변경

- [ ] `scripts/collectPrecedent.ts`
  - `parsePrecReferencedCases(json): string` 추가 — `PrecService.참조판례` 원문 그대로(trim만)
  - `parsePrecFullContent(json): string` 추가 — `PrecService.판례내용` 원문 그대로(trim만)
  - `PrecCitationSource` 인터페이스 추가 (`caseNumber`, `referencedCases`, `fullContent`)
  - `main()`: 본문 조회 콜백에서 같은 응답으로 위 2개 필드도 파싱 → 둘 중 하나라도 있으면 배열에 push
  - 실행 종료 시 `precedent_citation_source_<date>.json` 기록(둘 다 빈 문자열인 항목은 제외,
    비어 있으면 파일 자체를 쓰지 않음)
- [ ] `tests/unit/collectPrecedent.test.ts` — 신규 파서 단위 테스트

### 3.2 금지되는 변경

- ❌ `parsePrecBody`·`mapPrecedentToTaxLaw`·`TaxLaw` 스키마 — 기존 검색·답변 경로 무변경
- ❌ 추가 API 호출 (같은 응답 재사용만)
- ❌ `citation_edges` 적재·그래프 로직 (TAX-6B-31 담당)
- ❌ `--all`/`--max`/증분 로직 자체의 판정 흐름 변경

---

## 4. Acceptance Criteria

1. [ ] `parsePrecReferencedCases`/`parsePrecFullContent`가 필드 유무에 관계없이 안전하게 동작(누락 시 빈 문자열)
2. [ ] 추출값이 원문과 문자 단위 일치(trim 외 가공 없음, §6.1 원칙 준용)
3. [ ] 기존 `parsePrecBody`·`mapPrecedentToTaxLaw` 테스트 무회귀
4. [ ] 실행 시 API 호출 횟수 불변(본문 조회 1콜을 2번 파싱만 함)
5. [ ] `npm run test` 전체 GREEN, `tsc` 오류 0

---

## 5. Verification

1. `npm run collect:precedent -- --max 5` (소규모 테스트) → `precedent_citation_source_<date>.json` 생성 확인
2. 산출물 표본 1~2건이 원문 API 응답과 문자 단위 일치하는지 육안 대조
3. 기존 `precedent_incremental_<date>.json` 산출물 포맷·내용 무변화 확인

---

## 6. Related Tickets

- 후속(소비자): `TAX-6B-31_citation_edges_load.md` §2.4(실측 보강)에서 이 산출물을 엣지 원천으로 사용
- 배경: 그래프 엣지 설계 분석(2026-07-06, Claude Fable 5 → Sonnet 5 인계)

## 7. Report Link

Report: `docs/reports/TAX-6B-36_report.md` (구현 후 작성)

---

**작성자**: Claude Sonnet 5 / 승인: 회계사 (2026-07-06, 대화 중 즉시 승인)
**작성일**: 2026-07-06
