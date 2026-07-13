# [TAX-6B-33] 코드 수정 지시서 — R1

> **경미(Minor) 전용 — 🔴 Blocker 0건 · 🟡 Major 0건.** 아래 항목은 전부 🟢(안전 실패·경미)입니다.
> 티켓의 4대 금지사항(§3.2)과 6개 완료조건(AC1~6)은 코드 구조상 **충족**으로 확인됐습니다.
> 아래 🟢 항목은 회귀 위험이 없는 개선 제안이므로 Codex가 판단해 선택 반영해도 됩니다(미반영해도 무방).

## 이 문서의 사용법 (Codex에게)
아래 "수정 항목"을 순서대로 검토하세요. 각 항목의 파일·위치·기대 결과를 지킵니다.
**아래 "절대 규칙"을 어기는 수정은 하지 마세요.**

## 절대 규칙 (이 프로젝트 불변 제약)
- 법령/판례/예규 원문 텍스트를 요약·의역·가공하지 말 것. 발췌는 원문과 문자 단위로 일치해야 함(§6.1).
- 계층 구조 준수: UI → API Route → Usecase → Adapter/Port. Usecase에서 fetch·DB 직접 호출 금지.
- 이 티켓(TAX-6B-33) 범위 밖 파일은 수정하지 말 것. 무관한 리팩터 금지.
- API 키·주민/사업자번호·회계사 식별자를 코드·로그·에러 메시지·URL에 넣지 말 것.
- 기존 테스트를 깨지 말 것. temperature 0·재시도(withRetry) 등 기존 안전장치를 제거하지 말 것.
- **이 티켓 고유 금지사항**: 검수 없이 OVERRULED 자동 확정 금지 / 원문 가공 금지 / 검색·답변·라벨 파이프라인 변경 금지 / LLM 호출로 방향 판정 금지.

## 티켓 요약
- 목표: 뒤집힌 법리(전원합의체·판례변경 등) 신호를 담은 판례·심판례에서 **후보 목록**을 자동 추출해
  회계사 검수용 마크다운 표로 산출하고, 회계사가 표에 직접 기입한 **확정분만** `citation_edges`에
  `edge_type='OVERRULED'`로 반영. 방향·주체 판정은 절대 자동화하지 않음.
- 이번 라운드 최우선(R1): 전체 결함 해소. 단 본 리뷰 결과 🔴/🟡 없음 → 아래 🟢는 선택 반영.

## 검증 완료 사항 (참고 — 수정 불필요)
- **§3.2-1 자동 확정 금지 ✅**: `applyOverruledReview.ts`는 `classifyReviewVerdict`가 `'apply'`로 분류한
  행(= 검수 결과 셀이 정확히 `확정(판례→판례)`)만 DB에 반영. 산출물 `docs/review/OVERRULED_candidates_batch1~10.md`
  **2,796행 전부** 검수 결과·뒤집은 주체·뒤집힌 대상 3개 컬럼이 빈칸임을 실측 확인(비어있지 않은 행 0건).
- **§3.2-2 원문 가공 금지 ✅**: `extractSnippet`은 `content.slice()`만 사용(순수 부분 문자열). 표 셀 변환
  `toTableCell`은 개행류 공백만 단일 공백으로 접고(`\s*[\r\n]+\s*` → ' ') 단어·문장을 변형하지 않음.
  개행→공백 접기는 리포트·주석에 문서화된 정책이며 AC3에서 역산 대조로 30/30건 일치 확인.
- **§3.2-3 파이프라인 변경 금지 ✅**: 커밋 8df9fb3 변경 파일은 domain 순수함수 확장 + 신규 스크립트 2개 +
  테스트 + package.json + 문서/산출물뿐. `generateAnswer.ts`·`route.ts`·검색/어댑터 코드 미변경.
  (참고: 조회 어댑터 `citationGraph.ts`는 `edge_type IN ('FOLLOWS','REFERS')`만 확장하므로 신규 OVERRULED
  엣지는 참고목록 확장에서 자연 제외 — 안전한 부수효과, 코드 변경 아님.)
- **§3.2-4 LLM 방향 판정 금지 ✅**: 두 스크립트 모두 OpenAI/voyage/임베딩 import·호출 없음.
- **INSERT 정합 ✅**: `citation_edges` 스키마(migrate.sql) 대비 `snippet`(NOT NULL)·`in_corpus`(NOT NULL)
  포함 모든 필수 컬럼 채움, `ON CONFLICT (from_id, to_id)`가 `UNIQUE (from_id, to_id)`와 일치, 멱등.
- **오타 차단 ✅**: `parseReviewTable`이 허용값 5종 밖 검수 결과를 `errors`로 보고 →
  `applyOverruledReview.ts`가 `errors.length > 0`인 파일은 `continue`로 **전체 미반영**(부분 오반영 차단).
  단위 테스트(`확정(판례->판례)` ASCII 오타)로 검증됨.

