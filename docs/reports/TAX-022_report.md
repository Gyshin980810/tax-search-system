# TAX-022 구현 리포트 — `identityOf` 통합

- **티켓:** `docs/tickets/TAX-022_identityOf_unify.md`
- **작업일:** 2026-05-23
- **상태:** 구현 완료

---

## 변경 사항 요약

**파일 변경 목록:**
- `src/adapters/lawVerifier.ts` (수정 — identityOf 추가 + matchesIdentity·identityLabel 교체)
- `docs/tickets/TAX-022_identityOf_unify.md` (신규)
- `docs/reports/TAX-022_report.md` (신규)

**테스트·스냅샷 변경: 0줄**

---

## 변경 내용

### 추가: `identityOf(law: TaxLaw)` 파일-스코프 순수 함수

`matchesIdentity` 바로 위(파일-스코프)에 추가. TAX-019·020·021 패턴과 동일.

```typescript
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

| 반환 필드 | 용도 |
|---|---|
| `type` | 자료유형 (`sourceType ?? '법령'`) — 동일성 비교 첫 조건 |
| `key` | 동일성 비교 키 (법령=`lawName articleNumber`, 비법령=`caseNumber`, 없으면 `''`) |
| `label` | 실패 메시지 표시용 (법령=`lawName articleNumber`, 비법령=`lawName caseNumber`.trim()) |

### 교체: `matchesIdentity` + `identityLabel` → `identityOf` 위임

기존 두 함수가 각자 구현하던 `sourceType === '법령'` 분기를 `identityOf`에 위임.

**교체 전:**
```typescript
// matchesIdentity: 11줄 (sourceType 계산 2회 + 분기 2단계)
// identityLabel:    3줄 (별도 분기)
```

**교체 후:**
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

### 동작 등가성

| 경로 | 기존 결과 | 교체 후 결과 |
|---|---|---|
| 법령↔법령, lawName+articleNumber 일치 | `true` | `true` |
| 법령↔법령, 불일치 | `false` | `false` |
| 법령↔비법령 | `false` (sourceType 불일치) | `false` (type 불일치) |
| 비법령↔비법령, caseNumber 일치 | `true` | `true` |
| 비법령, caseNumber 없음 | `false` (`!!cited.caseNumber`) | `false` (`!!c.key` = `!!''`) |
| identityLabel 법령 | `lawName articleNumber` | `identityOf.label` = 동일 |
| identityLabel 비법령 | `lawName caseNumber`.trim() | `identityOf.label` = 동일 |

---

## 검증 결과

| 항목 | 결과 |
|---|---|
| `npm run typecheck` (tsc) | ✅ 에러 0 |
| `npm run lint` (eslint) | ✅ 경고/에러 0 |
| `npm run test` (vitest) | ✅ **136개 전부 통과** (스냅샷 diff 없음) |
| 변경 파일 | ✅ `lawVerifier.ts` 1개만 수정 |

기존 V1 출처 존재 검증·비법령 트랙 스냅샷·lawName 폴백 테스트가
**모두 그대로 통과**하여 출력 무변경이 자동으로 증명됨.

---

## 리팩터 시리즈 완결

| 티켓 | 내용 | 상태 |
|---|---|---|
| TAX-018 | 안전망 — 스냅샷 골든셋 + lawName 폴백 | ✅ 완료 |
| TAX-019 | `buildNonLawTaxLaw` 공통 빌더 추출 | ✅ 완료 |
| TAX-020 | `checkV1~checkV6` 분해 | ✅ 완료 |
| TAX-021 | `TwoStageSpec` 제네릭 2단계 실행기 | ✅ 완료 |
| TAX-022 | `identityOf` 통합 | ✅ 완료 |

**리포트:** `docs/reports/TAX-022_report.md`
