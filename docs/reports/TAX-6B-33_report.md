# TAX-6B-33 리포트 — 뒤집힌 법리(OVERRULED) 검수 큐 (후보 추출 + 회계사 검수 반영)

> 티켓: `docs/tickets/TAX-6B-33_overruled_review_queue.md`
> 착수 게이트 3개(①TAX-6B-18 심판례 전량 임베딩 ②TAX-6B-31 citation_edges 적재 ③회계사 "구현해줘" 승인)
> 전부 충족 후 2026-07-13 구현.

## 변경 사항 요약

**파일 변경 목록:**

- `src/domain/precedentCitation.ts` (수정) — `CitationEdgeType`에 `'OVERRULED'` 추가, TAX-6B-33 섹션 신설:
  `REVERSAL_PATTERNS`·`findReversalSignals`·`parseReviewTable`·`classifyReviewVerdict`·`parseDocCell`·
  `parseOverruledTarget` (전부 순수함수, LLM·DB 비의존)
- `scripts/extractOverruledCandidates.ts` (신규) — 후보 추출 → `docs/review/*.md` 산출
- `scripts/applyOverruledReview.ts` (신규) — 검수 완료 표 파싱 → `citation_edges` 반영
- `tests/unit/precedentCitation.test.ts` (수정) — TAX-6B-33 신규 함수 단위 테스트 22건 추가
- `package.json` (수정) — `overruled:extract`/`overruled:apply` npm script 2개 추가
- `docs/tickets/TAX-6B-33_overruled_review_queue.md` (수정) — §5 AC 6개 완료 반영
- `ROADMAP.md` (수정) — §3 인용 연결망 트랙 행 갱신

**주요 변경:**

- **뒤집힘 신호 탐지(`findReversalSignals`)**: 티켓 §2.1의 4개 신호 패턴(전원합의체·판례변경·견해변경·
  배치범위변경)을 그대로 구현. 신호는 "확정"이 아니라 "후보"일 뿐이며 방향·주체 판정은 하지 않는다.
- **후보 추출(`extractOverruledCandidates.ts`)**: `scripts/tribunal/records.jsonl`(2.3GB 스트리밍) +
  `scripts/precedent_full.json` 순회 → 신호 매치마다 ±90자 원문 발췌를 표 1행으로 산출. 300건 단위로
  `docs/review/OVERRULED_candidates_batch1~10.md`(총 2,796행) 분할 생성. **검수 결과·뒤집은 주체·뒤집힌
  대상 컬럼은 전부 빈칸으로 생성**했다(§9.1 STEP2 지침 — AI가 방향·주체를 미리 채우지 않음. 사건번호는
  이미 발췌 텍스트 안에 드러나 있어 정보 손실이 없다).
- **표 렌더링을 위한 개행→공백 접기(§6.1 관련 결정)**: 판례·심판례 원문은 섹션 구분 개행(`\n\n`)이
  잦아(90자 창 표본의 70.2%가 개행 포함) 마크다운 표 한 행에 그대로 넣으면 표가 깨진다. 단어·문장은
  전혀 건드리지 않고 개행만 단일 공백으로 접는 것으로 결정했다(정본은 `records.jsonl`/`precedent_full.json`에
  무변형으로 남아 있음). AC3 검증 시 이 접기를 역산해 문자 단위 일치를 확인했다(아래 검증 결과 참고).
- **검수 반영(`applyOverruledReview.ts`)**: `확정(판례→판례)`만 `citation_edges`에
  `edge_type='OVERRULED'`로 반영(기존 (from,to) 행 있으면 UPDATE, 없으면 코퍼스 조회 후 INSERT).
  `확정(입법→판례)`는 엣지가 아니므로 DB에 쓰지 않고 콘솔에 `SUPERSEDED_BY_LAW` 목록으로만 출력(활용
  설계는 별도 티켓, §7 Risks). `해당없음`·`보류`·빈칸은 스킵. 검수 결과 값이 허용된 5종(빈칸 포함)이
  아니면 그 **파일 전체**를 반영하지 않고 오류로 보고한다(오타로 인한 부분 오반영 차단).
- **자동 확정 금지 재확인**: LLM 호출도, 휴리스틱 방향 추정도 없다. `classifyReviewVerdict`는 회계사가
  표에 직접 기입한 문자열만 보고 `apply`/`superseded_by_law`/`skip` 3갈래로 결정론 분류한다.

## 검증 결과

1. `npm run typecheck` — PASS, 0 오류
2. `npm run test` — PASS, 796/796 (이 브랜치는 `master`에서 분기해 TAX-6B-20-B/C/D 미포함 — 별도 PR
   대기 중인 브랜치라 829가 아닌 796이 정상 기준선)
