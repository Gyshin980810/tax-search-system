# TAX-020 구현 리포트 — `verify` 메서드 V1~V6 분해

- **티켓:** `docs/tickets/TAX-020_verify_decompose.md`
- **작업일:** 2026-05-22
- **상태:** 구현 완료

---

## 변경 사항 요약

**파일 변경 목록:**
- `src/adapters/lawVerifier.ts` (수정 — checkV1~checkV6 분리 + verify 조합기로 교체)
- `docs/tickets/TAX-020_verify_decompose.md` (신규)
- `docs/reports/TAX-020_report.md` (신규)

**테스트·스냅샷 변경: 0줄**

---

## 변경 내용

### 추가: 6개 파일-스코프 순수 함수

클래스(`LawVerifierAdapter`) 선언 바로 위에 파일-스코프 순수 함수로 추가.
TAX-019 `buildNonLawTaxLaw` 패턴과 동일 — 클래스 내부 상태 의존 없음.

| 함수 | 의존 인수 | 반환 |
|---|---|---|
| `checkV1` | `answer`, `sourceLaws` | `string[]` (실패 이유) |
| `checkV2` | `answer`, `sourceLaws` | `string[]` |
| `checkV3` | `answer` | `string[]` |
| `checkV4` | `answer` | `string[]` |
| `checkV5` | `answer` | `string[]` |
| `checkV6` | `answer` | `string[]` |

빈 배열(`[]`) = 해당 V 통과. 실패 이유 문자열이 있으면 FAIL.

### 교체: `verify` 메서드 → 조합기(orchestrator)

108줄 인라인 로직 → 6개 함수 호출 + 결과 조합 14줄으로 교체.
로직 변경 없음 — 출력 동일성은 스냅샷 diff 0개로 자동 증명.

---

## 검증 결과

| 항목 | 결과 |
|---|---|
| `npm run typecheck` (tsc) | ✅ 에러 0 |
| `npm run lint` (eslint) | ✅ 경고/에러 0 |
| `npm run test` (vitest) | ✅ **136개 전부 통과** (스냅샷 diff 없음) |
| 스냅샷 업데이트 | ✅ **0개** (출력 무변경 확인) |

TAX-018 안전망(스냅샷 5건 + lawName 폴백 4건)이 스냅샷 diff를 감지하지 않아
**검증 출력이 리팩터 전후 동일함이 자동으로 증명됨.**

---

## 후속 작업

- **TAX-021:** `TwoStageSpec` 제네릭 2단계 실행기 — TAX-018·019 완료 후 (선행 충족)
- **TAX-022:** `identityOf` 통합 — matchesIdentity·identityLabel 중복 분기 통합 (TAX-020 완료 후)

**리포트:** `docs/reports/TAX-020_report.md`
