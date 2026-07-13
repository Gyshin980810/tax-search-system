# [TAX-6B-20-B] 코드 수정 지시서 — R1

> 🔴(치명) 결함 없음. 아래는 모두 🟡(범위·리포트 규칙) 항목이다. 코드 로직 자체는 티켓 사양(결정 ②
> 전문 다 넣기, 배치 글자수 예산, externalId 우선 중복검사)에 부합하고 §6.1 원문 보존·시크릿 비노출도
> 지켜졌다. 이번 라운드 수정은 **커밋 위생(범위 분리)과 리포트 규칙 정정**에 한정된다.

## 이 문서의 사용법 (Codex에게)
아래 "수정 항목"을 순서대로 처리하세요. 각 항목의 파일·위치·기대 결과를 지킵니다.
**아래 "절대 규칙"을 어기는 수정은 하지 마세요.**

## 절대 규칙 (이 프로젝트 불변 제약)
- 법령/판례/예규 원문 텍스트를 요약·의역·가공하지 말 것. 발췌는 원문과 문자 단위로 일치해야 함.
- 계층 구조 준수: UI → API Route → Usecase → Adapter/Port. Usecase에서 fetch·DB 직접 호출 금지.
- 이 티켓(TAX-6B-20-B) 범위 밖 파일은 수정하지 말 것. 무관한 리팩터 금지.
- API 키·`DATABASE_URL`·`VOYAGE_API_KEY`·주민/사업자번호·회계사 식별자를 코드·로그·에러 메시지·URL에 넣지 말 것.
- 기존 테스트를 깨지 말 것. `content_hash` dedup·`withRetry`·스트리밍 파서 등 기존 안전장치를 제거하지 말 것.
- 회계사 비용 승인 없이 전량 실적재(voyage 유료 호출) 실행 금지 — 이 티켓은 dry-run·smoke까지만 무비용 수행.

## 티켓 요약
- 목표: 20-A 산출물 `scripts/ntsExpc_full.json`(해석례 전문)을 voyage-4로 임베딩 적재할 수 있도록
  `embed.ts`를 국소 보강(결정 ② 전문 다 넣기 — `MAX_CONTENT_CHARS` 상향 + 배치 글자수 예산 flush)하고,
  `embedQuality.ts`의 중복 검사를 `externalId` 우선으로 보강한다. 실적재는 비용 게이트(§5) 승인 후.
- 이번 라운드 최우선: 전체 결함 해소(R1). 단, 🔴 없음 — 커밋 범위 분리와 리포트 규칙 정정만 처리.

## 수정 항목

### [1] 🟡 범위 밖 파일 변경 — 후속 티켓(20-C/D/E) 계획서 수정을 20-B 커밋에서 분리
- **파일**:
  - `docs/tickets/TAX-6B-20-C_interpretation_search_wiring.md`
  - `docs/tickets/TAX-6B-20-D_interpretation_docs_sync.md`
  - `docs/tickets/TAX-6B-20-E_interpretation_chunking.md`
- **문제**: 이 3개 파일은 **미착수 후속 티켓의 계획서**다(평가 대상은 20-B뿐). working tree에서 셋 다
  "2026-07-11 계획 재검토 반영" 내용으로 수정돼 있는데(총 +262/-45줄 규모), 20-B 티켓 §3.1 "허용되는
  변경" 목록(embed.ts·embedQuality.ts·dry-run·smoke)에 없다. CLAUDE.md §8.2(1 티켓 = 1 브랜치 = 1 PR,
  범위 밖 파일 수정 금지)·행동 10계명 #6(범위 엄수)·#7(최소 변경) 위반이다. 또한 20-B 리포트의 "파일
  변경 목록"이 이 3개 파일을 누락해 리포트-실제 변경이 불일치한다(CLAUDE.md §10 보고 형식).
- **기대 결과**: 20-B 커밋/PR에는 **20-B 범위 파일만** 포함된다 — 즉 `scripts/embed.ts`,
  `scripts/embedQuality.ts`, `tests/unit/embed.test.ts`, `tests/unit/embedQuality.test.ts`, 그리고
  리포트(항목 2에서 이름 정정). 20-C/D/E 계획서 변경은 (a) `git checkout -- <파일>`로 되돌리거나
  (b) "후속 티켓 계획 정합" 전용의 **별도 커밋/브랜치**로 분리한다. 어느 쪽이든 20-B 구현 커밋과 섞지 않는다.
  (계획서 내용 자체를 삭제·훼손하라는 뜻이 아니라, 20-B의 커밋 경계 밖으로 빼라는 것이다.)
