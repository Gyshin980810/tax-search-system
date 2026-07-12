# [TAX-6B-33] 품질 판정서 — R1

> 독립 판정자(quality-gate, 이 인스턴스)는 code-evaluator(R1_review.md 작성자)와 별도 인스턴스입니다.
> R1_review.md의 "🔴0·🟡0·🟢3, Codex 수정 단계 생략 가능" 결론을 그대로 신뢰하지 않고
> 코드 직접 열람 + 스크립트 재실행 + 원문 대조로 독립 재검증했습니다.

## 판정: PASS

## 게이트 1 — 기계 검증
- `npm run typecheck`: 오류 0 → **통과**
- `npm run test`: `Test Files 51 passed (51)` / `Tests 796 passed (796)` → **통과** (기준선 796/796 일치)
- `npm run lint`(참고): 에러 5건·경고 2건 발견되나 전부 `app/components/AnswerCard.tsx`·`BookmarkList.tsx`·
  `SearchBar.tsx`·`app/page.tsx`·`src/adapters/opsLog.ts`에서 발생 — **이 티켓 diff에 포함되지 않은 파일**
  (기존 기술부채, TAX-6B-33과 무관). Minor 참고로만 기록, FAIL 사유 아님.

## 게이트 2 — 지시서(R1_review.md) 항목·"결함 없음" 주장 재검증

### 지시서에 이미 명시된 🟢 3건(선택 반영) — Codex 미반영 확인, 내용 정확성 직접 재확인
- [1] 🟢 `edge_source` 하드코딩 `'field'` 오표기 — **[미반영·설명대로]**. `scripts/applyOverruledReview.ts:179` 그대로
  `'field'`. 기능 영향 없음(조회 어댑터 `citationGraph.ts:75-79`는 `SELECT from_id, to_id, to_type, edge_type`만 —
  `edge_source` 자체를 조회하지 않음). 순수 데이터 출처 라벨 문제, Minor로 타당.
- [2] 🟢 파이프 이스케이프 잔여 — **[미반영·설명대로]**. `toTableCell`(`extractOverruledCandidates.ts:50-52`)이
  `\|`로 이스케이프하지만 `applyOverruledReview.ts:153`은 겉따옴표만 벗기고 `\|`→`|` 복원 안 함. 실무 영향은
  희귀(원문에 `|` 문자 자체가 거의 없음, `records.jsonl`·`precedent_full.json` grep 결과 이번 2,796행에는
  해당 케이스 관측 안 됨). Minor로 타당.
- [3] 🟢 `cells.length < 7` 조용한 스킵 — **[미반영·설명대로]**. `precedentCitation.ts:406` 그대로. 방향이
  안전(누락이지 과잉반영 아님)이라는 설명도 코드상 타당.

### "검증 완료 사항"(🔴/🟡 없음 주장) — 직접 재현으로 검증, 전부 확인됨
- **§3.2-1 자동 확정 금지**: `docs/review/OVERRULED_candidates_batch1~10.md` 전체를 직접 파서로 재검사한 결과
  **데이터 행 2,796건 전부** 검수결과·뒤집은주체·뒤집힌대상 3열이 빈칸(비어있지 않은 행 0건) — R1 주장과 일치.
  `applyOverruledReview.ts`는 `classifyReviewVerdict(verdict) === 'apply'`(정확히 `확정(판례→판례)`)인 행만
  DB 반영 경로를 태움 — **[해소]**.
- **AC1(후보 추출 정합, 실측 1,219건)**: `npm run overruled:extract`를 **직접 재실행**해 재현 — 산출:
  `신호 보유 심판례 문서 수: 1219 (전원합의체1,111·판례변경75·견해변경82·배치범위변경1)`, 총 매치 2,796건.
  리포트 수치와 완전 일치. 재실행 후 `git status`/`git diff --stat docs/review/` 무변화 — 산출물이 완전
  결정론적(byte-identical)임도 확인 — **[해소]**.
