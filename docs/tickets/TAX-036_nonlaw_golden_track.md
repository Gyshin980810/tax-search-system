# TAX-036 비법령 골든셋 전용 트랙 (심판례·해석례·판례)

> 작성일: 2026-05-26 · 선행: TAX-015~017(비법령 검색), TAX-022(identityOf), TAX-028(골든셋 시드)
> 회계사 결정(2026-05-26): "비법령 전용 트랙 신설" 선택, 저장 위치 = `golden_direct.json` 통합(G-NL-*).

---

## Metadata

- **Type**: FEAT
- **Severity**: major (검증 사각지대 해소)
- **Layer**: eval (test fixture) + scripts (data)
- **Milestone**: Post-MVP (골든셋 30건 완성 트랙)
- **Estimated Size**: M (4~5파일)

---

## 1. Problem

### 1.1 현재 동작
- 골든셋(`eval/golden_direct.json`) 확정 10건 + 초안 18건이 **전부 법령(T1)** 사례.
- 시스템은 비법령(심판례·해석례·판례·국세청해석) 검색을 지원하지만(TAX-015~017), **검증되지 않은 사각지대**.
- `lawVerifier.identityOf()`는 이미 비법령을 `caseNumber`로 식별하도록 구현되어 있으나, 그 동작을 강제하는 회귀 테스트가 0건.

### 1.2 기대 동작
- 비법령 케이스(`G-NL-*`) 8건을 `golden_direct.json`에 추가하여 `npx vitest run tests/golden/run_golden.test.ts` 통과.
- 비법령 V1(caseNumber 대조)·V3(T3·T4 라벨 제약)·V6(🟡 단정 금지)가 회귀 보호됨.

### 1.3 영향·중요도
- 시스템 핵심 차별점인 비법령 검색을 골든셋이 검증해야 신뢰성 보증 가능.
- 향후 어댑터·검증 코드 변경 시 비법령 케이스에 대한 회귀 깨짐을 즉시 포착.

---

## 2. Context

### 2.1 관련 파일
- `eval/golden_direct.json` — 골든셋 본체 (수정)
- `eval/golden_seeds.json` — 비법령 시드 섹션 추가 가능 (선택)
- `scripts/golden/probeNonlaw.ts` — 비법령 검색 후보 수집 스크립트 (**신규**)
- `package.json` — `golden:probe-nonlaw` npm script 등록 (의존성 추가 없음)
- `src/adapters/lawVerifier.ts` — **변경 없음** (이미 비법령 지원)
- `src/adapters/nationalTaxLaw.ts` — **변경 없음** (이미 비법령 검색 구현)

### 2.2 외부 API·리소스
- 국세법령정보시스템 OPEN API
  - 심판례: `target=ttSpecialDecc` (본문 有: 주문+재결요지+이유)
  - 해석례(법제처): `target=expc` 등 (본문 有)
  - 판례: `target=prec` (국세 출처 본문 미제공 다수)
  - 국세청해석: `target=ntst` (본문 미제공)
- 인증: `NATIONAL_TAX_API_KEY` (기존 환경변수 재사용)

### 2.3 아키텍처 힌트
```
[probeNonlaw.ts]  →  NationalTaxLawAdapter.search(키워드)
                     ↓
                   심판례·해석례·판례·국세청해석 후보 JSON 저장
                     ↓
               회계사 검수 → 채택 케이스를 golden_direct.json에 머지
                     ↓
               npx vitest run tests/golden/run_golden.test.ts (전체 그린)
```

---

## 3. Scope

### 3.1 허용되는 변경
- [x] `eval/golden_direct.json` — `G-NL-*` 케이스 8건 추가
- [x] `scripts/golden/probeNonlaw.ts` — 신규 (비법령 후보 검색·수집)
- [x] `package.json` — `scripts.golden:probe-nonlaw` 항목 등록 (의존성 추가 없음)
- [x] `docs/reports/TAX-036_report.md` — 리포트 신규

### 3.2 금지되는 변경
- ❌ `lawVerifier.ts` 검증 로직 수정 (이미 지원)
- ❌ `nationalTaxLaw.ts` 어댑터 수정
- ❌ `tests/golden/run_golden.test.ts` 변경 (id 접두사로 자연 흡수)
- ❌ 법령 30건 골든셋 진행 트랙 간섭 (`G-S-*` 시드와 독립)
- ❌ 신규 npm 의존성 추가
- ❌ 비법령 본문(content) 원문 가공 (CLAUDE.md §6.1)

