# LR 티켓 재평가·정비 변경 내역 및 평가 요청서

> **평가자**: Codex (독립 평가)
> **작성자**: Claude
> **작성일**: 2026-08-07
> **대상**: `docs/tickets/` LR 시리즈 티켓 9개 (신규 5 / 수정 3 / 폐기 1)
> **입력 지시서**: `docs/tickets/_TEMP_LR_TICKET_REVISION_AND_REEVALUATION.md`

---

## 0. 이 문서의 목적

회계사가 `_TEMP_LR_TICKET_REVISION_AND_REEVALUATION.md`(이하 **임시 지시서**)로
"LR-A1~A4 티켓을 수정하고 구현 가능 여부를 독립 재평가하라"고 지시했다.
Claude가 그 작업을 수행했고, **본 문서는 그 결과를 Codex가 독립 평가하기 위한 자료**다.

평가 시 다음을 부탁한다.

- Claude가 주장한 **코드 근거(file:line)가 실제로 사실인지** 검증
- Claude가 **놓쳤거나 잘못 판단한 것**이 있는지 지적
- 정비된 티켓으로 **실제 구현이 가능한지** 판단
- 특히 §6의 "확신이 덜한 지점"을 집중적으로 봐 달라

**중요**: 본 작업에서 제품 코드는 한 줄도 변경하지 않았다(§7-2로 검증 가능).

---

## 1. 작업 배경

### 1.1 LR 트랙이란

조문 중심 답변 → **사례(판례·심판례·해석례) 중심 답변**으로 전환하는 방향 전환.
근본 원인은 벡터 검색이 `buildReferences` 안(=답변 생성 **이후**)에서만 호출돼
LLM이 사례를 볼 수 없다는 구조다.

1층(LR-A1~A4) = 답변 구조 전환, 2층(LR-001~011) = 법리 관계 판정.

### 1.2 임시 지시서의 판단

지시서는 기존 LR-A1~A4에 대해 **"현 상태로 LR-A1 구현에 착수하면 안 된다"**고 결론지었고,
6개 문제(§3.1~3.6)를 제시했다.

### 1.3 Claude의 재평가 결과 요약

지시서의 6개 지적은 **대체로 사실**이었다. 다만 코드 대조 결과 세 갈래로 갈렸다.

| 구분 | 건수 | 내용 |
|---|---|---|
| 지시서가 **과소평가** | 2건 | §3.3·§3.6 — "미비"가 아니라 **구조적으로 불가능**한 수준 |
| 지시서가 **과대평가** | 1건 | §3.1 — "정면 충돌"이 아니라 자료유형별로 상태가 다름 |
| 지시서 지적이 **정확** | 3건 | §3.2·§3.4·§3.5 |
| Claude **신규 발견** | 2건 | 지시서에 없던 항목(§3-1·§3-4 아래) |

---

## 2. 변경 파일 전체 목록

### 2.1 신규 작성 (5)

| 파일 | 역할 | 신설 사유 |
|---|---|---|
| `docs/tickets/LR-A0_case_citation_policy.md` | 사례 citation 정책 결정 | SSOT §7.2-a 명문 금지 + 승격 조건·기권 정책 부재 |
| `docs/tickets/LR-A0-B_retrieval_stage_metadata.md` | 항목별 검색 출처(`retrievalStage`) | `matchStage` 단일 필드로는 A1의 AC가 논리적으로 충족 불가 |
| `docs/tickets/LR-A0-C_case_first_eval_contract.md` | 사례 중심 E2E 평가 계약·러너 | 기존 골든셋이 검색·LLM 경로를 검사하지 못함 |
| `docs/tickets/PERF-LR-001_operational_p95_measurement.md` | 운영 동형 P95·토큰·비용 측정 | `measureP95.ts`가 운영 경로와 4곳 불일치 |
| `docs/tickets/LR-A5_golden_expectation_update.md` | 골든셋 기대값 갱신 전용 | 측정·분류와 정답 변경 분리(자기채점 차단) |

### 2.2 수정 (3)

