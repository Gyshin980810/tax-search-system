# TAX-030 틀린 케이스 → 골든셋 환류 구조 (운영 단계 설계 초안)

> 운영 중 발생한 "틀린 답변"을 수집해 골든셋으로 환류(feedback loop)하여 같은 실수의
> 재발을 막는 구조. **설계 초안(향후 작업)** — 즉시 구현이 아니라 Phase 4 이후 운영 단계에
> 진입할 때를 위한 계획 문서다.
>
> ⚠️ **두 대원칙(이 티켓 전체를 지배):**
> 1. **정답 확정은 항상 회계사** — 수집·골격화는 자동이어도 `summary`·`expectedStatus` 정답은
>    회계사가 확정(자기참조 채점 오류 금지, CLAUDE.md §2 / TAX-028과 동일).
> 2. **개인정보는 수집 첫 단계부터 차단** — PII 마스킹·식별자 제거 없이는 한 건도 저장하지 않는다
>    (CLAUDE.md §7, SSOT §7.8).

---

## Metadata

- **Type**: FEAT (운영 인프라)
- **Severity**: major (운영 정확도 지속 개선의 핵심 경로)
- **Layer**: usecase | adapter | ui | infra
- **Milestone**: Post-MVP (운영 단계 — Phase 4 이후 점진 도입)
- **Estimated Size**: L (3덩이로 분할 권장 — §9)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작
- RAG [4] 검증에서 FAIL이 나면 `E-VERIFY-FAIL`로 "확인 어려움"을 안내하지만, **그 케이스는 휘발**된다
  (재현·분석·골든셋 환류 경로 없음).
- 회계사가 답변을 보고 "이건 틀렸다"고 느껴도 **시스템에 알릴 수단이 없다**(silent failure가 그대로 묻힘).
- 골든셋(`eval/golden_direct.json`)은 회계사가 **수동으로 떠올려** 작성할 뿐, 실전 오류가 자동으로 쌓이지 않는다.

### 1.2 기대 동작
- **자동 수집:** 검증 FAIL(특히 재시도 후에도 실패한 `E-VERIFY-FAIL`) 케이스를 PII 마스킹 후 후보 큐에 적재.
- **사람 피드백:** 회계사가 답변 화면에서 "👎 신고"(+사유)로 **검증을 통과했지만 틀린** 케이스를 적재.
- **환류:** 수집 후보 → 골격화(`buildCases` 재활용) → **회계사 검수(정답 확정)** → `golden_direct.json` 머지 →
  CI 회귀로 영구 박제(FR-18 연계). 같은 실수가 재발하면 PR 단계에서 차단.

### 1.3 영향·중요도
- 골든셋이 "정확도를 지키고(회귀 방지) 약점을 드러내는" 도구임을 전제로, 본 구조는 **약점을 자동으로 모아주는 공급선**이다.
- 특히 **silent failure(검증 통과한 오답)**는 가장 위험한데(회계사가 의뢰인 보고서에 인용 가능), 자동 탐지가 불가능해
  **사람 피드백 경로가 유일한 수집 수단**이다 → 본 티켓의 핵심 가치.

---

## 2. Context (기술적 맥락)

### 2.1 재사용 가능한 기존 자산
- `src/usecases/generateAnswer.ts` — RAG [4] 검증·재시도·`E-VERIFY-FAIL` 발생 지점(수집 훅 위치 후보).
- `src/adapters/lawVerifier.ts` — `VerificationResult`(어떤 V가 실패했는지) 제공.
- `src/utils/piiFilter.ts`(`detectPii`) — 입력 PII 거부. 수집 시 한 번 더 마스킹/필터에 재사용.
- `scripts/logger.js` + `logs/`(`.gitignore` 처리됨) — 로깅 인프라.
- `scripts/golden/buildCases.ts` (TAX-028) — 후보 → 케이스 골격(원문 자동 채움, summary `__TODO__`).
- `eval/golden_direct.json` + `tests/golden/run_golden.test.ts` — 환류 종착지·회귀 게이트.

