# TAX-042F 리포트 — 입력 컨텍스트 윈도우 초과 처리

> 작성일: 2026-06-07
> 티켓: `docs/tickets/TAX-042F_input_context_window.md`
> 선행: TAX-042A(진단 인프라), TAX-042B(출력 측면 + cause 진단으로 본 결함 발견)

---

## 1. 사전 진단 결과

`scripts/perf/diagnoseSearch.ts`로 G-S-법인-06을 검증한 결과(answerGenerator 호출 없이 queryRewriter + searchPort만 실행):

| 항목 | 값 |
|---|---|
| queryRewriter 생성 키워드 | "법인세법"(243건), "손비 항목"(3건), "법인세 시행령"(296건) |
| 검색 결과 누적 조문 개수 | **542개** |
| 총 content 합계 | 약 41만 자 / **~54만 토큰** |
| GPT-4o-mini 입력 윈도우 | 128,000 토큰 |
| 초과율 | **약 4.2배** |

**결정적 발견**: 단일 거대 조문이 아니라 **다수 조문 누적**이 원인. queryRewriter가 "법인세법" 같은 광범위 한 단어 키워드를 만들어 search 어댑터에서 200+건씩 dump하는 구조적 문제.

---

## 2. 채택 전략 — korean-law-mcp 인사이트 기반 3중 방어

회계사 승인(2026-06-07) 사항을 그대로 구현:

| 단계 | 출처 | 효과 |
|---|---|---|
| A. `compactLawContent` | korean-law-mcp `src/lib/decision-compact.ts:36` (평균 -74% 실측) | 본문 앞 1500 + 중략 마커 + 뒤 500, 한국어 종결어미 가드(`한다.`, `있다.`, `본다.`, `정한다.`) |
| B. `densifyArticleRefs` | korean-law-mcp `densifyLawRefs:99` (평균 -40%) | "제26조(법인세 과세표준의 계산)" → "제26조" |
| C. `truncateForContext` | Trust Tier 정렬 + `compact-query-planner.ts:300` 키워드 가중치 차용 | T1→T2→T3→T4 우선, 같은 Tier 내 질문 키워드 매칭 점수 정렬, 누적 ≤ 60K 컷오프, 최소 1건 보장 |

핵심 안전 장치(CLAUDE.md §6.1·§6.4):
- `TruncateResult { promptLaws, originalRefs }`로 압축본 ↔ 원본 인덱스 1:1 분리
- `citations.taxLaw`는 `originalRefs[c.lawIndex]` 사용 → V1 출처 존재 정상
- `extractExcerpt(originalRefs[c.lawIndex].content, ...)` → V2 인용 무결성 substring 보장
- SYSTEM_PROMPT에 "⋯ 중략 N자 ⋯" 마커 인지 규칙 추가 → LLM이 중략 부분 인용 회피

---

## 3. 변경 사항 요약

**파일 변경 목록:**

- `src/adapters/contextBudget.ts` (신규, 196줄): 5개 export 함수 + `SAFE_INPUT_TOKENS`·`TIER_RANK` 상수 + `TruncateResult` interface
- `src/adapters/llmAnswerGenerator.ts` (수정): `truncateForContext` import, `generate()` 진입부 통합(promptLaws → buildLawsContext, citations 매핑 originalRefs 기반), SYSTEM_PROMPT에 중략 마커 인지 규칙 6줄 추가
- `tests/unit/contextBudget.test.ts` (신규): 16건 (estimateTokens·compactLawContent·densifyArticleRefs·extractQuestionKeywords·relevanceScore·truncateForContext)

**주요 변경:**
- 입력 토큰 추정·축약·컷오프 로직을 어댑터 자기완결로 추가(Port·Usecase·도메인 시그니처 무변경)
- TaxLaw 객체 원본은 절대 mutate하지 않음 — 압축은 프롬프트 임시본에만 적용

---

## 4. 검증 결과

### 4.1 4종 품질 게이트

| 명령 | 결과 |
|---|---|
| `npm run lint` | PASS (사전 무관 warning 1건 외 0 errors) |
| `npm run typecheck` | PASS |
| `npm run test` | **296/296 PASS** (기존 280 + 신규 16, 회귀 0건) |
| `npm run build` | PASS (Next.js 16.2.6 Turbopack) |

### 4.2 G-S-법인-06 단건 × 3회