---

## 4. Strategy

1. **probe 스크립트 작성** — 키워드 8~10개로 `adapter.search()` 호출, 결과를 `eval/golden_nonlaw_probe.json`에 출처유형·content길이·caseNumber 메타와 함께 저장.
2. **회계사 후보 검수** — 심판례·해석례 중 사실관계가 명확하고 question으로 다듬기 쉬운 8건 채택(PASS 6 + 네거티브 2).
3. **케이스 골격 작성** — 채택된 원문을 그대로 사용하여 `G-NL-01~06`(PASS) + `G-NL-N1·N2`(FAIL) 구성. summary는 회계사 작성(SSOT §13.2).
4. **머지 + 테스트** — `golden_direct.json`에 추가 → `npm run golden:status` → `vitest` 그린 확인.
5. **리포트** — `docs/reports/TAX-036_report.md` 작성.

---

## 5. Acceptance Criteria

1. [ ] `scripts/golden/probeNonlaw.ts` 신규 작성, `npm run golden:probe-nonlaw`로 실행 가능
2. [ ] `eval/golden_nonlaw_probe.json` 생성 — 키워드별 심판례·해석례·판례·국세청해석 후보 메타
3. [ ] 회계사 검수로 채택된 비법령 케이스 8건이 `golden_direct.json`에 `G-NL-*` 접두사로 머지
   - PASS 6건 (심판례 3 + 해석례 2 + references 1)
   - FAIL 2건 (V3·V6)
4. [ ] `npx vitest run tests/golden/run_golden.test.ts` 전체 그린
5. [ ] `npm run golden:status`에 비법령 케이스 분포 반영
6. [ ] `lawVerifier.ts`·`nationalTaxLaw.ts`·기존 G-*·G-S-*·G-N* 케이스 무수정·무회귀

---

## 6. Verification

1. `npm run golden:probe-nonlaw` 실행 → 후보 JSON 생성 확인
2. 후보 JSON에서 심판례 ≥ 5건·해석례 ≥ 3건·content 길이 ≥ 100자 확인
3. 회계사 검수 → 채택 케이스 8건 머지
4. `npx vitest run tests/golden/run_golden.test.ts` PASS
5. 의도적 회귀 시뮬레이션(`G-NL-N2`의 단정형 한 글자 변경)으로 V6 FAIL 재현 검증

---

## 7. Risks / Notes

- **API 키 의존**: `NATIONAL_TAX_API_KEY` 미설정 시 probe 실행 실패 → Fail-fast.
- **본문 미제공 자료**: 판례·국세청해석은 references로만 사용(citation 승격 금지, V2 우회 금지 — CLAUDE.md §6.4).
- **개인정보**: 청구인명·주민번호 등이 포함된 심판례 본문 가능성 → 사용 전 회계사 마스킹 검토(CLAUDE.md §7).
- **시점**: `decisionDate`(결정일)로 시점 라벨 처리. 비법령은 보통 `[현행]`(특정 사실관계 결정).

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출 (완료)
- [x] 근본 원인: 비법령 검증 사각지대 + 검증 코드는 이미 지원
- [x] 영향파일: probeNonlaw.ts·package.json·golden_direct.json
- [x] 구현 계획: probe → 후보 검수 → 머지 → 테스트

### 8.2 코딩 후 제출
- [ ] 변경 파일 목록
- [ ] 검증 결과(vitest·golden:status)
- [ ] 위험·제한사항
- [ ] 리포트: `docs/reports/TAX-036_report.md`

---

## 10. Related Tickets

- 선행: TAX-015(비법령 검색)·TAX-016(국세청 해석)·TAX-017(SSOT 정합)·TAX-022(identityOf)·TAX-028(시드/빌더)
- 병행: TAX-029 P95 측정·진행 중 법령 30건 트랙
- 후속: 비법령 골든셋 확장(폐지 ⚫ 케이스 등) — 별도 티켓

---

## 11. Report Link

Report: `docs/reports/TAX-036_report.md` (미작성)

---

**작성자**: AI (회계사 승인 2026-05-26)
**작성일**: 2026-05-26
**최종 수정일**: 2026-05-26