- **AC3(발췌 원문 일치)**: 리포트가 삭제했다는 검증 스크립트에 의존하지 않고, 독립적으로 2건 재대조:
  (a) `판례 2016누59203`(batch10 #2701) 발췌 → `precedent_full.json`에서 원문 로드 후 개행→공백 접기 적용해
  포함 여부 확인 → **일치**. (b) `심판례 조심2026중1148`(batch1 #1) 발췌 → `records.jsonl` 스트리밍으로 해당
  레코드(`lawName: "조세심판원 조심 2026중1148"`) 직접 탐색 후 같은 방식 대조 → **일치**. §6.1 준수 확인
  — **[해소]**.
- **§3.2-2 원문 가공 금지**: `extractSnippet`은 `content.slice()`만(도메인 함수 자체는 순수 부분 문자열).
  표 렌더링용 개행→공백 접기(`toTableCell`)는 별도 파생 문자열(`snippetForTable`)에서만 일어나고, 정본은
  원본 파일에 무변형 보존 — 위 (a)(b) 실측으로 재확인 — **[해소]**.
- **§3.2-3 파이프라인 변경 금지**: `git diff master...HEAD --stat` 확인 결과 `generateAnswer.ts`·`route.ts`·
  `citationGraph.ts`·검색/랭킹 코드 미변경. `precedentCitation.ts` diff는 `CitationEdgeType`에 `'OVERRULED'`
  유니온 멤버 추가(순수 확장) + TAX-6B-33 신규 함수 전부 파일 하단 추가뿐, 기존 함수 본문 무변경 — **[해소]**.
- **§3.2-4 LLM 방향 판정 금지**: `scripts/applyOverruledReview.ts`·`scripts/extractOverruledCandidates.ts`
  전문 검토 — OpenAI/voyage/임베딩 import·호출 0건. `classifyReviewVerdict`는 문자열 5종 매칭뿐 — **[해소]**.
- **INSERT 정합·멱등**: `migrate.sql:72-85` 스키마(`UNIQUE (from_id, to_id)`, `snippet` NOT NULL, `in_corpus`
  NOT NULL)와 `applyOverruledReview.ts:178-181` INSERT 문 컬럼·`ON CONFLICT (from_id, to_id) DO UPDATE SET
  edge_type = 'OVERRULED'` 완전 일치. 재실행 시 동일 값 재기록이라 행 수·값 불변 — 코드 구조상 AC5(멱등)
  주장 타당 — **[해소, 코드 구조 검토로 판단(라이브 Neon 재접속은 수행하지 않음, 과제 지시대로)]**.
- **오타 차단**: `parseReviewTable`이 허용 5종 밖 문구를 `errors`로 반환하고, `applyOverruledReview.ts:114-118`이
  `errors.length > 0`인 파일 전체를 `continue`로 건너뜀(부분 오반영 차단) — 단위 테스트(22건, 신규분 직접
  카운트로 재확인 — 리포트 "22건 추가" claim과 일치)로 커버 — **[해소]**.

### 독립적으로 발견한 추가 관찰(R1_review.md에 없던 항목) — FAIL 사유 아님, 잔여로 기록
- **"뒤집은 주체" 입력값이 `확정(판례→판례)` 반영 경로에서 사용되지 않음**: `applyOverruledReview.ts:139-155`의
  `action === 'apply'` 분기는 `row.overruledTarget`만 파싱해 `to_id`로 쓰고, `from_id`는 항상
  `parseDocCell(row.caseNumber)`(신호가 발견된 "문서" 열)를 사용 — `row.overruledBy`("뒤집은 주체" 회계사
  기입값)는 이 경로에서 **전혀 읽지 않음**(`superseded_by_law` 경로의 콘솔 로그용으로만 사용). 티켓 §1.2.2는
  "A가 B를 뒤집음(방향 포함)"이라 서술하고, 티켓 §1.3의 대표 사례(조심2026중1148 예시)가 정확히
  "신호가 발견된 문서 ≠ 실제 뒤집은 주체"인 경우를 보여줌 — 동일 구조가 `확정(판례→판례)` 케이스에서
  재현되면(회계사가 "뒤집은 주체"에 "문서" 열과 다른 사건번호를 적는 경우), 저장되는 엣지의 `from_id`가
  회계사가 실제로 확인한 "뒤집은 주체"가 아니라 "신호 발견 문서"가 되어버림. 다만: (1) `citation_edges`
  스키마 주석(`migrate.sql:74,76`)이 애초에 `from_id`="인용하는 문서", `to_id`="인용된 문서"로 문서화돼
  있어 FOLLOWS/REFERS/APPEAL과 동일한 관용을 그대로 따른 것으로 볼 여지도 있음(구현 일관성 자체는 있음).
  (2) 현재 `citationGraph.ts`는 `edge_type IN ('FOLLOWS','REFERS')`만 조회해 OVERRULED 엣지를 전혀 읽지
  않으므로 **지금 이 순간 사용자 노출 영향은 0**. (3) `docs/review/*.md`는 전부 빈칸(회계사 검수 미착수)이라
  현재 DB에 이 문제로 인한 오염된 행도 없음. → 이 티켓의 6개 AC·4대 금지사항 어느 것도 명시적으로 위반하지
  않으므로 FAIL 사유로 세우지 않되, **다음 단계(⚠️ 경고 표시 기능, TAX-6B-32 후속 또는 실제 회계사 검수 착수
  전)에서 반드시 재확인 필요**한 잔여 항목으로 기록.

## 게이트 3 — 범위·안전
- **범위 이탈**: 없음. `git diff master...HEAD --stat` 18개 파일 = 티켓 §3.1 허용 5개(`precedentCitation.ts`
  수정, `extractOverruledCandidates.ts`/`applyOverruledReview.ts` 신규, `precedentCitation.test.ts` 수정,
  `package.json` 수정) + 문서(`ROADMAP.md`·`docs/reports/TAX-6B-33_report.md`·티켓 파일) + 산출물
  (`docs/review/OVERRULED_candidates_batch1~10.md`, 10개). `generateAnswer.ts`·`app/api/**`·검색·랭킹 코드
  미변경. (작업 디렉터리에 `scripts/ntsExpc/`·`scripts/ntsExpc_full.json` untracked 파일이 존재하나 이 브랜치
  커밋(8df9fb3)에 포함되지 않은 미추적 파일이며 이 티켓과 무관 — 별도 확인 불필요.)
- **세법 정확성 회귀**: 없음. 법령/판례 원문 상수·검증 로직(V1~V6)·`withRetry`·`temperature 0` 등 기존 안전
  장치 변경 없음. `extractSnippet`은 TAX-6B-31에서 이미 검증된 순수함수를 그대로 재사용.
- **시크릿 노출**: 없음. `package.json` 신규 스크립트는 기존 패턴대로 `.env.local` 파일 참조만 사용, 코드
  전체에서 API 키·주민/사업자번호·회계사 식별자 패턴 검색(grep) 결과 0건.

## FAIL 사유
없음(PASS).

## 잔여 (PASS여도 남은 사항)
- 🟢 [1] `edge_source` 하드코딩 `'field'` → 실제 출처(회계사 수기 검수)를 반영하지 못함. 최소안 `'body'` 또는
  신규값 `'review'` 도입 권장(스키마 CHECK 제약 없어 즉시 반영 가능, `migrate.sql:79` 주석 갱신 병행).
- 🟢 [2] 발췌에 `|` 포함 시 DB `snippet`에 `\|` 잔여 + 표 파싱 셀 밀림 가능(희귀 케이스). 저장 전 `\|`→`|`
  복원 권장.
- 🟢 [3] 열 수 부족 행(`cells.length < 7`) 조용한 스킵 — 경고 없이 사라짐. `errors`에 별도 보고 권장.
- ⚠️ (신규 관찰) `확정(판례→판례)` 반영 시 `from_id`가 "뒤집은 주체" 입력이 아니라 "신호 발견 문서"로
  고정됨 — 현재 무영향이나, ⚠️ 경고 표시 기능(TAX-6B-32 후속) 설계 또는 실제 회계사 검수 착수 전에
  from/to 의미를 명확히 문서화하거나 로직을 "뒤집은 주체" 열 기준으로 바꿀지 결정 필요.
- `docs/review/OVERRULED_candidates_batch1~10.md`(2,796행)의 실제 회계사 검수는 이 티켓 범위 밖으로 별도
  장기 작업 — 리포트·ROADMAP 모두 이를 정직하게 명시함(완료로 과장하지 않음), 확인됨.
