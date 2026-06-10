# [TAX-005] Eval Harness 구축 — pass^k = 100% 목표

> 참조: `docs/reports/HARNESS-ENGINEERING-ADOPTION_report.md` 방안 4
> Phase 2 — M3 마일스톤

---

## Metadata

- **Type**: FEAT
- **Severity**: major
- **Layer**: infra
- **Milestone**: Post-MVP
- **Estimated Size**: M (3~5파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- CLAUDE.md에 골든셋 G-1~G-5가 "M3 이후" 예정으로만 언급
- 답변 품질을 정량적으로 측정할 메트릭과 파일이 없음
- 변경 배포 전 기존 답변이 깨지는지 확인하는 회귀 테스트 없음

### 1.2 기대 동작

- `eval/golden-set/` 아래 G-1~G-5 케이스 파일 존재
- 각 케이스는 입력 쿼리 + 검증 항목 + 합격 기준(`pass^k`)으로 구성
- 배포 전 `pass^3 = 100%` 통과 여부를 확인 가능

### 1.3 영향·중요도

- 회계사가 "이 시스템은 일관성 있다"고 신뢰하려면 정량 메트릭이 반드시 필요
- `pass@k`(최소 1회 성공) 대신 `pass^k`(전회 성공) — 세법 답변의 일관성이 핵심

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `eval/golden-set/G-1_basic_deduction.md` (신규)
- `eval/golden-set/G-2_real_estate.md` (신규)
- `eval/golden-set/G-3_corporate_tax.md` (신규)
- `eval/golden-set/G-4_inheritance_timing.md` (신규)
- `eval/golden-set/G-5_local_tax.md` (신규)
- `eval/baseline.json` (신규 — pass^k 기준선 기록)

### 2.2 골든셋 케이스 형식

```markdown
## EVAL: G-N 케이스 제목

### 입력 쿼리
"회계사가 실제로 질문할 법한 자연어 질문"

### 검증 항목 (Capability)
- [ ] Trust Tier T1 또는 T2 인용 포함
- [ ] 시점 라벨 부착 ([현행] 또는 [적용 시점])
- [ ] 의역 0건 (V2 통과)
- [ ] 조문 번호 정확 인용

### 회귀 검증 (Regression)
- [ ] 이전 케이스들(G-1~G-N-1)이 여전히 통과

### 합격 기준
- pass^3 = 100% (3회 모두 성공)
- 1회라도 실패 시 배포 중단
```

### 2.3 메트릭 정의

| 메트릭 | 의미 | 목표값 |
|---|---|---|
| `pass^1` | 1회 성공 | ≥ 80% |
| `pass^3` | 3회 연속 성공 | = 100% |
| `regression` | 기존 케이스 통과 | = 100% |

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [ ] `eval/golden-set/G-1_basic_deduction.md` 신규 생성
- [ ] `eval/golden-set/G-2_real_estate.md` 신규 생성
- [ ] `eval/golden-set/G-3_corporate_tax.md` 신규 생성
- [ ] `eval/golden-set/G-4_inheritance_timing.md` 신규 생성
- [ ] `eval/golden-set/G-5_local_tax.md` 신규 생성
- [ ] `eval/baseline.json` 신규 생성

### 3.2 금지되는 변경

- ❌ `src/` 하위 소스코드 수정
- ❌ `CLAUDE.md` 수정
- ❌ 골든셋 쿼리에 실제 의뢰인 정보 포함 (익명·가상 사례만)
- ❌ 법령 원문 임의 작성 (검증 항목은 원문 존재 여부만 확인)

---

## 4. Strategy (구현 힌트)

1. G-1: 근로소득 기본 공제 — 가장 단순한 T1 직접 근거 케이스
2. G-2: 부동산 양도소득세 — T1 + 시점 분기(취득일·양도일) 포함
3. G-3: 법인세 손금 — T3(예규·해석례) 활용 케이스
4. G-4: 상속세 — 법 개정 전·후 시점 분기 (`[적용 시점]` 라벨 필수)
5. G-5: 재산세(지방세) — 국세와 지방세 혼동 방지 케이스

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `eval/golden-set/` 아래 G-1~G-5 파일 존재
2. [ ] 각 케이스에 입력 쿼리, 검증 항목, 합격 기준 포함
3. [ ] 골든셋 케이스에 실제 개인·사업자 정보 없음
4. [ ] `eval/baseline.json`에 초기 pass^k 기준선 기록
5. [ ] G-4가 시점 라벨 검증 항목을 반드시 포함

---

## 6. Verification (검증 단계)

1. `eval/golden-set/` 폴더에 5개 파일 존재 확인
2. G-4 파일 열어 `[적용 시점: YYYY.MM.DD]` 검증 항목 존재 확인
3. 각 케이스의 합격 기준에 `pass^3 = 100%` 명시 확인
4. 익명·가상 사례 여부 확인 (실제 이름·번호 없음)

---

## 7. Risks / Notes

- 골든셋 케이스는 실제 법령에서 검증 가능한 사례만 포함 — 가상 법령 수치 작성 금지
- 케이스 작성 시 회계사가 검토 필수 (세법 정확성 확인)
- G-5 이후 케이스 추가는 별도 티켓으로 분리

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] G-1~G-5 각 케이스의 검증 항목 초안 (법령 근거 포함)

→ **인간(회계사) 승인 필수** — 세법 정확성 검토 후 파일 생성

### 8.2 코딩 후 제출할 것

- [ ] 생성된 케이스 파일 목록
- [ ] 각 케이스의 핵심 검증 항목 요약
- [ ] 리포트: `docs/reports/TAX-005_report.md`

---

## 10. Related Tickets

- 선행: TAX-004 (tax-verify 스킬 기반으로 케이스 작성)
- 후속: TAX-009 (Observability — 평가 결과 로깅)
- 참조: `docs/reports/HARNESS-ENGINEERING-ADOPTION_report.md` 방안 4

---

## 11. Report Link

Report: `docs/reports/TAX-005_report.md` (미작성)

---

**작성자**: AI (하네스 엔지니어링 보고서 기반)
**작성일**: 2026-05-11
**최종 수정일**: 2026-05-11
