# TAX-6B-1 부칙·경과조치 동반 조회 (FR-17, 백엔드)

## Metadata
- **Type**: FEAT
- **Severity**: major
- **Layer**: adapter
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: M

## 1. Problem
### 1.1 현재 동작
`fetchLawArticles`(nationalTaxLaw.ts L526)가 법령 본문 응답에서 `법령.조문.조문단위`만 파싱하고 **`법령.부칙` 노드를 버린다.** 프로브(scripts/diagnostics/probe_addenda.mjs) 결과 본문 응답 최상위 키에 `부칙`이 이미 포함(소득세법 기준 부칙단위 116개, 추가 호출 불필요)됨을 확인. 따라서 신·구법 적용 경계(경과조치)가 검색 결과에 노출되지 않는다.

### 1.2 기대 동작
법령 검색 시 시점 관련 부칙·경과조치를 함께 조회하여 `trustTier='T2'`로 검색 결과에 병합한다.

### 1.3 영향·중요도
부칙·경과조치 누락은 신·구법 적용 경계 오인으로 직결(PRD §16 FR-17). T2는 시점 분기 시 직접 근거.

## 2. Context
- `src/adapters/nationalTaxLaw.ts` — `RawLawService`, `fetchLawArticles`, `fetchArticles`
- 프로브 확인 부칙단위 필드: `부칙키, 부칙공포일자(YYYYMMDD), 부칙내용(중첩배열), 부칙공포번호`
- 기존 재사용: `toTrustTier`(부칙→T2), `flattenText`(중첩배열 원문 결합), `toArrayNode`, `toSourceUrl`

## 3. Scope
### 3.1 허용
- [ ] `RawLawService`에 `부칙` 타입 추가 + `RawBuchik` 신규
- [ ] `fetchLawArticles` 반환에 `addenda` 추가
- [ ] `fetchArticles`에 시점 관련 부칙 선별·T2 매핑·병합
- [ ] 부칙 선별·매핑 헬퍼 함수 신규
### 3.2 금지
- ❌ 부칙 원문 의역·요약 (§6.1 — flattenText 원문 결합만)
- ❌ Port 시그니처 변경 / UI 변경(6B-2) / 답변생성 LLM 변경
- ❌ law-verifier 완화

## 4. Strategy
시점 관련 부칙 선별(회계사 결정 2026-06-14): targetDate 지정 시 그 시점 직전 1개 + 직후 1개(적용 경계), 미지정 시 최신 공포 2개. 부칙내용 첫 줄("부칙 <제○호,날짜>")을 식별자로 사용.

## 5. Acceptance Criteria
1. [ ] 법령 검색 결과 items에 부칙이 T2로 포함(시점 관련 1~2건)
2. [ ] 부칙 content가 원문과 문자단위 일치(flattenText, 의역 없음)
3. [ ] targetDate 지정 시 그 시점 경계 부칙 선별
4. [ ] vitest run_golden 회귀 GREEN 유지(정적 골든셋 무영향)
5. [ ] 부칙 sourceUrl에 API 키(OC) 미포함

## 6. Verification
1. `node --env-file=.env.local scripts/diagnostics/probe_addenda_integration.mjs`(신규) 또는 단위 점검으로 부칙 T2 포함 확인
2. `npx vitest run tests/golden/run_golden.test.ts` GREEN

## 10. Related
- 선행: 없음 / 후속: TAX-6B-2(부칙 답변·UI 표시)
- 참조: PRD §16 FR-17, SSOT §7.6, `scripts/diagnostics/probe_addenda.mjs`

## 11. Report Link
Report: `docs/reports/TAX-6B-1_report.md` (작성중)

**작성자**: Claude (AI) / **작성일**: 2026-06-14