- **검증 방법**: `git status --short`에서 `docs/tickets/TAX-6B-20-C/D/E` 3개 파일이 20-B 스테이징
  대상에 없음 확인. 20-B 커밋의 `git show --stat`에 티켓 계획서 3개가 나타나지 않음.

### [2] 🟡 리포트 파일명 규칙 위반 + 변경 목록 정정
- **파일**: `docs/reports/TAX-6B-20_report.md`
- **문제**: 20-B 티켓 §10 Report Link는 `docs/reports/TAX-6B-20-B_report.md`를 명시하고, 형제 티켓
  20-A도 `docs/reports/TAX-6B-20-A_report.md` 규칙을 따른다. 그런데 이 리포트는 `-B` 접미사가 빠진
  `TAX-6B-20_report.md`(= 부모 티켓 TAX-6B-20 §11이 예약한 경로)로 저장돼, 부모 티켓 리포트 경로와
  충돌하고 추적성이 깨진다. 문서 제목 헤더는 "TAX-6B-20-B 리포트"인데 파일명만 부모 경로다.
  더해 리포트 "파일 변경 목록"이 4개 파일만 나열하나 실제 working tree 변경은 7개(항목 1의 티켓 3개 포함).
- **기대 결과**: 리포트 파일을 `docs/reports/TAX-6B-20-B_report.md`로 이름을 바꾼다(내용은 유지).
  "파일 변경 목록"이 항목 1 처리 후의 실제 20-B 범위 변경(embed.ts·embedQuality.ts·두 테스트)과 정확히
  일치하도록 확인한다(항목 1로 티켓 3개를 분리하면 이 4개 목록이 그대로 정확해진다).
- **검증 방법**: `ls docs/reports/`에 `TAX-6B-20-B_report.md` 존재. 파일 상단 제목과 파일명이 일치.
  리포트의 "파일 변경 목록"이 20-B 커밋 `git show --stat`의 파일 집합과 일치.

## 참고 — 결함으로 보지 않은 항목 (수정 불필요, quality-gate 참고용)
- **ROADMAP.md §3 미갱신**: CLAUDE.md §9 #9는 "리포트와 같은 커밋에 ROADMAP §3 갱신"을 요구하나,
  20-B는 실적재·smoke(AC #4·5·8·9)가 **비용 게이트(§5)로 정당하게 보류** 중이라 아직 "완료"가 아니다.
  따라서 현시점 ROADMAP 미갱신은 오히려 정확하다. **실적재 완료 시점(비용 승인 후)에 반드시 갱신**할 것.
- **`MAX_CONTENT_CHARS` 6000→30000 전역 상수화**: 증분 심판례·판례에도 새 상한이 적용되나, 20-B 티켓
  §4 "구현 방식 1"이 **의도된 것으로 명시·수용**했고 `BATCH_SIZE` 주석(embed.ts:36-38)도 함께 갱신됨. 정상.
- **배치 예산이 절단 전 원본 길이로 계산**: `shouldFlushBeforeAdding`이 `law.content.length`(원본)로 예산을
  재는데 실제 임베딩 입력은 `truncateContent`(≤30,000자)로 더 짧다 → 항상 **보수적(더 일찍 flush)**이라
  voyage 요청 한도를 넘길 위험이 없다. 안전 방향이므로 수정 불필요.
- **실적재/smoke 미수행**: 비용 게이트 준수(§3.2 "회계사 비용 승인 없이 전량 실적재 금지"). 정상 보류.
- **§6.1 원문 보존**: DB `content` 컬럼에는 `law.content` 원문 그대로 INSERT, 절단은 임베딩 입력에만 적용. 준수.

## 완료 확인 체크리스트 (Codex는 수정 후 스스로 점검)
- [ ] 위 모든 🟡 항목(1·2) 반영
- [ ] 20-B 커밋 대상에 `docs/tickets/TAX-6B-20-C/D/E` 3개 계획서가 포함되지 않음
- [ ] 리포트 파일이 `docs/reports/TAX-6B-20-B_report.md` 이며 "파일 변경 목록"이 실제 변경과 일치
- [ ] `npm run test` 전체 통과(리포트 기준 813/813 유지)
- [ ] `npm run typecheck` 오류 0
- [ ] 티켓 범위 밖 파일(코드·문서) 미변경
