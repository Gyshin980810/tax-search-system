# TAX-6B-18 심판례(조세심판원 결정례) 전량 벡터 적재

> ⚠️ **전체 착수는 보류 상태.** 본 티켓은 비용·시간 추산과 구현 계획서를 함께 담은 "설계 보관용" 문서다.
> 단, §4[2] 수집기 코드와 §4[4] 검색 경로 선행 배선은 `TAX-6B-18A` 성격의 부분 구현으로 완료됐으며,
> 실제 API 전수 수집·임베딩·DB 적재·운영 전환 검증은 아직 실행하지 않았다.
> 전체 착수 전 회계사 최종 승인(특히 §3 저장소 플랜·동기화 주기 결정) 필요.
>
> 선행 검토 근거: 2026-06-19 비용/시간 추산 + API 일일 한도 실측 (본 티켓 §2.4, §7).

---

## Metadata

- **Type**: FEAT
- **Severity**: major
- **Layer**: adapter / infra / usecase
- **Milestone**: Post-MVP (Phase 7 운영환류와 병행 검토)
- **Estimated Size**: L (6파일 이상 — 수집기/변환기/검색경로/스키마. 단계 분할 권장)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- 유사 사례로 노출되는 **심판례(조세심판원 결정례, Trust Tier T3)** 는
  매 질의마다 `target=ttSpecialDecc` 로 **국세법령정보시스템 API를 실시간 호출**한다.
  (`src/adapters/nationalTaxLaw.ts` `searchTribunal`, line 969)
- 관련도 측정은 2계층:
  1. **어댑터 목록 단계** — 사건명(제목)만으로 `scoreRelevance` 정렬 후 상위 5건만 본문 조회
     (`NONLAW_LIST_DISPLAY=12`, `NONLAW_BODY_FETCH_LIMIT=5`)
  2. **usecase 단계** — 글자 점수 + 의미 벡터(cosine) 가중합 + 컷오프
     (`src/domain/nonLawRelevance.ts`, `generateAnswer.buildReferences`)
- 한계: **실시간 API는 "제목 글자 매칭"으로 후보를 좁힌 뒤에만 본문/의미를 본다.**
  제목에 검색어가 안 들어간(표기 변이·동의어·쟁점만 일치하는) 심판례는 후보 12건 안에 들지 못해
  의미 검색의 기회조차 얻지 못한다. 판례(prec)는 이미 pgvector 전량 적재(TAX-6B-16, 10,075건)되어
  의미 검색이 동작하지만, **심판례만 실시간 API에 묶여 정확도가 구조적으로 낮다.**

### 1.2 기대 동작

- 심판례 전량(약 **139,791건**)을 voyage-4(1024차원)로 임베딩해 pgvector(Neon)에 적재한다.
- 질의 시 심판례 참고 목록을 **판례와 동일하게 벡터 의미 검색**으로 생성한다.
  → 제목에 검색어가 없어도 쟁점이 의미적으로 가까우면 후보로 건진다.
- 원문(주문+재결요지+이유)은 §6.1 인용 무결성을 위해 **문자 단위 보존**한다.

### 1.3 영향·중요도

