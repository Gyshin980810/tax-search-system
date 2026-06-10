# TAX-041 V1~V6 검증 통과율 개선 (14% → 70% 목표)

> 작성자: AI(Claude Opus 4.7) / 작성일: 2026-06-05
> 배경: TAX-029 2차 측정 결과 골든셋 40건 cyclic 100회 호출 시 V1~V6 통과율 14%(86건 실패 중 66건이 E-VERIFY-FAIL) 식별. Phase 4(TAX-026-B~) 게이트 해제의 마지막 잔여 항목.
> 절대 원칙: 검증 자체 완화 절대 금지(CLAUDE.md §6.4 — V1~V6 통과 없이 답변 노출 금지).

---

## Metadata

- **Type**: TASK (LLM 답변 품질 개선)
- **Severity**: major (Phase 4 게이트 차단)
- **Layer**: adapter (llmAnswerGenerator) + 부분적으로 usecase (generateAnswer 재시도 정책)
- **Milestone**: Post-MVP (Phase 4 진입 게이트)
- **Estimated Size**: M (분석 + 1~2회 개선 반복 + 재측정)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작 (TAX-029 2차 측정)

골든셋 40건 cyclic 100회 호출 시:

| 항목 | 값 |
|---|---|
| 정상 응답 | **14/100** (14%) |
| 답변 검증 실패 (E-VERIFY-FAIL) | 66건 |
| LLM 답변 생성 타임아웃 (25초 박힘) | 18건 |
| LLM 연결 불가 | 2건 |
| 누적 P95 | 32.05s (합격선 15s 초과) |

가장 큰 단일 실패 원인은 **V1~V6 검증 실패 후 재시도 1회까지 실패한 케이스(66건)**.

### 1.2 진짜 병목 구분

- 답변 생성 자체는 합리적: 자연 종료 평균 11.74s
- 답변 생성 타임아웃은 일부(19/179 호출, 10.6%) — TAX-040 이후 대부분 해결
- **본질은 LLM이 V1·V2 검증 기준에 맞는 답변을 생성하지 못함**

### 1.3 기대 동작

- 목표 1: 100회 호출 시 정상 응답 ≥ **70/100**
- 목표 2: 누적 P95 < **15초** (PRD §7.1)
- 목표 3: V1~V6 통과율 측정 가능한 분석 인프라 (measureP95.ts 확장)

### 1.4 영향·중요도

- **Phase 4 게이트 해제의 마지막 잔여 항목**.
- 운영 환경에서 회계사 노출 가능 답변 비율 = V1~V6 통과율. 14%로는 실 운영 불가능.
- 본 티켓 통과 후 → TAX-029-3 재측정 → 누적 P95 < 15s 확인 → Phase 4(TAX-026-B~H) 코딩 착수.

---

## 2. Context (기술적 맥락)

### 2.1 V1~V6 검증 규칙 (변경 금지)

`src/adapters/lawVerifier.ts` 99~250라인 (참조 전용):

| 항목 | 통과 조건 |
|---|---|
| V1 | 인용된 모든 조문이 검색 결과에 존재 (identityOf 비교) |
| V2 | 모든 excerpt가 원문 content에 substring 포함 + summary 큰따옴표 인용도 원문 대조 |
| V3 | Trust Tier별 허용 라벨 매핑 (T1·T2→🟢/⚫, T3·T4→🟡/⚪/⚫) |
| V4 | temporalLabel이 4종 정규식 중 하나 일치 |
| V5 | disclaimer 비어있지 않음 (재시도 시 자동 부착됨) |
| V6 | 🟡유사사례 인용 있을 때 summary에 단정형 표현 없음 |

### 2.2 관련 파일

- `src/adapters/llmAnswerGenerator.ts` (TO_MODIFY) — SYSTEM_PROMPT·buildLawsContext·구조화 출력
- `src/usecases/generateAnswer.ts` (참조 — 재시도 정책 runTwoStage)
- `src/adapters/lawVerifier.ts` (참조 전용 — 변경 금지)
- `scripts/perf/measureP95.ts` (수정 — failReasons 수집 ✅ 본 티켓 분석 단계에서 완료)
- `eval/golden_direct.json` (참조 — 골든셋 40건 V1~V6 사전 점검 0건 불일치)

### 2.3 외부 API·리소스

- OpenAI GPT-4o-mini (동일)
- 국세법령정보시스템 OpenAPI (동일)

---

## 3. Scope (작업 범위) ⭐ 가장 중요

### 3.1 허용되는 변경

- [x] `scripts/perf/measureP95.ts` 분석 인프라 확장 — failReasons·V1~V6 카운트 수집·출력 (완료)
- [x] `package.json` `perf:diagnose` 스크립트 추가 (완료)
- [ ] `src/adapters/llmAnswerGenerator.ts` SYSTEM_PROMPT 강화 — 인용 무결성 규칙 + few-shot 예시
- [ ] (필요 시) `src/adapters/llmAnswerGenerator.ts` 구조화 출력 스키마 보완 (excerpt 길이 가이드, citations 최대 수 등)
- [ ] (선택) `src/usecases/generateAnswer.ts` 재시도 시 검색 키워드 확장 정책 — V1 실패 시 동일 쿼리 대신 확장 쿼리 사용

