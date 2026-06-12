# TAX-6A-8 거짓 전제 수용 방어 (Summary False-Premise Defense)

> 발행 근거: Phase 6A 골든셋 1차 검수(PHASE6A-REVIEW_report.md)에서 G4-03·04·06이
> "거짓 전제 수용"으로 회계사 FAIL 판정. 이는 V1~V6 정적 검증의 사각지대이므로 별도 티켓.
> 회계사 승인: 2026-06-11 (결정 3 — "정확성에 도움이 된다면 진행").

---

## Metadata

- **Type**: FEAT
- **Severity**: major
- **Layer**: adapter (+ domain)
- **Milestone**: Post-MVP (Phase 6A)
- **Estimated Size**: M (3~5파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- 환각(존재하지 않는 조문·사건번호 인용) 방어는 law-verifier V1~V6가 막아낸다(실측 0건).
- 그러나 **질문에 담긴 거짓 전제를 summary가 사실처럼 되풀이**하는 경우는 검출하지 못한다.
- 실측 사례(G-4):
  - **G4-03**: "연 매출 3억 이하 소매업자는 부가세 전액 면세" → 그런 조항 없음에도 summary가 면세 가능성을 수용.
  - **G4-04**: "3대 가업상속 시 상속세 전액 면제" → '전액 면제' 특례 없음(한도 있는 공제)에도 "면제를 받을 수 있습니다"로 전제 수용.
  - **G4-06**: 상증세법 제53조 인용은 실재하나 "형제자매 간 비과세 범위 명시 안 됨"으로 잘못 서술(실제는 기타친족 1,000만원 공제 존재).
- 인용 자체는 정상(V1 통과)이라 현 검증 체계로는 PASS 처리된다.

### 1.2 기대 동작

- 질문의 전제가 검색된 법령 원문으로 뒷받침되지 않을 때, summary가 그 전제를
  **단정·수용하지 않고** "해당 규정을 찾지 못했습니다 / 전제와 다릅니다"로 명시한다.
- 거짓 전제 수용 패턴을 동적으로 검출하는 검증 축을 추가해 PHASE6A G4-03·04·06이
  FAIL(또는 안전 응답으로 전환되어 PASS)로 일관되게 판정되도록 한다.

### 1.3 영향·중요도

- 회계사가 의뢰인 보고서에 인용하는 답변이다. "전액 면제"·"비과세" 같은 거짓 전제 수용
  1건은 가산세·분쟁으로 직결(CLAUDE.md §2 — 틀린 답은 없는 답보다 나쁘다).
- 환각률 0%(노출 기준)는 달성했으나, **서술 결함률 15%(3/20)**가 남은 정확성 리스크.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/adapters/llmAnswerGenerator.ts` (SYSTEM_PROMPT — 전제 검증 지침 추가)
- `src/adapters/lawVerifier.ts` (V6 보강 또는 V7 신규 검사 함수 검토)
- `src/adapters/verifyDiagnostics.ts` (진단 메시지)
- `eval/golden_hallucination.json` (G4-03·04·06 — 동적 검증 편입 후 expectedStatus 확정)
- `tests/golden/run_golden.test.ts` (동적 케이스 분리 러너 검토)

### 2.2 외부 API·리소스

- 추가 외부 API 불필요. LLM(GPT-4o-mini) 프롬프트 + 규칙 기반 검증 조합.

### 2.3 아키텍처 힌트

```
[3] 답변 생성(SYSTEM_PROMPT 전제 검증 지침)
       ↓
[4] law-verifier (V6 보강 또는 V7 '전제 수용 금지' 신규 검사)
```

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [ ] `src/adapters/llmAnswerGenerator.ts` SYSTEM_PROMPT에 "질문의 전제를 검증 없이
      되풀이·단정하지 말 것. 검색 원문이 전제를 뒷받침하지 않으면 그 사실을 명시" 지침 추가
- [ ] `src/adapters/lawVerifier.ts`에 거짓 전제 수용 검출 로직(V6 확장 또는 V7) 추가 검토
- [ ] `eval/golden_hallucination.json` G4-03·04·06 동적 검증 편입 시 expectedStatus 확정
- [ ] 관련 단위 테스트 추가

### 3.2 금지되는 변경

- ❌ V1~V5 기존 판정 로직 변경(회귀 위험 — TIER_ALLOWED_LABELS 등 단일 진실원천 보호)
- ❌ 법령 원문 가공·요약 저장
- ❌ 정상 응답(직접 근거 있는 답변)을 과잉 차단하는 변경 — 오탐률 측정 필수
- ❌ 골든셋 정답값 AI 자동 확정(회계사 승인 필요, §8.1)

---

## 4. Strategy (구현 힌트)

1. **프롬프트 우선**: SYSTEM_PROMPT에 전제 검증 지침 추가 후 G4-03·04·06 단건 재실측 →
   프롬프트만으로 안전 응답 전환되는지 확인(저비용·저위험 1차 방어선).
2. **검증 축 보강**: 프롬프트로 부족하면 lawVerifier에 "🟢직접근거 없음 + summary가
   질문 키워드(면제/비과세/전액 등)를 단정"하는 패턴 검출 추가. 오탐 방지를 위해
   golden_direct 66건·G-4 PASS 17건에 회귀 0 확인.
3. **동적 케이스 분리**: 거짓 전제 케이스는 라이브 LLM 응답 평가가 필요하므로 정적
   run_golden과 분리된 평가 경로(예: reviewPhase6a 확장) 설계.

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] G4-03·04·06 재실측 시 summary가 거짓 전제를 단정·수용하지 않음(회계사 확인)
2. [ ] golden_direct 66건 + G-4 PASS 17건 회귀 0건(오탐으로 정상 답변이 깨지지 않음)
3. [ ] vitest 전체 GREEN
4. [ ] 거짓 전제 수용 검출 방식·한계를 리포트에 문서화

---

## 6. Verification (검증 단계)

1. SYSTEM_PROMPT 수정 후 `scripts/golden/reviewPhase6a.ts hallucination` 재실행
2. G4-03·04·06 summary 육안 확인 — 거짓 전제 수용 표현 소거 여부
3. `npx vitest run` 전체 통과
4. 회계사: 안전 응답으로 전환된 3건 expectedStatus 최종 확정

---

## 7. Risks / Notes

- **오탐 위험**: "면제/비과세/전액" 키워드 단순 차단은 정상 답변(실제 면제 규정 있는 질의)을
  깨뜨릴 수 있음. 반드시 "직접 근거 부재"와 결합한 조건부 검출로 설계.
- 거짓 전제 검출은 본질적으로 의미 이해 영역 → 규칙 기반만으로 완전 검출 불가.
  프롬프트 1차 방어 + 규칙 2차 방어 + 회계사 최종 판단의 3중 구조 권장.

---

## 10. Related Tickets

- 선행: Phase 6A 골든셋 검수(PHASE6A-REVIEW_report.md)
- 연관: `TAX-051_v3_label_safety_net.md`(어댑터 후처리 패턴 참조), V6 단정 금지(lawVerifier)
- 참조: `eval/golden_hallucination.json` G4-03·04·06 `_followupTicket`

---

## 11. Report Link

Report: `docs/reports/TAX-6A-8_report.md` (미작성)

---

**작성자**: Claude Code (회계사 승인 발행, 2026-06-11)
**작성일**: 2026-06-11
**최종 수정일**: 2026-06-11
