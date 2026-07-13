# TAX-6B-20-B 코드 리뷰 하네스 — 최종 요약

## 최종 판정: PASS (라운드 1, 사람 보정 포함)

## 경과
1. **R1 평가** (`code-evaluator`): 🔴 0건, 🟡 2건 — [1] 후속 티켓(20-C/D/E) 계획서가 20-B
   working tree에 혼재(커밋 분리 필요), [2] 리포트 파일명이 `TAX-6B-20_report.md`(부모 경로,
   `-B` 누락).
2. **Codex 수정**: 회계사가 20-B의 🟡 2건 수정과 함께 **TAX-6B-20-C(해석례 벡터 검색 배선)
   구현도 같은 세션에서 요청**(임베딩 실적재는 제외). 결과적으로 20-B·20-C 두 티켓 분량의
   코드가 한 working tree에 쌓였다.
3. **R1 검증** (`quality-gate`): FAIL 판정 — vitest 822/822·typecheck 0오류는 확인했으나,
   git status만으로는 `src/adapters/vectorSearch.ts`·`searchMerge.ts`·`generateAnswer.ts`
   변경과 신규 `docs/reports/TAX-6B-20-C_report.md`를 "미승인 범위 이탈(20-C 무단 구현)"로
   판단. 당시 quality-gate에는 회계사의 20-C 구현 승인 사실이 전달되지 않았던 것이 원인.
4. **사람(오케스트레이터) 보정**: 회계사가 20-C 구현을 직접 지시했음을 확인한 뒤, 20-C 코드
   diff와 티켓 사양(`TAX-6B-20-C_interpretation_search_wiring.md` §4 권장 구현 방식)을
   직접 대조 검증. `identityKey` 단일화, `rowToTaxLaw` 순수 함수 export, externalId 우선
   식별(caseNumber 안건번호 충돌 과잉제거 방지 테스트 포함) 모두 사양과 일치 확인.
   `docs/tickets/TAX-6B-20-C/D/E_*.md` 3개는 재확인 결과 Codex가 아니라 이전 세션(계획
   재검토 작업)의 미커밋 변경이었음을 확인 — quality-gate의 "무단 범위 이탈" 근거가 아니었음.

## 최종 판정 근거
- 기계 게이트: vitest 822/822 PASS, typecheck 0 오류 (quality-gate 실측 그대로 유지)
- 지시서 항목 [2](리포트 파일명) 완전 해소
- 지시서 항목 [1](범위 분리)은 "코드를 되돌리는" 방식이 아니라 **커밋 경계 분리**로 충족—
  20-B·20-C·문서(20-D/E)를 3개 커밋으로 분리해 각 커밋이 1티켓 범위만 포함하도록 함
  (CLAUDE.md §8.2)
- 20-C 코드 자체는 별도 문서화된 사양 대조로 추가 검증 완료(위 3번 참고)

## 최종 커밋 (로컬, 미푸시)
1. `dd191bf` fix(TAX-6B-20-B): 해석례 전문 임베딩 적재 준비
2. `d8abb85` feat(TAX-6B-20-C): 국세청 해석례 벡터 검색을 참고 목록에 배선
3. `7587c89` docs(TAX-6B-20-D/E): 계획 재검토 반영
4. `42f6257` docs: ROADMAP §3 갱신 — TAX-6B-20-B/C 코드 완료 반영

## 잔여 🟢 (참고용, 결함 아님)
- 실제 Voyage 임베딩 적재·`taxlaw_embeddings` 실데이터는 비용 게이트 승인 후 별도 실행 필요
- 현재 브랜치(`feat/tax-6b-20-a-nts-interp-collector`)에는 20-A 전용 PR #20이 이미 열려있어,
  push 전 브랜치/PR 분리 여부를 회계사와 다시 확인해야 함(지금은 로컬 커밋만 수행)

## 하네스 프로세스 노트 (향후 참고)
- 이번 라운드는 "1티켓=1루프" 원칙(스킬 §주의사항)이 흔들린 사례 — 회계사가 Codex에게 두
  티켓(20-B·20-C)을 한 세션에서 함께 요청했기 때문. quality-gate는 티켓 경계 밖 맥락(다른
  티켓의 승인 여부)을 알 수 없으므로, 여러 티켓을 한 Codex 세션에 묶을 경우 **각 티켓의
  승인 여부를 quality-gate 호출 시 명시적으로 전달**해야 오탐(false FAIL)을 줄일 수 있음.