| 파일 | 주요 변경 |
|---|---|
| `docs/tickets/LR-A1_case_first_answer_context.md` | AC 8개 → 11개 재설계, 선행 3티켓 추가, §2.3 예산 함정 신설 |
| `docs/tickets/LR-A2_case_first_answer_narrative.md` | §2.2-b "추가만 원칙의 예외" 신설, 스모크셋 전진 |
| `docs/tickets/LR-A3_case_first_answer_ui.md` | 제목안 재제시, AC 7개 → 11개 |

### 2.3 분할·폐기 (1)

| 파일 | 처리 |
|---|---|
| `docs/tickets/LR-A4_golden_regression_and_p95.md` | **폐기 표시**(삭제 안 함). 상단에 분할 안내 + 원본은 `<details>`로 접어 이력 보존 |
| `docs/tickets/LR-A4_accuracy_regression_run.md` | 대체 파일 — 회귀 실행·분류만 담당 |

> 삭제하지 않은 이유: untracked 파일이라 삭제 시 git 복구 불가. 임시 지시서 §8도 임의 삭제를 금지한다.

### 2.4 지시서 갱신 (1)

`docs/tickets/_TEMP_LR_TICKET_REVISION_AND_REEVALUATION.md` — §7 완료 조건 체크 + §9 재평가 결과 추가.

---

## 3. 코드 대조로 확인한 사실 (평가 핵심)

아래 5건은 모두 **실제 코드에서 확인**했다. Codex는 각 file:line을 직접 열어 검증해 주기 바란다.

### 3-1. 🔴 신규 발견 — 기존 골든셋은 검색·LLM 경로를 검사하지 못한다

```ts
// tests/golden/run_golden.test.ts:65
const result = await verifier.verify(tc.answer, tc.sourceLaws)
```

`tc.answer`는 `eval/golden_direct.json`에 **완성된 채로 하드코딩된 `LabeledAnswer` 객체**다(66건).
검색·LLM을 타지 않고 law-verifier V1~V6만 검사하는 **직접 주입형 픽스처**다.

**귀결**: 구 LR-A1 AC-5 "`eval/golden_direct.json` 회귀 통과"는 실효가 **0**이다.
A1이 검색 경로를 어떻게 바꾸든 66건은 그대로 통과한다.

**조치**: AC-5를 `LR-A0-C` E2E 기준선 대비로 교체. `LR-A0-C` 신설.

> 검증법: `eval/golden_direct.json`의 `cases[0].answer` 필드 존재 확인 +
> `run_golden.test.ts`가 `generateAnswer`를 import하지 않음을 확인.

---

### 3-2. 🔴 신규 발견 — `matchStage` 단일 필드로 안전장치와 AC가 동시 충족 불가

```ts
// src/adapters/llmAnswerGenerator.ts:450~481  (TAX-026-G)
function downgradeVectorLabels(citations, summary, matchStage) {
  if (matchStage === 'direct') return { citations, summary }   // ← 하향 없음
  const ceiling = matchStage === 'vector' ? '🟡유사사례' : '⚪참고자료'
  // T1·T2 출처까지 포함해 일괄 하향
}
```

```ts
// src/usecases/generateAnswer.ts:508
matchStage = searchResult.matchStage      // 검색 전체에 단 하나
// :518
const answer = await callGenerate(answerGenerator, split.citable, question, temporal, searchResult.matchStage)
```

LR-A1은 직접검색 법령과 벡터 사례를 같은 `citable`에 합류시킨다. 그러면:

| 선택 | 조문(T1·T2) | 벡터 사례(T3·T4) | 판정 |
|---|---|---|---|
| `direct` 유지 | 🟢 유지 ✅ | 벡터 천장 **미적용** ❌ | TAX-026-G 안전장치 우회 |
| `vector`로 변경 | 🟢→🟡 **하향** ❌ | 천장 적용 ✅ | A1 AC-2·AC-5 정면 위반 |

