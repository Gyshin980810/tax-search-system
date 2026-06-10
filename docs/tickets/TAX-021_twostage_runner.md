# TAX-021 — `TwoStageSpec` 제네릭 2단계 실행기

- **선행:** TAX-018 (안전망) + TAX-019 (buildNonLawTaxLaw) + TAX-020 (checkV1~V6) — 모두 완료
- **후행:** TAX-022 (identityOf 통합)
- **작업일:** 2026-05-22
- **위험도:** 🟡 낮음 — `src/` 수정 포함, TAX-018 안전망으로 회귀 즉시 감지 가능

---

## 배경

`src/usecases/generateAnswer.ts`의 verify+retry 블록(약 30줄, lines 136~166)이
세 가지 코드 경로를 하나의 인라인 블록에 혼재해 갖고 있다.

| 문제 | 증거 |
|---|---|
| 재시도 로직을 usecase 밖에서 단위 테스트 불가 | `generateAnswer` 전체를 통과해야만 확인 가능 |
| V5 자동 부착·V1 재검색·V2~V6 재생성 3경로가 혼재 | 단일 함수에서 역할 분리 불명확 |
| 향후 V7 추가 시 수정 범위 전파 위험 | 수정 포인트가 usecase 내부에 묻혀 있음 |

TAX-019(`buildNonLawTaxLaw`)·TAX-020(`checkV1~V6`) 패턴과 동일하게,
**파일-스코프 순수 함수 + 제네릭 인터페이스**로 추출한다.

---

## 변경 파일

| 파일 | 변경 종류 |
|---|---|
| `src/usecases/generateAnswer.ts` | 수정 |
| 기타 일체 | **변경 없음** |

---

## 구현 상세

### 추가: `VerifyState` 타입 + `TwoStageSpec<TState>` 인터페이스 + `runTwoStage<TState>()` 함수

`generateAnswer` 함수 선언 바로 위(파일-스코프)에 추가한다.

```typescript
/** verify 단계에서 두 시도 사이를 흐르는 상태 타입 */
interface VerifyState {
  answer: LabeledAnswer
  citable: TaxLaw[]
  verifyResult: VerificationResult
}

/**
 * 2단계 실행 스펙: 비용 없는 선처리(Stage 1) + 본격 복구(Stage 2)
 *
 * - preRetry: V5 자동 부착 등 재생성 없이 적용 가능한 수정 + 재검증.
 *             상태를 받아 수정이 필요하면 새 상태(verifyResult 갱신 포함)를 반환한다.
 *             수정 불필요하면 state 그대로 반환.
 * - recover:  V1(재검색+재생성) 또는 V2~V6(재생성) 경로 + 재검증.
 *             상태를 받아 복구 후 새 상태(verifyResult 갱신 포함)를 반환한다.
 * - isFailure: verifyResult.status === 'FAIL' 여부 판단.
 */
interface TwoStageSpec<TState> {
  isFailure: (state: TState) => boolean
  preRetry:  (state: TState) => Promise<TState>
  recover:   (state: TState) => Promise<TState>
}

/**
 * TwoStageSpec 실행기: 최초 상태를 받아 2단계로 실행한다.
 *
 * 흐름:
 *   초기 상태 isFailure? → NO → 즉시 반환
 *                        → YES → preRetry → isFailure? → NO → 반환
 *                                                        → YES → recover → isFailure? → NO → 반환
 *                                                                                       → YES → throw E-VERIFY-FAIL
 */
async function runTwoStage<TState>(
  initial: TState,
  spec: TwoStageSpec<TState>,
): Promise<TState> {
  if (!spec.isFailure(initial)) return initial

  // Stage 1: 비용 없는 선처리 (V5 자동 부착 등)
  let state = await spec.preRetry(initial)
  if (!spec.isFailure(state)) return state

  // Stage 2: 본격 복구 (V1 재검색 또는 V2~V6 재생성)
  state = await spec.recover(state)
  if (spec.isFailure(state)) {
    throw new AppError(
      'E-VERIFY-FAIL',
      '답변 검증에 실패했습니다. 해당 질문은 직접 국세청 또는 담당 세무사에게 문의해 주세요.',
    )
  }
  return state
}
```

### 교체: `generateAnswer` 내 verify+retry 블록 → `runTwoStage` 호출

기존 lines 136~166(30줄)을 `runTwoStage` 호출 + 인라인 스펙 객체로 교체한다.

```typescript
// [4] verify + 2단계 재시도
const finalState = await runTwoStage<VerifyState>(
  {
    answer,
    citable: split.citable,
    verifyResult: await verifier.verify(answer, split.citable),
  },
  {
    isFailure: (s) => s.verifyResult.status === 'FAIL',

    // Stage 1: V5 면책 고지 자동 부착 (재생성 없음)
    preRetry: async (s) => {
      if (s.verifyResult.checks.v5) return s
      const ans = { ...s.answer, disclaimer: DISCLAIMER }
      const vr  = await verifier.verify(ans, s.citable)
      return { ...s, answer: ans, verifyResult: vr }
    },

    // Stage 2: V1(재검색+재생성) 또는 V2~V6(재생성)
    recover: async (s) => {
      let ans: LabeledAnswer
      let citable: TaxLaw[]
      if (!s.verifyResult.checks.v1) {
        // V1 경로: 재검색 + 재분리 + 재생성
        const sr    = await searchPort.search(queries[0])
        const newSplit = splitResults(sr.items)
        ans     = await answerGenerator.generate(newSplit.citable, question, temporal)
        citable = newSplit.citable
      } else {
        // V2~V6 경로: 재생성만
        ans     = await answerGenerator.generate(s.citable, question, temporal)
        citable = s.citable
      }
      const vr = await verifier.verify(ans, citable)
      return { answer: ans, citable, verifyResult: vr }
    },
  },
)
// finalState.answer, finalState.citable, finalState.verifyResult 이후에 사용
```

> **분리(split) 변수 처리:**
> `recover` 내부에서 V1 경로가 `split`을 새로 갱신하므로,
> `generateAnswer` 함수의 `split` 변수 선언을 `let`으로 유지하거나
> `recover`가 반환한 `citable`을 이후 `buildReferences` 호출에 전달한다.
> 실행기(runner)는 `split` 참조를 몰라야 하므로 클로저(closure)로 포착한다.

---

## 검증 기준

1. `npm run typecheck` — 에러 0
2. `npm run lint` — 경고/에러 0
3. `npm run test` — 136/136 전부 통과 (스냅샷 diff 없음)
4. `git diff src/` — `generateAnswer.ts` 1개만 변경

---

## 후속 작업

- **TAX-022:** `identityOf` 통합 — `matchesIdentity`·`identityLabel` 두 함수의 중복 분기 통합 (`lawVerifier.ts`)
