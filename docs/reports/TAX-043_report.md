# TAX-043 리포트 — 비법령 검색 자연어 정규화 (불용어 + 사건번호)

> 티켓: `docs/tickets/TAX-043_nonlaw_query_normalization.md`
> 선행: TAX-042E 인사이트 리포트 (`docs/reports/TAX-042E_nonlaw-search-insights.md` §3 옵션 B + C)
> 작성: AI(Claude Opus 4.7), 2026-06-08
> 회계사 결정 적용: A·A·A (모듈 위치=도메인 / 사전=29개 보수적 / 사건번호=단독 검색)

---

## 1. 30초 요약

비법령 4트랙(`searchPrecedents` / `searchInterpretations` / `searchNtsInterpretations` / `searchTribunal`) 진입 직전에 자연어 정규화 한 단계를 추가했다.

- **불용어 29개 사전**으로 회계사 자연어 군더더기("찾아줘", "여부", "관련" 등) 제거 → 외부 API 검색 노이즈 ↓
- **사건번호 정규식 2종**(대법원 형식·심판원 청구번호)으로 정확매칭 우선 → 회계사가 사건번호 알 때 100% 정확매칭 기회 확보
- **CLAUDE.md §6.1 원문 보존 유지** — 입력만 정규화, 결과(`TaxLaw[]`) 데이터 무변경
- **V1~V6 검증 로직 무변경** — 검증 우회 없음

총 21건 신규 단위 테스트 추가, vitest **367/367 PASS** (기존 346 + 신규 21).

---

## 2. 변경 사항 요약

### 2.1 파일 변경 목록

| 파일 | 상태 | 변경 |
|---|---|---|
| `src/domain/nonLawQueryNormalize.ts` | 신규 | 불용어 사전 + 사건번호 정규식 2종 + `normalizeNonLawQuery()` |
| `tests/unit/nonLawQueryNormalize.test.ts` | 신규 | 단위 테스트 21건 (사전 보증·불용어·판례·심판례·오매칭 방지·정규식 직접 검증) |
| `src/adapters/nationalTaxLaw.ts` | 수정 | import 1줄 + 4트랙 메서드 진입부 각 2~3줄 (총 약 13줄 추가) |

### 2.2 주요 변경 내역

#### A. `src/domain/nonLawQueryNormalize.ts` (신규)

- `NONLAW_STOPWORDS`: 5그룹 29개 (의문 8 + 관계어 5 + 메타 5 + 추상 7 + 단위 4)
- `COURT_CASE_RE`: `(?:19|20)\d{2}` + 분류기호(`고합`·`고단`·`두`·`누`·`구`·`마`·`가`·`나`·`다` 등 19종) + `\d{1,8}`, 공백 허용
- `TRIBUNAL_CASE_RE`: `조심\s*\d{4}\s*[가-힣]\s*\d{1,4}`
- `normalizeNonLawQuery(raw)`: 심판례 우선 → 판례 → 불용어 제거 → `{caseNumber, keyword, applied}` 반환
- 보수적 fallback: 모든 단어가 불용어로 제거되면 원본 보존

#### B. `src/adapters/nationalTaxLaw.ts` (수정)

| 트랙 | 사건번호 정확매칭 적용 여부 | 진입부 변경 |
|---|---|---|
| `searchPrecedents` (판례 T4) | ✅ 적용 | `effectiveKeyword = n.caseNumber ?? n.keyword` |
| `searchTribunal` (심판례 T3) | ✅ 적용 | `effectiveKeyword = n.caseNumber ?? n.keyword` |
| `searchInterpretations` (해석례 T3) | ❌ 미지원(자연어 fallback) | `query: n.keyword` 만 사용 |
| `searchNtsInterpretations` (NTS 해석 T3) | ❌ 미지원(자연어 fallback) | `query: n.keyword` 만 사용 |

- 어댑터 본체(`search()` 머지·정렬·캐싱·`fetchArticles` 법령 트랙) **무변경**
- `cacheKey`는 raw `query.keyword.trim().toLowerCase()` 기준 유지 → 캐시 히트율 영향 없음

---

## 3. 검증 결과

| 항목 | 결과 |
|---|---|
| `npm run typecheck` | ✅ EXIT 0 |
| `npm run lint` (전체) | ✅ 0 errors (warning 1건은 기존 테스트 — 본 티켓 무관) |
| 신규 파일 lint 단독 | ✅ 0 errors 0 warnings |
| vitest 전체 | ✅ **367/367 PASS** (기존 346 + 신규 21) |
| 신규 단위 테스트 21건 | ✅ PASS |
| 어댑터 인테그레이션 회귀 36건 | ✅ PASS |
| 골든셋 V1~V6 검증 22건 | ✅ PASS (LawVerifierAdapter 직접 검증 무변경) |

### 3.1 단위 테스트 21건 구성

