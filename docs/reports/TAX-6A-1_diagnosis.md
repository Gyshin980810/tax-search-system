# TAX-6A-1 진단 리포트: 지방세법령 API 진단

> 작성일: 2026-06-11  
> 작성자: Claude Code  
> 상태: **완료**

---

## 0. 한 줄 요약

> **지방세법(법률)과 지방세법 시행령은 별도 "지방세법령정보시스템"이 없이도 이미 국세법령정보시스템(`www.law.go.kr/DRF/`)에서 `NATIONAL_TAX_API_KEY`로 검색 가능하다. `LOCAL_TAX_API_KEY`의 발급 목적·필요성을 회계사가 확인해야 한다.**

---

## 1. 조사 방법 및 근거

| 근거 | 내용 |
|---|---|
| `eval/golden_law_probe.json` | `scripts/golden/probeLaw.ts`가 NATIONAL_TAX_API_KEY로 수집한 실(real) API 응답 스냅샷 |
| `tests/integration/nationalTaxLaw.test.ts` | `지방세법` 검색을 NationalTaxLawAdapter로 단위 테스트 (TAX-031) |
| `scripts/diagnostics/jo_probe.mjs` | `probe('지방세법', '001100', '제11조')` — 국세 API 키로 지방세법 조문 조회 확인 |
| `src/adapters/nationalTaxLaw.ts` | `RawArticle.조문시행일자` 필드 정의 (line 54) |
| `.env.local` 확인 | `LOCAL_TAX_API_KEY` 미설정 확인 |

> ⚠️ 직접 네트워크 호출은 샌드박스 환경 제한(ECONNRESET)으로 불가. 위 기존 수집 데이터와 코드로 확인.

---

## 2. API 엔드포인트 및 접근 가능성

### 2.1 지방세법 — 국세 API로 접근 가능 (핵심 발견)

```
URL: https://www.law.go.kr/DRF/lawSearch.do
파라미터: OC={NATIONAL_TAX_API_KEY}, target=law, query=지방세법
법령일련번호(lsiSeq): 282559
```

| 항목 | 값 |
|---|---|
| 법령명 | 지방세법 |
| 법령일련번호 | 282559 |
| 법종구분 | 법률 |
| 최신 시행일자 | 2026-01-01 |
| 조문 수 | 254건 |
| 해석례 | 15건 |
| 심판례 | 5건 |
| 판례 | 10건 |
| sourceUrl 형식 | `https://www.law.go.kr/lsInfoP.do?efYd=20260101&lsiSeq=282559` |

### 2.2 지방세법 시행령 — 동일하게 접근 가능

```
법령일련번호(lsiSeq): 285497
최신 시행일자: 2026-04-24
조문 수: 241건
```

### 2.3 TAX-031에서 이미 확인된 사실

`nationalTaxLaw.test.ts` 시나리오 8 (법령 매칭 정확도) 참조:
- `법령일련번호: '282559'` = 지방세법임을 테스트 내부에서 명시
- `selectBestLaw` 로직이 "지방교부세법(1위) 오매칭 → 지방세법(정확매칭)" 선택하도록 확인됨
- 즉, 기존 `NationalTaxLawAdapter.search('지방세법')`이 이미 지방세법을 올바르게 반환

---

## 3. RawArticle 스키마 비교 (국세 vs 지방세)

**결론: 완전히 동일한 스키마**

| 필드 | 타입 | 국세법 값 예시 | 지방세법 값 예시 | 동일 여부 |
|---|---|---|---|---|
| `조문번호` | number | 26 | 115 | ✅ |
| `조문여부` | string | "조문" | "조문" | ✅ |
| `조문시행일자` | string(YYYYMMDD) | "20241231" | "20260101" | ✅ |
| `조문내용` | string | "제26조(면세)" | "제115조(납기)" | ✅ |
| `조문키` | string | 있음 | 있음 | ✅ |
| `항` | RawHang\|RawHang[] | 있음 | 있음 | ✅ |

**내용 조립 품질 (지방세법)**:
- contentLength 최대 7,970자 / 중앙값 381자
- 100자 이상 비율: 85% (항·호·목 조립 정상)
- G-5 골든셋 제115조 샘플: 467자, 항·호 본문 포함 확인

---

## 4. 조문시행일자 (시점 검색 근거)

`RawArticle.조문시행일자: string  // YYYYMMDD` — `nationalTaxLaw.ts` line 54

- 이 필드가 **시점 필터의 기준**이 된다.
- `golden_law_probe.json`에서 지방세법 조문의 revisionDate(= 조문시행일자)는 `2026-01-01`로 단일. 단, 이는 probeLaw.ts가 **현행 최신 버전만** 수집하기 때문. 실제 API는 개정 이력에 따라 조문마다 조문시행일자가 다름.
- `toSourceUrl(lsiSeq, article.조문시행일자)` — 기존 코드가 이미 조문별 시점을 sourceUrl에 반영 중.

---

## 5. 시점 파라미터 지원 여부

| 조사 항목 | 결론 |
|---|---|
| www.law.go.kr/DRF/ API에 과거 시점 조회 파라미터 있음? | **없음** — `MST`, `JO`, `OC`, `target`, `type` 파라미터만 존재. 시행일자 기준 필터 파라미터 불명 |
| 클라이언트 필터 가능? | **가능** — `조문시행일자` 필드로 `targetDate ≤ 조문시행일자` 필터 |
| 결론 | **클라이언트 필터 방식 채택** — `SearchQuery.targetDate?` 추가 후 어댑터에서 `조문시행일자` 기준 필터링 |