**둘 다 막힌다.** 임시 지시서 §3.3은 "출처 단계를 구분하기 어렵다"고 완곡히 적었으나,
실제로는 **설계 전제의 결함**이다.

**조치**: `LR-A0-B` 신설(항목별 `retrievalStage`). A1의 필수 선행으로 지정.

> 평가 요청: T3·T4는 `applyDeterministicLabels`(TAX-6A-11)가 어차피 🟡로 재계산하므로
> "라벨 결과만 보면 동일하지 않냐"는 반론이 가능하다. Claude는 **정책(벡터 결과는 덜 신뢰)이
> 사라지는 것 자체가 문제**라고 판단했으나, 이 판단의 타당성을 검토해 달라.

---

### 3-3. 🟠 `contextBudget` 컷오프가 `break`라 사례가 전멸할 수 있다

```ts
// src/adapters/contextBudget.ts:214~231
const sorted = [...laws].sort((a, b) => {
  const tierDiff = TIER_RANK[a.trustTier] - TIER_RANK[b.trustTier]   // T1→T2→T3→T4
  ...
})
for (const law of sorted) {
  const compacted = compactLawContent(densifyArticleRefs(law.content))
  const tok = estimateTokens(...)
  if (cumulative + tok > safeTokens) break        // ← 즉시 중단
  ...
}
```

사례는 T3·T4라 정렬 **최후미**. 법령이 `SAFE_INPUT_TOKENS`(35,000)를 채우면 사례는 0건이고,
`break`이므로 뒤쪽의 짧은 사례를 주워담는 동작도 없다.

구 LR-A1은 "압축 분기 추가"만 말했다 → **압축해도 순서상 잘린다.**

**조치**: A1에 **최소 보존 쿼터**를 AC-7로 신설 + §8.1 승인 항목화.

---

### 3-4. 🔴 신규 발견 — `measureP95`가 `matchStage`를 전달하지 않는다

```ts
// scripts/perf/measureP95.ts:140~148
function makeTimedAnswerGen(inner, buckets) {
  return {
    async generate(laws, question, temporal) {       // ← 4번째 인자(matchStage) 없음
      return await inner.generate(laws, question, temporal)
    },
  }
}
```

`callGenerate`(`generateAnswer.ts:29~39`)는 `matchStage != null`이면 4인수로 호출하지만,
데코레이터가 3인수만 받아 위임하므로 **측정 경로에서는 TAX-026-G 라벨 하향이 아예 작동하지 않는다.**

즉 측정 하네스가 **운영과 다른 라벨 로직으로 돈다**. 이 하네스로 정확도를 판단하면 안 된다.

운영과의 불일치는 총 4곳이다.

| # | 항목 | 하네스 | 운영 |
|---|---|---|---|
| 1 | 검색 포트 | `NationalTaxLawAdapter` (`:265`) | `FallbackSearchPort` (`route.ts:78`) |
| 2 | 다중 쿼리 | `searchMany` 미전달 (`:122~133`) → `queries[0]` 단일 폴백 | `searchMany` 병합 |
| 3 | 인용 그래프 | `citationGraphPort` 미주입 (`:303~313`) | 주입 (`route.ts:101`) |
| 4 | 라벨 후처리 | `matchStage` 미전달 (`:140~148`) | 전달 (`generateAnswer.ts:518`) |

**조치**: `PERF-LR-001` 신설(하네스 보수 포함). 임시 지시서는 1~3만 지적했고 **4는 Claude 신규 발견**이다.

---

### 3-5. ⚠️ SSOT 충돌 범위 — 지시서보다 좁다 (Claude의 정정)

임시 지시서 §3.1은 "SSOT §7.4가 참고 목록의 citation 승격을 금지하므로 LR-A1과 정면 충돌"이라 했다.
그러나 원문을 정확히 읽으면 다르다.

```
SSOT.md:320 / PRD.md:444
> 본문(발췌)이 없는 비법령 자료 및 인용되지 않은 본문 있는 비법령 자료는 …
> 참고 목록으로만 제시한다. 참고 목록은 … citation으로 승격할 수 없다.
```

