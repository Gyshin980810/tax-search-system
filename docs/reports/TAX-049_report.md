# TAX-049 리포트 — 조문번호 매핑 사전 + 어댑터 articleNumber 통합 (Track 1A)

> 티켓: `docs/tickets/TAX-049_article_number_hints_dictionary.md`
> 선행: TAX-048 (Track 2A SYSTEM_PROMPT 강화) — V3 PASS 11/11(100%) 달성
> 회계사 검수: 2026-06-09 — 결정 ④ 추천(a) 채택(AI 초안 → 검수 → 적용)
>             + 검수 후 발견된 이상점 6건 "일괄 위임"으로 자동 반영
>             + 옵션 A(어댑터 articleNumber 통합) 채택
> 작성: AI(Claude Opus 4.7), 2026-06-09

---

## 1. 30초 요약

TAX-048에서 V3 라벨 부적절은 SYSTEM_PROMPT로 해결했지만, **근본 원인인 "T1 검색 미확보"는 미해결**이었다. 본 티켓은 회계사 자연어 키워드 → 정식 법령명·조문번호의 결정론적 룩업 사전(47개)을 만들고, **어댑터 `fetchArticles`가 조문번호 힌트로 T1 조문을 정확 추출**하도록 통합했다.

- **핵심 성과**: G-S-소득-03가 처음으로 **T1 소득세법 제70조 정확 매칭**에 성공(이전 P95 100회에서 V3 FAIL 재현 케이스). 응답 시간도 **16.5s → 5.33s로 3배 단축**(사전 매칭 시 비법령 검색 스킵).
- **회귀 검증**: 단건 진단 8회 V3 **PASS 8/8 (100%)**. 5케이스 전부 PASS. vitest 387/387.
- **부수 성과**: G-S-상증-01 검색 결과 폭증(148개 → 4개) 해결. LLM 입력 윈도우 초과 위험 제거.

---

## 2. 변경 사항 요약

### 2.1 파일 변경 목록

| 파일 | 상태 | 변경 |
|---|---|---|
| `src/domain/articleNumberHints.ts` | 신규 | 47개 항목 사전 + `lookupArticleHints` 룩업 함수 |
| `src/domain/SearchQuery.ts` | 수정 | `articleNumberHint?` optional 필드 추가 |
| `src/adapters/nationalTaxLaw.ts` | 수정 | `search()` 분기 + `fetchArticles()` 조문 필터링 |
| `src/adapters/llmQueryRewriter.ts` | 수정 | 사전 prepend 통합 + cap 정책 (사전 N개 + LLM (3-N)개) |
| `tests/unit/articleNumberHints.test.ts` | 신규 | 사전 매칭·중복 제거·골든셋 9건 커버 검증 |
| `docs/tickets/TAX-049_article_number_hints_dictionary.md` | 신규 | 사전 초안 47개 + 검수 가이드 + 운영 보강 표시 |

### 2.2 주요 변경 내역

**(1) 사전 모듈 신규 (`src/domain/articleNumberHints.ts`)**

47개 항목(A.소득세법 14 · B.법인세법 8 · C.부가가치세법 7 · D.상증법 6 · E.종부세법 3 · F.지방세법 6 · G.국세기본법 3) 회계사 검수 완료.

```typescript
export function lookupArticleHints(question: string, requestedAt: Date): SearchQuery[]
// 부분 문자열 매칭 → SearchQuery { keyword: 법령명, articleNumberHint: "제N조" }[]
```

**(2) SearchQuery 확장**

```typescript
interface SearchQuery {
  keyword: string
  requestedAt: Date
  articleNumberHint?: string  // TAX-049
}
```

**(3) 어댑터 `fetchArticles` 조문 필터링**

```typescript
private async fetchArticles(keyword: string, articleNumberHint?: string)
// 힌트 부여 시 articles 중 articleNumber === hint인 조문만 반환
```

**(4) 어댑터 `search()` 분기**

`articleNumberHint`가 있으면 법령 본문(T1·T2)만 정확 검색. 비법령(prec·expc·cgmExpc·decc) **스킵** — 비법령 자료는 다른 LLM rewrite 쿼리에서 fallback으로 검색됨.

→ 외부 API 호출 수 감소(5→1), G-S-상증-01 결과 폭증 방지.

