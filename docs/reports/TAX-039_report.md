# TAX-039 구현 리포트 — 비법령 어댑터 매핑 회귀 방지

> 작성자: AI(Claude Opus 4.7) / 작성일: 2026-06-05
> 선행: TAX-037(V4 4종화), 병행: TAX-038(LLM 프롬프트 학습 — 진행 예정)

---

## 변경 사항 요약

### 파일 변경 목록

| 파일 | 구분 | 내용 |
|---|---|---|
| `docs/SSOT.md` | 수정 | §7.2에 비법령 자료 어댑터 매핑 표 신설, 버전 2.4 → 2.5, 변경 이력 추가 |
| `tests/integration/nationalTaxLaw.test.ts` | 수정 | 하단에 `describe('TAX-039 비법령 어댑터 매핑 회귀 방지')` 블록 추가 (4트랙 it.each) |
| `docs/tickets/TAX-039_nonlaw_adapter_mapping_regression_guard.md` | 수정 | 체크박스 갱신, 경로 정정(§7.6 → §7.2 / `tests/adapters/` → `tests/integration/`) |
| `src/adapters/nationalTaxLaw.ts` | 무변경 | 회귀 검증 목적 임시 손상 후 원복 (최종 변경 없음) |

### 티켓 §3.1 조정 (회계사 승인 2026-06-05)

원래 계획(신규 디렉토리·신규 파일·신규 fixture)에서 **조정안**으로 변경:

| 항목 | 원래 | 조정 후 |
|---|---|---|
| 테스트 파일 | `tests/adapters/nationalTaxLaw.nonlaw.test.ts` 신규 | 기존 `tests/integration/nationalTaxLaw.test.ts`에 블록 추가 |
| fixture | `tests/fixtures/nonlaw_responses/*.json` 3건 신규 | 기존 MSW 4트랙 모킹 데이터 재사용 |
| SSOT 섹션 | §7.6 (오기재 — 실제 Trust Tier) | §7.2 (필드 강제와 응집도) |

조정 효과: 신규 디렉토리·파일 무생성, 어댑터 코드 변경 없음(티켓 §3.2 준수), 작업 범위 축소.

---

## 변경 내용 상세

### 1. SSOT §7.2 비법령 매핑 표 신설 (핵심)

기존 §7.2 시점 라벨 의무 직후, "비법령 자료 어댑터 매핑 표 (TAX-039)" subsection 추가:

| 외부 API 필드(예) | 도메인 필드 | 정규화 규칙 |
|---|---|---|
| 사건번호 / 안건번호 / 청구번호 | `caseNumber` | 원문 보존 (매칭 시 공백·대소문자 정규화) |
| 법원명 / 회신기관명 / 해석기관명 / 재결청 / 데이터출처명 | `issuingBody` | 비면 sourceType별 기본값(`'국세청'`·`'조세심판원'`) 폴백 |
| 선고일자 / 회신일자 / 해석일자 / 의결일자 | `decisionDate` | `YYYY-MM-DD` 형식 정규화 (`toIsoDateLoose`) |
| 사건명 / 안건명 | `articleTitle` | 원문 그대로 |
| 판시사항+판결요지 / 질의요지+회답+이유 / 주문+재결요지+이유 | `content` | 원문 그대로 결합 (변형·요약 금지 — §7.1) |
| `target=prec` 또는 `ttSpecialDecc`·`expc`·`ntsCgmExpc` | `sourceType` | 판례=`판례` / 심판례=`심판례` / 해석례(법제처·국세청)=`해석례` |

⚠ 매핑 누락 시 §7.4 V4 시점 라벨이 `[현행]`으로 폴백되어 결정일 맥락이 손실됨을 명시.

### 2. 통합 테스트 신규 블록

```typescript
describe('TAX-039 비법령 어댑터 매핑 회귀 방지', () => {
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

  it.each([
    { name: '판례(대법원)',     caseNumber: '2020다288436',     issuingBody: '대법원',     sourceType: '판례' },
    { name: '법제처 해석례',   caseNumber: '12-0368',           issuingBody: '법제처',     sourceType: '해석례' },
    { name: '국세청 해석',     caseNumber: '법인22601-2200',    issuingBody: '국세청',     sourceType: '해석례' },
    { name: '심판례',          caseNumber: '조심 2020부1558',   issuingBody: '조세심판원', sourceType: '심판례' },
  ])('[$name] decisionDate가 YYYY-MM-DD 정규식 매칭 · caseNumber·issuingBody 채워진다', async (...) => {
    // sourceType+caseNumber로 명시 매칭(해석례 2트랙 issuingBody 구분)
    const item = result.items.find(i => i.sourceType === sourceType && i.caseNumber === caseNumber)
    expect(item!.decisionDate).toMatch(ISO_DATE_RE)
    expect(item!.caseNumber).toBeTruthy()
    expect(item!.issuingBody).toBe(issuingBody)
  })
})
```

