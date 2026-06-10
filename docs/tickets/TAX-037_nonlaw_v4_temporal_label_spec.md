# TAX-037 비법령 V4 시점 라벨 사양 정합

> 작성자: AI(Claude Sonnet 4.6) / 작성일: 2026-06-05
> 배경: TAX-036 골든셋 보강 중 비법령(심판례·해석례) V4 호환 임시 처리로 도출된 사양 공백 해소

---

## Metadata

- **Type**: TASK
- **Severity**: minor
- **Layer**: docs (SSOT·PRD·CLAUDE.md) + adapter (lawVerifier)
- **Milestone**: Post-MVP
- **Estimated Size**: S (문서 3파일 + 코드 1파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

비법령(심판례·해석례·판례)은 **법령처럼 시행일이 없고**, 대신 결정일·선고일·회신일(`decisionDate`)이 있다.

현재 `lawVerifier.ts`의 V4 검사는 시점 라벨 3종만 허용:
- `[현행]`
- `[적용 시점: YYYY.MM.DD ~ YYYY.MM.DD]`
- `[폐지: YYYY.MM.DD]`

TAX-036에서 `buildNonlawCases.ts`가 비법령에 `[결정: YYYY-MM-DD]` 형식을 부착하자 V4 FAIL이 발생했다.
"lawVerifier 무변경" 정책(메모리 `project_tax036_nonlaw_golden.md`)에 따라 **임시로 `[현행]`을 부착**하여 회귀를 막았다.

결과: 비법령의 결정일 정보가 시점 라벨에서 누락(summary 본문·`decisionDate` 필드에만 보존).

### 1.2 기대 동작

비법령용 시점 라벨이 **SSOT·PRD·CLAUDE.md·lawVerifier 4곳 모두에 일관되게 정의**된다.

예상 라벨 형식 (회계사 확정 필요):
- `[결정: YYYY.MM.DD]` — 결정·선고·회신일이 명확한 비법령 자료
- `[현행]` — 결정일 불명이거나 상시 적용되는 해석 원칙

lawVerifier V4가 위 형식을 허용하도록 정규식·분기 추가.

### 1.3 영향·중요도

- **V4 정확성 향상**: 현재 비법령 케이스에 `[현행]`이 임시 부착되어 결정 시점 맥락 약화
- **향후 비법령 추가 시 일관성**: 새로운 심판례·해석례 골든셋 작성할 때마다 임시 처리 없이 정식 라벨 사용 가능
- **코드 변경 범위**: lawVerifier V4 정규식 1~2줄 + 문서 3파일 §6.2 / §7.2 / CLAUDE.md §6.2 각 1~3행 추가

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/adapters/lawVerifier.ts` — V4 시점 라벨 검사 정규식 (수정)
- `docs/SSOT.md` §7.2 시점 라벨 의무 (수정: 비법령용 라벨 추가)
- `docs/PRD.md` §6.2 또는 정확성 보증 섹션 (수정: 동일 정합)
- `CLAUDE.md` §6.2 시점 라벨 (수정: 동일 정합)
- `scripts/golden/buildNonlawCases.ts` — `buildTemporalLabel()` 임시 처리 제거 (수정)
- `eval/golden_direct.json` — 현재 `[현행]` 부착된 비법령 4건 라벨 갱신 (선택: 회계사 결정)

### 2.2 현재 lawVerifier V4 코드 위치

```
src/adapters/lawVerifier.ts
→ V4 검사: temporalLabel 패턴 매칭 (grep: "현행\|적용 시점\|폐지")
```

### 2.3 아키텍처 힌트

문서 정합 → lawVerifier V4 코드 수정 → buildNonlawCases.ts 임시 처리 제거 → 골든셋 갱신(선택) 순서.

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [x] `docs/SSOT.md` §7.2 — 비법령용 시점 라벨 1종 추가 (v2.4)
- [x] `docs/PRD.md` — 동일 내용 정합
- [x] `CLAUDE.md` §6.2 — 동일 내용 정합
- [x] `src/adapters/lawVerifier.ts` — V4 정규식에 `[결정: ...]` 패턴 추가
- [x] `scripts/golden/buildNonlawCases.ts` — `buildTemporalLabel()` 임시 처리 제거
- [x] `eval/golden_direct.json` 비법령 4건 — `[현행]` → `[결정: YYYY.MM.DD]` 갱신

### 3.2 금지되는 변경

- ❌ lawVerifier V1~V3·V5·V6 로직 변경
- ❌ 법령(sourceType='법령') 시점 라벨 형식 변경
- ❌ 골든셋 확정본의 summary 내용 변경 (라벨만 수정)
- ❌ 아키텍처·폴더 구조 변경

---

## 4. Strategy (구현 힌트)

1. **회계사 확정**: `[결정: YYYY.MM.DD]` 형식 사용 여부 확인 (또는 `[현행]` 계속 사용 결정)
2. **SSOT §7.2 수정**: 시점 라벨 표에 비법령 행 추가
   ```
   | `[결정: YYYY.MM.DD]` | 비법령(심판례·해석례·판례) — 결정·선고·회신일 |
   ```
3. **lawVerifier V4 수정**: 정규식에 `[결정: \d{4}\.\d{2}\.\d{2}]` 패턴 추가
4. **buildNonlawCases.ts 수정**: `buildTemporalLabel()`이 `decisionDate`를 받아 실제 형식 반환
5. **골든셋 갱신**: 비법령 4건의 `temporalLabel` 필드 `[현행]` → `[결정: ...]` (선택, 회계사 결정)
6. **검증**: `npm run golden:status` + vitest 40건 그린

---

## 5. Acceptance Criteria (완료 조건)

1. [x] SSOT·PRD·CLAUDE.md에 비법령용 시점 라벨 형식이 명문화됨
2. [x] lawVerifier V4가 비법령 라벨을 PASS 처리
3. [x] `buildNonlawCases.ts`의 `buildTemporalLabel()` 임시 주석 제거
4. [x] `npm run golden:status` 불일치 0건 유지
5. [x] vitest 40건 PASS 유지

---

## 6. Verification (검증 단계)

1. `npm run golden:status` → 사전 점검 불일치 0건 확인
2. `npx vitest run tests/golden/run_golden.test.ts` → 40/40 PASS 확인
3. SSOT·PRD·CLAUDE.md §6.2 내 비법령 라벨 형식 확인

---

## 7. Risks / Notes (위험·주의사항)

- **회계사 확정 필요**: `[결정: YYYY.MM.DD]` 형식 확정 전 코드 수정 금지 (CLAUDE.md §9.10 "불확실하면 STOP & ASK")
- **골든셋 라벨 갱신은 선택**: 현재 `[현행]`으로 임시 부착된 4건은 V1~V6 통과 중이므로 갱신 여부는 회계사 결정
- **V4 정규식 변경 시 기존 법령 케이스 회귀**: 변경 후 반드시 vitest 전체 실행

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] 영향받는 파일 목록 (4파일)
- [ ] `[결정: YYYY.MM.DD]` vs 다른 형식 비교 (필요 시)
- [ ] V4 정규식 변경안 제시 후 회계사 승인

→ **회계사 확정 후** 코딩 시작

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록
- [ ] V4 정규식 변경 전후 비교
- [ ] `npm run golden:status` 결과
- [ ] vitest 결과
- [ ] 리포트: `docs/reports/TAX-037_report.md`

---

## 9. Related Tickets (관련 티켓)

- 선행: `TAX-036_nonlaw_golden_track.md` (비법령 V4 임시 처리 도출)
- 선행: `TAX-017_ssot_prd_nonlaw_spec_align.md` (비법령 T3·sourceType 명문화)
- 후속: (없음)

---

## 10. Report Link

Report: `docs/reports/TAX-037_report.md` ✅ 완료

---

**작성자**: AI(Claude Sonnet 4.6) + 회계사 검토 필요
**작성일**: 2026-06-05
**최종 수정일**: 2026-06-05