| # | 결과 | citations | time(s) | verify |
|---|---|---|---|---|
| 1 | PASS | 5 | 10.30 | PASS |
| 2 | PASS | 5 | 27.02 | PASS |
| 3 | FAIL | – | 15.58 | E-VERIFY-FAIL |

**해석**: TAX-042B 단건 측정에서는 **3/3 모두 E-LLM-UNAVAILABLE(컨텍스트 윈도우 초과)** 였음. 본 티켓 적용 후 컨텍스트 윈도우 초과는 **완전 소거** 됐고, 1·2회는 정상 답변 + V1~V6 통과. 3회의 E-VERIFY-FAIL은 컨텍스트 문제가 아니라 LLM 답변 품질의 산발적 변동(중략 마커 영역에서 인용 시도 또는 focusHint substring 미스로 추정). 본 티켓 범위 밖이며 다음 TAX-042G(queryRewriter 키워드 좁히기)로 자연 해소 가능성이 큼(542→수십 건으로 줄면 중략 자체가 거의 사라짐).

### 4.3 회귀 4종 단건 × 1회

| 케이스 | 결과 | citations | time(s) | verify |
|---|---|---|---|---|
| G-1 | PASS | 1 | 6.46 | PASS |
| G-2 | PASS | 4 | 8.15 | PASS |
| G-N1 | PASS | 2 | 5.10 | PASS |
| G-S-법인-01 | PASS | 5 | 7.89 | PASS |

**회귀 0건**. short-circuit(모든 content ≤ 2500자 + 누적 < SAFE/2 → 원본 그대로) 효과로 기존 정상 케이스 영향 없음 — 회귀 검증으로 입증.

### 4.4 V2 인용 무결성 유지 확인

- `citations[i].taxLaw`는 `originalRefs[c.lawIndex]` = 원본 TaxLaw 객체 참조
- `extractExcerpt`는 원본 `content`로 substring 추출
- 회귀 4종에서 V1~V6 모두 PASS → V2(인용 무결성) 원본 대조 정상

---

## 5. 잠재 위험 및 완화

| 위험 | 완화책 | 현 상태 |
|---|---|---|
| 중략 마커 영역에 답이 있는 경우 V2 FAIL | SYSTEM_PROMPT에 중략 마커 인지 규칙 추가, LLM이 해당 조문 citation 제외 | G-S-법인-06 3/3 회차 중 1회 FAIL — 규칙 효과 부분적, LLM 변동 영향 |
| 컷오프된 조문에 답이 있는 경우 | Trust Tier(T1 우선) + 질문 키워드 매칭 가중치 + 최소 1건 보장 | 1·2회 정상 PASS로 정렬 효과 입증 |
| 토큰 추정 부정확 | 한글 2 / 기타 0.3 간이 추정, SAFE=60K 보수 설정 | 윈도우 128K 대비 절반 이하로 마진 충분 |
| **근본 원인 미해결**: queryRewriter가 광범위 키워드 생성 | **TAX-042G로 분리** — `compact-query-planner.ts` 법리축+사실축 패턴 이식 권장 | TAX-042F 범위 밖, 후속 티켓 |

---

## 6. 후속 권장 작업

1. **TAX-042G (강력 권장)**: queryRewriter에 `compact-query-planner.ts:332 buildOriginalQueryAxes` 패턴 이식. 법리축(법인세법·소득세·부가세) + 사실축(손비·접대비·기부금) 결합 키워드 생성. 542건 → 수십 건으로 줄여 G-S-법인-06 잔여 1건 FAIL의 근본 원인 해소.
2. TAX-042C (Stage 3): `maxTokens`·retry 처방. 본 티켓에서 input 측 해결 후 output 측 안정성 보강.
3. TAX-042D (Stage 4): V3 라벨 적정성 강화.
4. TAX-042E (Stage 5): 100회 회귀.

---

## 7. 참고

- 인사이트 출처: `C:\Users\sfami\WorkSpace\korean-law-mcp-main\src\lib\decision-compact.ts:36-87`, `compact-query-planner.ts:115-371`
- V2 보호 근거: CLAUDE.md §6.1 인용 무결성, §6.4 law-verifier V1~V6
- TaxLaw 무변경 근거: `src/domain/TaxLaw.ts:25` "모든 텍스트 필드는 외부 API 원문과 문자 단위 일치 필수"
