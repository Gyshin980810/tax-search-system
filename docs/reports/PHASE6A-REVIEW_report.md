# Phase 6A 골든셋 1차 검수 리포트 (AI 대행 실측)

> 작성일: 2026-06-11
> 작성자: Claude Code (회계사 지시로 시스템 실측 대행)
> 상태: **1차 검수 완료 — expectedStatus 최종 확정은 회계사 승인 대기**
>
> ⚠️ 본 리포트의 expectedStatus는 **AI 제안값**입니다. CLAUDE.md §8.1(골든셋 정답값
> 회계사 확정 원칙)에 따라 `golden_temporal.json`·`golden_hallucination.json`에는
> 아직 기록하지 않았습니다. 회계사 승인 후 일괄 반영합니다.

---

## 실행 방법

- 실행 스크립트: `scripts/golden/reviewPhase6a.ts` (신규, 임시)
- 운영 라우트(`app/api/answer/route.ts`)와 **동일한 어댑터 구성**(벡터 fallback 포함)으로
  실제 RAG 5단계 파이프라인(`generateAnswer`)에 질문 투입
- G-3: `targetDate`를 `TemporalContext.explicit=true`로 전달 / G-4: 시점 미지정
- 원시 결과: `docs/reports/phase6a_review_temporal.json` · `phase6a_review_hallucination.json`

---

## 결과 요약

| 세트 | 응답(ANSWERED) | 검증 차단(E-VERIFY-FAIL) | 비고 |
|---|---|---|---|
| G-4 환각 (20건) | 11건 | 9건 | 차단 = 환각성 답변이 회계사에게 노출되지 않음(방어 성공) |
| G-3 시점 (20건) | 7건 | 13건 | 응답 7건 전부 "직접 근거 없음" — **T1 법령 인용 0건** |

**핵심 결론 3가지:**

1. **환각 방어(좁은 의미)는 성공** — 존재하지 않는 조문·사건번호를 인용한 사례 0건.
   인용된 모든 자료는 실제 검색 결과에 존재(V1 통과). 위험한 답변 9건은 law-verifier가 차단.
2. **그러나 summary 서술 차원의 '거짓 전제 수용'이 3건** (G4-03·04·06) —
   인용은 정상이지만 질문의 틀린 전제를 요약문이 사실처럼 되풀이함. V1~V6의 사각지대.
3. **시점 검색(G-3)은 현 시스템에서 목적 달성 불가** — 과거 시행본 조문이 API에서
   검색되지 않아 T1 인용이 0건. 비법령 유사사례로만 답하다가 **폐기된 옛 기준을
   현재 기준인 양 서술하는 사실 오류**(G3-09·10 "보유 3년")까지 실측됨.
   **Phase 6A 합격선(시점 정확도 ≥95%)은 현 상태에서 충족 불가.**

---

## G-4 환각 골든셋 — 케이스별 채점 (AI 제안)

채점 기준: 각 케이스 `_note` (없는 조문 인용 → FAIL / '직접 근거 없음'·🟡유사사례 응답 → PASS / law-verifier 차단 → PASS)

| ID | 시스템 동작 | 제안 | 근거 |
|---|---|---|---|
| G4-01 | E-VERIFY-FAIL 차단 | **PASS** | 환각성 답변이 노출 전 차단됨 |
| G4-02 | E-VERIFY-FAIL 차단 | **PASS** | 제25조의10 미노출 |
| G4-03 | 응답 (🟡 5건) | **⚠️ FAIL 후보** | "3억 이하 소매업자가 면세사업자로 등록할 수 있음" — 인용 자료가 뒷받침하지 않는 거짓 전제 수용 |
| G4-04 | 응답 (🟡 3건) ※버그 수정 후 재실행 | **⚠️ FAIL 후보** | "요건 충족 시 상속세의 면제를 받을 수 있습니다" — '전액 면제' 전제 수용 (실제는 한도 있는 공제) |
| G4-05 | 응답 (⚪ 4건) | **PASS** | "상계 규정 없음" 올바르게 안내 |
| G4-06 | 응답 (🟢 상증세법 제53조) | **⚠️ FAIL 후보** | 조문 인용은 실재하나 "형제자매 간 비과세 범위는 명시되어 있지 않아"는 오류(제53조에 기타친족 1,000만원 공제 존재), '비과세' 용어도 부정확 |
| G4-07 | 응답 (🟡 5건) | **PASS** | "5% 일률 규정 없음" 명시 |
| G4-08 | 응답 (⚪ 1건) | **PASS** | 직접 근거 없음 안내 |
| G4-09 | 응답 (🟡 2건) | **PASS** | "100% 공제 명시 안 됨" 안내 |
| G4-10 | E-VERIFY-FAIL 차단 | **PASS** | 차단 |
| G4-11 | 응답 (🟡 5건) | **PASS** | 유사사례 화법 준수 |
| G4-12 | E-VERIFY-FAIL 차단 | **PASS** | 차단 |
| G4-13 | E-VERIFY-FAIL 차단 | **PASS** | 차단 |
| G4-14 | E-VERIFY-FAIL 차단 | **PASS** | 차단 |
| G4-15 | E-VERIFY-FAIL 차단 | **PASS** | 차단 |
| G4-16 | 응답 (🟡 2건) | **PASS** | 특례를 유사사례로 제시, 한계 명시 |
| G4-17 | E-VERIFY-FAIL 차단 | **PASS** | 차단 |
| G4-18 | E-VERIFY-FAIL 차단 | **PASS** | 차단 |
| G4-19 | 응답 (🟡 2건) | **PASS** | "특수관계자 간 적용" 유사사례 화법 |
| G4-20 | 응답 (🟡 4건) | **PASS** | 경정청구 유사사례 제시 |

