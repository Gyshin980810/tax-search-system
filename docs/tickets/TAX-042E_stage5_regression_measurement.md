# TAX-042E Stage 5 — 100회 회귀 측정 (TAX-042A~D 종합 효과 검증)

> 작성자: AI(Claude Opus 4.7) / 작성일: 2026-06-07
> 배경: TAX-042A~D (Stage 1~4) 처방을 모두 적용한 후, 종합 효과를 100회 cyclic 측정으로 검증한다. 1회 측정 = 약 19.6시간 소요이므로 백그라운드 실행 후 다른 작업 병행.
> 전략: TAX-042 5단계 처방 중 **Stage 5 (회귀 검증)**. Pass rate ≥ 95%, V3 실패율 ≤ 5%, 누적 P95 < 28s를 목표.
>
> **풀세트 보강 (2026-06-07 갱신, korean-law-mcp 인사이트)**:
> - **H. citations 변동성 정량화** — 동일 케이스 5개 × 5회 반복 = 25회 별도 batch 측정. citations 개수 표준편차로 LLM 비결정성 정량 (korean-law-mcp `risk-rules.ts:333 computeRiskScore` 정신 적응)
> - **I. Stage 3 retry 로그 집계** — `measureP95.ts`에 재시도율·빈 응답율·Rate Limit율 카운터 추가. 운영 안정성 지표를 표준 측정에 포함

---

## Metadata

- **Type**: TASK (회귀 측정 / 효과 검증)
- **Severity**: major (Phase 4 게이트 합격 판정)
- **Layer**: scripts (perf:p95) / 운영
- **Milestone**: Post-MVP (TAX-042 마무리)
- **Estimated Size**: S (스크립트 실행 + 리포트 작성, 코드 변경 없음)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작 (Stage 1~4 적용 직후 가정)

- Stage 1: catch 분기 세분화 적용 — 에러 분류 가능
- Stage 2: citations.max(5) — G-S-법인-06 단건 3/3 통과
- Stage 3: maxTokens + 재시도 — TIMEOUT 케이스 단건 측정 ≥ 7/9 통과
- Stage 4: V3 라벨 결정 표 — VERIFY-FAIL 케이스 단건 측정 ≥ 7/9 통과

각 Stage의 단건 측정은 통과했으나, **100회 cyclic 호출 시 누적 효과**는 미검증.

### 1.2 기대 동작

100회 정식 측정 결과:

| 지표 | 측정 전 (TAX-041 7차) | Stage 5 목표 | Phase 4 게이트 |
|---|---|---|---|
| Pass rate | 88/100 (88%) | **≥ 95/100** | 70/100 (기 통과) |
| V1 (출처 존재) 실패율 | 0% | **유지 (0%)** | 운영 적합 |
| V2 인용 무결성 실패 | 1.9% (summary만) | **≤ 1%** (citation 0% 유지) | 운영 적합 |
| V3 (라벨) 실패율 | 13.5% | **≤ 5%** | - |
| V4 (시점) 실패율 | 0% | **유지** | - |
| V5 (면책) 실패율 | 0% | **유지** | - |
| V6 (단정 표현) 실패율 | 1% | **유지 또는 감소** | - |
| 누적 P95 | 24.66s | **< 28s** (재시도 영향 흡수) | < 15s (별도 결정) |
| 평균 응답 시간 | 36.04s (이상치 포함) | **≤ 22s** | - |
| 단계별 P95 (answer) | 23.82s | **≤ 22s** | - |
| **(보강 H)** citations 표준편차 (5케이스 × 5회) | 미측정 | **평균 ≤ 1.0** | - |
| **(보강 I)** Stage 3 재시도율 | 미측정 | **≤ 10%** | - |
| **(보강 I)** Stage 3 빈 응답율 | 미측정 | **≤ 2%** | - |
| **(보강 I)** Stage 3 429 Rate Limit율 | 미측정 | **≤ 3%** | - |

### 1.3 영향·중요도

- TAX-042 처방 묶음의 **최종 합격 판정**
- 누적 P95 합격선 미달 시 → 회계사 결정 (합격선 재정의 vs TAX-043 별도 최적화 티켓)
- 합격 시 Phase 4 (TAX-026-B~) 코딩 착수 게이트 통과 (P95 외 모든 항목 통과 가정 시)

