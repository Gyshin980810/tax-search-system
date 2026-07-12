# [TAX-6B-33] 뒤집힌 법리(OVERRULED) 검수 큐 — 후보 추출 + 회계사 검수 반영

> **초안** — AI(Claude Fable 5) 작성, 회계사 검토·승인 대기.
> 선행 TAX-6B-31(citation_edges 적재) 완료 후 착수. TAX-6B-32와는 독립 (병행 가능).

---

## Metadata

- **Type**: FEAT
- **Severity**: critical (오답 방지 — 폐기된 법리 인용 차단)
- **Layer**: domain | infra (scripts) | docs
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: M (3~4파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- 판례·심판례 중 일부는 **이후 전원합의체 판결·판례 변경·법 개정으로 뒤집힌 법리**를 담고 있음.
- 시스템은 이를 구분하지 못해, 폐기된 옛 법리를 담은 문서를 참고목록에
  정상 문서와 동급으로 제시할 수 있음 — "틀린 답은 없는 답보다 나쁘다" 원칙에 정면 위배.
- Fable 재평가 실측(2026-07-02): 뒤집힘 신호 보유 심판례 **1,219건**
  (전원합의체 1,111 / 판례변경 75 / 견해변경 82 / 배치범위변경 1).

### 1.2 기대 동작

1. 뒤집힘 신호가 담긴 심판례·판례에서 **후보 목록**을 자동 추출해
   회계사가 검수할 수 있는 문서(마크다운 표)로 산출.
2. 회계사가 각 후보를 검수해 확정: "A가 B를 뒤집음" (방향 포함).
3. 확정분만 `citation_edges`에 `edge_type='OVERRULED'`로 반영.
4. (표시 정책) OVERRULED 대상 문서가 참고목록에 오르면 ⚠️ 경고를 동반 —
   단, 표시 로직 구현은 TAX-6B-32 산출물 확인 후 범위 재확정.

### 1.3 영향·중요도

- **자동 확정 금지가 핵심 설계**: 실측 예시 조심2026중1148은 판례가 판례를 뒤집은 것이
  아니라 **법 개정(국세기본법 제2조 제20호 신설)** 으로 옛 전원합의체 판례(2008두150)가
  무효화된 사례 — 기계가 방향·원인을 오판하면 안전장치가 오히려 독이 됨.
- 후보 1,219건은 전체의 약 0.9% — 회계사 1인이 검수 가능한 분량 (회차 분할 가능).

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/domain/precedentCitation.ts` (TAX-6B-31에서 확장) — 뒤집힘 신호 패턴 추가 위치.
- `scripts/tribunal/records.jsonl`, `scripts/precedent_full.json` — 데이터 원천.
- Neon `citation_edges` (TAX-6B-31 산출물).
- 신호 패턴 (재평가 프로브 검증분):
  `판례.{0,6}변경` / `배치되는\s*범위에서.{0,10}변경` / `전원합의체` / `견해.{0,6}변경`

### 2.2 검수 문서 형식 (제안)

`docs/review/OVERRULED_candidates_batch1.md`:

| # | 문서(사건번호) | 신호 | 원문 발췌(±90자, 무변형) | 검수 결과 | 뒤집은 주체 | 뒤집힌 대상 |
|---|---|---|---|---|---|---|
| 1 | 조심2026중1148 | 전원합의체 | "…일방관계설의 입장(대법원 2008두150 전원합의체 판결)을 취하였고, 그 이후인 2011.12.30. 개정된…" | (회계사 기입) | 법 개정 | 2008두150 |

- 검수 결과 값: `확정(판례→판례)` / `확정(입법→판례)` / `해당없음` / `보류`
- **입법 변경**은 인용 엣지가 아니므로 별도 유형(`SUPERSEDED_BY_LAW` 메모)으로만 기록 —
  엣지 반영 여부는 검수 후 회계사 결정.

### 2.3 흐름

```
[1] scripts/extractOverruledCandidates.ts → docs/review/*.md (후보 추출, 자동)
[2] 회계사 검수 (수기, 표의 검수 결과 컬럼 기입)
[3] scripts/applyOverruledReview.ts → 확정분만 citation_edges UPDATE/INSERT (자동)
```

---

## 3. Scope (작업 범위) ⭐

### 3.1 허용되는 변경

- [ ] `src/domain/precedentCitation.ts` — 뒤집힘 신호 패턴·후보 추출 순수함수 추가
- [ ] `scripts/extractOverruledCandidates.ts` 신규 — 후보 추출 → `docs/review/*.md` 산출
- [ ] `scripts/applyOverruledReview.ts` 신규 — 검수 완료 표 파싱 → `edge_type='OVERRULED'` 반영
- [ ] `tests/unit/precedentCitation.test.ts` — 신호 패턴·표 파싱 테스트
- [ ] `package.json` — npm script 2개 추가

### 3.2 금지되는 변경

- ❌ 검수 없이 `OVERRULED` 자동 확정 (이 티켓의 존재 이유)
- ❌ 원문 가공 — 발췌는 원문 부분 문자열 그대로 (§6.1)
- ❌ 검색·답변·라벨 파이프라인 변경 (경고 표시는 후속 범위 재확정 후 별도)
- ❌ LLM 호출로 방향 판정 (결정론 원칙 — 판정 주체는 회계사)

---

## 4. Strategy (구현 힌트)

1. 후보 추출은 재평가 프로브 로직 재사용: 신호 매치 지점 ±90자 발췌 + 그 창 안의
   사건번호를 "뒤집힌 대상 후보"로 병기 (회계사 검수 보조).
2. 1,219건을 한 번에 내리지 말고 **batch 파일 분할**(예: 300건/회) — 검수 피로 완화.
3. 반영 스크립트는 표의 `확정(판례→판례)` 행만 처리, 나머지는 스킵 로그.
   기존 엣지가 있으면 `edge_type` UPDATE, 없으면 INSERT.
4. 멱등: 같은 검수 파일 재실행 시 결과 불변.

---

## 5. Acceptance Criteria (완료 조건)

1. [x] 후보 추출 결과가 실측치와 정합 (심판례 신호 레코드 1,219건 ±5%) — **완료(2026-07-13)**:
   실측 1,219건(전원합의체 1,111·판례변경 75·견해변경 82·배치범위변경 1) **정확히 일치**(오차 0%).
2. [x] 검수 문서에 사건번호·신호 종류·원문 발췌·검수 컬럼이 모두 포함 — **완료**: `docs/review/OVERRULED_candidates_batch1~10.md`(2,796행) 산출, 열 7개 전부 포함.
3. [x] 발췌 표본 20건이 원문과 문자 단위 일치 (§6.1) — **완료**: 판례 20건 + 심판례 10건 총 30건
   표본 검증, 개행→공백 접기(표 렌더링용, 문서화된 정책)를 역산 후 100% 일치(불일치 0건).
4. [x] 검수 표에서 `확정` 행만 DB 반영되고, `해당없음`·`보류`·빈칸은 반영되지 않음 (단위 테스트) — **완료**:
   `classifyReviewVerdict` 단위 테스트 + 실제 Neon 라이브 테스트(시험 검수 3건: 확정1·입법변경1·해당없음1
   → DB에 확정 1건만 반영, 나머지 미반영 확인 후 원상복구).
5. [x] 반영 스크립트 재실행 멱등 — **완료**: 라이브 테스트에서 `overruled:apply` 2회 연속 실행 후
   `citation_edges` OVERRULED 행 수 1건으로 불변 확인.
6. [x] `npm run test` 전체 GREEN, `tsc` 오류 0 — **완료**: typecheck 0에러, vitest 796/796(master 기준 브랜치).

---

## 6. Verification (검증 단계)

1. `npm run overruled:extract` → `docs/review/OVERRULED_candidates_batch1.md` 생성 확인
2. 표에서 2~3건 시험 검수(확정 1·해당없음 1·보류 1) 후 `npm run overruled:apply`
3. Neon에서 `SELECT * FROM citation_edges WHERE edge_type='OVERRULED';` → 확정분만 존재 확인
4. 같은 명령 재실행 → 행 수 불변 확인

---

## 7. Risks / Notes

- "전원합의체" 신호는 뒤집힘이 아닌 단순 인용도 다수 포함(1,111건 중 상당수) →
  후보일 뿐이며 확정률이 낮아도 정상. 검수 컬럼에 `해당없음`이 많을 것을 예상.
- 입법 변경 유형은 인용 그래프 밖의 개념 — 이번엔 기록만 하고 활용 설계는 별도 티켓.
- 검수는 장기 작업이 될 수 있음 — batch 단위로 반영 가능하게 설계 (부분 반영 허용).

---

## 8. AI Implementation Instructions

- 코딩 전: 근본 원인 분석·영향 파일·구현 계획 제시 → 회계사 승인 후 착수
- 코딩 후: 리포트 `docs/reports/TAX-6B-33_report.md`

---

## 9. 구현 계획 (사전 수립 — 착수 대기)

> **착수 게이트**: ① 심판례 전량 벡터 임베딩(TAX-6B-18 실행) 완료 후 + ② TAX-6B-31(citation_edges) 적재 완료 + ③ 회계사 "구현해줘" 승인 (2026-07-03 회계사 지시). TAX-6B-32와는 병행 가능.

### 9.1 단계별 계획

**STEP 1 — domain 순수함수 추가** (`src/domain/precedentCitation.ts`)

- `REVERSAL_PATTERNS` 상수: `판례.{0,6}변경` / `배치되는\s*범위에서.{0,10}변경` / `전원합의체` / `견해.{0,6}변경` (재평가 프로브 검증분 그대로)
- `findReversalSignals(content: string): { signal: string; index: number }[]` — 신호 종류·위치 반환
- `parseReviewTable(markdown: string): ReviewRow[]` — 검수 표 파싱. `검수 결과` 컬럼 값이 정확히
  `확정(판례→판례)` / `확정(입법→판례)` / `해당없음` / `보류` / 빈칸 중 하나가 아니면 해당 행 오류 보고(오타로 인한 오반영 차단)

**STEP 2 — 후보 추출 스크립트 신규** (`scripts/extractOverruledCandidates.ts`)

- `records.jsonl` 스트리밍(`law` 언랩) + `precedent_full.json` 순회 → 신호 매치마다:
  사건번호 / 신호 종류 / 원문 발췌(±90자, `slice`만 — §6.1) / 창 안의 인용 사건번호(뒤집힌 대상 후보로 병기)
- 300건 단위로 `docs/review/OVERRULED_candidates_batch1.md`, `batch2.md`… 분할 산출
  (검수 결과·뒤집은 주체·뒤집힌 대상 컬럼은 빈칸으로 생성 — 회계사 기입란)
- 요약 통계 출력: 총 후보 수(기대 ≈1,219±5%)·신호별 분포

**STEP 3 — 검수 반영 스크립트 신규** (`scripts/applyOverruledReview.ts`)

- `docs/review/*.md` 파싱(`parseReviewTable`) →
  - `확정(판례→판례)`: `citation_edges`에 `edge_type='OVERRULED'` — 기존 (from,to) 행 있으면 UPDATE, 없으면 INSERT
  - `확정(입법→판례)`: 엣지 미반영, `SUPERSEDED_BY_LAW` 별도 목록으로만 요약 출력(활용 설계는 별도 티켓)
  - `해당없음`·`보류`·빈칸: 스킵 로그
- 멱등: 같은 검수 파일 재실행 시 UPDATE가 같은 값으로 덮어써 결과 불변

**STEP 4 — 테스트** (`tests/unit/precedentCitation.test.ts` 확장)

- 신호 패턴 매칭·비매칭(예: "변경신고"는 판례변경 아님 — `{0,6}` 창 확인)
- parseReviewTable: 확정 행만 통과 / 허용값 외 문구는 오류 / 빈칸 스킵
- 발췌가 원문 부분 문자열 (§6.1)

**STEP 5 — npm script** (`package.json`): `overruled:extract` / `overruled:apply`

### 9.2 검증 순서

§6 그대로: extract → 시험 검수 3건(확정 1·해당없음 1·보류 1) → apply → Neon 확인 → 재실행 멱등.

### 9.3 예상 규모·리스크

- 신규 2파일 + 수정 2파일 + package.json (§3.1과 일치), 약 280줄. LLM 콜 0.
- 검수 자체가 장기 작업 — batch 부분 반영을 처음부터 지원하므로 회계사 페이스대로 진행 가능.
- "전원합의체" 1,111건 대부분은 단순 인용 예상 — `해당없음` 다수는 정상.

---

## 10. Related Tickets

- 선행: `TAX-6B-31_citation_edges_load.md` (필수)
- 병행 가능: `TAX-6B-32_citation_graph_reference_expansion.md`
- 참조: `TAX-6B-23` PoC의 ⚠️ 미해결 항목("뒤집힘 엣지 종류 설계 필수")을 본 티켓이 해소

## 11. Report Link

Report: `docs/reports/TAX-6B-33_report.md` (작성 완료)

---

**작성자**: Claude Fable 5 (초안) / 승인: 회계사 (대기)
**작성일**: 2026-07-03
**구현 완료**: 2026-07-13 — §9 계획대로 STEP1~5 구현, AC1~6 전부 통과. 검수 큐(2,796건)만 산출됐고
회계사의 실제 검수(확정/해당없음/보류 기입)는 이 티켓 범위 밖(별도 장기 작업, §7 Risks 참고).