이 규칙이 금지하는 것은 「**참고 목록에 들어간 항목**을 인용으로 끌어올리는 행위」다.
「본문이 있고 인용된 비법령이 citation이 되는 것」은 금지 대상이 아니며,
현행 코드가 이미 그렇게 동작한다.

```ts
// src/usecases/generateAnswer.ts:98~109 — content 유무만 보고 citable 판정
function splitResults(items: TaxLaw[]) {
  for (const item of items) {
    if (item.content.trim() !== '') citable.push(item)     // sourceType 무관
    else if (item.sourceType !== '법령') contentlessRefs.push(item)
  }
}
```
```ts
// src/adapters/lawVerifier.ts:64~75 — V1이 비법령을 caseNumber로 대조(=인용 가능 전제)
```

**진짜 명문 위반은 `SSOT.md:286` 한 줄이다.**

```
> (국세청 해석례 오프라인 코퍼스는) 트랙: 참고 목록(references) 전용
> — 위 §7.4 규칙대로 V1~V6 비대상·발췌 인용 승격 금지
```

따라서 상태가 셋으로 갈린다.

| 자료 | 상태 |
|---|---|
| 해석례 벡터 코퍼스 | ❌ **명문 금지** (SSOT §7.2-a) |
| 판례·심판례 벡터 코퍼스 | ⚠️ **명문 공백** (코드 주석에만 존재) |
| 직접검색 비법령(본문 有) | ✅ 이미 citation 가능 |

**조치**: `LR-A0`에서 D-1(범위)·D-2(조건)·D-3(기권)·D-4(검증범위)를 회계사가 결정하도록 구성.

> 평가 요청: 이 해석이 지나치게 관대한 것은 아닌지 검토해 달라.
> "인용되지 않은 본문 있는 비법령"이라는 문구를 Claude는 "인용된 것은 citation 가능"의
> 반대해석 근거로 삼았는데, 이 반대해석이 무리인지 판단이 필요하다.

---

### 3-6. 🟠 V1~V6는 사례의 관련성을 검증하지 않는다 (지시서 §3.2 확인)

`src/adapters/lawVerifier.ts` 전체를 확인한 결과, V1~V6 어디에도 다음을 보는 항목이 없다.

- 인용된 사례가 질문과 **법적으로 관련 있는가**
- 사례의 **결론을 올바르게 이해했는가**
- 사례의 **사실관계가 질문 사안과 유사한가**

V1=존재 여부, V2=글자 일치만 본다. 따라서 **"원문은 완벽히 정확한데 사안이 전혀 다른 사례"**는
전 게이트를 통과한다.

구 LR-A1 AC-1은 "사례 citation 1건 이상 등장"을 **무조건 요구**했다 → 위 유형을 답변 중심에 놓는다.

**조치**: AC-1을 AC-1a(조건부)·AC-1b(기권)로 분리. `LR-A0-C`에 `mustNotCite` 도입.

---

### 3-7. 🟠 SYSTEM_PROMPT 자기모순 (지시서 §3.4 확인)

```ts
// src/adapters/llmAnswerGenerator.ts:48
회계사의 질문에 대해 아래 제공된 법령 조문만을 근거로 답변을 생성합니다.

// :62
- 선정 우선순위: (1) T1·T2 출처 > (2) 질문 키워드와 직접 매칭되는 조문 > …

// :122
export const answerSchema = z.object({ citations: z.array(citationItemSchema).max(5), … })
```

"법령 조문만"에 사례 서술 지침을 **추가만** 하면 모순된 프롬프트가 된다.
또한 5건 상한에서 우선순위 (1)이 T1·T2라 사례가 밀린다.

**조치**: A2 §2.2-b 신설 — **지정 3개 문구에 한해** 최소 수정 허용. 나머지 6개 안전 블록은 불변 + AC-7로 테스트 고정.

---

### 3-8. 🟡 LR-A4 평가셋 표 오기 (지시서 §3.6 확인)