- 회계사 유사 사례 정확도의 마지막 큰 구멍(심판례 T3)을 메운다.
- 심판례는 사안 일치 시 🟢 승격이 가능한 T3라 회계사 실무 가치가 높다(SSOT §7.6).
- 판례 전량 적재(TAX-6B-13/16) 인프라(임베딩·검색·변환기)를 거의 그대로 재사용 → 신규 리스크 작음.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/adapters/nationalTaxLaw.ts` — `searchTribunal`, `fetchTribunalBody` (실시간 경로, 참고용)
- `src/adapters/embedding.ts` — `VoyageEmbeddingAdapter` (voyage-4 / 1024, 재사용)
- `src/adapters/vectorSearch*.ts` — pgvector 검색 어댑터 (판례용, 재사용 대상)
- `src/usecases/generateAnswer.ts` — `buildReferences` (심판례를 벡터 경로로 전환)
- `src/domain/nonLawRelevance.ts` — 의미/글자 점수 (재사용)
- `scripts/migrate.sql` — vector(1024) 스키마 (심판례 테이블/소스타입 추가)
- `scripts/*precedent*` — 판례 수집·변환·적재 스크립트 (심판례용으로 복제·일반화)

### 2.2 외부 API·리소스

- 국세법령정보시스템 DRF OPEN API (https://www.law.go.kr/DRF/)
  - 목록: `lawSearch.do?target=ttSpecialDecc&type=JSON&display=100&page=N`
  - 본문: `lawService.do?target=ttSpecialDecc&ID=...`
  - 인증: `OC` 파라미터 = `NATIONAL_TAX_API_KEY` (config.ts)
- 임베딩: voyage-4 (VOYAGE_API_KEY)
- 저장소: pgvector / Neon (DATABASE_URL)

### 2.3 아키텍처 힌트

```
[적재 1회성]  수집기(scripts) → 변환기(순수함수) → VoyageEmbeddingAdapter → pgvector(Neon)
[질의 시]     generateAnswer.buildReferences → vectorSearch(심판례) → 의미 상위 K → 참고 목록
```

### 2.4 실측 근거 (2026-06-19)

| 항목 | 실측값 | 출처 |
|---|---|---|
| 전체 건수 | **139,791건** | API `totalCnt` (국심 54,573 + 조심 77,122) |
| 본문 평균 길이 | 약 **8,000자** | 샘플 5건(주문+재결요지+이유) |
| 본문 1건 응답 | 약 **0.57초** | 샘플 5건 평균 |
| **버스트 throughput** | **동시성10 ≈ 18 req/s, 동시성30 ≈ 39 req/s** | 본 티켓 §7 실측 |
| **속도 throttle** | 누적 약 900콜까지 **차단 0건** | 본 티켓 §7 실측 |

> ⚠️ **날짜 필터 미지원**: `prncYd` 무시(항상 전체), `date`는 0건. 30개년치만 선별 다운로드 불가.
> 데이터가 1990년부터 시작·1995년 이전 극소수 → "30개년치 ≈ 전체 ≈ 14만건". **전수 페이징 후 클라이언트 필터**가 유일한 경로.
> 페이지 깊이 제한 없음(page=1398까지 정상), `sort=ddes` 정상.

---

## 3. 비용·시간 추산 (착수 판단 근거)

### 3.1 수집 (API 다운로드) — 비용 0원

- 호출 수: 목록 1,398회 + 본문 139,791회 ≈ **약 141,000회**
- 시간(실측 throughput 기준, throttle 미관측 가정):
  - 동시성 10(~18/s): 약 **2.2시간**
  - 동시성 30(~39/s): 약 **1시간**
- 비용: **0원** (국세법령정보 OPEN API 무료)

> ⚠️ **일일 한도 잔여 리스크**: §7 실측은 누적 ~900콜까지만 검증. 14만 콜 전수에서 일일 쿼터가
> 작동할 가능성은 배제 못 함 → **중단·재개(resume) 가능한 수집기 필수** (한도 시 며칠 분할).

### 3.2 임베딩 (voyage-4) — 1회성

- 토큰: 본문 8,000자 → 건당 5,000~8,000토큰 가정 → 전체 **약 7억~11억 토큰**
- 비용(단가 가정값, voyage 콘솔 확인 필요):

  | 단가 가정 | 하한(0.7B) | 상한(1.1B) |
  |---|---|---|
  | $0.06/1M | 약 $42 | 약 $66 |
  | $0.18/1M | 약 $126 | 약 $200 |

  → **약 $42~200 (약 6만~28만원), 1회성**
- 시간: 배치(128건) ≈ 1,092요청 → 약 **1~2시간** (voyage rate limit 의존)

### 3.3 저장소 (pgvector / Neon) — 월 구독

| 항목 | 용량 |
|---|---|
| 벡터 1024×4byte×139,791 | 약 0.6GB |
| 본문 텍스트 | 약 3.3GB |
| **합계** | **약 4GB** |

> ⚠️ **핵심 결정 사항**: Neon 무료 0.5GB → 4GB는 **유료 플랜(월 ~$19) 또는 본문 외부저장/실시간 재조회 절충** 필요.
> 판례 10,075건 적재 시 실제 용량을 측정해 외삽하면 더 정확. → **착수 전 회계사 결정 필요.**

### 3.4 종합

| 구분 | 비용 | 시간 |
|---|---|---|
| 수집 | 0원 | 1~2.2h (한도 시 분할) |
| 임베딩 | 6만~28만원(1회성) | 1~2h |
| 저장소 | 0~3만원/월 | — |

**한 줄 요약**: 금전 부담 작음. 진짜 일은 **① 14만 콜 resume 수집기**와 **② 4GB 저장 전략 결정**.

---

## 4. Strategy / 구현 계획서 (착수 시 이 순서)

> CLAUDE.md §8 — 실제 착수 시 이 계획을 회계사에게 다시 제시하고 승인받는다.
> **핵심 설계 원칙(회계사 결정 2026-06-19): "수집"과 "임베딩"을 분리한다.**

### 설계 원칙 — 로컬 파일 우선(수집 ↔ 임베딩 분리)

```
[2단계 수집기]  API(ttSpecialDecc)  →  로컬 파일(scripts/tribunal_full.json, TaxLaw[])   ← 여기까지가 수집기 책임
[3단계 임베딩]  로컬 파일  →  voyage-4  →  pgvector        ← 추후, 별도 실행(npm run embed)
```

- **수집기는 DB·임베딩을 모른다.** 오직 API → 로컬 `TaxLaw[]` JSON까지만 만든다(판례 `convertPrecedentMd` → `precedent_full.json` 패턴과 동일).
- 이점: ① voyage 모델/단가가 바뀌어도 **재수집 0회**(파일만 다시 임베딩) ② API 의존과 voyage 의존 **각각 독립 재개** ③ 원문 파일이 §6.1 문자 단위 대조의 **증거**로 남음 ④ 돈 드는 임베딩을 **맨 뒤로 미뤄** 단가 확인 후 실행 가능.

### 단계 분할 (각각 별도 PR 권장)

**[1] 저장소 스키마 + 결정 (선행 게이트)**
1. 판례 10,075건 실제 용량 측정 → 14만건 외삽 → Neon 플랜/본문저장 전략 **회계사 결정**.
2. `scripts/migrate.sql`에 심판례 테이블(또는 sourceType 컬럼) 일치 확인(vector(1024)).

**[2] 수집기 (resume 가능, 1회성 스크립트) — ✅ 본 티켓에서 구현 완료(실행 보류)**
- `scripts/collectTribunal.ts` — 목록 페이징(display=100) → 본문 조회 → 로컬 `TaxLaw[]` JSON.
  - 중간 산출물(resume): `scripts/tribunal/list.json`(목록), `records.jsonl`(본문, 한 줄씩 append), `checkpoint.json`(진행 통계). 최종 `scripts/tribunal_full.json`(embed.ts 입력).
  - 동시성 풀(기본 10, `--concurrency`), 지수 백오프(0.5→4s, `MAX_RETRY`), 타임아웃 15s.
  - **재개**: `records.jsonl`의 seq 집합으로 완료분 스킵 → 중단돼도 이어받기.
  - 본문은 어댑터 `fetchTribunalBody`와 **동일 로직**(주문+재결요지+이유 §6.1 문자 단위 보존).
  - **적재 전 품질 게이트**: finalize 시 `caseNumber` 중복·누락을 `scripts/tribunal/duplicate_case_numbers.json`으로 보고하고 기본 중단(`--allow-duplicate-case`로 수동 강행 가능).
  - 키(OC)는 `--env-file=.env.local`로 주입, 로그·sourceUrl 노출 금지(`scrubOc`, `toTribunalSourceUrl`, §7).
  - 플래그: `--list-only`(연결 확인), `--finalize`(jsonl→json), `--max N`(테스트), `--concurrency N`.
  - 순수 함수(`parseListPage`·`parseBody`·`mapTribunalToTaxLaw` 등)는 `tests/unit/collectTribunal.test.ts`로 검증(15건).

**[3] 임베딩 + 적재 (추후, 별도 실행)**
3. `npm run embed -- --input scripts/tribunal_full.json` — 기존 `embed.ts` 재사용.
   - voyage-4(1024) 배치 임베딩 + content_hash 멱등성(재실행 안전)은 embed.ts가 이미 보유.
   - ✅ 선행 보강: `scripts/embedQuality.ts`가 비법령 `sourceType + caseNumber` 중복·누락을 적재 전 검사하고, 문제 발견 시 `scripts/embed_case_number_issues.json` 작성 후 기본 중단한다(`--allow-case-issues`는 회계사 예외 승인 시만).

**[4] 검색 경로 전환 — ✅ 선행 배선 완료, 운영 전환 검증 보류**
4. `generateAnswer.buildReferences`에서 심판례를 판례와 동일한 sourceType별 벡터 참고자료 후보로 병합할 수 있게 선행 배선.
   - 판례 전용 `fetchPrecedentReferences` 패턴을 `fetchVectorReferences`로 일반화(`sourceType='판례' | '심판례'`).
   - top-K, MIN_SIMILARITY, sourceType별 MAX 상한을 동일하게 적용해 노이즈를 제한.
   - 실시간 `searchTribunal` 경로는 **폴백/롤백용으로 보존**(피처 플래그 권장).
   - 단, 심판례 전량이 아직 pgvector에 적재되지 않았으므로 운영 효과 검증은 미완료.
5. TAX-6B-10/11/12 컷오프·정렬·결정론 정책과 정합 유지.

### 동기화 주기 (착수 시 결정)
- 신규 심판례는 주당 수백 건 → 주간 증분(`sort=ddes` 최신 N페이지만) 배치 권장.

---

## 5. Acceptance Criteria (완료 조건)

1. [x] 심판례 약 139,791건이 pgvector에 적재(차원 1024, 사건번호 unique) — 실제 135,810건(3,981건은 원본 자체 content 중복, 정상 dedup. `docs/reports/TAX-6B-18_report.md` 참고).
2. [x] 적재 본문이 원문과 **문자 단위 일치**(§6.1, 샘플 대조) — 무작위 8건 100% 일치.
3. [x] 수집기가 중단 후 **체크포인트로 재개** 가능 — 실제 5회 재시작(수동 2·크래시 2·코드적용 1)에도 데이터 손실 0.
4. [x] 질의 시 심판례 참고 목록이 벡터 의미 검색으로 생성됨(제목 미일치 쟁점도 후보 진입) — `generateAnswer.ts` `fetchVectorReferences`를 판례·심판례 공용으로 일반화(병렬 실행), 실제 DB 스모크 테스트로 의미 매칭 확인(2026-07-04).
5. [x] 키(OC)·개인정보가 로그·산출물·UI에 노출되지 않음(§7).
6. [x] law-verifier V1~V6 회귀 통과, 기존 vitest 그린 — 694/694 PASS.
7. [ ] P95 회귀 없음 — ⚠️ 미측정. pgvector에 ANN 인덱스(HNSW) 미적용 상태로 단일 벡터 질의 실측 약 3.17초(전수 스캔, 135K+행) 확인. 병렬화로 게이트 2개(판례·심판례)가 직렬로 겹치지 않게는 했으나, 실제 답변 파이프라인 전체 P95 재측정은 아직 하지 않음 — 후속 확인 필요.

---

## 6. Verification (검증 단계)

1. 적재 건수 = API totalCnt 근사 확인(±오차 허용범위 기록).
2. 무작위 10건 본문을 API 원문과 diff → 문자 단위 일치 확인.
3. 표기 변이 쿼리(예: "양도세"↔"양도소득세")로 심판례 후보 진입 개선 확인(전/후 비교).
4. 골든셋 비법령(G-2 등) 회귀 합격선 유지.
5. P95 측정 → 게이트(<15s) 유지.

---

## 7. API 일일 한도 실측 결과 (2026-06-19)

> 일회용 측정 스크립트로 `target=ttSpecialDecc` 버스트 호출. 키 비출력(§7).

| 측정 | 동시성 | 요청 | 성공 | 차단의심 | throughput |
|---|---|---|---|---|---|
| 1차(교정후) | 10 | 300 | **300** | 0 | 18.3 req/s |
| 2차 | 30 | 300 | **300** | 0 | 39.1 req/s |

- **속도 throttle 미관측** — 누적 약 900콜(수 분 내)에서 HTTP 비정상·차단·한도 안내 0건.
- 1차 측정 초기 "차단의심" 오탐 발생 → 원인은 **심판례 본문에 "제한세율·한도·초과" 등 세법 용어 포함**.
  감지 기준을 HTTP status + JSON 구조(`"Decc"` 키)로 교정 후 300/300 정상 확인.
- **결론**: 분당/초당 throttle은 사실상 없음(최소 ~39 req/s 안정). **단, 14만 콜 전수에서의 일일 쿼터는
  미검증** → resume 수집기로 방어. 정식 일일 한도는 law.go.kr 사용기관 등록 정보로 확인 권장.

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것 (착수 시)
- [ ] 판례 실제 용량 측정 → 저장소 플랜 회계사 결정
- [ ] §4 4단계 계획 재제시 + 영향 파일 목록 + 피처 플래그 설계

### 8.2 코딩 후 제출할 것
- [ ] 변경 파일 목록 / 변경 요약 / 검증 PASS·FAIL
- [x] 수집기 부분 구현 리포트: `docs/reports/TAX-6B-18A_report.md`
- [x] 전량 적재·검색 전환 리포트: `docs/reports/TAX-6B-18_report.md`

---

## 9. Risks / Notes

- **일일 쿼터 미검증**(가장 큰 미지수) → resume 필수.
- **저장소 4GB** → 무료 한도 초과 가능 → 착수 전 결정.
- **voyage 단가 불확실** → 임베딩 전 콘솔에서 실단가 확인.
- 날짜 필터 API 미지원 → 전수 수집만 가능.
- 실시간 경로 제거 금지(롤백 보존) — 적재 실패/스키마 불일치 대비.

---

## 10. Related Tickets

- 선행/재사용: `TAX-6B-13_precedent_corpus.md`, `TAX-6B-16_precedent_full_load.md`(판례 전량 적재 인프라),
  `TAX-6B-15_voyage_embedding.md`(voyage-4), `TAX-026-B~H`(pgvector)
- 정합: `TAX-6B-10/11/12`(비법령 관련도·의미 재정렬 정책)
- 병행 검토: Phase 7(`TAX-030` 운영환류)

---

## 11. Report Link

Report: `docs/reports/TAX-6B-18A_report.md` (작성 완료 — 수집기 부분 구현 리포트) / `docs/reports/TAX-6B-18_report.md` (작성 완료 — 전량 적재·검색 전환 실행 리포트)

---

**작성자**: AI (Claude) — 회계사 지시로 설계 보관
**작성일**: 2026-06-19
**최종 수정일**: 2026-07-04
**상태**: ✅ **[2] 수집 + [3] 임베딩·적재 + [4] 검색 경로 전환 모두 실행 완료** (2026-07-03 밤 ~ 2026-07-04). P95 재측정만 잔여(§5 AC7).
  - 수집: `scripts/collectTribunal.ts` 실제 실행 완료(139,840건, checkpoint fail 0).
  - 적재: `scripts/embed.ts` 실제 임베딩·pgvector 적재 완료(135,810건, voyage-4/-4-large 혼재+metadata 추적, withRetry 안정화 추가). 상세: `docs/reports/TAX-6B-18_report.md`.
  - 검색 경로 전환: `generateAnswer.ts`의 `fetchPrecedentReferences`를 `fetchVectorReferences`로 일반화해 판례·심판례를 `VECTOR_REFERENCE_GATES` 배열로 병렬 검색(`tests/unit/tribunalReferences.test.ts` 신규 6건). 실시간 `searchTribunal` 경로는 폴백으로 그대로 보존. 실 DB 스모크 테스트로 의미 매칭 확인.
  - typecheck 0 / vitest 694/694 PASS.
  - **잔여**: P95 재측정(§5 AC7) — pgvector ANN 인덱스(HNSW) 미적용으로 벡터 질의 단건 약 3.17초 관측.
