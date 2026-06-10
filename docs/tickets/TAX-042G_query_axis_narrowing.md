# TAX-042G — queryRewriter 법리축+사실축 좁히기 (광범위 키워드 근본 원인 해소)

> 작성자: AI(Claude Opus 4.7) / 작성일: 2026-06-07
> 배경: TAX-042F 진단에서 G-S-법인-06 입력 컨텍스트 윈도우 4.2배 초과의 **근본 원인이 queryRewriter의 광범위 한 단어 키워드 생성**임을 확인. 압축으로 윈도우는 막혔으나 "중략 마커"에 정답이 묻혀 잔여 1/3 verify FAIL. 검색 단계(stage 2)에서 542건 → 수십 건으로 줄여 압축 의존도 자체를 낮춘다.
> 진단 근거: TAX-042F 리포트 §1 (`"법인세법"(243건)`, `"법인세 시행령"(296건)`, `"손비 항목"(3건)`)

---

## Metadata

- **Type**: TASK (검색 정확성·LLM 컨텍스트 효율 동시 개선)
- **Severity**: major (TAX-042F 잔여 1/3 FAIL의 근본 원인)
- **Layer**: adapter (`llmQueryRewriter`) + 신규 어댑터 유틸 (`queryAxisGuard`)
- **Milestone**: Post-MVP (TAX-042 처방 묶음, TAX-042F 직후)
- **Estimated Size**: M (3~4 파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

`OpenAIQueryRewriterAdapter.rewrite()`가 GPT-4o-mini로부터 최대 3개의 검색 키워드를 받고 그대로 반환. SYSTEM_PROMPT(`llmQueryRewriter.ts:20-28`)는 "법령명·조문 제목·세법 용어"만 안내해 **한 단어 광범위 키워드**(예: `법인세법`, `법인세 시행령`)를 그대로 허용. 결과:

| 측정 (TAX-042F §1) | 결과 |
|---|---|
| G-S-법인-06 "법인세법" | search items=243건 |
| G-S-법인-06 "법인세 시행령" | search items=296건 |
| G-S-법인-06 "손비 항목" | search items=3건 |
| 누적 조문 | **542건** / ~54만 토큰 / 입력 윈도우 4.2배 초과 |

### 1.2 기대 동작

- 검색 키워드는 **법리축(법령·세목) + 사실축(쟁점·행위·항목)** 결합 형태 강제
- 한 단어 광범위 키워드(`법인세법`, `소득세법`, `법인세 시행령` 등 단독)는 금지·자동 보강
- 누적 검색 결과 < 100건 (현재 542 → 100 이하)
- G-S-법인-06 단건 측정 3/3 PASS (TAX-042F 잔여 1건 FAIL 해소)

### 1.3 영향·중요도

- **TAX-042F 잔여 결함 직접 해소**: 검색 결과가 줄면 압축 마커 의존도가 자연 감소 → "중략 영역 정답 누락" 빈도 감소
- **답변 정확성**: 광범위 키워드는 무관 조문을 다수 끌어와 SYSTEM_PROMPT의 "직접 근거 우선" 판단에 노이즈로 작용
- **외부 API 비용**: search 호출당 dump 양 감소 → API 부담·응답 시간 동시 개선

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/adapters/llmQueryRewriter.ts:20-28` — SYSTEM_PROMPT (강화 대상)
- `src/adapters/llmQueryRewriter.ts:44-75` — `rewrite()` 정상 경로 (후처리 호출 위치)
- `src/ports/llmQueryRewriterPort.ts:10-18` — Port 시그니처 (무변경)
- `src/domain/SearchQuery.ts:5-10` — SearchQuery 도메인 (무변경)
- `scripts/perf/diagnoseSearch.ts` — 사후 누적 조문 개수 측정 도구 (재사용)

### 2.2 외부 제약

- GPT-4o-mini 한국어 출력 비결정성 — 같은 질문에도 한 단어 키워드를 반환할 가능성 잔존 → 후처리 필요
- `IQueryRewriterPort` 시그니처 무변경(Hex 아키텍처 격리 유지)
- `SearchQuery.keyword`는 PII 검증 통과 값으로 정의(CLAUDE.md §7 인용) → 후처리 시 PII 재오염 금지

### 2.3 아키텍처 힌트

```
[1] OpenAIQueryRewriterAdapter.rewrite()
       ├─ generateObject (GPT-4o-mini, 강화된 SYSTEM_PROMPT)
       ├─ object.queries.map(...) — 기존
       └─ enforceAxisCombination(queries, question) — 신규
             ├─ 한 단어 + 법리축 단독 ⇒ 사실축 토큰 자동 부착
             ├─ 사실축 단독 ⇒ 통과 (이미 좁음)
             └─ 빈 결과 방지 (최소 1건 보장)
       ↓
[2] searchPort
```

### 2.4 인사이트 출처 (korean-law-mcp v3.4.0)

- `src/tools/compact-query-planner.ts:332 buildOriginalQueryAxes` — 법리축·사실축 분리 패턴
- `compact-query-planner.ts:68 LEGAL_CORE_KEYWORDS`, `:79 TAX_DOMAIN_KEYWORDS` — 도메인 키워드 셋
- `compact-query-planner.ts:115 ORIGINAL_QUERY_STOPWORDS` — 보조어 제거 셋
- 본 티켓은 **세법 도메인에 한정**해 가벼운 셋만 이식(건설·노동·이혼 셋은 미이식)

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [ ] `src/adapters/queryAxisGuard.ts` (신규, ~120줄): 법리축 셋·STOPWORDS·`enforceAxisCombination` 후처리 함수
- [ ] `src/adapters/llmQueryRewriter.ts` (수정): SYSTEM_PROMPT에 결합 규칙·5종 예시 부속, `rewrite()` 반환 직전에 `enforceAxisCombination` 호출
- [ ] `tests/unit/queryAxisGuard.test.ts` (신규, 10건 이상): 한 단어 보강·정상 통과·최소 1건·STOPWORDS·PII 무관 보장
- [ ] 검증: `scripts/perf/diagnoseSearch.ts G-S-법인-06`(누적 < 100건) + `scripts/perf/single.ts` × 3 + 회귀 4종

### 3.2 금지되는 변경

- ❌ `IQueryRewriterPort` 시그니처 변경
- ❌ `SearchQuery` 도메인 필드 추가
- ❌ TaxLaw·검색 어댑터·답변 생성기 수정 (TAX-042F 범위 보호)
- ❌ law-verifier V1~V6 우회·완화
- ❌ TAX-042F 압축 로직 우회·제거(중복 보호로 유지)
- ❌ 외부 의존성 추가 (`compact-query-planner.ts`의 무거운 도메인 사전을 그대로 이식하지 말 것)

### 3.3 도메인 무결성 보호

- 후처리는 **검색 키워드 문자열에만** 적용. TaxLaw·답변·인용·시점 라벨 일체 무영향
- PII 재오염 금지: 보강 토큰은 **회계사가 입력한 질문 자체**에서 추출 → 새 PII 소스 없음
- CLAUDE.md §7 PII 입력 거부 정책은 상위 Usecase(`generateAnswer`)에서 이미 차단됨 → 본 어댑터 진입 시점에 question은 안전

---

## 4. Strategy (구현 힌트 — 인간 승인 후 확정)

### 4.1 enforceAxisCombination 핵심 의사 코드

```ts
const LEGAL_AXIS = new Set([
  '법인세법', '소득세법', '부가가치세법', '상속세및증여세법', '국세기본법',
  '조세특례제한법', '국세징수법', '지방세법', '지방세기본법', '지방세징수법',
])
const LEGAL_AXIS_SUFFIX = /^[가-힣]+법(?:\s*시행령|\s*시행규칙)?$/
const STOPWORDS = new Set(['관련','대한','관한','경우','등','이며','입니다','여부','방법','절차'])

function enforceAxisCombination(queries: SearchQuery[], question: string): SearchQuery[] {
  const factTokens = extractFactAxisTokens(question)   // 질문에서 STOPWORDS·법리축 제외 2자+ 토큰
  const out: SearchQuery[] = []
  for (const q of queries) {
    if (isTooBroad(q.keyword) && factTokens.length > 0) {
      const top = factTokens.slice(0, 2).join(' ')
      out.push({ ...q, keyword: `${q.keyword} ${top}` })
    } else {
      out.push(q)
    }
  }
  return out
}

function isTooBroad(keyword: string): boolean {
  const compact = keyword.trim()
  if (LEGAL_AXIS.has(compact)) return true
  if (LEGAL_AXIS_SUFFIX.test(compact)) return true
  if (compact.split(/\s+/).length === 1 && compact.length <= 6) return true
  return false
}
```

### 4.2 SYSTEM_PROMPT 강화 (추가 블록)

```
6. 모든 검색 키워드는 **법리축 + 사실축**을 결합합니다.
   - 법리축: 어떤 법령인가 (예: "법인세법", "소득세법", "부가가치세법", "시행령")
   - 사실축: 어떤 쟁점·행위·항목인가 (예: "손비", "접대비", "기부금", "양도소득", "세무조정")
7. ❌ 금지: "법인세법" 단독, "소득세법" 단독, "시행령" 단독 — 너무 광범위해 검색 결과 200건 이상 발생
8. ✅ 권장: "법인세법 손비", "법인세법 시행령 접대비", "양도소득세 비과세 1세대1주택"
```

### 4.3 합격선 후보

1. G-S-법인-06 단건 × 3회 → **3/3 PASS** (TAX-042F 2/3에서 진전)
2. `diagnoseSearch.ts G-S-법인-06` → 누적 조문 **< 100건** (현재 542)
3. 회귀 4종(G-1·G-2·G-N1·G-S-법인-01) → 4/4 PASS, 회귀 0건
4. 단위 테스트 ≥ 10건 모두 PASS, 누적 vitest PASS

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] G-S-법인-06 단건 측정 3회 → 3/3 PASS + V1~V6 통과
2. [ ] diagnoseSearch G-S-법인-06 누적 조문 < 100건
3. [ ] 회귀 4종(G-1·G-2·G-N1·G-S-법인-01) 각 1회 → 회귀 0건
4. [ ] 단위 테스트: 광범위 키워드 보강·STOPWORDS 제거·최소 1건·정상 키워드 무변경
5. [ ] `npm run lint`·`typecheck`·`test`·`build` 모두 PASS
6. [ ] V1~V6 보호: 후처리는 SearchQuery.keyword에만 영향, TaxLaw·인용 무관
7. [ ] 리포트 작성: `docs/reports/TAX-042G_report.md`

---

## 6. Verification (검증 단계)

1. `scripts/perf/diagnoseSearch.ts G-S-법인-06` — 누적 조문 개수 측정 (기대: <100)
2. `scripts/perf/single.ts` G-S-법인-06 × 3회
3. 회귀 4종 단건 × 1회
4. 단위 테스트: vitest queryAxisGuard suite
5. 4종 게이트

---

## 7. Risks / Notes (위험·주의사항)

- **위험 1**: 사실축 토큰 추출이 부정확해 결합 후 검색이 **0건**으로 떨어질 가능성
  - 완화책: 보강 후에도 원본 키워드 1건은 보존(보강 분리해 추가, 누적 3개 제한 내), 최소 1건 보장
- **위험 2**: 회계사가 광범위 질문("법인세법 알려줘") 시 사실축 추출 실패
  - 완화책: 사실축 토큰 0개면 원본 그대로 통과 — 회귀보다는 정확성·기존 동작 유지
- **위험 3**: GPT-4o-mini가 SYSTEM_PROMPT 강화 후에도 한 단어 반환 가능성
  - 완화책: 후처리(`enforceAxisCombination`)가 정적 거버넌스로 보강
- **위험 4**: PII 재오염 — 사실축 토큰이 질문 내 우연 PII를 포함
  - 완화책: 본 어댑터 진입 시점에 question은 상위 Usecase의 PII 필터 통과 후 — 새 PII 소스 없음

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [x] **사전 진단**: 이미 TAX-042F §1에 완료 (`"법인세법"=243건, "법인세 시행령"=296건` 등)
- [x] 전략 선택: **C안(프롬프트 강화 + 후처리 결합)** — 회계사 승인 2026-06-07
- [x] 인사이트 출처 명기: korean-law-mcp `compact-query-planner.ts:68/79/115/332`

→ **회계사 승인 완료, 즉시 코딩**

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록
- [ ] G-S-법인-06 × 3회 단건 측정 결과
- [ ] 회귀 4건 단건 측정 결과
- [ ] diagnoseSearch 누적 조문 개수 (before 542 / after 측정값)
- [ ] V1~V6 영향 없음 확인
- [ ] 리포트: `docs/reports/TAX-042G_report.md`

---

## 9. Ticket Size Rule

- 변경 파일: 3 (신규 `queryAxisGuard.ts`, 수정 `llmQueryRewriter.ts`, 신규 테스트)
- 논리적 변경: 1 (광범위 키워드 거버넌스)
- 예상 소요: 2~3시간

---

## 10. Related Tickets

- **선행**: TAX-042F (입력 컨텍스트 윈도우 압축 — 본 티켓이 근본 원인 해소)
- **후속**: TAX-042C (Stage 3 maxTokens·retry), TAX-042D (Stage 4 V3 라벨), TAX-042E (Stage 5 100회 회귀)
- **참조**:
  - TAX-042F 리포트 §1 진단(`542건/4.2배 초과`)
  - korean-law-mcp `compact-query-planner.ts:332 buildOriginalQueryAxes` (인사이트 원본)
  - CLAUDE.md §7 PII 처리, §6.1 인용 무결성(본 티켓은 검색 키워드 한정)

---

## 11. Report Link

Report: `docs/reports/TAX-042G_report.md` (미작성)

---

**작성자**: AI (Claude Opus 4.7)
**작성일**: 2026-06-07
**최종 수정일**: 2026-06-07
