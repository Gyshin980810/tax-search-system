# TAX-019 구현 리포트 — 비법령 4트랙 공통 빌더 `buildNonLawTaxLaw`

- **티켓:** `docs/tickets/TAX-019_common_builder.md`
- **작업일:** 2026-05-22
- **상태:** 구현 완료

---

## 변경 사항 요약

**파일 변경 목록:**
- `src/adapters/nationalTaxLaw.ts` (수정 — 빌더 추가 + 4종 변환 함수 교체)
- `docs/tickets/TAX-019_common_builder.md` (신규)
- `docs/reports/TAX-019_report.md` (신규)

**테스트·스냅샷 변경: 0줄**

---

## 변경 내용

### 추가: `NonLawBase` 인터페이스 + `buildNonLawTaxLaw` 함수

`// ─── Adapter ──` 구분선 위(`:316` 직전)에 파일-스코프 순수 함수로 추가.
클래스 내부 상태에 의존하지 않아 테스트 독립성 유지.

### 교체: 4종 변환 함수 `return { ... }` → `return buildNonLawTaxLaw({ ... })`

| 함수 | 제거된 중복 필드 수 |
|---|---|
| `toPrecedentTaxLaw` | 6개 (`articleNumber`, `revisionDate`, `enforcementDate`, `caseNumber`, `issuingBody`, `decisionDate`) |
| `toInterpretationTaxLaw` | 6개 (동일) |
| `toNtsInterpretationTaxLaw` | 6개 (동일) |
| `toTribunalTaxLaw` | 6개 (동일) |

각 함수에 남은 고유 인수: `sourceType`, `trustTier`, `lawName`, `caseNumber`, `issuingBody`,
`articleTitle`, `content`, `decisionDate`, `sourceUrl` — 함수별로 달라지는 값만 전달.

---

## 검증 결과

| 항목 | 결과 |
|---|---|
| `npm run typecheck` (tsc) | ✅ 에러 0 |
| `npm run lint` (eslint) | ✅ 경고/에러 0 |
| `npm run test` (vitest) | ✅ **136개 전부 통과** (스냅샷 diff 없음) |
| 스냅샷 업데이트 | ✅ **0개** (출력 무변경 확인) |

TAX-018 안전망(스냅샷 5건 + lawName 폴백 4건)이 스냅샷 diff를 감지하지 않아
**변환 출력이 리팩터 전후 동일함이 자동으로 증명됨.**

---

## 후속 작업

- **TAX-020:** `verify` 메서드 분해 — 독립 실행 가능 (TAX-019와 병렬)
- **TAX-021:** `TwoStageSpec` 제네릭 2단계 실행기 — TAX-018·019 완료 후

**리포트:** `docs/reports/TAX-019_report.md`