| describe 블록 | it 건수 | 보증 내용 |
|---|---|---|
| `NONLAW_STOPWORDS` 사전 보증 | 2 | 사전 크기 잠금(29) + 핵심 세무 단어 불용어 아님 회귀 차단 |
| 옵션 B (불용어 제거) | 6 | 군더더기 제거·다중 불용어·trim·미적용·fallback·빈 입력 |
| 옵션 C (판례 사건번호) | 4 | 표준 형식·공백 허용·19xx prefix·혼재 입력 |
| 옵션 C (심판례 청구번호) | 3 | 표준 형식·공백 허용·판례 우선순위 |
| 오매칭 방지 (안전성) | 3 | 연도 prefix 없는 일반 단어 + 1234 + "조심해서" |
| 정규식 직접 검증 (보조) | 3 | RE 단독 검증 (강건성) |

---

## 4. 잠재 위험·한계

| # | 위험 | 현재 완화 | 추가 권고 |
|---|---|---|---|
| ① | 불용어 사전이 회계사가 정말 쓰는 핵심 단어를 제거할 가능성 | 사전 닫힌 집합(테스트로 잠금) + 토큰 0개 fallback | 운영 1~2주 후 검색 로그 표본 검토 |
| ② | 사건번호 정규식 미커버 형식("선" 등 신규 분류기호) | 자연어 fallback (정확매칭 실패해도 일반 검색 그대로) | 회계사 신규 분류기호 확인 시 사전 확장 |
| ③ | 외부 API가 query 파라미터 정확매칭을 어느 정도로 지원하는지 트랙별 실험 부족 | korean-law-mcp의 검증된 동일 패턴 차용 | 단계 2(TAX-044) 진행 시 실측 검증 권고 |
| ④ | TAX-031 `normalizeLawName`과 동시 적용 시 영향 | 법령 트랙(`fetchArticles`) 무변경 — 본 티켓 비법령 트랙만 적용 | 변경 없음 |
| ⑤ | 사건번호 + 추가 키워드 입력 시 추가 맥락 손실 (옵션 A 결정의 trade-off) | 의도 — 회계사가 사건번호 명시 시 그 사건 우선 | 회계사 피드백 시 옵션 B(병렬 검색) 재검토 |

### 4.1 본 티켓 비대상 (단계 2·3에서 처리)

- **옵션 A**: 세무 도메인 사전 + 법리·사실축 결합 검색 → TAX-044 후보
- **옵션 D**: 저정보 조문 패널티 → TAX-045 후보
- **옵션 E**: 사후 결과 검증 그룹 → TAX-045 후보

---

## 5. 검증 — CLAUDE.md 정합성

| 항목 | 본 티켓 정합 |
|---|---|
| §6.1 인용 무결성 | ✅ 입력만 정규화. `TaxLaw[]` 결과 데이터 무변경 |
| §6.2 Trust Tier·시점 라벨 | ✅ 무변경 |
| §6.3 라벨링 시스템 | ✅ 무변경 |
| §6.4 V1~V6 검증 우회 금지 | ✅ 검증 로직·LawVerifierAdapter 무변경, 골든셋 22건 PASS |
| §7 개인정보·시크릿 | ✅ 정규화 입력은 기존 PII 필터(`piiFilter.ts`) 통과 후 수신 — 무관 |
| §8 워크플로우 | ✅ 티켓 → 계획서 → 회계사 승인(A·A·A) → 구현 → 검증 → 리포트 |
| §9 8번 결정 전 장단점 설명 | ✅ 결정 포인트 3개 각각 장단점 한 줄씩 제시 후 진행 |

---

## 6. 다음 단계 (회계사 결정 대기)

본 티켓은 **단계 1**만 다룬다. 회계사 피드백·운영 관찰 후:

| 옵션 | 효과 | 작업 크기 | 권고 시점 |
|---|---|---|---|
| TAX-044 — 옵션 A (세무 도메인 사전 + 결합 검색) | ⭐⭐⭐ 비법령 적중률 30~50% ↑ | M | 본 티켓 운영 1~2주 후 |
| TAX-045 — 옵션 D + E (패널티 + 사후 검증) | ⭐⭐ 라벨 정확성 안정화 | S+M | TAX-044 완료 후 |

---

## 7. 변경 위치 빠른 참조 (file:line)

- `src/domain/nonLawQueryNormalize.ts:38` — `NONLAW_STOPWORDS` 사전 (29개)
- `src/domain/nonLawQueryNormalize.ts:55` — `COURT_CASE_RE` 판례 정규식
- `src/domain/nonLawQueryNormalize.ts:64` — `TRIBUNAL_CASE_RE` 심판례 정규식
- `src/domain/nonLawQueryNormalize.ts:94` — `normalizeNonLawQuery()` 본체
- `src/adapters/nationalTaxLaw.ts:9` — import 추가
- `src/adapters/nationalTaxLaw.ts:592` — `searchPrecedents` 진입부
- `src/adapters/nationalTaxLaw.ts:677` — `searchInterpretations` 진입부
- `src/adapters/nationalTaxLaw.ts:754` — `searchNtsInterpretations` 진입부
- `src/adapters/nationalTaxLaw.ts:804` — `searchTribunal` 진입부

---

**작성**: AI(Claude Opus 4.7), 2026-06-08
**티켓**: `docs/tickets/TAX-043_nonlaw_query_normalization.md`
