# TAX-6B-20-A 리포트 — 국세청 세법해석례 본문 수집기(taxlaw 크롤링)

> 상위 티켓: `docs/tickets/TAX-6B-20_interpretation_corpus_load.md`
> 범위: 임베딩·DB 적재가 아니라, `ntsCgmExpc` 목록(운영키) + taxlaw.nts.go.kr 크롤링(키 불필요)으로
> 본문을 확보해 로컬 `TaxLaw[]` 파일로 수집하는 1회성 수집기 구현(20-B~D는 별도 후속).

---

## 1. 변경 사항 요약

**파일 변경 목록:**
- `scripts/collectNtsInterpretations.ts` (신규) — 국세청 세법해석례 목록·본문(taxlaw 크롤링) 수집기
- `tests/unit/collectNtsInterpretations.test.ts` (신규) — 수집기 순수 함수 단위 테스트(21건)
- `package.json` (수정) — `collect:nts-interp` 스크립트 추가
- `.gitignore` (수정) — `scripts/ntsExpc_full.json`, `scripts/ntsExpc/` 대용량 산출물 제외

**주요 변경:**
- `collectTribunal.ts`를 구조 템플릿으로 삼아 3단계(목록 → 본문 resume → finalize) 골격을 그대로 이식했다(`fetchJsonWithRetry`·`runPool`·`scrubOc`·`toIsoDateLoose`·`findDuplicateCaseNumbers`는 재사용, import).
- **목록**: `lawSearch.do?target=ntsCgmExpc`(운영키 필요, 정상 작동)에서 안건번호·안건명·해석일자·`법령해석상세링크`를 수집하고, 상세링크에서 정규식 `ntstDcmId=(\w+)`로 taxlaw 크롤링용 ID를 추출한다. 세법해석례는 판례와 달리 iframe 리다이렉트 체인 없이 목록 1콜로 이 ID를 바로 얻는다(티켓 §0 핵심 발견).
- **본문**: `taxlaw.nts.go.kr/action.do`(actionId=`ASIQTB002PR01`)를 POST로 호출한다. 키·쿠키·워밍업이 전혀 필요 없음을 이번에도 실측 확인했다(아래 §2 라이브 스모크).
- **§4.3 저장 형태**: 티켓이 제시한 두 방안 중 **방안①(추천안 — 평문 필드만)** 을 채택했다. `dcmDVO.ntstDcmGistCntn`(요지)+`ntstDcmCntn`(회신)만 원문 그대로 결합해 저장하고, HWP 전문(`dcmHwpEditorDVOList`)은 이번 단계에 포함하지 않았다. 두 필드 모두 이미 평문이라 HTML 가공(§6.1 왜곡 리스크)이 전혀 없다. 둘이 완전히 같은 경우(공식 API의 회답==질의요지 중복 사례를 참고한 방어)만 한 번만 결합한다.
- **빈본문 가드**: korean-law-mcp `precedents.ts:206`의 `hasSubstantiveTaxlawBody`(20자 미만 또는 "내용없음"류 문구)를 그대로 이식했다.
- **§6.1 원문 보존 세부 수정**: 최초 구현에서 요지·회신 필드를 각각 `.trim()`한 뒤 결합했는데, 이는 필드 내부(중간)에 있는 원문 공백까지 지우는 게 아니라 필드 앞뒤 공백만 지우는 것이지만, 실제 API 응답에 앞에 공백이 붙은 필드가 있어(예: `" 귀 질의의 경우..."`) 그 공백이 사라지는 문제가 있었다. `collectTribunal.parseBody`(주문+재결요지+이유 결합)와 동일한 관례로 맞춰 **개별 필드는 원문 그대로 두고 전체 결합 후에만 trim**하도록 고쳤다(§6.1 "문자 단위 일치" 원칙에 더 충실).
- `sourceUrl`은 목록 API가 이미 제공하는 키 없는 taxlaw 공개 링크(`법령해석상세링크`)를 그대로 쓴다(어댑터 `toNtsExpcSourceUrl`과 동일 로직을 국소 함수로 복제 — 실시간 어댑터는 건드리지 않음, §3.2 금지 규칙 준수).
- **매너 크롤링 강화(소량 실측 사고 대응)**: 최초 구현은 `DEFAULT_CONCURRENCY=5`·요청 간 지연 없음이었다. `--max 200` 소량 실측을 돌리자 약 **124건 연속 요청 후 taxlaw WAF가 우리 IP를 L7에서 침묵 차단**(응답 자체가 끊김)했다. 재발 방지를 위해 ① 동시성 기본값 5→**2** 하향, ② 요청 간 **0.5초 지연**(`REQUEST_DELAY_MS`), ③ 브라우저형 **User-Agent** 부착(봇 오탐 완화), ④ **연속 10건 실패 시 즉시 중단**(circuit breaker `CONSECUTIVE_FAIL_LIMIT` — 차단 연장·헛수고 방지)을 추가했다. 기존 resume 설계 덕분에 차단당해도 재실행하면 `records.jsonl` 기준으로 이어받는다.

---

## 2. 검증 결과

