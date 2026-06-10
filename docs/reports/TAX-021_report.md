# TAX-021 구현 리포트 — `TwoStageSpec` 제네릭 2단계 실행기

- **티켓:** `docs/tickets/TAX-021_twostage_runner.md`
- **작업일:** 2026-05-22
- **상태:** 구현 완료

---

## 변경 사항 요약

**파일 변경 목록:**
- `src/usecases/generateAnswer.ts` (수정 — TwoStageSpec/runTwoStage 추가 + verify+retry 블록 교체)
- `docs/tickets/TAX-021_twostage_runner.md` (신규)
- `docs/reports/TAX-021_report.md` (신규)

**테스트·스냅샷 변경: 0줄**

---

## 변경 내용

### 추가: `VerifyState` + `TwoStageSpec<TState>` + `runTwoStage<TState>()`

`generateAnswer` 함수 선언 직전(파일-스코프)에 추가. TAX-019·020 패턴과 동일.

| 추가 항목 | 위치 | 설명 |
|---|---|---|
| `VerifyState` | 파일-스코프 interface | verify 두 시도 사이를 흐르는 상태 타입 (`answer`, `citable`, `contentlessRefs`, `verifyResult`) |
| `TwoStageSpec<TState>` | 파일-스코프 interface | `isFailure` · `preRetry` · `recover` 3개 콜백 |
| `runTwoStage<TState>()` | 파일-스코프 async 함수 | 초기 상태를 받아 2단계(preRetry → recover) 실행 후 반환, 최종 FAIL 시 `E-VERIFY-FAIL` throw |

**실행기 흐름:**
```
isFailure(initial)? NO  → 즉시 반환
                    YES → preRetry → isFailure? NO  → 반환
                                               YES → recover → isFailure? NO  → 반환
                                                                           YES → throw E-VERIFY-FAIL
```

### 교체: verify+retry 인라인 블록(30줄) → `runTwoStage` 호출(35줄)

기존 `[4-a]` V5 자동 부착 + `[4-b]` V1/V2~V6 재시도 분기가 단일 usecase 블록에 혼재됐던 것을,
`runTwoStage`에 위임한 스펙 객체(inline)로 교체.

| 스펙 콜백 | 구현 내용 |
|---|---|
| `isFailure` | `s.verifyResult.status === 'FAIL'` |
| `preRetry` (Stage 1) | V5 미부착 시 DISCLAIMER 주입 후 `verifier.verify` 재호출, V5 이미 통과이면 상태 그대로 반환 |
| `recover` (Stage 2) | `!checks.v1`이면 재검색+재분리+재생성+재검증 (contentlessRefs 갱신 포함), 아니면 재생성+재검증 |

### 부수 개선: `let` → `const`

V1 재시도 시 `split`·`searchResult`·`answer`·`verifyResult`를 변수에 재할당하던 패턴이 없어져
`generateAnswer` 내부의 `let` 4개를 `const`로 변경. 로직 변경 없음.

---

## 검증 결과

| 항목 | 결과 |
|---|---|
| `npm run typecheck` (tsc) | ✅ 에러 0 |
| `npm run lint` (eslint) | ✅ 경고/에러 0 |
| `npm run test` (vitest) | ✅ **136개 전부 통과** (스냅샷 diff 없음) |
| 변경 파일 | ✅ `generateAnswer.ts` 1개만 수정 |

기존 `generateAnswer.test.ts`의 재시도 시나리오(V1 재시도, V2~V6 재시도, V5 자동 부착, E-VERIFY-FAIL)가
**모두 그대로 통과**하여 출력 무변경이 자동으로 증명됨.

---

## 후속 작업

- **TAX-022:** `identityOf` 통합 — `matchesIdentity`·`identityLabel` 두 함수의 중복 분기 통합 (`lawVerifier.ts`)

**리포트:** `docs/reports/TAX-021_report.md`
