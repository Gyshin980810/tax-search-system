# TAX-018 구현 리포트 — 리팩터 안전망 (4트랙 스냅샷 + lawName 폴백 테스트)

- **티켓:** `docs/tickets/TAX-018_refactor_safety_net.md`
- **작업일:** 2026-05-22
- **상태:** 구현 완료

---

## 변경 사항 요약

**파일 변경 목록:**
- `tests/integration/nationalTaxLaw.test.ts` (수정 — 스냅샷 5건 + lawName 폴백 4건 추가)
- `tests/integration/__snapshots__/nationalTaxLaw.test.ts.snap` (신규 자동 생성)
- `docs/tickets/TAX-018_refactor_safety_net.md` (신규)
- `docs/reports/TAX-018_report.md` (신규)

**프로덕션 코드 변경: 0줄** (`src/` 디렉토리 무변경)

---

## 추가된 테스트 (총 9건)

### 비법령 4트랙 전체 필드 스냅샷 (5건)

`lawAndPrecHandlers` MSW mock 재사용, 각 자료를 `caseNumber`/`issuingBody`로 명시 지목 후 `toMatchSnapshot()`.

| # | 자료 | 식별자 |
|---|---|---|
| 1 | 판례 (대법원·본문있음) | `caseNumber = '2020다288436'` |
| 2 | 판례 (국세출처·본문없음) | `caseNumber = '인천지방법원-2025-구단-50403'` |
| 3 | 법제처 해석례 | `caseNumber = '12-0368'` |
| 4 | 국세청 해석 | `sourceType='해석례' && issuingBody='국세청'` |
| 5 | 심판례 | `sourceType='심판례'` |

스냅샷에 고정된 필드: `lawName·sourceType·articleNumber·caseNumber·issuingBody·decisionDate·revisionDate·enforcementDate·sourceUrl·content·trustTier` 전부.

### lawName 폴백 규칙 명시 고정 (4건)

빈 기관명 mock을 별도 생성해 `expect(...).toBe(...)`로 규칙을 명문화.

| 자료 | 빈 값 | 기대 결과 | 특성 |
|---|---|---|---|
| 판례 | `법원명=''` | `lawName = '2020다288436'` | 폴백 없음 — 사건번호만 |
| 법제처 | `회신기관명=''` | `lawName = '12-0368'` | 폴백 없음 — 안건번호만 |
| 국세청 | `해석기관명=''` | `lawName = '국세청 법인22601-2200'` | `\|\|'국세청'` 폴백 + 항상 결합 |
| 심판례 | `재결청=''` | `lawName = '조세심판원 조심 2020부1558'` | `\|\|'조세심판원'` 폴백 + 결합 |

---

## 생성된 스냅샷 확인

`tests/integration/__snapshots__/nationalTaxLaw.test.ts.snap` 내용 요약:

```
판례(대법원)  → lawName="대법원 2020다288436", trustTier="T4", sourceUrl=precInfoP.do?precSeq=618543
판례(국세)    → lawName="인천지방법원-2025-구단-50403", content="", issuingBody="국세법령정보시스템"
법제처 해석례 → lawName="법제처 12-0368", trustTier="T3", content(질의요지+회답+이유 결합)
국세청 해석   → lawName="국세청 법인22601-2200", content="", sourceUrl=taxlaw.nts.go.kr
심판례        → lawName="조세심판원 조심 2020부1558", trustTier="T3", sourceUrl=allDeccSc.do?query=...
```

---

## 검증 결과

| 항목 | 결과 |
|---|---|
| `npm run typecheck` (tsc) | ✅ 에러 0 |
| `npm run lint` (eslint) | ✅ 경고/에러 0 |
| `npm run test` (vitest) | ✅ **136개 전부 통과** (기존 127 + 신규 9) |
| 스냅샷 5개 신규 생성 | ✅ `.snap` 파일 확인 |
| 프로덕션 코드 diff | ✅ **0줄** |

---

## 이 안전망의 사용법 (TAX-019~023 리팩터 시)

1. 리팩터 구현 후 `npm run test` 실행
2. 스냅샷 diff가 발생하면 → **사람이 눈으로 diff 검토**
3. "출력 무변경" 확인 후에만 `npx vitest run --update-snapshots`
4. diff가 없으면 → 회귀 없음 자동 증명

> ⚠️ `--update-snapshots`는 반드시 사람이 diff를 확인한 후에만 실행. 자동으로 업데이트하면 안전망 의미가 사라집니다.

---

## 잠재 위험 / 한계

- **Mock 기반 안전망:** 실 API end-to-end 동작까지는 커버하지 않음. 회계사 수동 검증(`npm run dev`) 여전히 필요.
- **스냅샷 업데이트 규율:** 리팩터 후 스냅샷 diff가 생기면 반드시 사람이 검토 후 갱신.

---

## 후속 작업

- **TAX-019:** `buildNonLawTaxLaw` 공통 빌더 (이 스냅샷이 안전망)
- **TAX-020:** `verify` 메서드 분해 (독립 실행 가능)

**리포트:** `docs/reports/TAX-018_report.md`