### 2.2 아키텍처 힌트
```
[자동] generateAnswer [4] FAIL/E-VERIFY-FAIL
          └→ harvestWrongCase(케이스, 마스킹) ──┐
[사람] UI "👎 신고" → /api/feedback ───────────┤
                                               ▼
                                   logs/wrong_cases/*.json (PII 마스킹·식별자 제거)
                                               │  (회계사 주기 검토)
                                               ▼
                        scripts/golden/harvestToSeeds.ts → golden_seeds.json 후보
                                               │  buildCases.ts (TAX-028 재사용)
                                               ▼
                        golden_direct.draft.json → 회계사 검수(정답 확정) → golden_direct.json
                                               ▼
                                   CI 회귀(run_golden.test.ts) — 재발 차단 (FR-18)
```

### 2.3 개인정보 처리 (설계 제약)
- 질문 원문에 주민·사업자번호 패턴이 있으면 **수집 거부**(`detectPii` 재사용).
- 회계사 식별자(이메일·이름·IP)는 **저장 금지**. 피드백은 익명 + 사유 텍스트만.
- 휴대폰·이메일이 본문에 있으면 **마스킹 후** 저장(`010-****-****`, `u***@d***`).

---

## 3. Scope (작업 범위) ⭐

### 3.1 허용 (분할 구현 시 — §9)
- [ ] 수집 훅: `generateAnswer`의 FAIL/`E-VERIFY-FAIL` 지점에서 마스킹된 케이스 적재(로그/큐).
- [ ] 피드백 API + UI 버튼: `app/api/feedback/route.ts` + 답변 화면 "👎 신고"(사유 입력).
- [ ] 환류 스크립트: `scripts/golden/harvestToSeeds.ts`(수집물 → 시드 후보) — `buildCases` 연결.
- [ ] 문서: `eval/GOLDEN_SET_GUIDE.md`에 "운영 환류" 절 추가.

### 3.2 금지
- ❌ **정답(`summary`·`expectedStatus`·라벨) 자동 생성** — 회계사 확정 전 골든셋 머지 금지.
- ❌ **PII·회계사 식별자 저장** — 마스킹/익명화 없는 수집 금지.
- ❌ RAG 5단계 압축·생략, 검증[4] 우회 (수집은 검증 *이후* 부가 동작).
- ❌ 수집 후보(draft)를 검수 없이 회귀 게이트(`golden_direct.json`)에 직접 편입.
- ❌ 본 티켓에서 전체 일괄 구현(§9대로 단계 분할·회계사 승인 후 진행).

---

## 4. Strategy (구현 힌트)
1. **수집 스키마 먼저:** `{ id, source: 'verify-fail'|'feedback', question(마스킹), sourceLawsRef, failedChecks?, reason?, ts }`.
2. **1단계(저비용) 먼저:** 자동 수집 훅 + 로그 적재만. 회계사가 월 1회 검토(KPI §17.1 "월 1회 표본 검수"와 연계).
3. **2단계:** 피드백 버튼/API(silent failure 수집) — UI E2E 시나리오 추가.
4. **3단계:** `harvestToSeeds.ts`로 후보 → `golden_seeds.json` → `buildCases`(TAX-028) → 검수 → 머지.
5. **편향 방지:** FAIL 케이스(자동)만 쌓이면 "이미 아는 약점"에 치우침 → **피드백 버튼을 반드시 포함**해 모르는 약점(silent failure)을 수집.

---

