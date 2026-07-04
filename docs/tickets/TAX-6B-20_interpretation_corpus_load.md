# TAX-6B-20 해석례 코퍼스 벡터 적재 (expc 본문 API + ntsCgmExpc 본문 스크래핑)

> 작성 전 실증 조사 완료(2026-06-22). 본 티켓은 **계획서**이며, 회계사 승인 전까지
> 실제 수집·스크래핑·임베딩은 착수하지 않는다(읽기 전용 조사만 수행함).

---

## Metadata

- **Type**: FEAT
- **Severity**: major
- **Layer**: infra (수집 스크립트) + adapter (검색 경로) + docs
- **Milestone**: Post-MVP (Phase 6B/7 데이터 인프라)
- **Estimated Size**: L (6파일 이상 — 분할 필수, 아래 §9 참조)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작 (TAX-6B-19 직후)

- 해석례(`expc` 법제처 + `ntsCgmExpc` 국세청) **둘 다 목록·참고 링크 트랙**으로 통일됨.
  - 본문 미조회 → `content=''` → 발췌 인용·🟢 직접 근거 승격 불가, V1~V6 비대상.
  - 검색은 **제목 키워드 매칭** 후 상위 N건만 참고 목록 노출.
- 판례(`prec`)·일부 심판례만 pgvector에 적재되어 **의미(semantic) 검색** 가능.

### 1.2 기대 동작

- 해석례 본문을 확보해 pgvector에 적재 → **의미 검색**으로 관련 해석례 정확도 향상.
- 본문이 있으면 일부 케이스는 발췌 인용(🟡 유사 사례)까지 승격 가능.

### 1.3 영향·중요도

- 법인세 실무(가지급금 등) 핵심 쟁점이 국세청 해석례에 다수 → 정확도 직결.
- 단, **정확성 4대 규칙(§6.1 인용 무결성)** 때문에 본문 출처 신뢰도가 관건.

---

## 2. Context (기술적 맥락) — 2026-06-22 실증 조사 결과

### 2.1 두 해석례 소스 비교

| 구분 | expc (법제처) | ntsCgmExpc (국세청) |
|---|---|---|
| 규모 | ~8,757건 (전 분야) | 136,280건 (세법 전용, 법인세 6,372) |
| 본문 취득 | **공식 API** `lawService.do?target=expc` ✅ 안정 | **공식 API 없음** ❌ (TAX-6B-19 확정) |
| 본문 대안 | (불필요) | 내부 AJAX `POST /action.do` 스크래핑 (아래 2.3) |
| 노이즈 | 세법 외 포함(필터 불가) | 세법 전용(깨끗) |
| Trust Tier | T3 | T3 |

### 2.2 robots.txt 확인 (2026-06-22)

- `taxlaw.nts.go.kr/robots.txt`: `Disallow`는 `/is/USEISA001M.do`, `/is/USEISA003M.do` **2개뿐**.
  본문 경로 `/qt/USEQTA002P.do`·`/action.do`는 **차단 대상 아님** → robots 관점 수집 허용.
- `law.go.kr/robots.txt`: `Allow: /` 전체 허용.

### 2.3 ntsCgmExpc 본문 스크래핑 메커니즘 (실증)

- 목록 API가 상세 링크 제공: `…/qt/USEQTA002P.do?ntstDcmId={18자리ID}`
- 상세 페이지는 **JS 렌더링** → HTML에 본문 없음. 본문은 AJAX로 로드:
  ```
  POST https://taxlaw.nts.go.kr/action.do
  Content-Type: application/x-www-form-urlencoded
  body: actionId=ASIQTB002PR01&paramData={"dcmDVO":{"ntstDcmId":"..."}}
  → JSON: data.ASIQTB002PR01.dcmDVO.{ntstDcmDscmCntn(질의), ntstDcmRplyCntn(회신=본문), ntstDcmTtl(제목)}
  ```