### 3. SSOT 버전·변경 이력

- 버전 헤더: `2.4` → `2.5`, 갱신 일자 `2026-06-05 (v2.5)` 추가
- 변경 이력 표 끝에 v2.5 행 추가 (TAX-039 매핑 표 신설 · 회귀 테스트 4트랙 추가)

---

## 검증 결과

### 1. 신규 테스트 PASS

```
npx vitest run tests/integration/nationalTaxLaw.test.ts
Test Files  1 passed (1)
Tests       36 passed (36)
Duration    5.87s
```

TAX-039 신규 4건 PASS + 기존 32건 회귀 없음.

### 2. 어댑터 매핑 손상 시뮬레이션 (회귀 검증)

`toIsoDateLoose()` 함수를 임시로 정규화 비활성화(`return raw`)하여 손상 시뮬레이션:

```
TAX-039 비법령 어댑터 매핑 회귀 방지
  ❌ [판례(대법원)]    expected '2026.03.12' to match /^\d{4}-\d{2}-\d{2}$/
  ❌ [법제처 해석례]   expected '2026.02.20' to match /^\d{4}-\d{2}-\d{2}$/
  ❌ [국세청 해석]     expected '2024.08.05' to match /^\d{4}-\d{2}-\d{2}$/
  ❌ [심판례]          expected '2020.06.16' to match /^\d{4}-\d{2}-\d{2}$/

Tests  4 failed | 32 skipped (36)
```

→ 4트랙 모두 즉시 catch. 회귀 봉인 작동 확인 후 원복.

### 3. 전체 vitest 회귀 게이트 (원복 후)

```
Test Files  12 passed (12)
Tests       249 passed (249)
Duration    5.91s
```

### 4. 골든셋 사전 점검

```
확정까지 남은 수: 0건 (목표 30)
사전 점검 불일치(기대≠실제): 0건
```

40건 V1~V6 모두 통과, 비법령 4건의 `[결정: YYYY.MM.DD]` 라벨 무회귀.

---

## 정책·결정 사항

| 결정일 | 항목 | 내용 |
|---|---|---|
| 2026-06-05 | 매핑 표 위치 | SSOT §7.2 하단 (필드 강제와 응집) — 원래 티켓 §7.6은 Trust Tier 섹션이라 정정 |
| 2026-06-05 | 테스트 위치 | 기존 `tests/integration/` 재사용 — 신규 디렉토리·fixture 무생성 |
| 2026-06-05 | SSOT 버전 | 2.4 → 2.5 |
| 2026-06-05 | 어댑터 코드 | 무변경 (회귀 검증 후 원복 완료) |

---

## 잠재 위험

| 위험 | 수준 | 대응 |
|---|---|---|
| 외부 API가 새 필드명(예: `결정일자`)을 도입 | 저 | SSOT §7.2 매핑 표를 분기별 점검 항목에 추가 권장 |
| 비법령 4트랙 외 신규 자료유형 추가 시 매핑 누락 | 저 | 신규 sourceType 추가 티켓 시 본 매핑 표 갱신 의무화 |
| MSW 모킹 데이터가 실 API 응답과 분기 | 저 | 분기별 1회 실 API probe → 모킹 데이터 갱신 (기존 운영 프로세스) |

---

## 후속 작업

- **TAX-038** 운영 LLM 프롬프트에 `[결정: ...]` 학습 — 본 티켓이 어댑터 단 `decisionDate` 안정 매핑을 보장했으므로 후속 진행 가능.

---

## 참조

- `docs/tickets/TAX-039_nonlaw_adapter_mapping_regression_guard.md` — 구현 티켓
- `docs/SSOT.md` §7.2 — 매핑 표 (line ~259)
- `tests/integration/nationalTaxLaw.test.ts` — TAX-039 블록 (line ~1011)
- `src/adapters/nationalTaxLaw.ts` `buildNonLawTaxLaw` (line ~418), `toIsoDateLoose` (line ~226) — 변경 없음