```
eval/golden_nonlaw_probe.json → description: "비법령 골든셋 후보 — TAX-036. 회계사가 본 파일에서 8건을 채택"
eval/golden_law_probe.json    → description: "법령 골든셋 후보 — TAX-036 보강."
```

두 파일 모두 `tests/` 어디에서도 참조되지 않고 `scripts/golden/probeLaw.ts`·`probeNonlaw.ts` 전용이다.
구 LR-A4 §2.1이 이를 "대상 평가셋"으로 나열한 것은 오기다.

**조치**: `LR-A4_accuracy_regression_run.md` §2.1에서 정정 + 회귀 대상에서 제외.

---

## 4. 티켓별 변경 상세 (변경 전 → 후 → 이유)

### 4.1 LR-A1

| 항목 | 변경 전 | 변경 후 | 이유 |
|---|---|---|---|
| 선행 | 없음 | `LR-A0`·`LR-A0-B`·`LR-A0-C` | §3-2·3-5, 평가 부재 |
| AC-1 | 사례 인용 1건 이상 **필수** | AC-1a 조건부 + **AC-1b 기권** | §3-6 |
| AC-5 | `golden_direct.json` 회귀 | `LR-A0-C` E2E 기준선 대비 | §3-1 (기존 AC 실효 0) |
| — | — | **AC-6** `mustNotCite` 위반 0건 (신설) | §3-6 |
| AC-6→AC-7 | 토큰 안전만 | 토큰 안전 **+ 최소 1건 도달 보장** | §3-3 |
| — | — | **AC-8** 재시도 시 사례·임베딩 재사용 (신설) | `generateAnswer.ts:546~553` |
| Strategy | 5단계 | 8단계(적격 게이트·쿼터·재시도·로그 추가) | 상동 |
| 위험 | 6개 | 8개 (위험 7=무관 사례, 위험 8=노출 위험 오판) | §3-6 |
| §8.1 근거 | "현행과 같은 6건이라 신규 노이즈 없음" | **철회** — 참고 목록과 인용은 노출 위험이 다름 | 지시서 §3.2 |

### 4.2 LR-A2

| 항목 | 변경 전 | 변경 후 | 이유 |
|---|---|---|---|
| 프롬프트 원칙 | 기존 지침 **추가만** | **지정 3개 문구 최소 수정 허용**(§2.2-b) | §3-7 |
| 안전 블록 | 4개, 육안 diff 확인 | **6개**, **테스트로 고정**(AC-7) | 실제 프롬프트에 중략 마커·T1·T2 부재 규칙도 존재 |
| 회귀 시점 | 전부 A4로 이연 | **스모크셋을 병합 전**(AC-9) | 상위 문서상 프롬프트 변경 후 회귀 필수 |
| 결론 표시 | "원문에 명시된 결론만 인용" | **발췌 안에서 확인되는 결론만** | 발췌 밖 요약 차단 |
| 그룹핑 | 승인 항목(기본=그룹 없음) | **금지 명문화**(AC-3b) | 결론 동일성 판정 자체가 관계 판정 |
| 5건 배분 | 없음 | **승인 항목 신설** | `answerSchema` max(5) |

### 4.3 LR-A3

| 항목 | 변경 전 | 변경 후 | 이유 |
|---|---|---|---|
| 섹션 제목 | "이 쟁점의 판단 기준 (판례·심판원)" 확정 | **승인 항목으로 재제시**(추천안 변경) | 🟡 오독 + 해석례 누락 |
| 분류 기준 | `sourceType` 또는 `trustTier` | `sourceType` + **Tier 정합 검증**(AC-8) | 어긋난 자료의 조용한 오배치 방지 |
| 정렬 | 미정 | **결정론 고정**(AC-9) | 회귀 판정 가능성 |
| 시점 | 미언급 | **혼합 시점 처리**(§4-7, 승인 항목) | 조문 `[현행]` + 사례 `[결정:…]` |
| — | — | **AC-10** 사실관계 차이 안내 (신설) | 적용 한계 고지 |
| 게이트 | typecheck·test | **+ `test:e2e`** | UI 변경 |