- ⚠️ **안정성 경고(실증)**: 동일 요청이 호출 조건에 따라 `SUCCESS / data:null / ERROR`로 **일관되지 않게** 응답.
  세션 쿠키(JSESSIONID)·요청 헤더·warm-up 순서에 민감한 것으로 추정.
  → **공식 계약(contract)이 아닌 내부 엔드포인트**. 언제든 깨질 수 있고, 무결성 보장이 약함.

### 2.4 관련 파일

- `scripts/collectInterpretations.ts` (신규 예정) — 수집기
- `scripts/embed.ts` (재사용, 무변경 목표) — voyage-4 임베딩 적재
- `scripts/embedQuality.ts` (재사용) — caseNumber 중복·누락 게이트
- `src/adapters/nationalTaxLaw.ts` (후속 단계에서 검색 경로 전환)
- `src/adapters/vectorSearch.ts` 계열 (벡터 검색 경로 — 판례 패턴 재사용)

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경 (단계별, 아래 §9 분할대로)

- [ ] (20-A) `scripts/collectInterpretations.ts` 신규 — expc 본문 API 수집 (안정 소스 먼저)
- [ ] (20-B) ntsCgmExpc 스크래핑 수집기 — `/action.do` 기반, resume·throttle·scrubOc
- [ ] (20-C) 임베딩 적재 — 기존 `embed.ts` 재사용 (무변경 목표)
- [ ] (20-D) 검색 경로 전환 — 해석례 벡터 검색 합류 (실시간 폴백 보존)

### 3.2 금지되는 변경

- ❌ 법령 원문·해석례 본문 임의 가공·요약 저장 (§6.1 — 문자 단위 보존)
- ❌ V1~V6 검증 로직 변경 (§6.4)
- ❌ Usecase에서 fetch/DB 직접 호출 (Port만)
- ❌ API 키(OC)·DATABASE_URL을 로그·sourceUrl·에러에 노출 (scrubOc 적용)
- ❌ robots.txt `Disallow` 경로(`/is/USEISA001M.do`, `/is/USEISA003M.do`) 접근
- ❌ 한 번에 전량(136,280건) 무제한 스크래핑 (throttle·resume 필수)

---

## 4. Strategy — 본문 취득 방식 3안 (회계사 결정 필요)

> ⚠️ 핵심 결정 포인트. expc는 어느 안이든 공식 API라 문제없고, **쟁점은 ntsCgmExpc 본문**이다.

### A안 — expc(법제처)만 본문 적재, ntsCgmExpc는 현행(목록) 유지 ⭐추천

- **장점**: 100% 공식 API라 안정·무결성 보장. 즉시 가능. §6.1 위반 위험 0. 구현 작고 깨질 일 없음.
- **단점**: 세법 핵심인 국세청 해석례(13.6만건)는 여전히 의미 검색 불가. 커버리지 제한.
- 비유: "정품 보증서 있는 책만 서가에 꽂는다." 적지만 안전.

### B안 — A + ntsCgmExpc를 `/action.do` 스크래핑으로 본문 적재

- **장점**: 세법 전용 13.6만건 본문 확보 → 의미 검색 커버리지 최대.
- **단점**: 비공식 엔드포인트 의존(2.3의 SUCCESS/null/ERROR 불안정) → 수집 신뢰성·무결성 약함.
  본문이 §6.1 "문자 단위 일치"를 보장하려면 스크래핑 결과를 인용 근거로 못 쓸 수 있음(참고 목록 한정 권장).
  대량 수집 부하·차단 리스크. 사이트 구조 변경 시 파손.
- 비유: "출처가 흔들리는 복사본을 잔뜩 들여온다." 양은 많지만 신뢰가 약함.

### C안 — A + ntsCgmExpc는 헤드리스 브라우저(Puppeteer)로 렌더링 후 추출

- **장점**: 실제 렌더링 결과라 `/action.do` 직접 호출의 상태 불안정 회피 가능.
- **단점**: `package.json` 의존성 추가(puppeteer ~수백MB), 수집 속도 느림(건당 수초), 운영 복잡.
  무결성·인용 한계는 B안과 동일.