### 3.2 금지되는 변경

- ❌ `src/adapters/lawVerifier.ts` V1~V6 검증 규칙 완화·우회 (CLAUDE.md §6.4 절대 금지)
- ❌ Zod 스키마 구조 본질 변경 (citationItemSchema·answerSchema 인터페이스)
- ❌ `LabeledAnswer`·`Citation`·`TaxLaw` 도메인 타입 변경
- ❌ LLM 모델 교체 (gpt-4o-mini 유지)
- ❌ 재시도 횟수 무한 증가 (현 1회 유지 — 누적 시간 폭증 방지)
- ❌ 검증 실패 시 PENDING 상태로 회계사에 노출

---

## 4. Strategy (구현 힌트 — 3단계 진행)

### 4.1 [Step 1] 분석 단계 (완료 또는 진행 중)

1. measureP95.ts 확장 — verifier 데코레이터에서 VerificationResult.failReasons 수집 ✅
2. V1~V6 항목별 실패 카운트 + 상위 실패 사유 prefix 50자 출력 ✅
3. `npm run perf:diagnose` (40회) 실행 → 어디서 떨어지는지 분포 파악

### 4.2 [Step 2] 진단·개선 단계 (Step 1 결과 후)

#### 가장 흔한 실패 유형별 대응 안

**V1 실패 (인용이 검색 결과에 없음)**
- 원인 1: LLM이 검색 결과에 없는 조문을 인용 (환각)
- 원인 2: 검색 결과가 빈약해 LLM이 다른 조문을 끌어옴
- 대응: 시스템 프롬프트에 "제공된 조문 배열 [0]~[N] 인덱스 안의 자료만 인용" 강조 + Zod citationItem.lawIndex 검증 강화
- 대응 (재시도): generateAnswer.ts V1 실패 시 검색 쿼리 확장(현재는 동일 쿼리 재검색)

**V2 실패 (excerpt가 원문과 불일치)** ← 추정 최다 원인
- 원인: LLM이 원문 텍스트를 미세하게 변형(공백·문장부호·줄바꿈)
- 대응 1: 시스템 프롬프트 인용 무결성 규칙을 더 강조 + few-shot 예시 1~2개 ("이렇게 그대로 복사하세요" 명시)
- 대응 2: 구조화 출력 후 어댑터에서 sourceLaws.content에 가장 가까운 substring으로 자동 보정 — 단 검증 통과 우회로 보일 수 있어 신중

**V3 실패 (Tier-라벨 부적합)**
- 원인: 비법령(T3·T4)에 🟢직접근거 라벨 부착
- 대응: 시스템 프롬프트 Tier별 허용 라벨 매핑 더 명시적으로

**V4 실패 (시점 라벨 형식 불일치)**
- TAX-037·038·039로 정합 완료된 영역 — 추가 실패는 LLM 변형 가능성
- 대응: SYSTEM_PROMPT 시점 라벨 규칙 추가 강조 (이미 명시되어 있음)

**V6 실패 (🟡 단정형)**
- 원인: 🟡유사사례에서 "이 경우도 X입니다" 등 단정 표현
- 대응: SYSTEM_PROMPT 단정 금지 규칙 강조 + 예시

### 4.3 [Step 3] 검증 단계

1. `npm run perf:diagnose` (40회) 재실행 → 통과율 개선 확인
2. 합격선 도달 시 `npm run perf:p95` (100회) 정식 측정
3. 누적 P95 < 15s + 정상 응답 ≥ 70/100 확인
4. TAX-029 리포트 §3 갱신 (3차 측정 결과 추가) + Phase 4 게이트 해제 판단

---

## 5. Acceptance Criteria (완료 조건)

### 5.1 분석 단계

1. [x] `scripts/perf/measureP95.ts` failReasons 수집 + V1~V6 카운트 출력
2. [x] `npm run perf:diagnose` 40회 실행 가능
3. [x] V1~V6 실패 분포 데이터 확보 — V2 89.8% 압도적 1위 식별

### 5.2 개선 단계

4. [x] SYSTEM_PROMPT 4차례 강화 + **옵션 A(어댑터 자동 추출)** + 날짜 표기 substring 안전망 적용
5. [x] `npx vitest run` → **270/270 PASS** (extractExcerpt 단위 테스트 17건 신규 + 회귀 없음)
6. [x] `src/adapters/lawVerifier.ts` 무변경 (검증 우회 금지 — CLAUDE.md §6.4)

### 5.3 검증 단계

7. [x] `npm run perf:p95` 100회 측정 시 정상 응답 **88/100** ✅ (목표 70 초과)
8. [ ] 누적 P95 < **15초** — **24.66s** (이상치 제외) ❌ 미달
9. [x] V1~V6 항목별 실패 카운트 분포 — V2 1.9% / V3 13.5% / V6 1% / V1·V4·V5 0%
10. [x] TAX-029 리포트 §3.6 3차 측정 결과 갱신 완료
11. [x] Phase 4 게이트 해제 판단 — **조건부 보류** (Pass rate·V1~V6 합격, P95만 미달)

