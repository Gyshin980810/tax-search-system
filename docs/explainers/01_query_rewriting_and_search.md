# RAG 파이프라인 해설 ① — 질문 처리(쿼리 변환)와 검색

> 이 문서는 **초보자도 이해할 수 있게** 우리 시스템이 회계사 질문을 어떻게 처리하는지 설명합니다.
> 대상 단계: RAG 5단계 중 **[1] 자연어 쿼리 변환**과 **[2] 외부 API 검색**.
> 작성일: 2026-06-24 / 기준 커밋: master

---

## 0. 전체 그림 (5단계 파이프라인)

```
회계사 질문
   ↓
[1] 쿼리 변환   ← LLM이 질문을 "검색 키워드"로 통역  (이 문서 §1)
   ↓
[2] 검색        ← 키워드로 조문·해석례·심판례·판례 긁어옴  (이 문서 §2)
   ↓
[3] 답변 생성   ← LLM이 결과 요약 + 라벨·시점 부착   (별도 문서)
   ↓
[4] 검증 V1~V6  ← law-verifier가 독립 검증           (별도 문서)
   ↓
[5] 회계사 화면 출력
```

> 비유: 시스템은 **도서관 사서**처럼 일합니다.
> ① 손님 말을 전문 용어로 통역 → ② 서가에서 책 찾기 → ③ 요약해 건네기 → ④ 검수 → ⑤ 전달.

---

## 1. [1단계] 질문 처리 = 쿼리 변환 (Query Rewriting)

**담당 코드:** `src/adapters/llmQueryRewriter.ts`
**담당 에이전트 역할:** `tax-planner` (검색어 생성 전담 — 원문·답변 생성 금지)

### 1.1 한 줄 정의

회계사의 **일상어 질문**을 국세법령정보시스템 API가 알아듣는 **세법 전문 키워드**로 번역한다.
이 단계는 **답을 만들지 않는다.** 오직 "검색어"만 만든다.

> 예: "법인이 특수관계자에게 부동산을 싸게 팔면 세금 문제 있나요?"
> → `법인세법 부당행위계산부인`, `법인세법 시행령 특수관계인 저가양도`

### 1.2 입력 → 처리 → 출력

```
[입력]  회계사 질문 + 시점 정보(언제 기준 법인지)
   ↓
[처리]  GPT-4o-mini 키워드 추출  +  코드의 결정론적 보정
   ↓
[출력]  검색 키워드 최대 3개 (SearchQuery[])
```

### 1.3 실제 6단계 (코드 기준)

#### 1) 질문 + 시점 전달 (line 68-70)
```typescript
const userPrompt = temporal.explicit && temporal.targetDate
  ? `질문: ${question}\n기준 시점: ${temporal.targetDate.toISOString().slice(0, 10)}`
  : `질문: ${question}`
```
"예전 법", "2023년 기준" 같은 시점이 있으면 함께 넘긴다(시점 정확성, CLAUDE.md §6.2).

#### 2) 규칙서(System Prompt) 부여 (line 31-50)
GPT-4o-mini가 받는 핵심 규칙:
- 법령명·조문 제목·**세법 공식 용어** 중심 (생활어 ❌)
- **최대 3개**, 핵심 → 확장 순
- **개인정보(주민번호·사업자번호) 절대 금지** (§7)
- **법리축 + 사실축 결합** (TAX-042G):
  - 법리축 = 어떤 법인가 (`법인세법`, `소득세법`)
  - 사실축 = 어떤 쟁점인가 (`부당행위`, `접대비`)
  - ❌ 법리축 단독 금지 → 검색 결과 200건 폭증 위험

#### 3) "정해진 틀"로만 답하게 강제 (line 52-58, 77-79)
```typescript
const querySchema = z.object({
  queries: z.array(z.object({ keyword: z.string().min(1).max(100) })).min(1).max(3),
})
// generateObject = 자유 문장 금지, 이 JSON 틀로만 응답
```
객관식 답안지처럼 칸을 파놓고 그 칸만 채우게 한다 → 다음 단계가 안정적으로 수신.

#### 4) 결정론 고정 (line 84)
```typescript
temperature: 0,  // 같은 질문 = 항상 같은 키워드 (TAX-6A-11)
```
검색 결과가 매번 흔들리면 정확성이 무너지므로 무작위성을 0으로.

#### 5) 코드의 결정론적 후처리 (line 96-106) ⭐
LLM 출력을 **그대로 쓰지 않는다.** 두 가지를 더한다:
- `enforceAxisCombination` (line 96): LLM이 법리축 한 단어만 뱉으면, 질문에서 사실축을 찾아 자동 부착(안전망, TAX-042G).
- `lookupArticleHints` (line 100): "제70조" 같은 조문번호를 **사전에서 결정론적으로 prepend**(TAX-049) → 외부 API 정확매칭 트리거.

#### 6) 병합·중복 제거 (line 106-117)
사전 힌트 N개 + LLM (3-N)개 = **총 3개 이내**(LLM 최소 1개 보장), 중복 제거 후 반환.

### 1.4 안전장치

| 장치 | 코드 | 이유 |
|---|---|---|
| 타임아웃 25초 | `LLM_TIMEOUT_MS` (line 20) | 지연 시 끊고 에러 처리(P95 보호) |
| temperature 0 | line 84 | 결정론 |
| PII 금지 | System Prompt 규칙 5 | 개인정보 검색어 유입 차단 |

실패는 `LlmTimeoutError`/`LlmUnavailableError`로 변환(line 118-121) — 조용히 틀린 답 대신 명확히 "실패".