## 5. Acceptance Criteria (단계별)
1. [ ] (1단계) `E-VERIFY-FAIL` 발생 시 PII 마스킹된 케이스가 `logs/wrong_cases/`에 적재되고, 식별자가 포함되지 않음.
2. [ ] (2단계) 답변 화면 "👎 신고" → `/api/feedback`로 케이스 적재(익명·사유 텍스트만).
3. [ ] (3단계) `harvestToSeeds.ts`가 수집물을 `golden_seeds.json` 후보로 변환 → `buildCases`로 골격 생성(summary `__TODO__`).
4. [ ] 수집 어느 경로에서도 정답이 자동 확정되지 않음(머지 전 회계사 검수 필수).
5. [ ] PII·식별자 미저장 단위 테스트 통과.
6. [ ] 기존 골든셋 회귀 그린 유지.

---

## 6. Verification (검증 단계 — 회계사)
1. 의도적으로 검증 FAIL을 유발(존재하지 않는 조문 질의) → `logs/wrong_cases/`에 마스킹 케이스 적재 확인.
2. PII 포함 질의 → 수집 거부 확인.
3. 정상 답변에 "👎 신고" → 익명 케이스 적재 확인(식별자 없음).
4. `harvestToSeeds` → `buildCases` → draft의 `summary`가 `__TODO__`인지 확인.
5. 검수·머지 후 회귀 그린 확인.

---

## 7. Risks / Notes
- **편향 함정:** 자동(FAIL)만 모으면 "아는 약점"에 치우침 → 사람 피드백(silent failure) 경로 필수.
- **자기참조 오염:** 정답 자동생성 시 "AI가 틀린 답을 모아 AI가 정답으로 박제" → §3.2 절대 금지.
- **개인정보:** 수집은 PII 사고가 가장 쉬운 지점. 마스킹·익명화를 설계 1단계부터 박을 것.
- **노이즈:** 피드백 남용·중복 → 중복 제거·임계치·회계사 검토 게이트로 완충.
- **PRD/SSOT 정합:** 본 구조를 정식 기능으로 승격 시 PRD에 FR 신설(예: FR-21 가칭)·SSOT 반영 필요 → 별도 정합 티켓(STOP & ASK, 임의 FR 부여 금지).

---

## 8. AI Implementation Instructions
### 8.1 코딩 전: 단계(1/2/3) 중 어디부터 할지 회계사 결정 + 영향 파일 + 계획 → 승인 후 착수.
### 8.2 코딩 후: 변경 파일 / 요약 / 검증 PASS·FAIL / PII 미저장 증명 / `docs/reports/TAX-030_report.md`.

---

## 9. 분할 제안 (L → 3 서브티켓)
| 서브 | 내용 | 의존 | 비용/위험 |
|---|---|---|---|
| **TAX-030-A** | 자동 수집 훅 + `logs/wrong_cases/`(PII 마스킹) | — | 낮음 (기존 인프라) |
| **TAX-030-B** | 피드백 버튼/API(silent failure 수집, 익명) | A | 중간 (UI+API+E2E) |
| **TAX-030-C** | `harvestToSeeds.ts` 환류 + `buildCases` 연결 + 검수 머지 흐름 | A(B) | 중간 (TAX-028 연계) |

> 권장 진입 순서: A(저비용·즉효) → C(환류 완성) → B(UI 여력 시). 단, **silent failure 가치가 크므로 B를 너무 미루지 말 것.**

---

## 10. Related Tickets
- 기반/재사용: `TAX-028`(골든셋 작성 보조 — `buildCases`·`status`), `TAX-012`(law-verifier·E-VERIFY-FAIL).
- 연계 FR: **FR-18**(골든셋 회귀 테스트 자동화) — 본 구조의 종착(회귀 박제).
- 상위 정합(승격 시): PRD §15(골든셋)·§17.1(KPI 월 1회 검수)·§14(개인정보), SSOT §7.8(로그 마스킹).

---

## 11. Report Link
Report: `docs/reports/TAX-030_report.md` (미작성 — 향후 구현 시)

---

**작성자**: AI 초안 (회계사 검토 대기 · 향후 운영 단계 작업)
**작성일**: 2026-05-23
**최종 수정일**: 2026-05-23