### 4.4 LR-A4 → 4분할

| 신규 티켓 | 범위 |
|---|---|
| `LR-A0-C` | 평가 계약·러너 + 1층 **이전** 기준선 (**A1보다 먼저**) |
| `LR-A4` | 1층 **이후** 회귀 실행·분류 (기대값 무변경, AC-7로 `eval/` diff 0 강제) |
| `PERF-LR-001` | 운영 동형 측정 + 하네스 4개 불일치 보수 |
| `LR-A5` | 회계사 검수 기반 기대값 갱신 (입력 = A4 분류표 (a) 항목만) |

---

## 5. 판정 결과

| 티켓 | 판정 | 준비도 | 차단 사유 |
|---|---|---|---|
| `LR-A0` | 🟢 READY | 5/5 | — |
| `LR-A0-B` | 🟡 CONDITIONAL | 4/5 | LR-A0 확정 + 태깅 계층·폴백 승인 |
| `LR-A0-C` | 🟡 CONDITIONAL | 4/5 | 케이스 수·반복·판정 기준 + 유료 승인 |
| `LR-A1` | 🔴 BLOCKED | 3/5 | 선행 3티켓 |
| `LR-A2` | 🔴 BLOCKED | 3/5 | LR-A1 + 결론 표기·5건 배분 승인 |
| `LR-A3` | 🔴 BLOCKED | 4/5 | LR-A2 |
| `LR-A4` | 🔴 BLOCKED | 4/5 | LR-A3 |
| `PERF-LR-001` | 🔴 BLOCKED | 4/5 | LR-A3 (하네스 보수만 선행 가능) |
| `LR-A5` | 🔴 BLOCKED | 5/5 | LR-A4 분류표 |

착수 순서:

```
LR-A0 → LR-A0-B → LR-A0-C → LR-A1 → LR-A2 → LR-A3 → (LR-A4 ∥ PERF-LR-001) → LR-A5
```

---

## 6. Codex에게 요청하는 평가 항목

### 6.1 사실 검증 (필수)

§3의 코드 근거 8건이 실제로 맞는지 확인해 달라. 특히:

- [ ] `run_golden.test.ts:65`가 정말 검색·LLM을 타지 않는가 (§3-1)
- [ ] `downgradeVectorLabels`가 정말 T1·T2까지 하향하는가 (§3-2)
- [ ] `contextBudget.ts`의 `break`가 정말 사례를 전멸시킬 수 있는가 (§3-3)
- [ ] `makeTimedAnswerGen`이 정말 `matchStage`를 누락하는가 (§3-4)
- [ ] SSOT §7.4의 반대해석(§3-5)이 무리가 아닌가

### 6.2 Claude가 확신이 덜한 지점 (집중 검토 요망)

1. **§3-2의 심각도 판단** — T3·T4는 `applyDeterministicLabels`가 어차피 🟡로 재계산하므로,
   최종 라벨만 보면 `matchStage='direct'`여도 결과가 같다. Claude는 "정책이 사라지는 것 자체가
   문제"라며 Critical로 분류했으나, **과잉 대응일 가능성**이 있다.
   `LR-A0-B`(티켓 1개)를 신설할 만한 사안인지 판단해 달라.

2. **§3-5의 반대해석** — "인용되지 **않은** 본문 있는 비법령"이라는 문구에서
   "인용된 것은 citation 가능"을 도출했다. 문법적으로는 성립하나,
   **SSOT 작성 의도**는 "비법령 전반을 참고 목록으로 밀어내는 것"이었을 수 있다.
   해석이 지나치게 관대한지 검토해 달라.

3. **LR-A0-C의 비용 대비 효용** — E2E 평가 계약을 A1보다 먼저 만들면 자기채점은 막지만,
   유료 호출과 회계사 검수 시간이 선행 비용으로 든다. 이 순서가 과한지 판단해 달라.

4. **티켓 9개는 과분할인가** — 원래 4개였던 것이 9개가 됐다.
   1인 개발(회계사 + AI) 환경에서 관리 부담이 실익을 넘어서는지 봐 달라.