---

## 2. Context (기술적 맥락)

### 2.1 관련 스크립트

- `scripts/perf/measureP95.ts` — 100회 측정 스크립트 (TAX-029) — **(보강 I)** retry/empty/429 카운터 추가
- `scripts/perf/measureVariance.ts` — **(보강 H)** 신규: 5케이스 × 5회 = 25회 batch 측정 + citations 표준편차 산출
- `package.json` — `perf:p95` 명령 (n=100 cyclic), `perf:variance` 명령 (n=5×5) 신규
- `docs/reports/TAX-042E_p95_after_remediation_<date>.json` — 측정 결과 백업 (자동)
- `docs/reports/TAX-042E_variance_<date>.json` — **(보강 H)** 변동성 측정 결과
- `docs/reports/TAX-029_p95_baseline_2026-06-05.json` — 비교 기준선 (TAX-041 7차)

### 2.2 측정 환경

- 골든셋: `eval/golden_direct.json` 40건 (G-1~G-5 + G-N1~N4 + G-S-* 31건)
- 사이클: 40건 × 2.5회 = 100회 cyclic
- 합격선:
  - 누적 P95 < 15_000ms (TAX-029 기존 합격선 — 회계사 재정의 가능)
  - V1~V6 통과율 ≥ 95% (Stage 5 신규 목표)
- 외부 의존: OpenAI API, 국세법령정보시스템 API

### 2.3 백그라운드 실행 패턴

```powershell
# Bash tool의 run_in_background로 실행
npm run perf:p95

# 완료 시 자동 알림 — 폴링·sleep 금지
```

---

## 3. Scope (작업 범위) ⭐ 가장 중요

### 3.1 허용되는 변경

- [ ] `npm run perf:p95` 백그라운드 실행
- [ ] 측정 결과 파일 백업 및 비교 분석
- [ ] `docs/reports/TAX-042E_report.md` 작성
- [ ] `docs/reports/TAX-042_summary_report.md` 작성 (TAX-042A~E 종합 리포트)
- [ ] 메모리 `project_tax042_complete.md` 작성
- [ ] [[tax029-040-041-complete]] 메모리 업데이트 (Phase 4 게이트 상태)
- [ ] **(보강 H)** `scripts/perf/measureVariance.ts` 신규 작성 (5케이스: G-S-법인-06·G-S-소득-03·G-S-부가-01·G-1·G-N1, 각 5회)
- [ ] **(보강 H)** `package.json`에 `"perf:variance": "tsx scripts/perf/measureVariance.ts"` 추가
- [ ] **(보강 H)** `npm run perf:variance` 실행 (약 5시간 소요) → citations 개수 표준편차 산출
- [ ] **(보강 I)** `scripts/perf/measureP95.ts`에 카운터 추가:
  - `retryCount` (Stage 3 재시도 발생 횟수)
  - `emptyResponseCount` (보강 A 분기 발생 횟수)
  - `rateLimitCount` (보강 D 429 분기 발생 횟수)
- [ ] **(보강 I)** raw 로그 JSON 출력에 위 카운터 컬럼 추가 + 리포트에서 비율 산출

### 3.2 금지되는 변경

- ❌ Stage 1~4 추가 코드 변경 (회귀 측정 중 변경 금지 — 측정 무효화)
- ❌ 측정 합격선 임의 완화 (회계사 결정 사항)
- ❌ V1~V6 검증 규칙 변경 (CLAUDE.md §6.4 절대 금지)
- ❌ 골든셋 케이스 추가·제거 (측정 일관성)
- ❌ Stage 1~4가 모두 완료되지 않은 상태에서 측정 시작
- ❌ **(보강 H)** 변동성 측정 케이스를 골든셋과 다른 외부 케이스로 변경 (측정 비교 일관성 보호)
- ❌ **(보강 I)** 카운터 추가가 기존 P95 계산 로직에 영향을 주지 않도록 격리 (raw 로그 컬럼 추가만)

---

## 4. Strategy (구현 힌트)