> ⚠️ 단, API에 시점 파라미터가 실제로 존재하는지 완전히 배제할 수 없음(숨겨진 파라미터 가능성). 클라이언트 필터 방식은 "전체 조문을 받아서 필터"이므로 트래픽 증가 없음(이미 전체 조문 수집 중).

---

## 6. LOCAL_TAX_API_KEY 발급 상태

| 항목 | 상태 |
|---|---|
| `.env.local` 설정 | ❌ **미설정** |
| SSOT §1.2 명기 | `LOCAL_TAX_API_KEY` — 지방세법령정보시스템 API |
| PRD §12 | "API 키 발급 완료" (지방세법령정보시스템 API로 표기) |
| 실제 필요성 | 지방세법(법률)은 이미 NATIONAL_TAX_API_KEY로 접근 가능 — **별도 키 필요성 재검토 필요** |

---

## 7. 회계사 결정 게이트 (3건 → 구현 시작 전 필수)

### Gate A: LOCAL_TAX_API_KEY 필요성 ⭐ 가장 중요

> **핵심 질문:** 지방세법(법률·시행령)은 이미 국세 API 키로 검색됩니다. `LOCAL_TAX_API_KEY`를 발급받아 별도 시스템을 추가로 연결해야 할 이유가 있나요?

| 선택지 | 장점 | 단점 | 추천 |
|---|---|---|---|
| **A-1. 국세 API 키로 통합** (LocalTaxLawAdapter 불필요) | 구현 단순, 새 키 불필요, 이미 동작 확인됨 | 향후 조례 검색(지방세법령정보시스템 전용 데이터) 추가 시 재작업 | ✅ 1순위 |
| **A-2. LOCAL_TAX_API_KEY 발급·사용** | 지방세법령정보시스템 원본 데이터 접근 가능(조례 포함 가능성) | 추가 발급 절차, 응답 스키마 별도 진단 필요 | 조례 필요시 |
| **A-3. 현행 유지 (별도 결정 보류)** | 즉시 진행 가능 | 지방세 통합이 사실상 이미 완성(새 기능 추가 없음) | - |

### Gate B: 시점 필터 방식 승인

클라이언트에서 `조문시행일자 ≤ targetDate` 조건으로 필터링하는 방식으로 구현할 예정입니다.  
이 방식은 API 호출 수가 증가하지 않으며 기존 동작과 호환됩니다.  
승인 여부를 알려주시면 TAX-6A-4 구현에 반영합니다.

### Gate C: 골든셋 파일 구조

| 선택지 | 장점 | 단점 |
|---|---|---|
| **C-1. 별도 파일** (`golden_temporal.json`, `golden_hallucination.json`) | 목적별 분리, 파이프라인 독립 실행 가능 | 파일 2개 추가 |
| **C-2. golden_direct.json 통합** (G-2와 동일 방식) | Phase 5(G-2)와 일관성, 파일 관리 단순 | 시점·환각 케이스를 필터로 구분해야 함 |

---

## 8. 구현 영향 분석 (Gate A 결정에 따른 분기)

### A-1 선택 시 (국세 API 통합): 구현 범위 **축소**

- `LocalTaxLawAdapter` 신규 파일 불필요
- `CompositeSearchAdapter` 불필요 (기존 NationalTaxLawAdapter가 지방세법 이미 반환)
- `config.ts` `localTaxApiKey` 추가 불필요
- **남은 작업**: SearchQuery.targetDate 추가(TAX-6A-4) + 시점 검색 UI(TAX-6A-5) + 골든셋(TAX-6A-6·7)
- TAX-6A-2(어댑터 골격), TAX-6A-3(CompositeSearchAdapter)이 **취소 또는 대폭 축소**

### A-2 선택 시 (별도 LOCAL_TAX_API_KEY): 구현 범위 **현행 유지**

- LocalTaxLawAdapter 신규 작성 + 지방세법령정보시스템 API 스키마 별도 진단 필요
- CompositeSearchAdapter로 두 어댑터 병합
- `NATIONAL_TAX_API_KEY`가 이미 지방세법을 반환하는 상황에서 중복 검색 방지 로직 필요

---

## 9. 권장 사항

1. **A-1 (국세 API 통합) 채택 권장** — 지방세법은 이미 현행 어댑터로 검색됨. 별도 LOCAL_TAX_API_KEY 없이 시점 검색(TAX-6A-4~5)과 골든셋(TAX-6A-6~7)에 집중하는 것이 효율적.
2. **TAX-6A-2, TAX-6A-3 티켓 재검토** — Gate A 결정 후 축소 또는 취소 가능.
3. **시점 검색은 클라이언트 필터** 방식으로 Gate B 승인 요청.

---

## 10. 코드 변경 현황

- **코드 변경: 0건**
- `.env.local` 변경: 없음
- 신규 파일: 이 리포트만

---

## 참조

- `src/adapters/nationalTaxLaw.ts` — RawArticle 스키마, 조문시행일자 필드
- `eval/golden_law_probe.json` — 지방세법 254건, 지방세법 시행령 241건 수집 데이터
- `scripts/diagnostics/jo_probe.mjs` — 지방세법 국세 API 조회 진단
- `tests/integration/nationalTaxLaw.test.ts` — 지방세법 매칭 정확도 테스트(TAX-031)
- `SSOT.md §1.2` — LOCAL_TAX_API_KEY 명기
- `PRD.md §12` — 환경변수 목록