**(5) llmQueryRewriter cap 정책**

```typescript
const llmCap = Math.max(MAX_LLM_QUERIES - hintQueries.length, 1)
// 사전 1개 매칭 시 LLM 2개로 줄여 합산 3 유지
```

### 2.3 무변경 보장 (CLAUDE.md §6.4 보호)

- `src/adapters/lawVerifier.ts` — **무변경** (V1~V6 판정 로직)
- `src/adapters/verifyDiagnostics.ts` — **무변경**
- `TIER_ALLOWED_LABELS` 상수 — **무변경**
- `src/adapters/llmAnswerGenerator.ts` — **무변경** (TAX-048 영역)
- 골든셋 데이터(`eval/golden_direct.json`) — **무변경**
- 어댑터 `articleNumberHint` 미부여 경로(기존 동작) — **무변경**

---

## 3. 진행 과정 (1차 진단 → 옵션 A 채택 → 운영 보강)

### 3.1 1차 시도 (Naïve prepend)

- 사전이 `"법령명 제N조"` 형태 단일 keyword로 prepend
- **문제 발견**:
  - G-S-소득-03: 검색 23개, **T1 0개** 여전 (어댑터 `selectBestLaw`가 "소득세법 제70조"를 법령명으로 매칭 못 함 → fallback)
  - G-S-상증-01: 검색 5개 → **148개 폭증** (~266K 토큰, **윈도우 초과 ⚠️**) — 사전 + LLM 4개 쿼리의 비법령 결과 누적

### 3.2 옵션 A 채택 (회계사 결정 2026-06-09)

| 옵션 | 비교 | 채택 |
|---|---|---|
| A | 어댑터에 `articleNumberHint` 통합 — T1 정확매칭 + 외부 호출 감소 | ⭐ **채택** |
| B | 키워드를 법령명만으로 단순화 | 의미 없음(약칭사전과 동일) |
| C | TAX-049 롤백 + Phase 4 직행 | 보류 |

### 3.3 운영 보강 1건 (2026-06-09)

옵션 A 통합 후 G-S-소득-03이 여전히 사전 미매칭. 원인: 회계사 검수에서 `"확정신고"` → `"확정신고기한"`으로 강화하셨지만 골든셋 질문 `"…확정신고는 언제까지…"`에 "기한"이 없음. **검수 의도(기한 강조) 보존 + 매칭 폭 확장**으로 짧은 형태 4개 추가:

```typescript
keywords: ['종합소득세 확정신고', '종합소득세 확정신고기한',
           '종합소득 확정신고', '종합소득 확정신고기한']
```

---

## 4. 검증 결과

### 4.1 자동 검증

| 항목 | 결과 |
|---|---|
| `npm run typecheck` | ✅ EXIT 0 |
| `npm run test` (vitest 전체) | ✅ **387/387 PASS** (회귀 0건) |

### 4.2 검색 진단 (`perf:diagnose-search`)

| 케이스 | 결과 수 | T1 등장 | 비고 |
|---|---|---|---|
| **G-S-소득-03** | 12 → **13** | **0 → 1 (제70조)** ✨ | 사전 매칭 + 어댑터 필터 |
| **G-S-상증-01** | 148 → **4** | 0 → 1 (제19조) ✨ | 폭증 해결 + T1 확보 |

### 4.3 V3 PASS 회귀 (`perf:single-diagnostics`)

| 케이스 | 회수 | PASS | V3 PASS | 평균 시간 | 이전 대비 |
|---|---|---|---|---|---|
| **G-S-소득-03** | 3 | 3/3 | **3/3** | 5.33s | TAX-048 후 16.50s → **3배 단축** |
| **G-S-상증-01** | 2 | 2/2 | **2/2** | 5.41s | 회귀 없음 |
| G-1 | 1 | 1/1 | 1/1 | 5.89s | 회귀 없음 |
| G-S-법인-01 | 1 | 1/1 | 1/1 | 8.54s | 회귀 없음 |
| G-S-부가-01 | 1 | 1/1 | 1/1 | 21.10s | 회귀 없음 |
| **총** | **8** | **8/8** | **8/8 (100%)** | | |

### 4.4 부수 효과

