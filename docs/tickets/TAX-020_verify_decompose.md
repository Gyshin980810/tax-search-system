# TAX-020 — `verify` 메서드 V1~V6 분해

- **선행:** TAX-019 (buildNonLawTaxLaw 공통 빌더)
- **후행:** TAX-022 (identityOf 통합)
- **작업일:** 2026-05-22
- **위험도:** 🟡 낮음 — `src/` 수정 포함, TAX-018 안전망으로 회귀 즉시 감지 가능

---

## 배경

`src/adapters/lawVerifier.ts`의 `verify` 메서드가 V1~V6 검사 로직을 하나의
단일 메서드(108줄) 안에 순차 인라인으로 갖고 있었다.

| 문제 | 증거 |
|---|---|
| 특정 V 검사만 단위 테스트 불가 | `verify` 전체를 통과해야만 검사 결과 확인 가능 |
| 향후 V별 재시도 격리 불가 | usecase에서 FAIL 시 "V2만 재생성" 같은 흐름 추가 불가 |
| 의존성 혼재 | V1·V2는 `sourceLaws` 필요, V3~V6는 `answer`만 필요 — 시그니처에 미반영 |

TAX-019 패턴(파일-스코프 순수 함수)을 동일하게 적용한다.

---

## 변경 파일

| 파일 | 변경 종류 |
|---|---|
| `src/adapters/lawVerifier.ts` | 수정 |
| 기타 일체 | **변경 없음** |

---

## 구현 상세

### 추가: 6개 파일-스코프 순수 함수 (클래스 위)

```typescript
// 반환값: 실패 이유 목록 (빈 배열 = 통과)
function checkV1(answer: LabeledAnswer, sourceLaws: TaxLaw[]): string[]
function checkV2(answer: LabeledAnswer, sourceLaws: TaxLaw[]): string[]
function checkV3(answer: LabeledAnswer): string[]
function checkV4(answer: LabeledAnswer): string[]
function checkV5(answer: LabeledAnswer): string[]
function checkV6(answer: LabeledAnswer): string[]
```

| 함수 | 원본 줄 | 의존 인수 |
|---|---|---|
| `checkV1` | `:101~:109` | `answer`, `sourceLaws` |
| `checkV2` | `:114~:143` | `answer`, `sourceLaws` |
| `checkV3` | `:145~:154` | `answer` |
| `checkV4` | `:159~:167` | `answer` |
| `checkV5` | `:174~:180` | `answer` |
| `checkV6` | `:183~:194` | `answer` |

### 교체: `verify` 메서드 → 조합기(orchestrator)

6개 함수를 호출 후 결과를 조합하여 `VerificationResult` 반환.
로직 변경 없음 — 출력 동일 보장.

---

## 검증 기준

1. `npm run typecheck` — 에러 0
2. `npm run lint` — 경고/에러 0
3. `npm run test` — 136/136 전부 통과 (스냅샷 diff 없음)
4. `git diff src/` — `lawVerifier.ts` 1개만 변경
