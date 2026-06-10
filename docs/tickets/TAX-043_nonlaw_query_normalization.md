# TAX-043 비법령 검색 자연어 정규화 (불용어 + 사건번호)

> TAX-042E 사후 분석(`docs/reports/TAX-042E_nonlaw-search-insights.md`) §4.3의 1단계 묶음.
> korean-law-mcp `compact-query-planner.ts`의 불용어·사건번호 패턴을 우리 세법 시스템 비법령 4트랙에 가장 작은 변경으로 적용한다.
>
> 본 티켓은 **검색 입력 정규화만** 다룬다. 도메인 사전 + 법리·사실축(옵션 A)·저정보 조문 패널티(옵션 D)·사후 검증(옵션 E)은 별도 티켓(TAX-044/045)으로 분리.

---

## Metadata

- **Type**: FEAT
- **Severity**: minor
- **Layer**: adapter (보조 도메인 모듈 신규)
- **Milestone**: Post-MVP
- **Estimated Size**: S (2~3파일 신규 + 어댑터 1줄 연결)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- `src/adapters/nationalTaxLaw.ts:464~471`의 비법령 4트랙(`searchInterpretations` / `searchNtsInterpretations` / `searchTribunal` / `searchPrecedents`)이 모두 `query.keyword`를 **있는 그대로** 외부 API의 `query=` 파라미터로 전달
- 자연어 군더더기("찾아줘", "여부", "관련", "어떤", "되나요" 등)가 검색어에 그대로 포함 → 일반론 안내·관련 없는 트랙 결과가 우선 노출
- 회계사가 사건번호("2023두12345", "조심2023서0001")를 명시해도 본문 검색만 수행 → 정확매칭 기회 상실

### 1.2 기대 동작

- 회계사 자연어 질의가 **외부 API 호출 직전**에 비법령 트랙용으로 정규화됨
  - 사건번호 패턴 발견 시 → 사건번호 단독 검색 (정확매칭 우선)
  - 그 외 → 불용어 제거 후 검색
- 법령 트랙(`fetchArticles`)은 정규화하지 않음(법령명 약칭 정규화 TAX-031과 분리)
- 검색 결과 자체(`TaxLaw[]`)는 변형하지 않음 — CLAUDE.md §6.1 원문 보존

### 1.3 영향·중요도

- **비법령 4트랙 검색 적중률 향상**: 자연어 군더더기 제거 효과로 V1·V2 정성 정확도 ↑
- **사건번호 직접매칭**: 회계사가 사건번호 알 때 100% 정확매칭
- **TAX-042D 후속 보강**: 일반론 결과 노출 감소 → 직접근거 라벨이 일반 조문에 잘못 붙는 사고 추가 완화

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

**신규 생성:**
- `src/domain/nonLawQueryNormalize.ts` — 불용어 사전 + 사건번호 정규식 + `normalizeNonLawQuery` 함수
- `tests/domain/nonLawQueryNormalize.test.ts` — 단위 테스트

**최소 수정:**
- `src/adapters/nationalTaxLaw.ts` — 비법령 4트랙 메서드 진입부 1줄: `keyword = normalizeNonLawQuery(keyword)` 적용

**참조 (수정 없음):**
- `src/adapters/nationalTaxLaw.ts:464~471` — 4트랙 진입점
- `src/domain/lawAliases.ts` — TAX-031 약칭 정규화 패턴 참고 (구조 유사)
- `C:\Users\sfami\WorkSpace\korean-law-mcp-main\src\tools\compact-query-planner.ts` — 원본 패턴

### 2.2 외부 API·리소스

- 국세법령정보시스템 OPEN API `query=` 파라미터
- 트랙별 사건번호 형식 차이:
  - 판례(`prec`): `2023두12345` (대법원 형식)
  - 심판례(`ttSpecialDecc`): `조심2023서0001` 또는 `조심 2023 서 0001`
  - 해석례/NTS 해석: 사건번호 직접 검색 불가(본 티켓에서는 비대상)

### 2.3 아키텍처 힌트

```
UI → API Route → generateAnswer Usecase
                       ↓ search()
                NationalTaxLawAdapter.search()
                       ↓ 비법령 4트랙 진입
                normalizeNonLawQuery(keyword)  ← 본 티켓 신규
                       ↓
                searchInterpretations / Tribunal / NtsInterpretations / Precedents
```

---

## 3. Scope (작업 범위) ⭐

### 3.1 허용되는 변경

- [ ] `src/domain/nonLawQueryNormalize.ts` 신규
- [ ] `tests/domain/nonLawQueryNormalize.test.ts` 신규
- [ ] `src/adapters/nationalTaxLaw.ts` — 4트랙 메서드 진입부 정규화 호출 추가 (각 메서드 1줄)

