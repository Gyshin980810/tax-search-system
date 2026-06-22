# TAX-6B-19 구현 리포트 — 해석례 목록 전용 검색 전환

- **작업일**: 2026-06-22
- **티켓**: `docs/tickets/TAX-6B-19_interpretation_list_only.md`
- **유형**: REFACTOR (사양 변경 동반)
- **승인**: 회계사 (A안 — 해석례 전체를 목록·참고 링크로 통일)

---

## 배경 (근본 원인)

- 같은 "해석례"인데 출처별로 처리가 갈렸다:
  - 법제처(`expc`): 목록 조회 후 관련도 상위 5건 **본문(질의요지·회답·이유) 추가 조회**(N+1) → 발췌 인용 가능
  - 국세청(`ntsCgmExpc`): **본문 조회 API 자체가 없어** 목록만 → 참고 목록
- 2026-06-22, 국세청 `ntsCgmExpc` 본문 부재를 **3중 실증으로 확정**:
  1. 가이드대로(`lawService.do?target=ntsCgmExpc&ID=...&type=JSON/XML`) 9개 조합 모두 HTML만 반환
  2. 응답 HTML이 "미신청" 안내였으나, 신청 메뉴에 본문 항목 자체가 없음
  3. `OC=data` 공개 테스트키로도 본문 응답이 비어 있음(인증 문제 아님 = API 부재 확정)
- 따라서 두 해석례 처리를 일관화하고, expc 본문 N+1 호출을 제거해 P95를 개선한다.

---

## 변경 사항 요약

### 파일 변경 목록

- `src/adapters/nationalTaxLaw.ts` (수정)
- `tests/integration/nationalTaxLaw.test.ts` (수정 — 테스트 1건 + 스냅샷 1건)
- `docs/SSOT.md` (정합 — 매핑 표 + 변경 이력 v2.8)
- `docs/PRD.md` (정합 — FR-19/20 보충 + 변경 이력 v2.7)
- `docs/tickets/TAX-6B-19_interpretation_list_only.md` (신규)

### 주요 변경

1. **`searchInterpretations()`**: 본문 조회 분기 제거 → 모든 항목 `toInterpretationTaxLaw(e, '')`. 관련도 정렬(`rankByRelevance`)은 유지(참고 목록도 관련순 노출).
2. **`fetchInterpretationBody()`**: 메서드 삭제(미사용화).
3. **`RawExpcService`**: 인터페이스 삭제(미사용화).
4. **어댑터 클래스 docstring**: `[법제처해석] → 목록만`으로 갱신, 해석례 통일 정책 명시.
5. **본문 링크 유지**: `sourceUrl`(키 없는 공개 뷰어 `expcInfoP.do` / `taxlaw.nts.go.kr`)는 그대로 — 회계사가 직접 원문 확인.
6. **범위 밖 불변**: ntsCgmExpc 검색, 심판례·판례 본문 조회, `display`(`NONLAW_LIST_DISPLAY`=12), `NONLAW_BODY_FETCH_LIMIT`(심판례에서 계속 사용).

---

## 검증 결과

1. `npm run typecheck` — **0 에러** ✅
2. `npx vitest run` — **616/616 통과** ✅
   - 갱신: `[해석례] … 목록·메타·T3·키없는 링크를 가진다` — `content===''` 검증으로 변경
   - 갱신: `[스냅샷] 법제처 해석례(12-0368)` — `content: ''` 반영(스냅샷 1건 업데이트)
3. 비법령 골든셋 회귀 — 해석례 케이스 2건, 발췌/직접근거 기대 0건 → **회귀 없음** ✅
4. 사양 정합 — SSOT §7.2 매핑 표 + FR-20/§7.4 참고 목록 규칙과 정합 ✅

---

## 잠재 위험 / 주의

- ⚠️ **정확성 trade-off**: expc 본문 발췌(🟢 직접 근거 승격)가 사라짐 → 해석례는 항상 참고 목록(🟡/⚪). "직접 근거"가 필요한 질의에서 해석례를 단정 근거로 못 씀. (회계사 결정 — 본문은 링크로 확인하는 방식 채택)
- ℹ️ "목록만 검색하면 13.6만 건 전량 노출"은 아님 — 키워드 매칭 결과 중 `display`(12) 한도 내 상위만. 노출 폭 확대는 별도 티켓.
- ℹ️ 진단 프로브(`scripts/diagnostics/probe_nts_body_v2.mjs`, `probe_expc_org.mjs`)는 읽기 전용. 정리 필요 시 별도 처리.

---

## 관련

- 선행: TAX-016A(expc 본문 도입), TAX-016B(ntsCgmExpc 목록), TAX-6B-11(후보 확대)
- 메모리: `project_nonlaw_interp_tracks` (해석례 2트랙·본문 API 부재 확정)