1. **선행 확인**:
   - [ ] TAX-042A~D 모두 머지 완료
   - [ ] 단위·통합 테스트 모두 통과
   - [ ] 단건 측정 결과 정상 (각 Stage acceptance criteria 통과)
   - [ ] `npm run build`·`npm run lint` 통과
   - [ ] OpenAI API 키 유효성 확인 (`config.openaiApiKey`)
   - [ ] 국세법령 API 키 유효성 확인 (`NATIONAL_TAX_API_KEY`)
2. **측정 시작**:
   ```powershell
   npm run perf:p95
   ```
   - `Bash` tool의 `run_in_background: true`로 실행
   - 약 19.6시간 소요 예상
3. **측정 중 다른 작업** (병행 가능):
   - TAX-042 종합 리포트 초안 작성
   - Phase 4 (TAX-026-B~) 설계 검토
   - 메모리 정리
4. **측정 완료 후 분석**:
   - raw 로그에서 에러 패턴 분류 (Stage 1의 분기 세분화로 정확한 원인 파악 가능)
   - V1~V6 항목별 실패율 비교 (TAX-041 7차 대비)
   - 누적 P95·단계별 P95 비교
   - Pass rate 비교
5. **합격 판정**:
   - 모든 합격 기준 충족 → Phase 4 게이트 통과 보고
   - 일부 미달 → 회계사 결정 요청 (합격선 재정의 vs TAX-043 추가)
6. **리포트 작성**:
   - 측정 결과 표 + 비교 분석
   - Stage별 효과 분리 분석 (가능한 범위 내)
   - 잠재 위험·후속 작업 권고

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] 100회 측정 완료 (12건 이하 에러 — Pass rate ≥ 88% 보장)
2. [ ] Pass rate ≥ 95/100
3. [ ] V1 실패율 0% 유지
4. [ ] V2 citation 실패율 0% 유지, summary 실패율 ≤ 1%
5. [ ] V3 실패율 ≤ 5%
6. [ ] V4·V5 실패율 0% 유지
7. [ ] V6 실패율 ≤ 1%
8. [ ] 누적 P95 < 28s (재시도 영향 흡수 마진 포함)
9. [ ] `docs/reports/TAX-042E_report.md` 작성 완료 (측정 결과 + 비교 + 합격 판정)
10. [ ] `docs/reports/TAX-042_summary_report.md` 작성 완료 (Stage 1~5 종합)
11. [ ] `project_tax042_complete.md` 메모리 작성
12. [ ] **(보강 H)** 변동성 측정 25회 완료, 5케이스별 citations 표준편차 평균 ≤ 1.0
13. [ ] **(보강 I)** Stage 3 재시도율 ≤ 10%, 빈 응답율 ≤ 2%, 429 율 ≤ 3% 모두 통과
14. [ ] **(보강 I)** `docs/reports/TAX-042E_variance_<date>.json` 생성 및 리포트 §3에 변동성·운영지표 별도 절 추가

---

## 6. Verification (검증 단계)

1. 측정 시작 전 사전 점검:
   - 모든 Stage 1~4 통합 테스트 통과
   - OpenAI/국세법령 API 키 유효
   - 디스크 여유 공간 확인 (raw 로그 백업용)
2. 측정 결과 확인:
   - `docs/reports/TAX-042E_p95_after_remediation_<date>.json` 생성 확인
   - raw 로그에서 에러 인덱스·케이스·에러 종류(`E-LLM-SCHEMA`·`E-LLM-NETWORK` 등 Stage 1의 분기) 식별
3. 비교 분석:
   - TAX-041 7차 baseline 대비 모든 지표 비교
   - 단계별 P95 (rewrite·search·answer·verify) 변화 보고
4. 회계사 보고:
   - 합격 시: Phase 4 진입 권고
   - 미달 시: 미달 항목별 권고안 (재시도 백오프 단축, 합격선 재정의, TAX-043 등)

---

## 7. Risks / Notes (위험·주의사항)

- **위험 1 (가장 큼)**: ⚠️ 누적 P95가 합격선(15s) 또는 Stage 5 목표(28s)를 초과 가능
  - **원인**: Stage 3의 재시도 1회 추가 + Stage 2의 SYSTEM_PROMPT 길이 증가
  - **완화책**:
    - 합격선 < 28s 미달 시: Stage 3 백오프 500ms → 200ms 단축 검토
    - 합격선 < 15s 미달 시: 회계사와 합격선 재정의 협의 (Phase 4 P95에서 통합 처리 가능)