### 1.5 이 단계가 하지 않는 것
- ❌ 법령 원문 변형 ❌ 답변 생성 ❌ 라벨·Trust Tier 부착 → **오직 검색어 생성만.**

---

## 2. [2단계] 검색 (External API Search)

**담당 코드:** `src/adapters/nationalTaxLaw.ts`
**담당 에이전트 역할:** `tax-searcher` (외부 API 호출 → 원문 그대로 TaxLaw[] 반환)

### 2.1 한 줄 정의

쿼리 변환이 만든 키워드로 **국세법령정보시스템 API를 호출**해 5종(법령·법제처해석·국세청해석·심판례·판례)을 가져와 Trust Tier 순으로 병합한다.

### 2.2 5종 동시 검색 (line 574-592)
```typescript
const [lawResult, interpItems, ntsItems, tribunalItems, precItems] = await Promise.all([
  this.fetchArticles(query.keyword, undefined, query.targetDate),  // 법령(조문)
  this.searchInterpretations(query.keyword).catch(() => []),       // 법제처 해석례
  this.searchNtsInterpretations(query.keyword).catch(() => []),    // 국세청 해석례
  this.searchTribunal(query.keyword).catch(() => []),              // 심판례
  this.searchPrecedents(query.keyword).catch(() => []),            // 판례
])
items = [...lawResult.items, ...interpItems, ...sortByDecisionDate(ntsItems),
         ...tribunalItems, ...sortByDecisionDate(precItems)]
```
- `Promise.all` = 5종 **동시** 검색(빠름)
- `.catch(() => [])` = **부분 실패 허용**(비법령이 죽어도 법령은 살림). 단 **법령만 catch 없음** → 핵심이라 실패 시 전체 실패(의도).
- **Trust Tier 순 병합**: 법령(T1·T2) → 해석례(T3) → 심판례(T3) → 판례(T4).

### 2.3 법령 검색의 구조 (line 655-666)
```typescript
const normalized = normalizeLawName(keyword)        // 약칭 → 정식명 (TAX-031)
const laws = await this.searchLaws(normalized)      // display=5 → 후보 법령 5개
const topLaw = selectBestLaw(laws, normalized)!.law // 그중 "딱 1개"만 선택
const { articles } = await this.fetchLawArticles(topLaw.법령일련번호) // 그 법의 조문 전체
```
- 약칭 정규화(TAX-031): "상증세법" → "상속세 및 증여세법"
- 정확매칭 선택(TAX-031): API 1위가 동음이의 법일 수 있어("지방세법"→1위 "지방교부세법") 정식명과 가장 일치하는 법을 고름.
- **후보 5개 중 1개만** 조문 수집 → 한계는 §3 개선점 참조.

### 2.4 원문 보존·시점 필터
- `assembleArticleContent` (line 685): 항·호·목 본문을 **원문 그대로 조립**(번호 prepend·요약·재배열 없음, §6.1).
- `targetDate` 필터 (line 705-710): 과거 시점 지정 시 **조문시행일자 ≤ 기준일**만 반환(TAX-6A-4, 클라이언트 필터).
- 부칙 병합 (line 715): 시점 경계 부칙을 T2로 첨부(TAX-6B-1 FR-17).

### 2.5 캐시 (line 554-597)
```typescript
const cacheKey = `${keyword}|${articleNumberHint}|${targetDate}`  // 조문힌트·시점 포함
```
같은 키워드+조문힌트+시점이면 캐시 반환. 빈 결과는 짧은 TTL(`CACHE_EMPTY_TTL_MS`).

---

## 3. 개선점 (코드 분석, 2026-06-24)

| # | 단계 | 발견 | 근거 | 심각도 | 관련 |
|---|---|---|---|---|---|
| P1 | 처리 | 쿼리 변환 결과 미캐시(temperature 0이라 결정론인데 매번 GPT 호출) | `llmQueryRewriter.ts` 전체 | 중 | quick win |
| P2 | 처리 | 법령 후보 5개 중 1개만 선택 → 2순위 법 정답 조문 누락 | `nationalTaxLaw.ts:665` | 중 | **TAX-6B-22** |
| P4 | 처리 | 인메모리 캐시 → Vercel 서버리스 인스턴스마다 비어 콜드스타트 미스 | `nationalTaxLaw.ts:557` | 중 | 공유 캐시(Neon/KV) |
| I2 | 입력 | 프롬프트 "10자 이내" vs 예시(13자)·스키마 max(100) 불일치 | `llmQueryRewriter.ts:37,48,55` | 소 | quick win |
| I1 | 입력 | `toISOString().slice(0,10)` UTC 변환 → KST 날짜 경계 어긋남 의심 | `llmQueryRewriter.ts:69`, `nationalTaxLaw.ts:554` | 소(검증) | TemporalContext 확인 |
| O1 | 출력 | 법령 검색 재시도 없음(resultCode≠00 즉시 throw) → 일시 블립 취약 | `nationalTaxLaw.ts:615` | 소 | 베타 로그 후 |

> ⚠️ I1은 코드만 본 "의심"이며 `TemporalContext`의 `targetDate` 생성 방식 확인 후 확정 필요(단정 금지).

---

## 4. 참고

- CLAUDE.md §5(RAG 5단계), §6.2(Trust Tier·시점 라벨), §7(개인정보)
- 관련 티켓: TAX-042G(축 결합), TAX-049(조문번호 사전), TAX-031(약칭·정확매칭), TAX-6A-4(시점 필터), TAX-6A-11(결정론), TAX-6B-22(법령 하이브리드 의미검색)
- 다음 문서(예정): `02_answer_generation_and_verify.md` — [3] 답변 생성 + [4] V1~V6 검증