1. `npx vitest run tests/unit/collectNtsInterpretations.test.ts` — PASS, 21/21
2. `npm run typecheck` — PASS (0 에러)
3. `npx vitest run` (전체 회귀) — PASS, 795/795 (52개 파일)
4. **라이브 스모크(실제 외부 호출, 키 불필요·공개 테스트키만 사용)**:
   - `fetchTaxlawAction('010000000000100201')` → 실제 taxlaw.nts.go.kr 서버 응답 수신 성공
   - `parseActionBody(...)` → 본문 167자 정상 추출("1986 사업연도분 가지급금 적수계산 시 …")
   - `hasSubstantiveTaxlawBody(...)` → `true` (빈본문 아님 정상 판정)
   - 목록 API(`OC=data` 공개 테스트키) → `totalCnt: 342`(질의 "가지급금") 정상 수신
   - 위 라이브 스모크는 임시 파일(`scripts/_smoke_tmp_20a.ts`)로 실행 후 즉시 삭제, 커밋 대상 아님
5. **`--max 200` 소량 실측(실 크롤링)에서 WAF 차단 재현 → 매너 크롤링 강화**:
   - 최초 설정(동시성 5·무지연)으로 실행 시 약 124건 후 IP 침묵 차단을 실제로 겪음(`scripts/ntsExpc/records.jsonl`에 124건 잔존 — gitignore 대상, 커밋 제외).
   - 매너 크롤링 강화(동시성 2·지연 0.5초·User-Agent·circuit breaker) 후 `npx tsc --noEmit` PASS(0 에러), `npx vitest run tests/unit/collectNtsInterpretations.test.ts` 21/21 PASS(순수 함수 회귀 무영향 — 강화는 네트워크·타이밍 계층에만 국한).

---

## 3. 범위 밖 (후속 20-B~D)

- 실제 136,280건 목록 전수 수집·본문 크롤링은 실행하지 않았다(`--list-only`/`--max` 소량 실측도 아직 미실행 — 회계사 승인 후 진행).
- voyage-4 임베딩과 pgvector 적재는 실행하지 않았다(TAX-6B-20-B).
- `generateAnswer.ts`의 `VECTOR_REFERENCE_GATES`에 `해석례` 엔트리를 추가하는 검색 배선은 아직 하지 않았다(TAX-6B-20-C) — 지금 코드는 로컬 파일 수집기일 뿐, 실시간 검색 경로(`searchNtsInterpretations`)는 TAX-6B-19 그대로(content='') 무변경이다.
- SSOT/PRD/CLAUDE.md 문서 정합 및 TAX-6B-19 "본문 API 없음" 기록 정정은 하지 않았다(TAX-6B-20-D).
- §2.4에 남아 있던 "회계사망(사내 프록시/SSL inspection)에서 taxlaw 직접 POST 확인"은 이번 세션 환경에서는 성공했지만, 회계사의 실제 운영 환경(사내망)에서의 확인은 별도다.

---

## 4. 잠재 위험

- **비공식 엔드포인트**: `/action.do`·`actionId`·필드명(`ntstDcmGistCntn` 등)은 taxlaw 내부 규격이라 예고 없이 바뀔 수 있다. `parseActionBody`를 순수 함수로 격리해 변경 시 국소 수정만으로 대응 가능하게 설계했다.
- **대량 크롤링 매너/부하**: `--max 200` 소량 실측에서 taxlaw WAF의 공격적 차단을 실제로 겪었다(약 124건 후 IP 침묵 차단). 이에 매너 크롤링 기본값을 보수화했다(동시성 **2**, 요청 간 0.5초 지연, 브라우저형 User-Agent, 연속 10건 실패 시 circuit breaker 즉시 중단). 그럼에도 13.6만 건 전수 수집은 한 번의 실행으로 끝내기 어려우므로, 전수 실행 전 `--max`로 실패율·차단 여부를 다시 확인하고 필요 시 지연 상향·시간대 분산을 고려해야 한다(§7). 차단당해도 resume으로 이어받되, **차단 해제까지 수십 분~수 시간 대기**가 필요하다.
- **저장 형태(§4.3) 재검토 여지**: 방안①(평문만)로 시작했다. 만약 검증 단계(티켓 §6-4, 본문 샘플 3건 육안 대조)에서 요지+회신만으로 정보량이 부족하다고 판단되면, `parseActionBody`에 HWP 전문 추출을 추가하는 방안②로 승격해야 한다(설계상 이 함수 하나만 손대면 되도록 격리해 둠).
- `scripts/ntsExpc_full.json`, `scripts/ntsExpc/`는 대용량 산출물이므로 `.gitignore`에 추가해 커밋 대상에서 제외했다.

---

## 5. 다음 작업

1. 회계사 승인 후 `npm run collect:nts-interp -- --list-only`로 목록 전수·ntstDcmId 추출률을 먼저 확인한다(티켓 §6-3).
2. `npm run collect:nts-interp -- --max 200` 등 소량 실행으로 본문 샘플을 육안 대조하고(§6-4), 방안①/② 결정을 확정한다.
3. TAX-6B-20-B(임베딩 적재) → 20-C(검색 배선) → 20-D(문서 정합) 순으로 진행한다.

**리포트:** `docs/reports/TAX-6B-20-A_report.md`