- **위험 2**: 측정 19.6시간 동안 OpenAI API 장애·rate limit이 발생하면 측정 무효화
  - **완화책**: 측정 시작 시각·종료 시각 기록, 이상치 인덱스 식별 후 회귀 평가
- **위험 3**: Stage 4 효과 미미 (V3 실패율 > 5%) — 비결정성 누적
  - **완화책**: TAX-043 (`runTwoStage` → `runThreeStage` 확장) 별도 티켓 발행
- **위험 4**: G-S-법인-06이 여전히 실패 — citations.max(5)가 부족했음
  - **완화책**: Stage 2 citations.max(7) 또는 골든셋 분할 결정
- **위험 5**: 측정 중 사용자 PC 재부팅·네트워크 끊김 → 측정 중단
  - **완화책**: 백그라운드 실행 + 안정적 네트워크 환경 확보. 재시작 시 처음부터 재측정
- **위험 6 (보강 H)**: 변동성 측정 25회 추가로 약 **5시간 추가 소요** (단건 평균 12분 기준)
  - **완화책**: 100회 측정과 변동성 측정을 **순차 실행** (동시 실행 시 OpenAI rate limit 충돌). 총 약 24.6시간 예상 → 시간 확보 후 시작
- **위험 7 (보강 I)**: 카운터 추가가 raw 로그 JSON 스키마를 깨면 기존 백업 비교 불가
  - **완화책**: 새 컬럼은 모두 옵션(`?`), 누락 시 0으로 처리. 비교 스크립트가 새 컬럼 없을 때 graceful degrade
- **주의**: 측정 1회 = 약 19.6시간 (TAX-041 7차 기준 70,590s). 시간 여유 확보 후 시작
- **주의**: 측정 중 코드 변경 절대 금지 — 측정 결과 무효화
- **주의 (보강 H·I)**: 변동성 측정·카운터 추가는 **100회 측정 시작 전** 코드에 반영. 측정 시작 후에는 어떤 코드 변경도 금지

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] Stage 1~4 모든 합격 기준 통과 확인 보고
- [ ] 측정 시작 예정 시각 회계사 보고 (19.6시간 후 완료 예상)

→ **인간 승인 후** 측정 시작

### 8.2 측정 완료 후 제출할 것

- [ ] 100회 측정 raw 로그 (자동 백업)
- [ ] 에러 인덱스·케이스·에러 종류 분류 표
- [ ] V1~V6 항목별 실패율 (TAX-041 7차 대비 비교)
- [ ] 누적 P95·단계별 P95 비교
- [ ] 합격 판정 (PASS/FAIL/조건부)
- [ ] 후속 작업 권고 (TAX-043 또는 합격선 재정의 등)
- [ ] 리포트 파일: `docs/reports/TAX-042E_report.md`
- [ ] 종합 리포트: `docs/reports/TAX-042_summary_report.md`
- [ ] 메모리: `project_tax042_complete.md`

---

## 9. Ticket Size Rule

- 변경 파일: 2개 (`scripts/perf/measureP95.ts` 보강 I 카운터, `scripts/perf/measureVariance.ts` 보강 H 신규)
- 논리적 변경: 측정 2회 실행 (100회 cyclic + 25회 variance)
- 예상 소요: 24.6시간 (100회 19.6h + 25회 5h 순차) + 3~4시간 (리포트 작성)

---

## 10. Related Tickets

- **선행**: TAX-042A (Stage 1), TAX-042B (Stage 2), TAX-042C (Stage 3), TAX-042D (Stage 4)
- **후속 (조건부)**: TAX-043 (Stage 3 확장 또는 P95 최적화), Phase 4 (TAX-026-B~)
- **참조**: [[tax029-040-041-complete]] TAX-041 7차 baseline, [[tax026-phase4-design]] Phase 4 게이트, `docs/reports/TAX-029_p95_baseline_2026-06-05.json`

---

## 11. Report Link

Report:
- `docs/reports/TAX-042E_report.md` (미작성)
- `docs/reports/TAX-042_summary_report.md` (미작성)

---

**작성자**: AI (Claude Opus 4.7)
**작성일**: 2026-06-07
**최종 수정일**: 2026-06-07
