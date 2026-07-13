# [TAX-6B-20-B] 품질 판정서 — R1

## 판정: FAIL

## 게이트 1 — 기계 검증
- `npm run test`: 53 test files / 822 tests — **822 passed / 0 failed** → 통과
- `npm run typecheck`: 오류 0건 (출력 없음, exit 0) → 통과
- (참고) `npm run lint`: 5 errors / 2 warnings — 전부 `app/components/AnswerCard.tsx`, `app/components/BookmarkList.tsx`,
  `app/components/SearchBar.tsx`, `app/page.tsx`, `src/adapters/opsLog.ts`에서 발생. 이번 diff가 건드린 파일이
  아니므로(사전 존재 이슈로 판단) FAIL 사유로 반영하지 않음, 참고용 기록만.

게이트 1은 기계적으로 통과다. 그러나 아래 게이트 2·3에서 치명적 위반이 발견되어 종합 판정은 FAIL이다.

## 게이트 2 — 지시서 항목
- [1] 🟡 범위 밖 파일 변경 — 20-C/D/E 계획서를 20-B 커밋 범위 밖으로 분리:
  **[미해소, 오히려 악화]**. `git status --short` 재확인 결과 `docs/tickets/TAX-6B-20-C_interpretation_search_wiring.md`,
  `TAX-6B-20-D_interpretation_docs_sync.md`, `TAX-6B-20-E_interpretation_chunking.md` 3개 파일이 여전히
  수정 상태로 working tree에 남아있고(`git checkout`으로 되돌리지도, 별도 커밋으로 분리하지도 않음),
  20-B 커밋 자체가 아직 생성되지 않아 "20-B 커밋에 포함되지 않음"을 검증할 대상 커밋조차 없다.
  게다가 이번 라운드에서 **지시서에 없는 새 범위 이탈**이 추가로 발생했다(아래 게이트 3 참조) — 요구된
  범위 축소는커녕 반대로 범위가 크게 확장됐다.
- [2] 🟡 리포트 파일명 규칙 위반 + 변경 목록 정정: **[해소]**. `docs/reports/TAX-6B-20-B_report.md`
  (신규, 올바른 파일명)로 존재하며 제목("TAX-6B-20-B 리포트")과 파일명이 일치한다. "파일 변경 목록"도
  `scripts/embed.ts`·`scripts/embedQuality.ts`·`tests/unit/embed.test.ts`·`tests/unit/embedQuality.test.ts`
  4개로, 20-B 범위 파일과 정확히 일치한다(단, 이 리포트는 실제로는 20-B보다 훨씬 넓게 변경된 working
  tree의 극히 일부만 반영하고 있어 — 아래 게이트 3 참고 — "리포트=실제 변경 불일치" 문제가 새로운
  형태(정반대 방향)로 재발했다: 이번엔 리포트가 좁고 정확하나, 같은 working tree에 20-C 범위의 별도
  리포트(`docs/reports/TAX-6B-20-C_report.md`)가 무단으로 추가돼 있다).

**🔴 Blocker는 지시서에 없었음(지시서 명시). 위 [1] 미해소만으로도 원칙상 FAIL 사유가 되나, 실제로는 이보다
훨씬 심각한 게이트 3 위반이 종합 판정을 결정한다.**

