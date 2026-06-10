# TAX-042D Stage 4 — V3 라벨 결정 규칙 강화 (SYSTEM_PROMPT 라벨 결정 표 명시)

> 작성자: AI(Claude Opus 4.7) / 작성일: 2026-06-07
> 배경: TAX-029/040/041 7차 정식 100회 측정에서 V3 (라벨 적정성) 실패율 13.5%, 40회 진단 측정에서 8.6%. T3·T4 자료에 🟢직접근거 라벨을 잘못 붙이는 패턴 반복. 1회 재생성(`runTwoStage` Stage 2) 후에도 비결정적으로 같은 실수.
> 전략: TAX-042 5단계 처방 중 **Stage 4**. SYSTEM_PROMPT에 "라벨 결정 표"를 명시적으로 추가해 LLM이 sourceType·trustTier로 라벨을 결정론적으로 선택하도록 가이드.
>
> **풀세트 보강 (2026-06-07 갱신, korean-law-mcp 인사이트)**:
> - **E. 기계 가독 진단 마커** — V3 결과를 `LabeledAnswer.diagnostics.verifyMarker: 'VERIFIED' | 'PARTIAL_VERIFIED' | 'LABEL_MISMATCH'` 3단계로 세분화. **V3 PASS/FAIL 판정 로직은 절대 무변경** — 진단 부가 필드만 추가 (korean-law-mcp `errors.ts:10 ErrorCodes`·`verify-citations.ts:131 loose-match warning` 적응)
> - **F. Trust Tier 루즈 매칭 등급** — `tierMatchGrade: 'exact' | 'loose' | 'mismatch'` 3등급 (예: T1→🟢 exact, T1→⚪ loose-안전방향, T3→🟢 mismatch)
> - **G. V3 세부 그룹 진단** — `v3Groups: { labelEnum, tierMapping, deprecation }` (어느 그룹에서 실패했는지 명시. 운영 로그·Stage 5 측정에서 패턴 분석에 활용)
>
> **모든 보강(E·F·G)은 진단 부가 필드만 추가**. V3 검증 PASS/FAIL 결과와 합격선은 CLAUDE.md §6.4에 따라 절대 변경하지 않음. 회계사 화면에 보이는 라벨(🟢🟡⚪⚫)도 무변경.

---

## Metadata