3. **AC1 (후보 추출 정합)**: `npm run overruled:extract` 실측 — 신호 보유 심판례 문서 수 **1,219건**,
   신호별 전원합의체 1,111·판례변경 75·견해변경 82·배치범위변경 1 — 티켓 §1.1 사전 실측치와 **완전
   일치**(오차 0%, ±5% 여유보다 훨씬 정확). 판례는 별도로 766건 매치(10,083건 스캔).
4. **AC2 (표 컬럼 구성)**: `docs/review/OVERRULED_candidates_batch1.md` 1행 예시가 티켓 §1.3의 실측
   예시(조심2026중1148·전원합의체·"…2008두150 전원합의체 판결…")와 그대로 재현됨을 육안 확인. 7개
   열(#·문서·신호·발췌·검수결과·뒤집은주체·뒤집힌대상) 전부 존재.
5. **AC3 (발췌 원문 일치, 표본 30건)**: 임시 검증 스크립트(작업 후 삭제)로 판례 20건·심판례 10건을
   원본(`precedent_full.json`, `records.jsonl` 재스트리밍)과 대조 — 개행→공백 접기를 원문에도 동일 적용한
   뒤 부분 문자열 포함 여부 확인, **30/30건 전부 일치**(불일치 0건).
6. **AC4·AC5 (DB 반영·멱등, 라이브 테스트)**: 회계사 승인 하에 운영 Neon에서 실제 테스트 진행.
   - 시험 검수 3건 구성: ①실제 기존 엣지(조심2025서4053→조심2012서1970, 원래 `REFERS`)를
     `확정(판례→판례)`로, ②티켓 §1.3 실측 예시(조심2026중1148)를 그 실제 결론대로 `확정(입법→판례)`로,
     ③임의 1건을 `해당없음`으로.
   - `npm run overruled:apply` 실행 → 콘솔: "반영 대상 1건 · 입법 변경(기록만) 1건 · 스킵 2,797건".
   - `SELECT * FROM citation_edges WHERE edge_type='OVERRULED'` → **정확히 1행**(①만 존재, ②③은 미반영)
     확인 — AC4 PASS.
   - 동일 명령 재실행 → 콘솔 출력 동일, `SELECT count(*) WHERE edge_type='OVERRULED'` → **1건으로 불변**
     — AC5(멱등) PASS.
   - **테스트 데이터 원상복구**: ①의 엣지를 원래 값(`REFERS`)으로 `UPDATE` 복구, 테스트용
     `docs/review/OVERRULED_candidates_batch99.md`는 삭제. 실제 `batch1~10.md`(회계사 검수용 원본, 전부
     빈칸)는 건드리지 않았다. 최종 확인: `citation_edges` OVERRULED 행 수 0(테스트 이전 상태로 복귀).
7. **§3.2 금지 사항 재확인**: 코드에 LLM 호출·자동 방향 판정 로직이 없음을 직접 코드 리딩으로 확인.
   검수 표의 3개 컬럼(검수결과·뒤집은주체·뒤집힌대상)은 추출 시점에 항상 빈칸.

## 잠재 위험 / 후속 메모

- **실제 회계사 검수는 이 티켓 범위 밖**이다. `docs/review/OVERRULED_candidates_batch1~10.md`(2,796행)가
  실제 검수 대기 큐로 그대로 남아 있다 — 대량(회차 분할 가능, 300건/파일)이므로 장기 작업이 될 수 있음
  (티켓 §7 Risks에 이미 명시된 예상).
- "전원합의체" 신호(2,479매치·1,111문서)는 대부분 단순 인용일 가능성이 높다(티켓 §7 Risks 경고).
  `해당없음`이 다수 나올 것을 예상하고 있어야 한다.
- 라이브 테스트에서 확인한 대로, 조심2026중1148(전원합의체 신호)의 실제 정답은 "판례가 판례를
  뒤집은 것이 아니라 법 개정"이었다 — 신호만 보고 기계적으로 `확정(판례→판례)`를 고르면 안 된다는
  티켓의 핵심 경고(§1.3)가 실측으로도 재확인됐다.
- `확정(입법→판례)`로 기록된 항목(`SUPERSEDED_BY_LAW`)은 현재 콘솔 출력으로만 남고 DB나 파일에
  영구 저장되지 않는다. 활용(예: 참고목록 경고 표시)은 별도 티켓 범위(§7).
- 참고목록 경고 표시(⚠️) 자체도 이 티켓 범위 밖 — TAX-6B-32 산출물 확인 후 범위 재확정 예정(티켓
  §1.2 4번).