- **외부 API 호출 수 감소**: 사전 매칭 시 비법령 검색 스킵 → 5번 → 1번 (P95 부담 완화)
- **LLM 입력 토큰 감소**: G-S-상증-01 266K → 25K
- **응답 시간 단축**: G-S-소득-03 평균 16.5s → 5.33s

---

## 5. CLAUDE.md 정합성 검증

| 항목 | 본 티켓 정합 |
|---|---|
| §2 정확성 > 완전성 | ✅ T1 정확 추출 + V3 PASS 100% |
| §6.1 인용 무결성 | ✅ 무변경 (excerpt·V2 로직 무변경, 사전은 검색 키워드만 다룸) |
| §6.2 시점 라벨 | ✅ 무변경 |
| §6.3 라벨링 시스템 | ✅ TIER_ALLOWED_LABELS·V3 판정 로직 무변경 |
| §6.4 V1~V6 검증 우회 금지 | ✅ `lawVerifier` 무변경, V3 PASS 8/8 |
| §7 개인정보·시크릿 | ✅ 사전은 공개 법령명·조문번호만, PII 없음 |
| §8 워크플로우 | ✅ 티켓 → 회계사 검수 → 일괄 위임 → 옵션 A 결정 → 구현 → 검증 → 리포트 |
| §9 7 최소 변경 | ✅ 사전 신규 1 + 어댑터 2개 함수 + 1 타입 확장 |
| §9 8 계획 먼저 | ✅ 옵션 A/B/C 장단점 표 제시 → 회계사 결정 |
| §9 10 STOP & ASK | ✅ 1차 진단 실패 시 즉시 보고 → 회계사 결정 받음 |

---

## 6. 잠재 위험·한계

| # | 위험 | 현재 완화 | 후속 |
|---|---|---|---|
| ① | 사전 47개 커버리지 한계 — 다른 골든셋 케이스도 매칭 실패 가능 | 부분 문자열 매칭으로 유연성 확보 + LLM rewrite fallback | P95 100회 재측정에서 매칭 실패 케이스 발견 시 보강 |
| ② | 키워드 모호성 — "인적공제" 같은 짧은 키워드가 다른 조문도 매칭 | 다중 매칭 허용·중복 제거로 안전 | 운영 로그 분석 후 키워드 세분화 |
| ③ | 사전 매칭 시 비법령 스킵 — 회계사가 T3 자료를 못 볼 가능성 | 다른 LLM rewrite 쿼리에서 자연 fallback으로 검색됨 | 운영 관찰 |
| ④ | 사전 확장 거버넌스 — 임의 추가 금지 | CLAUDE.md §9 8 (회계사 검수) | PR 검수 절차 유지 |
| ⑤ | G-S-부가-01 21.10s — 일부 케이스 응답 시간 변동 | 평균은 단축, 일부 변동 잔존 | TAX-042 LLM 속도 후속 |

---

## 7. 변경 위치 빠른 참조 (file:line)

- `src/domain/articleNumberHints.ts:1~140` — 사전 47개 + 룩업 함수 신규
- `src/domain/SearchQuery.ts:10~17` — `articleNumberHint?` 필드 추가
- `src/adapters/nationalTaxLaw.ts:457~498` — `search()` `articleNumberHint` 분기
- `src/adapters/nationalTaxLaw.ts:538~597` — `fetchArticles()` 조문 필터링
- `src/adapters/llmQueryRewriter.ts:19~29` — `MAX_LLM_QUERIES` 상수
- `src/adapters/llmQueryRewriter.ts:84~104` — 사전 prepend + 동적 cap

---

## 8. 다음 단계

1. **P95 100회 재측정** (TAX-029 재실행) — TAX-048 + TAX-049 누적 효과 확인
   - 가설: V3 PASS rate 91.3% → ~98%+ / G-S-소득-03 등 매칭 케이스 시간 단축 → 누적 P95 개선
2. Phase 4 게이트 판정
3. 운영 로그에서 사전 미매칭 케이스 발견 시 키워드 보강 (회계사 검수 후 PR)

---

**작성**: AI(Claude Opus 4.7), 2026-06-09
**티켓**: `docs/tickets/TAX-049_article_number_hints_dictionary.md`
**연관 리포트**: `docs/reports/TAX-048_report.md`