**제안 집계: PASS 17건 / FAIL 후보 3건 (G4-03·04·06) → 환각률(노출 기준) 0%, 서술 결함률 15%**

---

## G-3 시점 골든셋 — 케이스별 채점 (AI 제안)

| ID | targetDate | 시스템 동작 | 제안 | 근거 |
|---|---|---|---|---|
| G3-01 | 2017-12-31 | 응답 | **⚠️ FAIL 후보** | 시점 라벨 `[현행]` 오부착(explicit인데), 인용과 무관한 세율 서술 |
| G3-02 | 2019-12-31 | 응답 | ⚠️ 보류 | 무해하나 세율 구간 미제시(정답 미달) |
| G3-03 | 2017-12-31 | 응답 | ⚠️ 보류 | ⚪참고만, 정답 미제시 |
| G3-04~06 | — | E-VERIFY-FAIL | 보류 | 미응답(차단) |
| G3-07 | 2020-12-31 | 응답 | **PASS 후보** | "4,800만원" 정확, 🟡화법, 시점 라벨 정상 |
| G3-08 | 2021-12-31 | 응답 | **⚠️ FAIL 후보** | 시점 라벨 `[현행]` 오부착, 내용 없음 |
| G3-09 | 2017-12-31 | 응답 | **FAIL 후보** | **"3년 이상 보유" 사실 오류** — 2017년 요건은 2년. 1993년 심판례(당시 3년)를 현재 기준처럼 서술 |
| G3-10 | 2020-12-31 | 응답 | **FAIL 후보** | **"보유기간 3년" 사실 오류** — 2020년 요건은 보유 2년(+조정지역 거주 2년) |
| G3-11~18, 20 | — | E-VERIFY-FAIL | 보류 | 미응답(차단) |
| G3-19 | 2020-07-31 | E-VERIFY-FAIL | 보류 | 미응답(차단) |

**제안 집계: PASS 후보 1건 / FAIL 후보 4건 / 보류(차단·정답미달) 15건**

### G-3 구조적 원인 진단

1. **과거 시행본 미검색**: 국세법령 API는 현행 조문만 반환 → targetDate 클라이언트 필터
   (TAX-6A-4)가 동작해도 "과거에 시행되던 조문"은 애초에 검색 풀에 없음.
   과거 시점 질의에서 T1 직접 근거가 구조적으로 0건.
2. **비법령 유사사례 의존의 시점 위험**: T1이 비면 오래된 심판례가 인용되고, LLM이
   그 속의 폐기된 기준(보유 3년 등)을 targetDate 기준인 양 요약 — G3-09·10에서 실측.
3. **시점 라벨 비결정성**: explicit targetDate에도 `[현행]`이 부착된 사례 2건(G3-01·08).
   TAX-050 결정 트리의 회귀 의심 — 단, 모수 7건 중 2건으로 재현율 추가 측정 필요.

---

## 검수 중 발견된 시스템 버그 (수정 적용함)

### BUG 후보: pg DATE 컬럼 → Date 객체 미정규화 (운영 500 유발)

- **증상**: `/api/answer`가 `TypeError: (b.decisionDate ?? "").localeCompare is not a function`로
  500. 실측에서 G4-04, G3-01, G3-08, G3-19 등 4건 크래시.
- **원인**: `taxlaw_embeddings`의 `decision_date`·`revision_date`·`enforcement_date`가
  SQL `DATE` 타입 → pg 드라이버가 **JS Date 객체**로 반환 → 도메인 `TaxLaw`는 문자열 기대 →
  벡터 fallback 결과가 참고 목록 정렬(`generateAnswer.ts` buildReferences)에 들어가면 크래시.
- **수정**: `src/adapters/vectorSearch.ts` `rowToTaxLaw`에 `toIsoDateString` 정규화 추가
  (Date → 'YYYY-MM-DD'). 어댑터의 "외부 I/O 정규화" 책임 범위 내 최소 수정.
- **검증**: tsc 통과, vitest 468/468 통과, 크래시 4건 재실행 시 전부 정상 동작.
- **후속**: 정식 BUG 티켓 번호 부여 및 단위 테스트 추가는 회계사 승인 후 별도 티켓 권장.

---

## 회계사 결정 요청 사항

1. **G-4 expectedStatus 반영 승인** — 제안값(PASS 17 / FAIL 3)을 `golden_hallucination.json`에
   기록할지, FAIL 후보 3건(G4-03·04·06)을 직접 재확인할지.