### 6.3 놓친 것 찾기

Claude가 확인하지 **않은** 영역이 있다. 여기에 문제가 숨어 있을 수 있다.

- `app/components/AnswerCard.tsx` 내부 구조 (LR-A3가 "착수 시 확인"으로 미룸)
- `src/usecases/searchWithFallback.ts`(`FallbackSearchPort`)의 `matchStage` 산정 로직
- `src/adapters/vectorSearch.ts`의 반환 형태가 `TaxLaw`와 완전히 호환되는지
- 사례 본문을 `citable`에 넣었을 때 `extractExcerpt`(발췌 자동 추출)가 판례 문체에서
  정상 동작하는지 — **V2 실패율에 직결되는데 미검증**
- 2층 계획서(`LEGAL_RELATION_CHATBOT_IMPLEMENTATION_PLAN.md`)와의 정합

---

## 7. 검증 방법 (재현 가능)

### 7.1 변경 파일 확인

```bash
git status --short docs/tickets/
```

기대: `LR-A0*`·`LR-A4_accuracy_regression_run`·`LR-A5*`·`PERF-LR-001*`이 `??`(신규),
`LR-A1`~`LR-A3`·구 `LR-A4`·`_TEMP_*`가 `??`(원래 untracked였음).

### 7.2 제품 코드 무변경 확인 (중요)

```bash
git status --short src/ app/ eval/
```

기대: **빈 결과**.

```bash
git status --short tests/ scripts/
```

기대: 아래 4건만 — 전부 **본 작업 이전부터 있던 기존 미커밋 변경**이며 Claude가 건드리지 않았다.

```
 D scripts/diagnostics/impact_links_probe.mjs
 D scripts/diagnostics/impact_map_probe.mjs
 M tests/integration/__snapshots__/nationalTaxLaw.test.ts.snap
 M tests/unit/AnswerCard.test.tsx
```

### 7.3 기계 게이트

```bash
npm run lint && npm run typecheck && npm run test
```

기대: 문서만 변경했으므로 본 작업 이전과 동일한 결과.

---

## 8. 알려진 미결 사항

1. **`LR-A0` D-1~D-4가 미결정** — 회계사 결정 대기. 이것 없이는 LR-A1 착수 불가.
2. **임시 지시서 처리 미정** — 삭제 / `docs/review/` 이동 / 유지 중 회계사 확인 대기(지시서 §8).
3. **구 `LR-A4` 파일 처리 미정** — 폐기 표시만 함. 삭제 여부 회계사 확인 대기.
4. **`ROADMAP.md` 미갱신** — 본 작업은 티켓 정비(구현 완료가 아님)라 §3 현재 상태 표 갱신 대상이
   아니라고 판단했다. **이 판단이 CLAUDE.md §9-9에 비추어 옳은지 평가해 달라.**
5. **`extractExcerpt`의 판례 문체 대응 미검증** (§6.3) — LR-A1의 V2 실패율에 직결.

---

## 9. 참고 문서

| 문서 | 역할 |
|---|---|
| `docs/tickets/_TEMP_LR_TICKET_REVISION_AND_REEVALUATION.md` | 본 작업의 입력 지시서 (§9에 재평가 결과 추가됨) |
| `docs/SSOT.md` §7.2-a·§7.4 | 참고 목록·해석례 코퍼스 규칙 |
| `docs/PRD.md` §6.5.3 | 참고 목록 검증 범위 |
| `CLAUDE.md` §6·§9 | 세법 도메인 4대 규칙·AI 행동 10계명 |
| `docs/review/LEGAL_RELATION_CHATBOT_IMPLEMENTATION_PLAN.md` | 2층 구현 계획 |
| `docs/review/LEGAL_RELATION_CHATBOT_ROADMAP_REVIEW_V2.md` | 로드맵 재평가 |

---

**작성자**: Claude
**작성일**: 2026-08-07
**평가 요청 대상**: Codex
