# TAX-6A-10 G-3 시점 골든셋 11건 E-VERIFY-FAIL 근본원인 진단·해소 (이연)

> 이 티켓은 TAX-6A-9(G-3 재구성) 완료 후 남은 11건의 구조적 검증 실패를 별도로 다루기 위해 분리되었습니다.
> 회계사 지시(2026-06-14)로 Phase 6B 착수보다 후순위로 이연합니다.

---

## Metadata

- **Type**: BUG
- **Severity**: minor (운영 무영향 — 골든셋 정량 커버리지 한정)
- **Layer**: adapter | domain (lawVerifier·llmAnswerGenerator·nationalTaxLaw 추정)
- **Milestone**: Later (Phase 6B 이후)
- **Estimated Size**: M (진단 우선, 수정 범위는 진단 결과에 따라 확정)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

`eval/golden_temporal.json`의 G-3 시점 검색 골든셋 20건 중 **11건이 실제 RAG 파이프라인에서 답변 생성 자체에 실패**한다.

- 실패 케이스: **G3-01, 03, 05, 08, 10, 12, 13, 15, 16, 18, 19** (11건)
- 증상: `generateAnswer` 실행 시 law-verifier V1~V6 재시도(1회) 후에도 통과하지 못해 `E-VERIFY-FAIL` 발생 → **답변(citations) 0건 반환**
- 2026-06-14 재실측에서 11건 전부 재현 (8~36초씩 실제 LLM·국세 API 호출, 새 PASS 0건)
- 따라서 골든셋에서 `expectedStatus=''`(draft) 상태로 남아 vitest 정적 검증에 편입 불가

> 현재 G-3 정량 커버리지: **9/20 PASS** (나머지 11건은 _draft 유지). vitest 95/95 GREEN은 9건 + golden_direct 66건 기준으로 유지됨.

### 1.2 기대 동작

11건 각각에 대해 **왜 V1~V6를 통과하지 못하는지 근본원인을 규명**하고,
- (a) 시스템(파이프라인) 결함이면 → 수정하여 정상 답변 생성 → 회계사 검수 후 `expectedStatus='PASS'` 확정
- (b) 질문 자체가 현행 API로 답변 불가한 구조면 → 케이스 폐기 또는 재설계(회계사 승인)

로 정리하여 G-3를 완결한다.

### 1.3 영향·중요도

- **운영 영향 없음**: 실패 케이스는 회계사 화면에 노출되지 않으며(검증 미통과 답변 차단 정상 동작), `run_golden`은 `expectedStatus` 채워진 케이스만 검증한다.
- **품질 측정 영향**: G-3 시점 검색의 정량 회귀 커버리지가 9건으로 제한됨. 일부 실패가 **실제 회계사 질문(예: 세율표 조회)에서도 재현되는 production 결함**일 가능성이 있어 진단 가치가 있음.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `eval/golden_temporal.json` — G-3 골든셋 (11건 `_draft: true`)
- `src/adapters/lawVerifier.ts` — V1~V6 검증 로직 (TEMPORAL_LABEL_PATTERNS, checkV2 인용 무결성)
- `src/adapters/llmAnswerGenerator.ts` — 답변·라벨·시점 생성
- `src/adapters/nationalTaxLaw.ts` — 조문 본문 조립 (세율표 중첩배열 복원 등)
- `scripts/golden/reviewPhase6a.ts` — 재실측 배치 스크립트
- `scripts/diagnostics/debug_always_fail.mjs` — 실패 원인 분류 스크립트 (V1/V2/V4 구분)
- `docs/reports/phase6a_review_temporal.json` — 재실측 원시 결과 (11건 errorCode='E-VERIFY-FAIL')

### 2.2 외부 API·리소스

- 국세법령정보시스템 OpenAPI (`law.go.kr`) — 현행 법령만 반환, 연혁(`enfDate`) 미지원 (TAX-6A-9 진단)
- 환경변수: `NATIONAL_TAX_API_KEY`, `OPENAI_API_KEY`, `DATABASE_URL`

### 2.3 아키텍처 힌트

```
debug_always_fail.mjs → 11건 재실행 → V1/V2/V4 실패 분류
   ↓
원인 유형별 분기:
  V2(인용 무결성) 실패 → nationalTaxLaw 본문 조립(세율표·중첩배열) 또는 excerpt 매칭 점검
  V4(시점 라벨) 실패 → llmAnswerGenerator 시점 라벨 생성 / lawVerifier 패턴 점검
  V1(출처 존재) 실패 → 검색 단계 조문 누락 점검
```

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경 (진단 단계 — 수정은 진단 후 별도 승인)

- [ ] `scripts/diagnostics/` 진단 스크립트 추가·활용 (읽기·분석 전용)
- [ ] 진단 리포트 작성 `docs/reports/TAX-6A-10_report.md`
- [ ] (진단 후 승인 시) 근본원인에 해당하는 어댑터 1개 수정
- [ ] (회계사 승인 후) `eval/golden_temporal.json` 해당 케이스 `expectedStatus` 확정 또는 폐기