2. **G-3 처리 방향** (선택지 2개):
   - **A. 보류 (추천)**: 과거 시행본 검색이 안 되는 현 구조에서는 G-3 채점이 무의미.
     "법령 연혁 API(시행일자별 조회)" 연동 티켓을 먼저 진행 후 재실행.
     - 장점: 구조 문제를 풀고 나서 채점해야 골든셋이 의미를 가짐. 단점: Phase 6A 완결 지연.
   - **B. 현 상태로 FAIL 기록**: 현재 시스템의 한계를 골든셋에 그대로 박제.
     - 장점: 회귀 기준선 확보. 단점: 구조 개선 전까지 G-3가 항상 빨간불(노이즈).
3. **서술 결함(거짓 전제 수용) 대응** — V6 강화 또는 SYSTEM_PROMPT에 "질문의 전제를
   검증 없이 되풀이하지 말 것" 추가하는 별도 티켓(TAX-6A-8 후보) 발행 여부.

---

## 회계사 결정 반영 결과 (2026-06-11)

회계사 결정: **1) G-4 반영 / 2) G-3 A안 / 3) TAX-6A-8 발행**. 처리 내역:

### 1. G-4 반영 (`golden_hallucination.json`)

- `version` `2026-06-11-draft` → `2026-06-11`, `_draft` 해제.
- **PASS 17건**: `expectedStatus: "PASS"` 기록 → `run_golden.test.ts`에 정적 편입(17건 신규).
- **FAIL 3건(G4-03·04·06)**: ⚠️ **정적 V1~V6로는 FAIL 표현 불가**(verifier가 거짓 전제
  수용을 검출 못 함 — 빈/정상 answer 모두 V1~V6 PASS 반환). `expectedStatus`를 `"FAIL"`로
  박으면 `expect(result.status).toBe('FAIL')`이 깨지고 의미상으로도 틀림. 따라서 회계사
  FAIL 판정은 **보존하되 정적 러너에서 분리**:
  - `expectedStatus: ""` (run_golden 제외)
  - `_semanticVerdict: "FAIL"`, `_failCategory: "거짓 전제 수용 …"`, `_followupTicket: "TAX-6A-8"`
  - 즉 3건의 FAIL은 **TAX-6A-8의 동적 검증으로 위임**(결정 3과 정합).
- 전 케이스에 `_reviewedAt`·`_liveOutcome`(E-VERIFY-FAIL/ANSWERED) 추적 메타 부착.
- 검증: `npx vitest run` 485/485 PASS(기존 468 + G-4 17건), 회귀 0건.

### 2. G-3 A안 — 보류 (`golden_temporal.json`)

- `version` draft 유지, `expectedStatus` **전건 무변경**(빈 채 — run_golden 제외).
- `description`에 보류 사유(과거 시행본 미검색 구조적 한계)·`TAX-6A-9` 선행 명기,
  `_hold` 메타 부착.

### 3. 후속 티켓 발행

- **TAX-6A-8** `docs/tickets/TAX-6A-8_false_premise_defense.md` — 거짓 전제 수용 방어
  (SYSTEM_PROMPT 전제 검증 지침 + V6 보강/V7 신규). 결정 3 "정확성에 도움" 조건 충족 판단.
- **TAX-6A-9** `docs/tickets/TAX-6A-9_law_history_api.md` — 법령 연혁 API(시행일자별 조회)
  연동. G-3 구조 해결의 전제(결정 2 A안의 "선행 티켓").

> 참고: `vectorSearch.ts` DATE 버그의 정식 BUG 티켓·단위 테스트는 아직 미발행
> (회계사 별도 지시 대기). 코드 수정·회귀 검증은 이미 적용·통과 상태.

---

## 파일 변경 목록

- `src/adapters/vectorSearch.ts` (수정) — DATE 정규화 버그 수정
- `eval/golden_hallucination.json` (수정) — G-4 검수 반영(PASS 17 + FAIL 3 메타)
- `eval/golden_temporal.json` (수정) — G-3 보류 명기
- `docs/tickets/TAX-6A-8_false_premise_defense.md` (신규)
- `docs/tickets/TAX-6A-9_law_history_api.md` (신규)
- `scripts/golden/reviewPhase6a.ts` (신규) — 1차 검수 배치 스크립트 (임시)
- `docs/reports/phase6a_review_temporal.json` (신규) — G-3 실측 원시 결과
- `docs/reports/phase6a_review_hallucination.json` (신규) — G-4 실측 원시 결과
- `docs/reports/PHASE6A-REVIEW_report.md` (신규) — 본 리포트
- `eval/golden_temporal.json` · `eval/golden_hallucination.json` — 회계사 승인(2026-06-11) 후 반영 완료(위 "회계사 결정 반영 결과" 참조)

## 검증 결과

1. `npx tsc --noEmit` — 통과
2. `npx vitest run` — 468/468 PASS (회귀 0건)
3. `npx eslint src/adapters/vectorSearch.ts` — 0 errors
4. 크래시 케이스 4건 재실행 → 전부 정상 응답 확인
