# [TAX-6B-31] 인용 연결망 엣지 테이블 구축·적재 (판례·심판례)

> **초안** — AI(Claude Fable 5) 작성, 회계사 검토·승인 대기.
> 근거: TAX-6B-23 PoC(판례→판례, 내부 밀도 64.3%) + Fable 재평가 실측(2026-07-02, 심판례 139,840건 전수).

---

## Metadata

- **Type**: FEAT
- **Severity**: major
- **Layer**: domain | infra (scripts)
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: M (4~5파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- 심판례·판례 본문에는 "(조심 2022서1437, 같은 뜻임)", "(대법원 2003두7392 판결 등 참조)" 같은
  **상호 인용이 원문에 명시**되어 있으나, 시스템은 이를 전혀 활용하지 않음.
- TAX-6B-23 PoC로 판례→판례 엣지 26,337개를 `scripts/precedent_edges.json`에 산출했으나
  로컬 파일에 머물러 있고, 심판례 층은 미측정 상태였음.

### 1.2 기대 동작

- 3방향 인용 엣지(판례→판례, 심판례→판례, 심판례→심판례)를 추출·분류해
  **기존 Neon(Postgres)에 `citation_edges` 테이블로 적재** (새 인프라 0).
- 엣지 종류는 인용 직후 관용구로 결정론적(정규식) 분류:
  - "같은 뜻임" → `FOLLOWS` (선례 지지, 실측 32.3%)
  - "참조"·"취지"·무표지 → `REFERS` (참고, 실측 19.2% + 0.9% + 47.3%)
  - 변경·폐기·전원합의체 신호는 **엣지로 확정하지 않고** TAX-6B-33 검수 큐로 위임.
- 이 티켓은 **데이터 적재까지만**. 검색 파이프라인 반영은 TAX-6B-32.

### 1.3 영향·중요도

- 후속 3효과의 토대: ① 참고목록 1-hop 확장(환각 0, 적중 1건당 평균 판례 1.7건+심판례 1.4건),
  ② 피인용수 랭킹(허브: 대법원 2002두9537, 심판례로부터 598회 피인용),
  ③ 뒤집힌 법리 경고(후보 1,219건).
- LLM·임베딩 호출 0 → **과금 0**, 원문 읽기 전용 → §6.1 위반 여지 없음.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/domain/precedentCitation.ts` (기존) — `CITATION_PATTERN`·`normalizeCaseNumber`·`extractCitedCaseNumbers`·`buildCitationGraph`. **확장 대상**.
- `scripts/precedentCitationProbe.ts` (기존, 참고용) — 판례 층 프로브.
- `scripts/migrate.ts` + `scripts/migrate.sql` (기존) — Neon DDL 실행 패턴 (`IF NOT EXISTS`, 재실행 안전).
- 데이터 원천(로컬, git 미추적):
  - `scripts/precedent_full.json` (판례 10,083건, caseNumber 보유 9,962건)
  - `scripts/tribunal/records.jsonl` (심판례 139,840행, 각 행 `{seq, law:{...}}` 구조 — `law` 언랩 필요)

### 2.2 실측 근거 (2026-07-02 Fable 재평가)

| 방향 | 엣지 | 코퍼스 적중 |
|---|---|---|
| 판례→판례 | 26,337 | 62.0% |
| 심판례→판례 | 55,078 | 55.4% (30,510) |
| 심판례→심판례 | 37,832 | 61.0% (23,070) |

- 심판례 사건번호 패턴: `(조심|국심|감심)\s*제?\s*([0-9]{4}[가-힣][0-9]+)` (기관 접두 필수 → 오탐 차단).
- 심판례 자기 사건번호는 `lawName`에서 추출 (예: "조세심판원 조심 2026중1364").

### 2.3 아키텍처 힌트

```
scripts/buildCitationEdges.ts (배치, 오프라인)
  → src/domain/precedentCitation.ts (순수함수: 추출·정규화·분류)
  → Neon citation_edges 테이블 (pg Pool, migrate.ts 패턴 재사용)
```

- 수집(로컬 JSON 산출)과 적재(DB insert)를 분리해 재실행·검증 가능하게 (collectTribunal.ts 선례).

### 2.4 실측 보강 (2026-07-06, 그래프 엣지 설계 분석 — 회계사 승인·반영)

샘플 구조를 직접 실측한 결과, 최초 설계(§2.2·§4)를 다음 4가지로 보강한다.

1. **관용구 분류를 "매치 후 40자 창"이 아니라 "괄호 그룹 단위"로.**
   심판례 인용은 거의 전부 `(…)` 괄호 안에 있고, "같은 뜻임" 그룹의 **8.8%가 인용 2건 이상의
   사슬**이다(예: `(대법원 2005.1.28. 선고 2002두2871 판결, 대법원 2023.11.16. 선고
   2023두50004 판결, 같은 뜻임)`). 매치 직후 40자 창 방식은 앞쪽 인용의 관용구를 못 보고
   `FOLLOWS`를 `REFERS`로 잘못 분류한다 — 5,080건 표본에서 **6.2%(313건) 오분류** 실측.
   → §4.2·§9.1 STEP1을 "괄호 그룹째 잘라 그룹 끝의 관용구를 그룹 내 모든 인용에 적용"으로 수정.
2. **판례→판례 엣지는 `참조판례` 구조화 필드를 1순위 원천으로.**
   API 본문(판시사항+판결요지)의 인용 밀도는 **0.2%(8,366건 중 19건)**로 사실상 무용하지만,
   대법원 판례의 `참조판례` 필드는 "법원명+선고일+사건번호"가 정리된 목록이라 정규식보다
   오탐 위험이 없고 날짜 대조까지 된다. 하급심은 이 필드가 비어 있으나 `판례내용`(전문)에
   문서당 평균 ~4건의 인용이 있다. → 이 두 필드는 TAX-6B-36(수집기 확장, 별도 파일)에서
   보존하며, 본 티켓은 그 산출물(`precedent_citation_source_<date>.json`)도 추출 입력에 포함한다.
3. **원심(심급) 인용을 선례 인용과 분리 — 신규 엣지 타입 `APPEAL`.**
   하급심 전문에는 자신의 1심 사건번호가 섞여 나온다. 이를 `FOLLOWS`/`REFERS`와 같은 목록에
   두면 "선례를 인용"과 "같은 사건의 원심"이 혼동된다(PoC 엣지에서도 `2025두35626 →
   2024누39327` 같은 원심 링크가 실제 확인됨). → `edge_type`에 `APPEAL` 추가, "원심판결"/
   "환송" 맥락에서만 분류.
4. **시간 방향 검증을 안전판으로 추가.** 인용문에 선고일이 함께 있으면(참조판례 필드는 항상
   동반) 대상 노드의 `decisionDate`와 대조해 `from.결정일 ≥ to.선고일`이 아닌 엣지는
   의심 표시(플래그)한다 — 별도 컬럼 없이 적재 로그에만 남겨 후속 검수 자료로 삼는다.

> **정정(2026-07-06, 판례 중복 정리 작업 중 재검증)**: 위 "충돌 0건"은 당시 부분집합(고등법원 "구"
> 사건 미포함) 기준이었다. 판례 전체 코퍼스로 다시 대조하니 **실제로 사건번호 단독 키 충돌이 14건
> 확인됐다** — 전부 1998년 행정법원 설치 이전, 서울·대구·광주·부산 각 고등법원이 1심 행정사건
> 번호("구")를 독립적으로 매기던 시기의 것(예: `71구9`가 서울고등법원·대구고등법원에 각각 다른
> 사건으로 존재). **따라서 `citation_edges`의 `from_id`/`to_id`는 사건번호만으로는 불충분하며,
> `in_corpus` 판정·엣지 생성 시 최소한 `issuing_body`(법원명)까지 함께 대조해야 한다.** DDL의
> `from_id`/`to_id`를 "사건번호"에서 "사건번호+법원명 복합키"로 변경하거나, 매칭 시 법원명이 다르면
> 후보에서 제외하는 필터를 추가하는 것으로 §9.1 STEP1·STEP3에 반영 필요(구현 시 착수).

---

## 3. Scope (작업 범위) ⭐

### 3.1 허용되는 변경

- [ ] `src/domain/precedentCitation.ts` — 심판례 인용 패턴 + 관용구 분류 순수함수(`classifyCitationEdge`) 추가
- [ ] `scripts/buildCitationEdges.ts` 신규 — 스트리밍 추출 → 로컬 JSON → Neon 적재 (`--extract` / `--load` 분리)
- [ ] `scripts/migrate.sql` — `citation_edges` DDL 추가 (`IF NOT EXISTS`)
- [ ] `tests/unit/precedentCitation.test.ts` — 분류 함수·패턴 테스트 확장
- [ ] `package.json` — npm script 1개 추가 (예: `citation:build`)

### 3.2 금지되는 변경

- ❌ 검색 파이프라인(`searchWithFallback`·`generateAnswer` 등) 일체 (TAX-6B-32에서)
- ❌ 법령·판례·심판례 원문 가공 — snippet은 **원문 부분 문자열 그대로** 저장 (§6.1)
- ❌ LLM·임베딩 API 호출 (과금 0 원칙)
- ❌ `OVERRULED` 엣지 자동 확정 (TAX-6B-33 검수 후에만)
- ❌ 기존 `taxlaw_embeddings` 테이블 스키마 변경

---

## 4. Strategy (구현 힌트)

1. **DDL** (§2.4 보강 반영 — `edge_source`·`cited_date`·`group_no` 추가, `APPEAL` 타입 추가):
   ```sql
   CREATE TABLE IF NOT EXISTS citation_edges (
     id BIGSERIAL PRIMARY KEY,
     from_id TEXT NOT NULL,      -- 인용하는 문서 사건번호(정규화: 공백 제거)
     from_type TEXT NOT NULL,    -- '판례' | '심판례'
     to_id TEXT NOT NULL,        -- 인용된 문서 사건번호(정규화)
     to_type TEXT NOT NULL,
     edge_type TEXT NOT NULL,    -- 'FOLLOWS' | 'REFERS' | 'APPEAL'(원심/환송 — 선례 인용과 분리)
     edge_source TEXT NOT NULL,  -- 'field'(참조판례 구조화 필드) | 'body'(본문 정규식) — 신뢰도 구분
     snippet TEXT NOT NULL,      -- 인용 지점 원문 발췌(±90자, 무변형)
     in_corpus BOOLEAN NOT NULL, -- 인용 대상이 보유 코퍼스에 존재하는가
     cited_date TEXT,            -- 인용문에 동반된 선고일(있으면) — 대상 검증용
     group_no INT,               -- 같은 괄호 그룹에서 나온 인용 묶음 번호 — 사슬 추적용
     created_at TIMESTAMPTZ DEFAULT now(),
     UNIQUE (from_id, to_id)
   );
   CREATE INDEX IF NOT EXISTS idx_citation_edges_to ON citation_edges (to_id);   -- 피인용 집계용
   CREATE INDEX IF NOT EXISTS idx_citation_edges_from ON citation_edges (from_id); -- 1-hop 확장용
   ```
2. **분류 순수함수** (domain, §2.4 보강): 괄호 그룹(`(…)`) 단위로 잘라 그룹 끝의 관용구를
   그룹 내 **모든 인용에 적용** → `같은\s*뜻임` 이면 `FOLLOWS`, "원심판결"/"환송" 맥락이면
   `APPEAL`, 그 외 전부 `REFERS`(가장 약한 주장이 기본값 = 안전). 40자 창 방식 대비
   사슬 오분류 6.2% 해소(§2.4 실측).
3. **추출 배치**: records.jsonl 스트리밍(2.3GB, readline) + precedent_full.json 일괄 로드.
   같은 (from,to) 쌍 중복은 첫 발생만. 진행 로그 2만 건 단위.
4. **적재 배치**: `INSERT ... ON CONFLICT (from_id, to_id) DO NOTHING`, 1,000행 단위 배치.
5. 예상 규모: 전체 엣지 약 11.9만 행 (수 MB 수준 — Neon 무료 한도 영향 미미).

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `citation_edges` 행 수가 실측치 ±5% 이내 (약 11.3만~12.5만)
2. [ ] `edge_type` 분포: FOLLOWS 약 30~35%, REFERS 약 65~70% (실측 정합)
3. [ ] `in_corpus=true` 비율 55~65% (실측 정합)
4. [ ] 표본 20행의 snippet이 원본 문서 content의 부분 문자열과 **문자 단위 일치** (§6.1)
5. [ ] 재실행(`--load` 2회) 시 행 수 불변 (멱등)
6. [ ] `npm run test` 전체 GREEN, `tsc` 오류 0
7. [ ] 검색·답변 경로 무변경 (기존 vitest 무회귀로 확인)

---

## 6. Verification (검증 단계)

1. `npm run citation:build -- --extract` → 로컬 JSON 산출, 요약 통계 출력 확인
2. 요약 통계를 실측표(§2.2)와 대조
3. `npm run citation:build -- --load` → Neon 적재
4. Neon 콘솔에서 `SELECT edge_type, count(*) FROM citation_edges GROUP BY 1;` 분포 확인
5. `SELECT to_id, count(*) FROM citation_edges WHERE in_corpus GROUP BY 1 ORDER BY 2 DESC LIMIT 5;`
   → 상위에 `2002두9537`(피인용 최다) 등장 확인
6. 같은 `--load` 재실행 → 행 수 동일 확인

---

## 7. Risks / Notes

- records.jsonl(2.3GB)은 로컬 전용·git 미추적 — 유실 시 collectTribunal.ts 재수집 필요.
- 사건번호 정규식은 보수적(오탐<누락 우선). 누락분은 후속 개선 여지로 수용.
- 심판례 원문에 연도만 다른 유사 사건번호 오기가 있을 수 있음 → 존재 검증(in_corpus)이 안전판.
- DATABASE_URL 필요 — 실행은 회계사 로컬에서 (키·비용 게이트).

---

## 8. AI Implementation Instructions

- 코딩 전: 근본 원인 분석·영향 파일·구현 계획 제시 → 회계사 승인 후 착수
- 코딩 후: 리포트 `docs/reports/TAX-6B-31_report.md`

---

## 9. 구현 계획 (사전 수립 — 착수 대기)

> **착수 게이트**: ① 심판례 전량 벡터 임베딩(TAX-6B-18 실행) 완료 후 + ② 회계사 "구현해줘" 승인 (2026-07-03 회계사 지시).
> 참고: 이 티켓 자체는 로컬 파일만 읽어 임베딩과 기술적 의존이 없으나, 회계사가 정한 순서를 따른다.

### 9.1 단계별 계획

**STEP 1 — domain 순수함수 추가** (`src/domain/precedentCitation.ts`)

- `TRIBUNAL_CITATION_PATTERN = /(조심|국심|감심)\s*제?\s*([0-9]{4}[가-힣][0-9]+)/g` — 기관 접두 필수(오탐 차단, 재평가 프로브 검증분과 동일)
- `extractTribunalSelfId(lawName: string): string | null` — 자기 사건번호 추출(예: "조세심판원 조심 2026중1364")
- `splitBracketGroups(content: string): { text: string; start: number; end: number }[]` — 괄호
  `(…)` 단위로 자르는 헬퍼(§2.4 보강). 중첩·미종결 괄호는 보수적으로 스킵(오탐<누락).
- `classifyCitationEdge(groupText: string): 'FOLLOWS' | 'REFERS' | 'APPEAL'` — 그룹 텍스트
  전체에서 관용구 검사: `같은\s*뜻임` → FOLLOWS, `원심판결`·`환송` → APPEAL, 그 외 전부
  REFERS(가장 약한 주장이 기본값). 그룹 내 인용 전부에 동일하게 적용(사슬 오분류 방지).
- `extractCitedDate(groupText: string): string | null` — 그룹 내 "YYYY.MM.DD. 선고"류 날짜를
  ISO로 파싱(있으면), 시간 방향 검증용(§2.4 ④).
- `extractSnippet(content: string, index: number, length: number): string` — ±90자, `content.slice()`만 사용(원문 부분 문자열 보장, §6.1)

**STEP 2 — DDL 추가** (`scripts/migrate.sql`)

- §4.1의 `citation_edges` DDL + 인덱스 2개를 파일 말미에 추가 (`IF NOT EXISTS`, 기존 테이블 무변경)

**STEP 3 — 배치 스크립트 신규** (`scripts/buildCitationEdges.ts`)

- `--extract`: ① `precedent_full.json` 일괄 로드로 판례 사건번호 집합 구축 → ② `records.jsonl` 1차 스트리밍(readline, `law` 언랩)으로 심판례 자기번호 집합 구축 → ③ 2차 스트리밍 + 판례 파일 순회로 3방향 엣지 추출·분류 → `scripts/citation_edges.json` 산출(.gitignore 등재) + 요약 통계(방향별 엣지 수·FOLLOWS 비율·in_corpus 비율) 출력
  - **판례→판례 원천 이원화(§2.4 보강)**: `precedent_citation_source_*.json`(TAX-6B-36 산출물)이
    있으면 우선 사용 — `참조판례` 필드는 `edge_source='field'`로 정밀 추출(날짜 동반),
    `판례내용`(전문)은 본문 정규식으로 `edge_source='body'`. 산출물이 없는 문서는 기존
    판시사항+판결요지 정규식으로 폴백(밀도 낮음을 감수).
- `--load`: `citation_edges.json` → pg Pool(`ssl: { rejectUnauthorized: false }`, migrate.ts 패턴) → `INSERT ... ON CONFLICT (from_id, to_id) DO NOTHING`, 1,000행 배치, 진행 로그 2만 건 단위
- 같은 (from,to) 쌍은 첫 발생만 유지(snippet은 최초 인용 문맥)

**STEP 4 — 테스트 확장** (`tests/unit/precedentCitation.test.ts`)

- classifyCitationEdge: "같은 뜻임"→FOLLOWS / "참조"·무표지→REFERS / 창 경계(40자 밖 관용구는 무시)
- 심판례 패턴: 기관 접두 없는 숫자열 미매칭(오탐 차단), `제` 유무 변형 매칭
- extractSnippet 결과가 항상 원문 `includes()` 통과 (§6.1 구조 보장)

**STEP 5 — npm script** (`package.json`): `"citation:build": "tsx scripts/buildCitationEdges.ts"`

### 9.2 검증 순서

§6 그대로: `--extract` 통계를 §2.2 실측표와 대조 → `--load` → Neon 분포 쿼리 → `--load` 재실행 멱등 확인 → vitest 전체 GREEN.

### 9.3 예상 규모·리스크

- 신규 코드 약 300줄, 파일 5개(범위 §3.1과 일치). LLM·임베딩 콜 0 → 과금 0.
- `--load`만 DATABASE_URL 필요 — 실행은 회계사 로컬에서.

---

## 10. Related Tickets

- 선행: `TAX-6B-23_precedent_citation_graph_poc.md` (효용 검증), `TAX-6B-18_tribunal_full_load.md` (데이터 원천)
- 선행(선택, 판례 엣지 원천 강화): `TAX-6B-36_precedent_citation_source_fields.md` (참조판례·판례내용 필드 보존)
- 후속: `TAX-6B-32_citation_graph_reference_expansion.md`, `TAX-6B-33_overruled_review_queue.md`

## 11. Report Link

Report: `docs/reports/TAX-6B-31_report.md` (미작성)

---

**작성자**: Claude Fable 5 (초안) / 승인: 회계사 (대기)
**작성일**: 2026-07-03
