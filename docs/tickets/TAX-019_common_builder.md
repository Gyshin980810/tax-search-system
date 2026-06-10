# TAX-019 — 비법령 4트랙 공통 빌더 `buildNonLawTaxLaw` 추출

- **선행:** TAX-018 (리팩터 안전망 — 스냅샷 5건 + lawName 폴백 4건)
- **후행:** TAX-021 (선행 조건 중 하나)
- **작업일:** 2026-05-22
- **위험도:** 🟡 낮음 — `src/` 수정 포함, TAX-018 안전망으로 회귀 즉시 감지 가능

---

## 배경

`nationalTaxLaw.ts`의 4종 비법령 변환 함수(`toPrecedentTaxLaw`, `toInterpretationTaxLaw`,
`toNtsInterpretationTaxLaw`, `toTribunalTaxLaw`)가 `TaxLaw` 객체를 반환할 때
아래 6개 필드를 4곳 모두에서 동일하게 중복 작성했다.

| 필드 | 중복된 패턴 |
|---|---|
| `articleNumber` | 항상 `''` |
| `enforcementDate` | 항상 `''` |
| `revisionDate` | 항상 `decisionDate` |
| `caseNumber` | 항상 `caseNo` 변수 |
| `issuingBody` | 항상 `issuingBody` 변수 |
| `decisionDate` | 항상 `decisionDate` 변수 |

이 중복을 `buildNonLawTaxLaw` 함수 1개로 추출한다.

---

## 변경 파일

| 파일 | 변경 종류 |
|---|---|
| `src/adapters/nationalTaxLaw.ts` | 수정 |
| 기타 일체 | **변경 없음** |

---

## 구현 상세

### 추가 (`// ─── Adapter ──` 구분선 바로 위)

```typescript
interface NonLawBase {
  sourceType: TaxLaw['sourceType']
  trustTier: TrustTier
  lawName: string
  caseNumber: string
  issuingBody: string
  articleTitle: string
  content: string
  decisionDate: string
  sourceUrl: string
}

function buildNonLawTaxLaw(base: NonLawBase): TaxLaw {
  return {
    sourceType: base.sourceType,
    lawName: base.lawName,
    articleNumber: '',
    articleTitle: base.articleTitle,
    content: base.content,
    revisionDate: base.decisionDate,  // 정렬·표시 호환을 위해 결정일로 채움
    enforcementDate: '',
    sourceUrl: base.sourceUrl,
    trustTier: base.trustTier,
    caseNumber: base.caseNumber,
    issuingBody: base.issuingBody,
    decisionDate: base.decisionDate,
  }
}
```

### 교체 (4종 변환 함수)

각 `return { ... }` 블록을 `return buildNonLawTaxLaw({ ... })`로 교체.
각 함수의 고유 필드(`sourceType`, `trustTier`, `lawName`, `caseNumber`, `issuingBody`,
`articleTitle`, `content`, `decisionDate`, `sourceUrl`)만 인수로 전달.

---

## 검증 기준

1. `npm run typecheck` — 에러 0
2. `npm run lint` — 경고/에러 0
3. `npm run test` — 136/136 전부 통과 (스냅샷 diff 없음)
4. `git diff src/` — `nationalTaxLaw.ts` 1개만 변경