### 3.2 금지되는 변경

- ❌ `src/adapters/nationalTaxLaw.ts`의 정렬·머지·캐싱·`fetchArticles`(법령 트랙) 로직 변경
- ❌ `TaxLaw[]` 반환 데이터 수정 — CLAUDE.md §6.1 원문 보존
- ❌ V1~V6 검증 로직·라벨 enum 변경 (CLAUDE.md §6.4)
- ❌ 법령(`fetchArticles`) 트랙 정규화 — TAX-031의 `normalizeLawName`과 충돌
- ❌ `app/`·`src/usecases/`·`src/ports/` 수정
- ❌ 골든셋 파일(`eval/golden_direct.json`) 수정
- ❌ 외부 API URL·인증·`OC=` 키 변경

---

## 4. Strategy (구현 힌트)

### 4.1 모듈 구조

```ts
// src/domain/nonLawQueryNormalize.ts

const NONLAW_STOPWORDS: ReadonlySet<string> = new Set([
  // 1) 의문·요청 동사 (회계사 자연어 군더더기)
  "찾아줘", "찾아주세요", "알려줘", "알려주세요", "보여줘", "보여주세요",
  "검색", "조회",
  // 2) 관계어 (검색 노이즈)
  "관련", "관한", "대한", "대해", "대하여",
  // 3) 메타 명사 (트랙 자체를 가리키는 단어 — 어차피 트랙별 검색이므로 중복)
  "판례", "판결", "결정", "사례", "해석",
  // 4) 추상어
  "여부", "가능", "가능한가요", "되나요", "되는지", "어떤", "어떻게",
  // 5) 단위·수식어
  "얼마", "기준", "경우", "때",
])

const COURT_CASE_RE = /(?:19|20)\d{2}\s*(?:두|누|구|마|가|나|다|라|기|아|자|고합|고단|선|허)\s*\d{1,8}/u
const TRIBUNAL_CASE_RE = /조심\s*\d{4}\s*[가-힣]+\s*\d{1,4}/u

export interface NormalizedNonLawQuery {
  /** 사건번호 발견 시 정확매칭용 단일 검색어, 없으면 null */
  caseNumber: string | null
  /** 불용어 제거 후 검색어 (caseNumber와 무관하게 항상 생성) */
  keyword: string
  /** 디버그용: 어떤 정규화가 일어났는지 */
  applied: Array<"stopwords" | "court_case" | "tribunal_case">
}

export function normalizeNonLawQuery(raw: string): NormalizedNonLawQuery
```

### 4.2 4트랙 어댑터 연결 (각 메서드 진입부)

```ts
// 예: searchPrecedents
private async searchPrecedents(keyword: string): Promise<TaxLaw[]> {
  const n = normalizeNonLawQuery(keyword)
  const effectiveKeyword = n.caseNumber ?? n.keyword  // 사건번호 있으면 그것만
  // 기존 코드 (params.query = effectiveKeyword)
}
```

- 사건번호 정확매칭은 판례(`prec`) + 심판례(`ttSpecialDecc`) 트랙만 적용 (해석례/NTS 해석은 사건번호 검색 미지원 — 자연어 fallback)
- 빈 문자열·공백만 입력 시 `keyword = raw.trim()` 그대로 유지(빈 검색은 외부 API가 처리)

### 4.3 보수적 안전망

- 사건번호 정규식이 너무 짧은 키워드("두"·"가")에 오매칭하지 않도록 `\d{4}` 연도 prefix + 1~8자리 번호 suffix 강제
- 불용어 제거 후 검색어 길이가 1 이하면 → 정규화 무효 (원본 keyword 사용)
- 모든 결과가 빈 배열이면 정규화 미적용 fallback(다음 호출 시 자동 복구 — 캐시 TTL 5분)

---

## 5. Acceptance Criteria (완료 조건)

### 5.1 단위 테스트 (vitest)

1. [ ] 불용어 제거: `"법인이 사기로 양도세 신고누락 시 가산세 사례 찾아줘"` → `"법인이 사기로 양도세 신고누락 시 가산세"`
2. [ ] 사건번호 정확매칭: `"2023두12345 관련 판례 보여줘"` → `caseNumber="2023두12345"`, `keyword="법인이..."`
3. [ ] 심판례 사건번호: `"조심2023서0001 결정"` → `caseNumber="조심2023서0001"`
4. [ ] 사건번호 + 공백 변형: `"조심 2023 서 0001"` → 인식
5. [ ] 빈 입력: `""` → `keyword=""`, `caseNumber=null`
6. [ ] 정규화 후 검색어 길이 ≤ 1 → 원본 keyword 보존 (보수적 fallback)
7. [ ] 사건번호 정규식이 일반 단어("두 사람", "가산세")에 오매칭하지 않음