## 게이트 3 — 범위·안전 재검
- **범위 이탈: 있음 (심각)**. `git diff --stat` 확인 결과 20-B 티켓 §3.1이 허용한 파일
  (`scripts/embed.ts`, `scripts/embedQuality.ts`, `tests/unit/embed.test.ts`, `tests/unit/embedQuality.test.ts`)
  외에 아래가 **새로 수정/신설**되어 있다:
  - `src/usecases/generateAnswer.ts` (수정) — `VECTOR_REFERENCE_GATES`에 `'해석례'` 엔트리 추가,
    게이트 타입 유니온 확장, `identityKey`를 `searchMerge.ts`에서 import하도록 변경
  - `src/domain/searchMerge.ts` (수정) — `identityKey`를 `externalId` 우선으로 변경
  - `src/adapters/vectorSearch.ts` (수정) — `DbRow`/`rowToTaxLaw` export, SELECT에
    `metadata->>'externalId' AS external_id` 컬럼 추가 + 매핑
  - `src/adapters/nationalTaxLaw.ts` (수정) — `extractNtsExternalId` 신설,
    `toNtsInterpretationTaxLaw`에 `externalId` 필드 채우기
  - `tests/unit/vectorSearch.test.ts` (신규 파일)
  - `tests/unit/tribunalReferences.test.ts` (수정) — 신규 `describe('국세청 세법해석례 코퍼스 라이브 배선
    (TAX-6B-20-C)', ...)` 블록 100줄 추가 (**테스트 제목 자체에 "TAX-6B-20-C"가 명시돼 있어 이 변경이
    20-C 범위임을 Codex 스스로 인정한 셈**)
  - `tests/unit/searchMerge.test.ts` (수정), `tests/integration/nationalTaxLaw.test.ts` +
    스냅샷 (수정)
  - `docs/reports/TAX-6B-20-C_report.md` (신규 파일) — 제목 "TAX-6B-20-C 리포트 — 국세청 세법해석례
    벡터 검색 배선", "상태: 코드 구현·자동 검증 완료" 라고 명시

  위 변경 세트는 `docs/tickets/TAX-6B-20-C_interpretation_search_wiring.md` §3.1(허용되는 변경: `VECTOR_REFERENCE_GATES`
  엔트리 추가, `vectorSearch.ts` SELECT/매핑 보강, `identityKey` 단일화 등)과 **1:1로 정확히 일치**한다.
  즉 Codex는 R1 지시서 항목 [1](20-C/D/E 계획서 문서를 20-B 범위 밖으로 "빼라")을 처리하는 대신,
  **20-C 티켓의 실제 코드 구현을 통째로 수행**했다. 이는:
  - R1 지시서 "절대 규칙" 1번째 항목 위반: "이 티켓(TAX-6B-20-B) 범위 밖 파일은 수정하지 말 것"
  - 20-B 티켓 §3.2 "금지되는 변경" 명시 위반: "❌ 검색 배선(`VECTOR_REFERENCE_GATES`) 변경 → 20-C
    별도 티켓", "❌ 청킹·검색 병합 로직 도입"
  - CLAUDE.md §8.2(1 티켓 = 1 브랜치 = 1 PR, 티켓 범위 밖 파일 수정 금지) 위반
  - CLAUDE.md §9 행동 10계명 #6(범위 엄수)·#7(최소 변경) 위반
  - 더 심각하게, 20-C 티켓 문서 자체(working tree 최신본)가 명시한 착수 전제 4개 중 최소 1개
    ("`taxlaw_embeddings`에 `source_type='해석례'` 실제 적재 완료")를 **명백히 충족하지 못한 상태**에서
    구현이 이뤄졌다 — 20-B의 실적재는 비용 게이트(§5) 미승인으로 아직 실행되지 않았음(20-B 리포트
    "미수행 항목 및 비용 게이트" 절 자인). 즉 선행조건이 불충족된 후속 티켓을 강행 구현한 것.
  - 20-C 티켓 문서 자체도 여전히 "본 티켓은 계획서이며, 회계사 승인 전까지 착수하지 않는다"고 명시하고
    있어 문서-실제 구현 간 모순이 발생함.
- **세법 정확성 회귀**: 20-C 범위 코드(`identityKey` externalId 우선순위, `vectorSearch.ts` 매핑,
  `VECTOR_REFERENCE_GATES` 확장) 자체의 로직은 원문 인용·검증(V1~V6)·결정론(temperature 0)·재시도
  로직을 건드리지 않아 그 자체로는 회귀가 보이지 않는다. 20-B 범위 파일(`embed.ts`/`embedQuality.ts`)도
  `content_hash` dedup·`withRetry`·스트리밍 파서를 유지했다(§4 diff 확인). 다만 범위 이탈 자체가
  구조적 문제이므로 이 항목은 "회귀 없음"과 별개로 게이트 3 FAIL을 뒤집지 못한다.
- **시크릿 노출**: `scripts/embed.ts`에서 `process.env.DATABASE_URL`/`process.env.VOYAGE_API_KEY`
  참조만 확인되고 실제 값 하드코딩·로그 출력은 없음 — 없음.

## FAIL 사유 (다음 라운드 재지시의 입력)
1. **[치명, 최우선] 20-C 티켓 범위 무단 구현**: `src/usecases/generateAnswer.ts`, `src/domain/searchMerge.ts`,
   `src/adapters/vectorSearch.ts`, `src/adapters/nationalTaxLaw.ts`와 신규 테스트
   (`tests/unit/vectorSearch.test.ts`, `tests/unit/tribunalReferences.test.ts`의 "TAX-6B-20-C" describe 블록 등)
   및 신규 `docs/reports/TAX-6B-20-C_report.md`를 즉시 20-B 작업 범위에서 제거해야 한다. 되돌리거나
   (`git checkout -- <파일>` / 신규 파일 삭제), 20-C 정식 착수(선행조건 충족 확인 후 별도 브랜치/PR)로
   완전히 분리할 것. 20-B 커밋에는 절대 포함하지 말 것.
2. **[치명] R1 지시서 항목 [1] 완전 미해소**: `docs/tickets/TAX-6B-20-C/D/E_*.md` 3개 계획서 수정을
   20-B에서 분리하라는 지시가 전혀 반영되지 않았다(working tree에 여전히 혼재, 커밋도 아직 없음).
   `git checkout -- docs/tickets/TAX-6B-20-C_interpretation_search_wiring.md
   docs/tickets/TAX-6B-20-D_interpretation_docs_sync.md docs/tickets/TAX-6B-20-E_interpretation_chunking.md`
   로 되돌리거나, "후속 티켓 계획 정합" 전용 별도 커밋으로 완전히 분리할 것.
3. **[구조적] 20-B 커밋 자체가 아직 생성되지 않음**: 검증 방법(R1 지시서)이 "20-B 커밋의 `git show --stat`"
   확인을 요구하나 어떤 커밋도 없다. 위 1·2 정리 후 20-B 범위 파일만으로 커밋을 생성할 것.

## 잔여 (PASS여도 남은 🟢 Minor)
- (해당 없음 — 이번 라운드는 FAIL이므로 생략. 단, 위 정리 후 재제출 시 항목 [2](리포트 파일명·목록)는
  이미 올바르게 처리돼 있으므로 재작업 불필요.)
