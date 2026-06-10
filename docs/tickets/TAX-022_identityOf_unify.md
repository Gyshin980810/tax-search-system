# TAX-022 — `identityOf` 통합

- **선행:** TAX-020 (checkV1~V6 분해) + TAX-021 (TwoStageSpec) — 모두 완료
- **후행:** 없음 (리팩터 시리즈 최종)
- **작업일:** 2026-05-23
- **위험도:** 🟡 낮음 — `src/` 수정 포함, TAX-018 안전망으로 회귀 즉시 감지 가능

---

## 배경

`src/adapters/lawVerifier.ts`의 `matchesIdentity`·`identityLabel` 두 함수가
**동일한 `sourceType === '법령'` 분기 로직**을 각자 독립적으로 구현하고 있다.

| 문제 | 증거 |
|---|---|
| 분기 로직 중복 | `matchesIdentity` 58~64줄, `identityLabel` 69~71줄에 동일 패턴 |
| 향후 sourceType 추가 시 수정 지점 2곳 | 새 자료유형(예: 심판례 세분화) 추가 시 두 함수 모두 수정 필요 |
| TAX-019·020·021 패턴과 불일치 | 같은 파일의 나머지 함수는 파일-스코프 순수 함수로 정리됨 |

TAX-019(`buildNonLawTaxLaw`)·TAX-020(`checkV1~V6`)·TAX-021(`runTwoStage`) 패턴과 동일하게,
**파일-스코프 순수 함수**(`identityOf`)를 추출하고 두 함수가 위임하도록 교체한다.

---

## 변경 파일

| 파일 | 변경 종류 |
|---|---|
| `src/adapters/lawVerifier.ts` | 수정 |
| 기타 일체 | **변경 없음** |

---

## 현재 코드 (문제 지점)

```typescript
// matchesIdentity — lines 56~65
function matchesIdentity(source: TaxLaw, cited: TaxLaw): boolean {
  const sourceType = source.sourceType ?? '법령'
  const citedType  = cited.sourceType  ?? '법령'
  if (sourceType !== citedType) return false
  if (citedType === '법령') {                              // ← 분기 ①
    return source.lawName === cited.lawName && source.articleNumber === cited.articleNumber
  }
  return !!cited.caseNumber && source.caseNumber === cited.caseNumber
}

// identityLabel — lines 68~72
function identityLabel(law: TaxLaw): string {
  return law.sourceType === '법령'                         // ← 분기 ②(동일 패턴)
    ? `${law.lawName} ${law.articleNumber}`
    : `${law.lawName} ${law.caseNumber ?? ''}`.trim()
}
```

**중복:** 두 함수 모두 `sourceType === '법령'` → `lawName+articleNumber`, 비법령 → `caseNumber` 를 독립 구현.

---

## 구현 상세

### 추가: `identityOf(law: TaxLaw)` 파일-스코프 순수 함수

`matchesIdentity` 바로 위(파일-스코프)에 추가한다.

```typescript
/**
 * 자료 식별자 정규화 — 유형별 동일성 비교(key)·표시(label) 단일 진입점
 *
 * - 법령: lawName + articleNumber (조문번호가 식별자)
 * - 비법령(판례·해석례·심판례 등): caseNumber (사건번호가 식별자; 없으면 key = '')
 *
 * key = '' 이면 식별 불가 → matchesIdentity에서 false 반환 (환각 차단, V1 규칙).
 */
function identityOf(law: TaxLaw): { type: string; key: string; label: string } {
  const type = law.sourceType ?? '법령'
  if (type === '법령') {
    const k = `${law.lawName} ${law.articleNumber}`
    return { type, key: k, label: k }
  }
  const key = law.caseNumber ?? ''
  return { type, key, label: `${law.lawName} ${key}`.trim() }
}
```

### 교체: `matchesIdentity` + `identityLabel` → `identityOf` 위임

```typescript
function matchesIdentity(source: TaxLaw, cited: TaxLaw): boolean {
  const s = identityOf(source)
  const c = identityOf(cited)
  return s.type === c.type && !!c.key && s.key === c.key
}

function identityLabel(law: TaxLaw): string {
  return identityOf(law).label
}
```

**동작 등가성 증명:**

| 경로 | 기존 | 교체 후 |
|---|---|---|
| 법령 ↔ 법령, lawName+articleNumber 일치 | `true` | `s.type === c.type` ✓ + `s.key === c.key` ✓ → `true` |
| 법령 ↔ 법령, 불일치 | `false` | `s.key !== c.key` → `false` |
| 법령 ↔ 비법령 | `sourceType !== citedType` → `false` | `s.type !== c.type` → `false` |
| 비법령 ↔ 비법령, caseNumber 일치 | `true` | `s.key === c.key` ✓ → `true` |
| 비법령, caseNumber 없음 | `!!cited.caseNumber` → `false` | `!!c.key` = `!!''` → `false` |
| identityLabel 법령 | `lawName articleNumber` | `identityOf.label` = 동일 |
| identityLabel 비법령 | `lawName caseNumber`.trim() | `identityOf.label` = 동일 |

---

## 삽입 위치

현재 파일 구조:

```
lines  1~  6: imports
lines  8~ 18: TIER_ALLOWED_LABELS 상수
lines 20~ 32: ASSERTIVE_PATTERNS 상수
lines 34~ 47: TEMPORAL_LABEL_PATTERNS 상수
lines 49~ 65: matchesIdentity  ← identityOf를 이 위에 삽입
lines 67~ 72: identityLabel    ← 내용 교체
lines 74~ 86: extractQuotedSpans
lines 88~174: checkV1~checkV6
lines 176~211: LawVerifierAdapter 클래스
```

`identityOf`는 `matchesIdentity` 바로 위(현재 49줄 주석 앞)에 삽입한다.

---

## 검증 기준

1. `npm run typecheck` — 에러 0
2. `npm run lint` — 경고/에러 0
3. `npm run test` — 136/136 전부 통과 (스냅샷 diff 없음)
4. `git diff src/` — `lawVerifier.ts` 1개만 변경

---

## 후속 작업

없음 — TAX-018·019·020·021·022로 리팩터 시리즈 완결.