- 비유: "사람이 일일이 페이지 열어 베껴 적는 로봇을 고용." 견고하지만 느리고 무겁다.

> **추천**: **A안 먼저(20-A 단독 머지)** → 효과·정확도 측정 후, 국세청 해석례가 정말 필요하면
> B/C를 **별도 후속 티켓**으로 재평가. (1티켓=1논리변경 원칙, §9)

---

## 5. Acceptance Criteria (단계별)

**20-A (expc 본문 적재):**
1. [ ] expc 본문이 `lawService.do` 공식 API로 수집되어 JSONL 산출 (질의요지·회답·이유 포함)
2. [ ] 본문이 원문과 **문자 단위 일치**(§6.1), scrubOc로 키 미노출
3. [ ] `embedQuality` 게이트 통과(중복·누락 0) 후 pgvector 적재
4. [ ] 해석례 의미 검색이 제목 매칭 대비 관련도 개선(샘플 케이스로 회계사 확인)
5. [ ] 기존 vitest 그린 유지, P95 합격선(15s) 미회귀

**20-B/C (해당 안 선택 시 별도 티켓에서 정의)**

---

## 6. Verification (회계사 확인 순서)

1. (조사 단계, 완료) robots.txt·본문 엔드포인트 실증 결과 검토
2. 수집기 dry-run 로그 확인 (실적재 전)
3. 샘플 3건 본문이 원문과 일치하는지 육안 대조
4. `npm run dev` → 해석례 키워드 검색 시 의미 검색 결과 노출·링크 정상

---

## 7. Risks / Notes

- ⚠️ **§6.1 무결성**: 스크래핑 본문(B/C)은 출처 안정성이 약해 발췌 인용(citation) 승격에 부적합할 수 있음 → **참고 목록 한정** 권장.
- ⚠️ ntsCgmExpc `/action.do`는 비공식·불안정(2.3). 사이트 개편 시 즉시 파손 가능.
- ⚠️ 저장소 용량: 해석례 본문 적재는 TAX-6B-18(심판례 ~3GB)과 **같은 저장소 플랜 결정**에 묶임.
- ℹ️ expc는 전 분야라 세법 외 노이즈 포함 — 의미 검색 가중치·컷오프로 완화(TAX-6B-12 패턴 재사용).
- ℹ️ TAX-6B-19로 제거한 expc 본문 조회를 "검색 경로"가 아닌 "사전 적재 경로"로 부활시키는 구조 — 실시간 N+1 부활 아님(P95 안전).

---

## 9. 티켓 분할 (L 크기 → 4개로)

- **TAX-6B-20-A**: expc 본문 수집기 + 임베딩 적재 (공식 API, 안정) ⭐ 먼저
- **TAX-6B-20-B**: ntsCgmExpc `/action.do` 스크래핑 수집기 (B안 채택 시)
- **TAX-6B-20-C**: 해석례 벡터 검색 경로 전환 (실시간 폴백 보존)
- **TAX-6B-20-D**: SSOT/PRD 정합 (해석례 본문 적재 정책 명문화)

---

## 10. Related Tickets

- 선행: TAX-6B-21(해석례 **제목** 전량 벡터화 — 경량 선행, 효과 측정 후 본 티켓 승격), TAX-6B-19(해석례 목록 전용), TAX-6B-15(voyage-4), TAX-6B-16(판례 전량 적재)
- 형제: TAX-6B-18(심판례 전량 적재 — 저장소 플랜 공유)
- 참조: 메모리 `project_nonlaw_interp_tracks`, `project_tax6b18_tribunal_full_load`

---

## 11. Report Link

Report: `docs/reports/TAX-6B-20_report.md` (미작성)

---

**작성자**: AI (회계사 조사 의뢰)
**작성일**: 2026-06-22
**최종 수정일**: 2026-06-22
