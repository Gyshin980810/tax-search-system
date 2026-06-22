# TAX-6B-19 해석례 목록 전용 검색 전환 (본문 조회 제거 · 참고 링크 통일)

> 작업 시작 전 `CLAUDE.md` + `docs/SSOT.md`(§7 세법 도메인) + 본 티켓 + 메모리 `project_nonlaw_interp_tracks` 를 읽을 것.

---

## Metadata

- **Type**: REFACTOR (사양 변경 동반)
- **Severity**: major
- **Layer**: adapter (+ docs 정합)
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: S (어댑터 1파일 + 문서 정합)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- 법제처 해석례(`target=expc`)는 **목록 조회 후 관련도 상위 5건(`NONLAW_BODY_FETCH_LIMIT`)에 대해 본문(질의요지·회답·이유)을 추가 조회**(N+1)하여 발췌 인용(🟢 직접 근거 승격 가능) 대상으로 처리한다. (`searchInterpretations` + `fetchInterpretationBody`)
- 국세청 세법해석례(`target=ntsCgmExpc`)는 **본문 조회 API가 존재하지 않아**(2026-06-22 실호출·공식 페이지·OC=data 테스트키로 3중 확정) 이미 목록만 조회하고 참고 목록(references)으로만 노출한다.
- 결과적으로 같은 "해석례"인데 출처에 따라 처리 경로가 갈린다(expc=본문 발췌 / ntsCgmExpc=목록만).

### 1.2 기대 동작

- 해석례(expc·ntsCgmExpc)를 **모두 목록 조회만으로 통일**한다. 본문 조회 단계를 제거하고 `content=''`로 정규화한다.
- 두 출처 모두 **본문 원문 링크(`sourceUrl`)는 그대로 제공**한다. (회계사가 링크 클릭으로 원문 확인)
  - expc: `https://www.law.go.kr/LSW/expcInfoP.do?expcSeq=...` (키 없는 공개 뷰어)
  - ntsCgmExpc: `https://taxlaw.nts.go.kr/qt/...` (API가 키 없는 공개 링크 직접 제공)
- 해석례는 **참고 목록(references) 트랙**으로 일관 노출된다(🟡/⚪, 발췌 인용·V검증 비대상).

### 1.3 영향·중요도