### 3.2 금지되는 변경

- ❌ 골든셋 정답(summary·excerpt·temporalLabel)·`expectedStatus`의 **AI 자동 확정** (CLAUDE.md §8.1 — 회계사 승인 필수)
- ❌ 법령 발췌 임의 생성·의역 (§6.1 인용 무결성 — V2 통과를 위해 발췌를 지어내는 것 금지)
- ❌ law-verifier V1~V6 우회·완화로 억지 PASS 만들기 (§6.4)
- ❌ Phase 6B 범위 파일 동시 수정 (1티켓 1범위)

---

## 4. Strategy (구현 힌트)

1. **진단 먼저**: `debug_always_fail.mjs`를 11건 전체로 확장 실행 → 케이스별 V1/V2/V4 실패 유형 표로 정리
2. **유형 군집화**: 동일 원인(예: 세율표 중첩배열 V2 불일치)으로 묶어 공통 결함 식별
3. **시스템 결함 vs 케이스 결함 판정**:
   - 시스템 결함 → 어댑터 수정안 제시 → 회계사 승인 → 수정 → 재실측
   - 케이스 결함(현행 API로 답변 불가) → 폐기/재설계안 제시 → 회계사 승인
4. **회계사 검수**: PASS 확정 케이스만 `merge_g3_answers.mjs`로 병합 → vitest 편입
5. **리포트**: 11건 각각의 최종 처리(수정·폐기·PASS) 기록

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] 11건 각각의 실패 원인(V1/V2/V4 중 무엇인지)이 진단 리포트에 명시됨
2. [ ] 각 케이스가 "시스템 결함" 또는 "케이스 결함"으로 분류됨
3. [ ] 시스템 결함으로 판정된 항목은 수정 후 재실측에서 PASS 또는 명확한 미해결 사유 기록
4. [ ] 회계사 승인된 케이스만 `expectedStatus='PASS'`로 골든셋 편입
5. [ ] vitest `run_golden` 회귀 GREEN 유지 (기존 95건 무손상)
6. [ ] 법령 원문·발췌가 AI에 의해 변형되지 않음 (§6.1)

---

## 6. Verification (검증 단계)

1. `node scripts/diagnostics/debug_always_fail.mjs` 실행 → 11건 실패 유형 출력 확인
2. 진단 리포트 `docs/reports/TAX-6A-10_report.md`에 케이스별 원인·분류 표 확인
3. (수정 시) `node --env-file=.env.local --conditions=react-server --import tsx scripts/golden/reviewPhase6a.ts temporal` 재실측 → 개선 건수 확인
4. `npx vitest run tests/golden/run_golden.test.ts` → GREEN 확인

---

## 7. Risks / Notes (위험·주의사항)

- **LLM 비결정성**: 일부 케이스는 동일 입력에도 PASS/FAIL이 갈릴 수 있음 → "항상 FAIL"과 "간헐 FAIL"을 구분해 기록
- **세율표 V2 위험**: 법인세·소득세 세율표는 중첩배열(ASCII 표)로 조립되어 excerpt 문자단위 일치가 까다로움 (TAX-031/032 연관)
- **억지 PASS 금지**: V2/V4 통과를 위해 발췌·라벨을 손대는 것은 인용 무결성 위반 — 반드시 시스템 수정 또는 케이스 폐기로 해결
- 진단 결과 11건 모두 "케이스 결함"이면 G-3는 9건으로 확정하고 본 티켓을 종결할 수 있음 (회계사 판단)

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것
- [ ] 11건 실패 유형 진단표 (V1/V2/V4)
- [ ] 시스템 결함 vs 케이스 결함 분류
- [ ] 수정 대상 파일·범위 → **회계사 승인 후** 수정 착수

### 8.2 코딩 후 제출할 것
- [ ] 변경 파일 목록·요약
- [ ] 케이스별 최종 처리 결과 (PASS/폐기/미해결)
- [ ] vitest 회귀 결과
- [ ] 리포트: `docs/reports/TAX-6A-10_report.md`

---

## 10. Related Tickets (관련 티켓)

- 선행: `TAX-6A-9_law_history_api.md` (G-3 방안 A 재구성 — 9/20 PASS)
- 연관: `TAX-031_law_matching_accuracy.md`, `TAX-032_article_body_assembly.md` (세율표 조립), `TAX-050_v4_temporal_label_strengthening.md`, `TAX-051_v3_label_safety_net.md`
- 후속: (없음)

---

## 11. Report Link (리포트 연결)

Report: `docs/reports/TAX-6A-10_report.md` (미작성)

---

**작성자**: Claude (AI), 회계사 지시로 분리
**작성일**: 2026-06-14
**최종 수정일**: 2026-06-14
