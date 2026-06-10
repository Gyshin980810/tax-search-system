# TAX-037 구현 리포트 — 비법령 V4 시점 라벨 사양 정합

> 작성자: AI(Claude Sonnet 4.6) / 작성일: 2026-06-05

---

## 변경 사항 요약

### 파일 변경 목록

| 파일 | 구분 | 내용 |
|---|---|---|
| `src/adapters/lawVerifier.ts` | 수정 | V4 정규식에 `[결정: YYYY.MM.DD]` 패턴 추가 (3종 → 4종) |
| `docs/SSOT.md` | 수정 | §7.2 시점 라벨 목록에 `[결정: ...]` 행 추가, 버전 2.3 → 2.4, 변경 이력 추가 |
| `docs/PRD.md` | 수정 | §6.4.1 시점 라벨 표에 `[결정: ...]` 행 추가 |
| `CLAUDE.md` | 수정 | §6.2 시점 라벨 목록·§9.4 시점 라벨 참조 행 업데이트 |
| `scripts/golden/buildNonlawCases.ts` | 수정 | `buildTemporalLabel()` 임시 처리 제거 → `decisionDate` 기반 실제 변환 |
| `eval/golden_direct.json` | 수정 | 비법령 4건 `temporalLabel` `[현행]` → `[결정: YYYY.MM.DD]` |

---

## 변경 내용 상세

### 1. lawVerifier.ts V4 정규식 (핵심 변경)

**변경 전:**
```typescript
const TEMPORAL_LABEL_PATTERNS: RegExp[] = [
  /^\[현행\]$/,
  /^\[적용 시점: \d{4}\.\d{2}\.\d{2}~\d{4}\.\d{2}\.\d{2}\]$/,
  /^\[폐지: \d{4}\.\d{2}\.\d{2}\]$/,
]
```

**변경 후:**
```typescript
const TEMPORAL_LABEL_PATTERNS: RegExp[] = [
  /^\[현행\]$/,
  /^\[적용 시점: \d{4}\.\d{2}\.\d{2}~\d{4}\.\d{2}\.\d{2}\]$/,
  /^\[폐지: \d{4}\.\d{2}\.\d{2}\]$/,
  /^\[결정: \d{4}\.\d{2}\.\d{2}\]$/,   // 비법령용 (TAX-037)
]
```

V1~V3·V5·V6 로직 무변경. 법령 시점 라벨 형식 무변경.

### 2. buildNonlawCases.ts `buildTemporalLabel()` 정식화

**변경 전 (임시 처리):**
```typescript
function buildTemporalLabel(_decisionDate: string | undefined): string {
  return '[현행]'   // TAX-036 임시: 결정일 무시
}
```

**변경 후 (정식):**
```typescript
function buildTemporalLabel(decisionDate: string | undefined): string {
  if (!decisionDate) return '[현행]'
  const m = decisionDate.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return '[현행]'
  return `[결정: ${m[1]}.${m[2]}.${m[3]}]`
}
```

`decisionDate` 없거나 형식 불명 시 `[현행]` 반환 → 기존 동작 보존.

### 3. 문서 정합 (SSOT v2.4·PRD·CLAUDE.md)

3개 문서에 동일한 내용 추가:

```
[결정: YYYY.MM.DD] — 비법령(심판례·해석례·판례) 결정·선고·회신일 (TAX-037)
비법령에서 결정일 불명이거나 상시 해석 원칙인 경우 [현행] 사용 가능.
```

### 4. 골든셋 비법령 4건 라벨 갱신

| ID | 결정일(decisionDate) | 변경 전 | 변경 후 |
|---|---|---|---|
| G-S-NL-01 | 2012-09-14 | `[현행]` | `[결정: 2012.09.14]` |
| G-S-NL-02 | 2011-06-29 | `[현행]` | `[결정: 2011.06.29]` |
| G-S-NL-03 | 2013-05-30 | `[현행]` | `[결정: 2013.05.30]` |
| G-S-NL-04 | 2010-12-23 | `[현행]` | `[결정: 2010.12.23]` |

`answer.temporalLabel` + `citations[].temporalLabel` 동시 갱신.

---

## 검증 결과

### 1. V1~V6 사전 점검

```
확정(golden_direct.json): 40 / 30  [████████████████████████]
전체 40건 V1~V6: 40/40 통과
사전 점검 불일치(기대≠실제): 0건
```

비법령 4건 V4: `[결정: ...]` 패턴으로 ✔ → 기존 `[현행]`과 동일하게 통과.

### 2. vitest 회귀 게이트

```
Test Files  1 passed (1)
Tests       40 passed (40)
Duration    1.39s
```

법령 36건 회귀 없음. 비법령 4건 라벨 변경 후에도 PASS 유지.

---

## 잠재 위험

| 위험 | 수준 | 대응 |
|---|---|---|
| 운영 LLM 프롬프트가 `[결정: ...]` 형식을 모르면 생성 안 할 가능성 | 저 | 현재 운영 답변은 법령 위주 → 비법령 V4는 골든셋 픽스처 수준에서만 작동. 향후 운영 프롬프트에 `[결정: ...]` 안내 추가 필요 |
| 비법령 결정일이 `decisionDate`가 아닌 다른 필드에 있을 경우 | 저 | 현재 4건 모두 `decisionDate` 존재 확인. 없으면 `[현행]` 반환으로 안전 처리 |

---

## 정책·결정 사항

| 결정일 | 항목 | 내용 |
|---|---|---|
| 2026-06-05 | 비법령 시점 라벨 형식 | `[결정: YYYY.MM.DD]` 정식 채택 |
| 2026-06-05 | 결정일 불명 처리 | `[현행]` 허용 (예외 경로) |
| 2026-06-05 | SSOT 버전 | 2.3 → 2.4 |

---

## 참조

- `docs/tickets/TAX-037_nonlaw_v4_temporal_label_spec.md` — 구현 티켓
- `src/adapters/lawVerifier.ts` — V4 정규식 (line ~43)
- `scripts/golden/buildNonlawCases.ts` — `buildTemporalLabel()` (line ~105)
- `eval/golden_direct.json` — 비법령 4건 (G-S-NL-01~04)