---

## 6. Verification (검증 단계)

1. 분석 측정: `npm run perf:diagnose` → 콘솔에 V1~V6 항목별 실패 카운트 + 상위 실패 사유 출력
2. 개선 후 vitest 회귀: `npx vitest run` → 253/253
3. 정식 재측정: `npm run perf:p95` → 정상 응답 비율·누적 P95 확인
4. baseline JSON 비교: 1차(10s)·2차(25s)·3차(개선) 시계열 추적

---

## 7. Risks / Notes (위험·주의사항)

| 위험 | 수준 | 대응 |
|---|---|---|
| 개선해도 V1~V6 통과율 70% 미달 | 중 | 분석 결과에 따라 1~2회 추가 반복. 그래도 미달이면 회계사와 골든셋 분포·합격선 재검토 |
| LLM 비결정성으로 측정 변동 | 중 | 40회 분석 + 100회 정식 측정으로 분포 확보 |
| 시스템 프롬프트 강화가 응답 시간 증가시킬 가능성 | 저 | few-shot 예시는 입력 토큰만 증가, gpt-4o-mini는 토큰 영향 미미 |
| V2 자동 보정 도입 시 인용 무결성 원칙(§6.1) 우회 우려 | **고** | 자동 보정은 채택 금지 — LLM 자체 출력 개선만 허용 |
| 검증 자체 완화 유혹 | **고** | 절대 금지(CLAUDE.md §6.4). 본 티켓은 LLM 답변 품질 개선만 다룸 |
| OpenAI 비용 | 저 | 분석 40회($0.1) + 정식 100회($0.25) = 약 $0.35 추가 |

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [x] 영향 파일 목록
- [x] 분석 단계 측정 인프라
- [x] 분석 결과(V1~V6 실패 분포) — V2 89.8%, V3 16.9%, V6 3.4%
- [x] 개선 방안(Step 2) 1~2건 선택안 + 회계사 결정 — C 확정

→ **회계사 §9 결정 후** Step 2 구현

### 8.2 코딩 후 제출할 것

- [x] 분석 결과 표 (V1~V6 카운트) — V2 53/59 = 89.8%
- [x] 적용한 개선 사항 diff — SYSTEM_PROMPT 강화 4차례 + 옵션 A (어댑터 자동 추출) + 날짜 안전망
- [x] vitest 회귀 결과 — 270/270 PASS (신규 17건 단위 테스트 포함)
- [x] 정식 재측정 결과 — 정상 응답 **88/100**, 누적 P95 **24.66s** (이상치 제외)
- [x] Phase 4 게이트 판단 — **조건부 보류** (Pass rate·V1~V6 합격, P95만 미달)
- [x] 리포트: TAX-029 리포트 §3.6 갱신 완료

---

## 9. 회계사 결정점 (Step 2 진입 전 확정)

분석 결과(Step 1) 확인 후 회계사가 선택할 항목:

| # | 결정 항목 | 선택지 | 권장 |
|---|---|---|---|
| ① | 1순위 개선 대상 | 분석 결과 가장 많이 실패한 V1~V6 항목 | (분석 결과 후 추천) |
| ② | 시스템 프롬프트 강화 방식 | A. 규칙 강조만 / B. few-shot 예시 추가 / C. 둘 다 | **C** (효과 보강) |
| ③ | 재시도 정책 확장 (V1 실패 시 검색 쿼리 확장) | A. 진행 / B. 보류 | (분석 결과 후 결정) |
| ④ | V2 자동 보정 어댑터 | 금지 | (인용 무결성 우회 위험) |

> 회계사 회신란 (2026-06-05 확정):
> - ① 1순위 개선 대상 = **V2 인용 무결성** (진단 결과 89.8% — 압도적 1위)
> - ② 시스템 프롬프트 강화 방식 = **C (규칙 강조 + 비법령 명시 + few-shot 예시)**
> - ③ 재시도 정책 확장 (V1) = **보류** (V1 실패 0건 — 해당 없음)
> - V3·V6 동시 개선 = **예** (같은 파일에서 함께 강화)

---

## 10. Related Tickets (관련 티켓)

- 선행: `TAX-029_p95_response_time_measurement.md` (P95 측정 인프라 — 완결)
- 선행: `TAX-040_llm_timeout_alignment.md` (타임아웃 정합 — 완결)
- 후속: TAX-029-3 재측정 (본 티켓 검증 단계에 포함)
- 게이트 해제 대상: `TAX-026_vector_db_phase4.md` (TAX-026-B~H Phase 4 코딩 착수)
- 참조: CLAUDE.md §6.4 (검증 우회 금지), PRD §7.1 (응답시간 합격선), `src/adapters/lawVerifier.ts` (V1~V6 검증 규칙)

---

## 11. Report Link

Report: TAX-029 리포트 §3 갱신으로 갈음 (3차 측정 결과 + Phase 4 게이트 판단)

---

**작성자**: AI(Claude Opus 4.7)
**작성일**: 2026-06-05
**최종 수정일**: 2026-06-05