## 수정 항목
### [1] 🟢 OVERRULED 엣지 `edge_source` 값이 실제 출처와 불일치
- **파일**: `scripts/applyOverruledReview.ts:179`
- **문제**: INSERT 문에서 `edge_source`를 하드코딩 `'field'`로 넣는다. 그러나 스키마 주석(`scripts/migrate.sql:79`)상
  `'field'`는 "참조판례 구조화 필드"에서 온 엣지, `'body'`는 "본문 정규식"에서 온 엣지를 뜻한다.
  이 티켓의 OVERRULED 엣지 `snippet`은 본문(`content`)을 `extractSnippet`으로 자른 것이며, 엣지 자체는
  회계사 수기 검수에서 나온 것이다 — `'field'`는 출처를 잘못 표기한다(TAX-6B-31 신뢰도 구분 의미와 어긋남).
  **기능 영향은 없음**(조회 어댑터가 `edge_source`를 필터에 쓰지 않고, `buildCitationEdges` 통계는 DB가 아니라
  매 실행 재계산이므로 오라벨이 통계를 오염시키지 않음). 순수 데이터 출처 정확성 문제.
- **기대 결과**: `edge_source`가 이 엣지의 실제 출처를 정확히 반영. 최소안은 `'body'`(발췌가 본문 유래)로 변경.
  더 정확히 하려면 회계사 검수 출처를 뜻하는 새 값(예: `'review'`)을 쓰고 `migrate.sql:79` 주석에 그 값을 한 줄 추가.
  (스키마에 CHECK 제약이 없어 어느 쪽이든 INSERT는 통과함. 새 값 도입 시 주석 갱신만 잊지 말 것.)
- **검증 방법**: 변경 후 `npm run typecheck` 0오류, `npm run test` 전체 GREEN. 라이브 재적재는 불필요(값만 교정).

### [2] 🟢 발췌에 파이프(`|`)가 포함될 때의 이스케이프 잔여·표 파싱 어긋남(희귀 엣지)
- **파일**: `scripts/extractOverruledCandidates.ts:51` (`toTableCell`) 및
  `scripts/applyOverruledReview.ts:153` (`snippet` 겉따옴표 제거) / `src/domain/precedentCitation.ts:405` (`split('|')`)
- **문제**: `toTableCell`이 마크다운 표 보호를 위해 `|` → `\|`로 이스케이프한다. 그런데
  (a) `applyOverruledReview.ts`는 DB 저장 전 겉따옴표만 벗기고 `\|`는 되돌리지 않아, 발췌에 `|`가 있었다면
  DB `snippet`에 백슬래시가 남아 원문과 문자 단위로 어긋난다(§6.1). (b) `parseReviewTable`의 `line.split('|')`는
  이스케이프를 이해하지 못해 셀 정렬이 밀린다. **실무 영향은 사실상 없음**: 판례·심판례 원문에 `|` 문자는
  거의 등장하지 않고, 설령 밀리더라도 검수 결과 셀이 유효값 5종과 정확히 일치할 확률이 없어 **오적용이 아니라
  "파일 오류로 전체 미반영"(안전 실패)** 로 귀결된다. 그래도 완결성을 위한 개선 여지.
- **기대 결과**: 발췌에 `|`가 있어도 (a) DB `snippet`이 원문과 문자 단위 일치(저장 전 `\|`→`|` 복원) (b) 표 파싱이
  이스케이프된 파이프를 하나의 셀로 올바로 인식. 최소안: `applyOverruledReview.ts`에서 겉따옴표 제거와 함께
  `\|`→`|` 복원. 여력 시 `parseReviewTable`이 `\|`를 셀 분리자로 보지 않도록 처리.
- **검증 방법**: 발췌에 `|`를 포함한 샘플 행으로 `parseReviewTable` 단위 테스트 1건 추가(셀 개수·verdict 정위치 확인),
  `snippet` 복원 확인. `npm run test` GREEN.

### [3] 🟢 열 수가 부족한 행을 조용히 스킵(경고 없음)
- **파일**: `src/domain/precedentCitation.ts:406` (`if (cells.length < 7) return`)
- **문제**: 회계사가 검수 결과를 기입했더라도 실수로 `|` 하나를 지우면 그 행은 `cells.length < 7`이 되어
  **경고 없이 스킵**된다. 방향은 안전(과잉 반영이 아니라 누락)하지만, 확정 기입한 행이 조용히 사라져
  회계사가 알아채기 어렵다. `errors` 배열은 "허용 안 된 검수값"만 보고하고 열 수 부족은 보고하지 않는다.
- **기대 결과**: 데이터로 보이는 행(맨 앞 셀이 숫자 `#`)인데 열 수가 7 미만이면 `errors`(또는 별도 경고)로 보고해
  회계사가 표 손상을 인지하도록 함. 헤더/구분선/표 밖 잡음 행은 지금처럼 조용히 무시.
- **검증 방법**: 열 6개짜리 "숫자 시작" 행을 넣은 `parseReviewTable` 테스트 1건 추가 → `errors` 1건 확인. `npm run test` GREEN.

## 완료 확인 체크리스트 (Codex는 수정 후 스스로 점검)
- [ ] 🔴·🟡 항목 없음 — 위 🟢 3건은 선택 반영(미반영 가능, 단 반영 시 아래 통과 필수)
- [ ] `npm run test` 전체 통과(기준선 796/796 유지)
- [ ] `npm run typecheck` 오류 0
- [ ] 티켓(TAX-6B-33) 범위 밖 파일 미변경 — 특히 `generateAnswer.ts`·검색/답변/라벨 경로 불변
- [ ] `docs/review/OVERRULED_candidates_batch1~10.md`의 검수 결과·뒤집은 주체·뒤집힌 대상 3개 컬럼은 계속 전부 빈칸
