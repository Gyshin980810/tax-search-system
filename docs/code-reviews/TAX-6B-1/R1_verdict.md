# [TAX-6B-1] 품질 판정서 — R1

## 판정: PASS

## 게이트 1 — 기계 검증
- `npm run test`: Test Files 51 passed (51) / Tests 774 passed (774) → 통과
- `npm run typecheck`: 출력 없음(오류 0) → 통과
- 추가 확인: `npx vitest run tests/golden/run_golden.test.ts tests/unit/addendaSelection.test.ts` → Test Files 2 passed (2) / Tests 114 passed (114) — 골든셋·신규 단위 테스트 개별 재확인 GREEN
- 참고: `npm run lint` — 5 errors / 2 warnings 발생하나 전부 이번 변경과 무관한 기존 파일(app/components/AnswerCard.tsx, BookmarkList.tsx, SearchBar.tsx, app/page.tsx, src/adapters/opsLog.ts)에서 발생. `src/adapters/nationalTaxLaw.ts`·신규 테스트 파일에는 lint 오류 없음 → FAIL 사유 아님(참고용)

## 게이트 2 — 지시서 항목
- [1] 🟡 T1 조문 블록이 T2 부칙 블록보다 항상 앞: [해소] (`src/adapters/nationalTaxLaw.ts:759` — `const merged = [...sortTaxLaws(filtered), ...sortTaxLaws(addendaItems)]`로 조문 블록과 부칙 블록을 각각 정렬 후 이어붙임. 위 주석(L754)도 "T1 조문 블록과 T2 부칙 블록을 따로 정렬한 뒤 이어 붙여"로 실제 동작과 일치하게 정정됨. `totalCount = merged.length` 유지)
- [2] 🟢 동일 공포일자 tie-break 결정론: [해소] (`nationalTaxLaw.ts:334~345` — `addendaTieKey(부칙공포번호|부칙키)`를 보조 정렬 키로 추가, `localeCompare(..., 'ko-KR', {numeric:true})`. `tests/unit/addendaSelection.test.ts:55~79`에서 입력 순서 역전 후에도 결과 동일함을 검증(공포번호 있는 케이스·없는 케이스 둘 다 커버))
- [3] 🟢 부칙 식별자 유일성: [해소] (`nationalTaxLaw.ts:365~377` `buildAddendaArticleNumber` — 공포번호·공포일자·부칙키를 조합해 값이 있는 것만 결합. `content` 자체는 미변경(§6.1 준수). `tests/unit/addendaSelection.test.ts:113~139`에서 공포번호 공란 시 두 부칙이 서로 다른 유일 식별자(`부칙 <2020-06-09, addenda-a>` vs `addenda-b`)를 갖고 구식 `부칙 <제호>` 폴백이 사라졌음을 확인)
- [4] 🟢 신규 단위 테스트: [해소] (`tests/unit/addendaSelection.test.ts` 신규 8건 — targetDate 미지정 최신 2개, targetDate 지정 직전/직후 경계, 동률 tie-break 2종, T2/법령/OC미포함/flattenText 원문 그대로 매핑, 식별자 유일성 2종 전부 커버. `selectRelevantAddenda`·`buchikToTaxLaw`를 `export`로 노출한 것 외 기존 시그니처·동작 변경 없음)

## 게이트 3 — 범위·안전
- 범위 이탈: 없음 — `git diff --name-only` 결과 수정 파일은 `src/adapters/nationalTaxLaw.ts` 1건뿐이며, 신규 추가는 `tests/unit/addendaSelection.test.ts` 1건. 지시서가 허용한 범위(어댑터 파일 + 신규 테스트) 내. Port·UI(app/)·`src/usecases/generateAnswer.ts`·law-verifier 미변경 확인
- 세법 정확성 회귀: 없음 — `flattenText` 원문 결합 로직 자체는 diff에 등장하지 않음(무변경). `buchikToTaxLaw`의 `content = flattenText(buchik.부칙내용)` 호출부 그대로 유지, 변경은 `articleNumber`(라벨)에만 적용됨. `sortTaxLaws` 내부 규칙(개정일↓→시행일↓→조문번호↑)도 무변경, 블록 분리 후 재사용만 함. `trustTier='T2'` 유지. temperature 0·withRetry 등은 이번 변경 범위(어댑터 부칙 병합)와 무관하며 diff에 등장하지 않음
- 시크릿 노출: 없음 — `toSourceUrl` 호출부 무변경, `sourceUrl.not.toContain('OC=')`를 단위 테스트로도 재확인(`addendaSelection.test.ts:110`). API 키·주민/사업자번호·회계사 식별자 diff에 없음

## 잔여 (PASS여도 남은 🟢 Minor)
- 지시서 [1]의 검증 방법에 언급된 라이브 프로브(`node --env-file=.env.local --import tsx scripts/diagnostics/probe_addenda_integration.mjs`)는 외부 API 실호출·`.env.local` 키가 필요해 본 판정에서는 실행하지 않음. 대신 코드 정적 확인(블록 분리 후 이어붙임 로직) + 단위 테스트로 동등 수준의 확신을 확보함. 필요 시 회계사가 별도로 라이브 프로브를 1회 실행해 실제 API 응답 기준 순서를 재확인하는 것을 권장(선택 사항, FAIL 사유 아님)