### 5.2 어댑터 회귀

8. [ ] `nationalTaxLaw.ts:464~471` 4트랙 호출 진입 직후 정규화만 적용, 다른 로직 무변경
9. [ ] 골든셋 비법령 40건(G-N1~N4 + G-S-NL-01~04 + 비법령 트랙 인용) 회귀: V1·V2 통과율 ≥ 적용 전 수준
10. [ ] vitest 전체(346건+) PASS 유지
11. [ ] `npm run typecheck` EXIT 0
12. [ ] `npm run lint` 에러 0

### 5.3 안전 보증

13. [ ] CLAUDE.md §6.1 원문 보존: 검색 결과(`TaxLaw[]`) 데이터 무변경 — 정규화는 입력만
14. [ ] CLAUDE.md §6.4 검증 우회 없음: V1~V6 로직 무변경
15. [ ] 캐시 키(`query.keyword.trim().toLowerCase()`)는 정규화 전 raw 기준 유지(캐시 히트율 보존)

---

## 6. Verification (검증 단계)

1. `npm test -- src/domain/nonLawQueryNormalize` — 단위 테스트 7건 PASS
2. `npm run typecheck` — EXIT 0
3. `npm run lint` — 신규 파일 에러 0
4. `npm test` — 전체 346건+ PASS
5. (회계사 직접) 회귀 케이스 5건 수동 검증:
   - "법인 사기 양도세 가산세 판례 찾아줘" → 결과 정성적 관련성 ↑ 확인
   - "2023두12345 어떤 판결인지 알려줘" → 사건번호 매칭 확인
   - "조심2023서0001 결정" → 심판례 매칭 확인
   - "1세대 1주택 비과세" (사건번호 없음) → 회귀 변화 없음 확인
   - 골든셋 G-N1~N4 4건 → V1·V2 통과 유지 확인

---

## 7. Risks / Notes

| # | 위험 | 완화 |
|---|---|---|
| ① | 불용어 사전이 회계사가 정말 쓰는 핵심 단어를 제거 | 사전 보수적 구성 + 길이 ≤ 1 fallback + 골든셋 회귀 |
| ② | 사건번호 정규식 미커버 형식 | 자연어 fallback (정확매칭 실패해도 일반 검색은 그대로) |
| ③ | 외부 API가 사건번호 정확매칭을 지원하는지 트랙별 차이 | `query=` 파라미터 그대로 사건번호 전달 — API가 본문 매칭으로 처리(검증된 동작 패턴, korean-law-mcp 동일) |
| ④ | TAX-031(`normalizeLawName`)과 동시 적용 시 충돌 | 비법령 트랙만 신규 정규화 적용 — `fetchArticles`는 무변경 |
| ⑤ | 캐시 키 정합성 | `cacheKey`는 raw 기준 유지(어댑터 `search()` 진입 시점 결정) |

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출

- [x] 근본 원인 분석: 비법령 4트랙 입력 정규화 부재
- [x] 영향 파일 목록: §2.1
- [x] 구현 계획: §4 + 본 티켓과 함께 별도 계획서 제시(결정 포인트 §9 8번 정합)

### 8.2 코딩 후 제출

- [ ] 변경 파일 목록
- [ ] 단위 테스트 7건 PASS 캡처
- [ ] vitest 전체 PASS 캡처
- [ ] typecheck·lint 결과
- [ ] 골든셋 비법령 회귀 결과
- [ ] 리포트 파일: `docs/reports/TAX-043_report.md`

---

## 9. Ticket Size Rule

- 신규 1파일(`nonLawQueryNormalize.ts`) + 테스트 1파일 + 어댑터 4트랙 진입부 4줄 = 합계 ~3파일
- S 크기 (1~2시간 이내 완료 가능)

---

## 10. Related Tickets

- 선행:
  - `TAX-031` 법령명 정확매칭 + 약칭 사전 (법령 트랙 정규화 — 본 티켓과 분리)
  - `TAX-042E` 인사이트 리포트 (`docs/reports/TAX-042E_nonlaw-search-insights.md` §3 옵션 B+C)
- 후속:
  - `TAX-044` (옵션 A) 세무 도메인 사전 + 법리·사실축 결합 검색 — 본 티켓 완료 후 진행
  - `TAX-045` (옵션 D+E) 저정보 조문 패널티 + 사후 검증
- 참조:
  - `C:\Users\sfami\WorkSpace\korean-law-mcp-main\src\tools\compact-query-planner.ts`

---

## 11. Report Link

Report: `docs/reports/TAX-043_report.md` (완료)

---

**작성자**: AI(Claude Opus 4.7)
**작성일**: 2026-06-08
**최종 수정일**: 2026-06-08