- **Type**: TASK (답변 품질 라벨 결정 가이드 강화)
- **Severity**: major (V3 실패율 13.5%로 Stage 5 합격 영향)
- **Layer**: adapter (llmAnswerGenerator)
- **Milestone**: Post-MVP (TAX-042 처방 묶음)
- **Estimated Size**: S (1~2 파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

| 측정 | V3 실패율 | V6 실패율 |
|---|---|---|
| 100회 (정식) | 13.5% (14건) | 1% (1건) |
| 40회 (진단) | 8.6% (3건) | 5.7% (2건) |

100회 측정 VERIFY-FAIL 3건 (인덱스 25, 70, 86) 중 일부가 V3 누적 실패로 추정.

**실패 패턴**:
- T3 (예규·해석례·심판례) 자료에 🟢직접근거 라벨 부착
- T4 (판례) 자료에 🟢직접근거 라벨 부착
- 1회 재생성 후에도 라벨 결정이 비결정적

**현재 SYSTEM_PROMPT (line 44-52)**:
```
[라벨링 규칙 — 조문 목록의 Trust Tier 기준 엄수]
조문 목록에 표시된 (T1)·(T2)·(T3)·(T4)를 보고 라벨을 결정합니다:
- 🟢직접근거: (T1)(법률·시행령·규칙) 또는 (T2)(부칙·경과조치) 출처만 허용. 단정형 표현 허용.
- 🟡유사사례: (T3)(예규·훈령·고시·심판례·해석례) 또는 (T4)(판례)는 반드시 이 라벨 이하.
  ...
```

이미 가이드가 있으나 LLM이 13.5% 빈도로 위반. → **표 형태로 더 명시적이고 결정론적**으로 제시 필요.

### 1.2 기대 동작

SYSTEM_PROMPT에 "라벨 결정 표" 추가:
- 출처(T1~T4) × 허용 라벨 매핑을 표로 명시
- "❌ 위 표를 어기면 V3 검증에서 즉시 FAIL → 답변 폐기" 경고
- T3·T4 단정형 표현 금지 재강조 (V6 대응)

기대 효과:
- V3 실패율 13.5% → ≤ 5%
- V6 실패율 변화 없음 또는 감소
- **(보강 E·F·G)** 운영·로그에서 실패 원인을 라벨 enum 위반/Tier 매핑 위반/폐지 처리 누락 중 어느 그룹인지 즉시 분류 가능. Stage 5 측정에서 빈도 별 처방 결정 보조

### 1.3 영향·중요도

- Stage 5 합격 기준 (Pass rate ≥ 95%) 달성을 위한 마지막 처방
- V3 비결정성이 해소되면 `runTwoStage` Stage 2 재생성 의존도 ↓ → P95 추가 압축 효과
- V3·V6 라벨 정책은 [[tax029-040-041-complete]] 옵션 A의 보조 가이드. SYSTEM_PROMPT만 건드림 → 회귀 위험 작음

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/adapters/llmAnswerGenerator.ts:32-62` — SYSTEM_PROMPT (특히 line 44-52 라벨링 규칙)
- `src/adapters/lawVerifier.ts` — **V3 PASS/FAIL 판정 로직 무변경**, `LabeledAnswer.diagnostics` 부착만 (보강 E·F·G)
- `src/domain/LabeledAnswer.ts` — **(보강 E·F·G)** `diagnostics?: VerifyDiagnostics` 옵션 필드 추가 (기존 PASS/FAIL과 분리)
- `tests/integration/llmAnswerGenerator.test.ts` (mock 5건 중 T3 케이스 mock 갱신)
- `tests/unit/lawVerifierDiagnostics.test.ts` — **(보강 E·F·G)** 신규 단위 테스트 3건

### 2.2 V3·V6 검증 규칙 (변경 금지)

| 항목 | 통과 조건 |
|---|---|
| V3 | Trust Tier별 허용 라벨 매핑 (T1·T2→🟢/⚫, T3·T4→🟡/⚪/⚫) |
| V6 | 🟡유사사례 인용 있을 때 summary에 단정형 표현 없음 |

### 2.3 라벨 결정 표 (CLAUDE.md §6.3 기준)

| 조문 목록 출처 | 허용 라벨 |
|---|---|
| (T1) 법률·시행령·시행규칙 | 🟢직접근거 또는 ⚫폐지 |
| (T2) 부칙·경과조치 | 🟢직접근거 또는 ⚫폐지 |
| (T3) 예규·해석례·심판례·훈령 | 🟡유사사례 또는 ⚪참고자료 |
| (T4) 판례 | 🟡유사사례 또는 ⚪참고자료 |

---

## 3. Scope (작업 범위) ⭐ 가장 중요

### 3.1 허용되는 변경

- [ ] `src/adapters/llmAnswerGenerator.ts:44-52` — 기존 `[라벨링 규칙]` 섹션 다음에 `[라벨 결정 표]` 섹션 추가
- [ ] `src/adapters/llmAnswerGenerator.ts` — 위 표를 ASCII로 명시 + "표를 어기면 V3 FAIL" 경고
- [ ] `src/adapters/llmAnswerGenerator.ts` — 🟡유사사례 summary 작성 가이드 보강 ("이 케이스도 X입니다" 등 단정형 금지 예시 추가)
- [ ] **(보강 E·F·G)** `src/domain/LabeledAnswer.ts` — `VerifyDiagnostics` 타입 정의 + `LabeledAnswer.diagnostics?: VerifyDiagnostics` 옵션 필드 추가:
  ```typescript
  export interface VerifyDiagnostics {
    verifyMarker: 'VERIFIED' | 'PARTIAL_VERIFIED' | 'LABEL_MISMATCH'  // 보강 E
    tierMatchGrade: 'exact' | 'loose' | 'mismatch'                    // 보강 F
    v3Groups: {                                                        // 보강 G
      labelEnum: 'pass' | 'fail'      // 라벨이 enum 4종 중 하나인가
      tierMapping: 'pass' | 'fail'    // Trust Tier ↔ 라벨 매핑 OK인가
      deprecation: 'pass' | 'fail'    // 폐지 자료에 ⚫ 라벨 강제 OK인가
    }
  }
  ```
- [ ] **(보강 E·F·G)** `src/adapters/lawVerifier.ts` — V3 검증 **로직과 PASS/FAIL 결과는 절대 무변경**. `LabeledAnswer.diagnostics` 부착만 신설:
  - `verifyMarker = (v3Groups 모두 pass) ? 'VERIFIED' : (라벨이 enum이고 폐지 OK) ? 'PARTIAL_VERIFIED' : 'LABEL_MISMATCH'`
  - `tierMatchGrade = (exact 매칭) ? 'exact' : (안전 방향 오분류: T1→⚪) ? 'loose' : 'mismatch'`
- [ ] `tests/integration/llmAnswerGenerator.test.ts` — T3 단독 입력 mock 1건 갱신 → 🟡 라벨 단언
- [ ] **(보강 E·F·G)** `tests/unit/lawVerifierDiagnostics.test.ts` — 신규 단위 테스트 3건:
  - (a) T3 자료 + 🟡 라벨 → `verifyMarker='VERIFIED'`, `tierMatchGrade='exact'`, `v3Groups` 전체 pass
  - (b) T3 자료 + 🟢 라벨 → `verifyMarker='LABEL_MISMATCH'`, `tierMatchGrade='mismatch'`, `v3Groups.tierMapping='fail'`
  - (c) T1 자료 + ⚪ 라벨 (안전 방향 오분류) → `verifyMarker='PARTIAL_VERIFIED'`, `tierMatchGrade='loose'`

### 3.2 금지되는 변경

- ❌ `src/adapters/lawVerifier.ts` V3·V6 **검증 PASS/FAIL 판정 로직** (CLAUDE.md §6.4 절대 금지). 마커 부착만 허용
- ❌ **V3·V6 합격선·통과 조건 완화**. `diagnostics.verifyMarker`는 진단용이며 V3 PASS/FAIL과 무관
- ❌ `citationItemSchema`·`answerSchema` 변경
- ❌ Trust Tier 정의 변경 (`src/domain/TaxLaw.ts`)
- ❌ 라벨 enum (`🟢직접근거`·`🟡유사사례`·`⚪참고자료`·`⚫폐지`) 변경
- ❌ **회계사 화면에 보이는 라벨 표시 변경** (`diagnostics`는 운영·로그 전용)
- ❌ `runTwoStage` 변경 (Stage 3 추가는 별도 티켓)
- ❌ Stage 1·2·3 처방을 본 티켓에 함께 적용

---

## 4. Strategy (구현 힌트)

1. **기존 가이드 유지**: line 44-52는 보존. 그 다음에 표 추가.
2. **표 추가 (의사 코드)**:
   ```
   [라벨 결정 표 — 무조건 이 표를 따를 것]
   | 조문 목록 출처 (T1/T2/T3/T4) | 허용 라벨 |
   |---|---|
   | (T1) 법률·시행령·시행규칙 | 🟢직접근거 (또는 폐지 시 ⚫폐지) |
   | (T2) 부칙·경과조치 | 🟢직접근거 (또는 폐지 시 ⚫폐지) |
   | (T3) 예규·해석례·심판례·훈령 | 🟡유사사례 또는 ⚪참고자료 |
   | (T4) 판례 | 🟡유사사례 또는 ⚪참고자료 |

   ❌ 위 표를 어기면 V3 검증에서 즉시 FAIL → 답변 폐기됩니다.
   ❌ T3·T4 출처에서 summary 작성 시 "이 케이스도 X입니다"·"X로 결정됩니다" 같은
      단정형 표현 금지 (V6 FAIL).
   ✅ T3·T4 출처 인용 시 summary 표현 예시:
      "유사 사례에서는 ... 으로 판단한 바 있습니다"
      "참고가 될 수 있는 자료로 ..."
   ```
3. **few-shot 보강 (선택)**:
   - 부정 예: "(T3) 예규 → 🟢직접근거" → ❌
   - 긍정 예: "(T3) 예규 → 🟡유사사례" → ✅
4. **통합 테스트 갱신**: 기존 5건 중 T3 케이스가 있으면 🟡 라벨 단언 추가, 없으면 신규 mock 1건 추가.

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] SYSTEM_PROMPT에 라벨 결정 표 추가 및 V6 단정형 금지 가이드 보강
2. [ ] `tests/integration/llmAnswerGenerator.test.ts` mock 갱신 1건 통과
   - T3 단독 입력 → 응답 citation의 `label === '🟡유사사례'`
3. [ ] 기존 단위·통합 테스트 회귀 없이 통과
4. [ ] `npm run build`·`npm run lint` 통과
5. [ ] VERIFY-FAIL 케이스 단건 측정:
   - G-S-소득-03 단독 3회 → 정상 응답 ≥ 2/3
   - G-S-부가-02 단독 3회 → 정상 응답 ≥ 2/3
   - G-5 단독 3회 → 정상 응답 ≥ 2/3
   - **종합 ≥ 7/9 통과** (목표)
6. [ ] V3 라벨 적정성 통과율: Stage 5 100회 회귀에서 V3 실패율 ≤ 5%
7. [ ] **(보강 E·F·G)** 신규 단위 테스트 3건 (a)(b)(c) 통과
8. [ ] **(보강 E·F·G)** V3 PASS/FAIL 결과가 본 티켓 전후로 **동일**함을 회귀 측정으로 확인 (diagnostics는 부가 정보일 뿐)
9. [ ] **(보강 E·F·G)** `LabeledAnswer.diagnostics`가 옵션 필드(`?`)로 정의되어 기존 호출부에 영향 없음

---

## 6. Verification (검증 단계)

1. `npm run test` 전체 회귀 없음
2. VERIFY-FAIL 케이스 3개를 각 3회씩 단건 측정 → 7/9 이상 통과
3. T3 자료를 포함하는 다른 케이스(G-N1~N4, G-S-NL-01~04 등)에서 🟢직접근거 라벨이 부착되지 않음을 단건 측정으로 샘플 확인

> 100회 회귀 측정은 Stage 5에서 일괄.

---

## 7. Risks / Notes (위험·주의사항)

- **위험 1**: SYSTEM_PROMPT 길이 ↑ → 입력 토큰 비용 미미하게 ↑ (수익 무관)
- **위험 2**: 강화 가이드가 정상 케이스의 🟢 라벨 판정을 보수화 → 일부 T1·T2에 잘못 🟡 라벨 부착해 V1·V2가 아닌 다른 가이드 위반 가능성 (낮음)
  - **완화책**: 표가 "T1·T2 → 🟢직접근거"를 명시하므로 보수화 가능성 낮음. Stage 5 회귀에서 모니터링
- **위험 3**: Stage 4 효과 미미 시 (V3 실패율 > 5%) Stage 3 추가 (`runTwoStage` → `runThreeStage`) 검토 → 별도 티켓
- **위험 4 (보강 E·F·G)**: `diagnostics` 부착 로직이 V3 PASS/FAIL 판정 코드와 같은 함수 내에 있으면 의도하지 않은 결합 위험
  - **완화책**: `diagnostics`는 V3 검증 함수 외부에서 별도 헬퍼(`computeVerifyDiagnostics(answer, taxLaws)`)로 산출. V3 판정 함수는 read-only 입력
- **위험 5 (보강 E·F·G)**: `diagnostics`를 V3 판정 근거로 오용 (예: 'PARTIAL_VERIFIED'면 통과시키기) → CLAUDE.md §6.4 우회 위험
  - **완화책**: 코드 주석으로 "diagnostics는 진단 전용. V3 판정 PASS/FAIL은 변경 금지" 명시 + lawVerifier.ts의 V3 함수가 diagnostics를 read하지 않음을 단위 테스트로 보장
- **주의**: Stage 2에서 추가한 "citations 5개 우선순위 가이드" 보존 (Stage 4 추가가 덮어쓰지 않도록)
- **주의**: 표는 GPT-4o-mini가 ASCII 표를 파싱 가능한 형태로 작성. 한글 정렬·기호 통일.

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] 변경 후 SYSTEM_PROMPT 전체 의사 코드 제시 (Stage 2 변경분 보존 확인)
- [ ] T3 mock 갱신 테스트 케이스 명세 제시

→ **인간 승인 후** 코딩 시작

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록
- [ ] T3 케이스 mock 테스트 결과
- [ ] VERIFY-FAIL 케이스 9회 단건 측정 결과
- [ ] 리포트 파일 경로: `docs/reports/TAX-042D_report.md`

---

## 9. Ticket Size Rule

- 변경 파일: 5개 (`llmAnswerGenerator.ts`, `lawVerifier.ts`, `LabeledAnswer.ts`, `tests/integration/llmAnswerGenerator.test.ts`, `tests/unit/lawVerifierDiagnostics.test.ts` 신규)
- 논리적 변경: 4개 (SYSTEM_PROMPT 라벨 표 + diagnostics 필드 + computeVerifyDiagnostics 헬퍼 + V3 PASS/FAIL 무변경 보장)
- 예상 소요: 2~3시간 (보강 3건 추가)

---

## 10. Related Tickets

- **선행**: TAX-042A (Stage 1), TAX-042B (Stage 2), TAX-042C (Stage 3) — 같은 파일 순차 편집
- **후속**: TAX-042E (Stage 5 100회 회귀)
- **참조**: CLAUDE.md §6.3 라벨링 시스템, [[feedback_similar_cases]] 유사 사례 라벨링 선호

---

## 11. Report Link

Report: `docs/reports/TAX-042D_report.md` (미작성)

---

**작성자**: AI (Claude Opus 4.7)
**작성일**: 2026-06-07
**최종 수정일**: 2026-06-07
