# TAX-6B-1 리포트 — 부칙·경과조치 동반 조회 (FR-17, 백엔드)

**작성일:** 2026-06-14
**담당:** Claude (AI)
**검토:** 회계사 (부칙 선별 정책 결정 2026-06-14)

---

## 1. 배경 및 목표

법령 검색 시 부칙·경과조치가 결과에 노출되지 않아 신·구법 적용 경계를 회계사가 인지할 수 없었다. FR-17은 부칙·경과조치를 T2 Trust Tier로 동반 노출한다.

프로브(`scripts/diagnostics/probe_addenda.mjs`)로 확인: 국세 API 법령 본문 응답(`lawService.do?target=law`)에 `법령.부칙.부칙단위`가 **이미 포함**(소득세법 116개)되어 추가 API 호출이 필요 없으며, 기존 `fetchLawArticles`가 `.조문`만 보고 `.부칙`을 버리고 있었다.

---

## 2. 변경 사항 요약

**파일 변경 목록:**
- `src/adapters/nationalTaxLaw.ts` (수정) — 부칙 타입·파싱·선별·T2 매핑·병합
- `docs/tickets/TAX-6B-1_addenda_auto_link.md` (신규) — 티켓
- `scripts/diagnostics/probe_addenda.mjs` (신규) — 부칙 응답 구조 프로브
- `scripts/diagnostics/probe_addenda_integration.mjs` (신규) — 부칙 T2 통합 프로브

**주요 변경:**
1. `RawBuchik` 타입 + `RawLawService.법령.부칙` 노드 추가
2. `fetchLawArticles` 반환에 `addenda: RawBuchik[]` 추가 (단수/복수 `toArrayNode` 정규화)
3. `selectRelevantAddenda(addenda, targetDate)` — **시점 관련 부칙 선별**(회계사 결정):
   - targetDate 지정: 직전 공포 1개(당시 적용 법) + 직후 공포 1개(다음 개정 경계)
   - 미지정: 최신 공포 2개
4. `buchikToTaxLaw()` — 부칙 → TaxLaw(T2). content는 `flattenText`로 원문 그대로 결합(§6.1), 식별자는 부칙내용 첫 줄("부칙 <제○호,날짜>"), sourceUrl은 OC 키 없는 퍼블릭 링크
5. `fetchArticles`에서 선별 부칙을 `sortTaxLaws`로 병합(T1 조문 → T2 부칙 순)

**기존 자산 재사용:** `toTrustTier`(부칙→T2 매핑 의도 일치), `flattenText`(중첩배열 원문 결합), `toArrayNode`, `toSourceUrl`, `toIsoDate`, `sortTaxLaws`. 신규 분류·정렬 로직 없음.

---

## 3. 검증 결과

1. **`npx tsc --noEmit`** — 타입 에러 0 (EXIT 0)
2. **`npx vitest run tests/golden/run_golden.test.ts`** — **95/95 GREEN** (정적 골든셋 무영향: 라이브 검색 미경유)
3. **통합 프로브** (`probe_addenda_integration.mjs`):

| 시나리오 | T2 부칙 | 비고 |
|---|---|---|
| 현행 소득세법 | 2건 (2026.4.21·2025.12.23) | 최신 2개 정책 ✅ |
| 소득세법 @2020-01-01 | 직전 2019.12.31 + 직후 2020.6.9 | 시점 경계 ✅ |
| sourceUrl OC 노출 | 전부 false | §7 준수 ✅ |

4. **원문 무결성(§6.1)** — content 첫 줄이 부칙 원문 헤더와 일치, 의역·요약 없음(flattenText 결합만)

---

## 4. 잠재 위험

- **부칙 발췌 V2 검증**: 6B-2(답변·UI)에서 LLM이 부칙을 인용·발췌할 때 V2(문자단위 일치) 회귀 주의. 부칙내용 중첩배열의 줄 결합이 원문과 일치해야 함.
- **P95 영향 없음**: 부칙은 본문 응답에 이미 포함되어 추가 API 호출 없음. 호출 수 불변.
- **선별 개수 2개 고정**: 회계사 결정(시점 관련 우선)에 따라 최대 2건. 더 많은 부칙이 필요한 케이스는 후속 조정 대상.

---

## 5. 다음 단계

- **TAX-6B-2** (FR-17 답변·UI 표시): T2 부칙을 본법령과 묶어 [경과조치]로 화면 표시, law-verifier V1~V6 회귀 확인.

**리포트:** docs/reports/TAX-6B-1_report.md