- 회계사 요청: 해석례 본문 조회가 누락/실패로 결과를 좁히는 것으로 의심 → 목록 기반으로 단순화하고, 본문은 링크로 회계사가 직접 확인하는 편이 일관적.
- 부수 효과: expc 본문 N+1 호출(최대 5건) 제거 → **P95 개선**.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/adapters/nationalTaxLaw.ts` (수정) — `searchInterpretations()`, `fetchInterpretationBody()`(삭제), `toInterpretationTaxLaw()`
- `docs/SSOT.md` (정합) — §7 해석례 본문 발췌 인용 관련 서술
- `docs/PRD.md` (정합) — 해석례 트랙 사양(FR-19/20 인근)
- `tests/**` (해석례 관련 단위 테스트)

### 2.2 외부 API·리소스

- `lawSearch.do?target=expc` / `target=ntsCgmExpc` — 목록(JSON). 본문 링크 필드 포함.
- ⚠️ `lawService.do?target=ntsCgmExpc` 본문 API는 **존재하지 않음**(확정). expc 본문 API는 존재하나 본 티켓에서 사용 중단.

### 2.3 아키텍처 힌트

```
검색 → nationalTaxLawAdapter.searchInterpretations(expc)     → 목록만 → content='' (references)
       nationalTaxLawAdapter.searchNtsInterpretations(ntsCgmExpc) → 목록만 (현행 유지)
```

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [ ] `searchInterpretations()`에서 `fetchInterpretationBody()` 호출 제거 → 모든 항목 `content=''`
- [ ] `fetchInterpretationBody()` 메서드 삭제(미사용화 시)
- [ ] 관련 주석/타입 정리(`RawExpcService` 미사용 시 정리)
- [ ] `docs/SSOT.md`·`docs/PRD.md` 해석례 사양 정합(본문 발췌 → 목록·참고 링크)
- [ ] 해석례 단위 테스트 기대값 조정

### 3.2 금지되는 변경

- ❌ ntsCgmExpc 검색 로직 변경(이미 목록만 — 그대로 유지)
- ❌ 심판례(`ttSpecialDecc`)·판례(`prec`)의 본문 조회 로직 변경 (이 티켓 범위 아님 — 본문 발췌 유지)
- ❌ `sourceUrl`(원문 링크) 생성 로직 약화 — 링크는 반드시 유지
- ❌ display 한도(`NONLAW_LIST_DISPLAY`) 변경 — 별도 논의 사항(§7 참조)
- ❌ 법령 원문 가공·요약 저장

---

## 4. Strategy (구현 힌트)

1. `searchInterpretations()`의 `ranked.map`에서 본문 조회 분기 제거 → `toInterpretationTaxLaw(e, '')` 고정.
2. 관련도 정렬(`extractTerms`/`nonLawRelevance`)은 **유지** — 참고 목록도 관련도순 노출이 유의미.
3. `fetchInterpretationBody()`·`RawExpcService` 사용처가 사라지면 제거(타입체크로 확인).
4. 단위 테스트: expc 결과 `content===''` 및 `sourceUrl` 존재를 검증하도록 수정/추가.
5. SSOT/PRD에서 "expc 본문 발췌 인용 가능" 서술을 "해석례는 목록·참고 링크(발췌 비대상)"로 갱신.

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `searchInterpretations()` 결과의 모든 항목이 `content===''`
2. [ ] expc·ntsCgmExpc 결과 모두 `sourceUrl`(키 없는 공개 링크) 보유
3. [ ] expc 결과에 안건명(제목)·안건번호·기관·일자 메타 포함
4. [ ] `lawService.do?target=expc` 본문 호출이 더 이상 발생하지 않음(N+1 제거)
5. [ ] `npm run typecheck` 0 에러, vitest 전건 통과(해석례 테스트 갱신 포함)
6. [ ] 비법령 골든셋(해석례 2건) 회귀 없음 — expectedLabel/expectedStatus 유지
7. [ ] SSOT·PRD 해석례 사양 정합 완료

---

## 6. Verification (검증 단계)

1. `npm run dev` 후 해석례가 잘 나오는 키워드로 검색
2. 해석례 항목이 **참고 목록**으로 노출되고, 각 항목의 **원문 링크 클릭 시 본문 페이지로 이동**하는지 확인(expc·ntsCgmExpc 각각)
3. `npm run typecheck` / vitest 통과 확인

---

## 7. Risks / Notes (위험·주의사항)

- ⚠️ **정확성 trade-off**: expc 본문 발췌(🟢 직접 근거 승격)가 사라진다 → 해석례는 항상 참고 목록(🟡/⚪) 수준. "직접 근거"가 필요한 질의에서 해석례가 단정 근거로 못 쓰임. (회계사 결정 사항 — 본문은 링크로 직접 확인하는 방식 채택)
- ℹ️ "목록만 검색하면 13.6만 건이 모두 노출"되는 것은 아님 — 키워드 매칭 결과 중 `display`(현 12) 한도 내 상위만 노출. 노출 폭 확대를 원하면 별도 티켓.
- 비법령 골든셋 30건 중 해석례 2건, 발췌/직접근거 기대 0건 확인(2026-06-22) → 회귀 위험 낮음.
- `lawService.do?target=ntsCgmExpc` 본문 부재는 가이드 문서(`cgmExpcNtsInfoGuide`)와 어긋남 — 가이드 오류로 판단(메모리 `project_nonlaw_interp_tracks` 기록).

---

## 10. Related Tickets

- 선행: TAX-016A(expc 본문 도입), TAX-016B(ntsCgmExpc 목록), TAX-6B-11(후보 확대)
- 참조: 메모리 `project_nonlaw_interp_tracks`

---

## 11. Report Link

Report: `docs/reports/TAX-6B-19_report.md` (미작성)

---

**작성자**: AI (회계사 승인 기반)
**작성일**: 2026-06-22
**최종 수정일**: 2026-06-22
