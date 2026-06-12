# TAX-6A-9 법령 연혁 API 연동 (시행일자별 과거 시행본 조회)

> 발행 근거: Phase 6A 골든셋 1차 검수(PHASE6A-REVIEW_report.md)에서 G-3 시점 검색이
> 구조적으로 실패(과거 시행본 미검색, T1 직접근거 0건, 13/20 E-VERIFY-FAIL) 확인.
> 회계사 결정: 2026-06-11 (결정 2 — A안: G-3 보류 후 본 티켓 선행).

---

## Metadata

- **Type**: FEAT
- **Severity**: major
- **Layer**: adapter (+ usecase)
- **Milestone**: Post-MVP (Phase 6A)
- **Estimated Size**: M~L (분할 검토)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- 국세법령정보시스템 API(www.law.go.kr/DRF/)는 **현행 조문만** 반환한다.
- TAX-6A-4의 `targetDate` 클라이언트 필터는 "검색된 조문의 시행일자"로 거를 뿐,
  애초에 **과거에 시행되던 조문(개정 전 버전)이 검색 풀에 들어오지 않는다.**
- 결과: 과거 시점 질의에서 T1 직접근거가 구조적으로 0건. 비법령 유사사례에 의존하다
  **폐기된 옛 기준을 현재 기준처럼 서술**하는 사실 오류 발생(G3-09·10 "보유 3년" 실측).

### 1.2 기대 동작

- targetDate가 주어지면 해당 시점에 **시행 중이던 조문 원문**을 조회한다.
- 예: "2017년 법인세율" → 2018년 개정 전 3구간(10/20/22%) 시행본을 T1으로 인용.
- G-3 골든셋 20건이 T1 직접근거 기반으로 채점 가능해진다.

### 1.3 영향·중요도

- Phase 6A 합격선(시점 정확도 ≥95%)을 충족하기 위한 **전제 조건**. 본 티켓 없이는
  G-3 채점 자체가 무의미(현 구조에서 항상 빨간불).
- 회계사가 과거 귀속연도 사안(경정청구·소급 적용)을 다룰 때 직접 사용.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/adapters/nationalTaxLaw.ts` (시행일자별 조회 파라미터·연혁 엔드포인트 추가)
- `src/domain/SearchQuery.ts` / `src/domain/TemporalContext.ts` (시점 전달 구조)
- `src/usecases/generateAnswer.ts` (시점 검색 분기)
- `eval/golden_temporal.json` (연동 후 재실측·expectedStatus 확정)

### 2.2 외부 API·리소스

- 국세법령정보시스템 OPEN API — **법령 연혁/시행일자별 조회** 지원 여부 선(先)조사 필요.
  - 후보: 법령 본문 조회 시 `시행일자`·`이력` 파라미터, 또는 연혁 목록 API.
  - 문서: https://www.law.go.kr/DRF/openapi.do
  - 인증: 기존 `NATIONAL_TAX_API_KEY` 재사용(추가 키 불필요 — TAX-6A-1 진단 정합).
- **선조사 결과가 "미지원"이면** 대체 설계(스냅샷 적재·부칙 파싱)를 별도 검토.

### 2.3 아키텍처 힌트

```
targetDate 有 → nationalTaxLawAdapter.searchAsOf(date) → 해당 시점 시행본 T1 반환
              → generateAnswer가 T1 기반 답변 + [적용 시점] 라벨
```

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [ ] (1단계) 법령 연혁/시행일자별 조회 API 지원 여부 **진단 리포트** 선작성
- [ ] `src/adapters/nationalTaxLaw.ts`에 시행일자 기준 조회 메서드 추가
- [ ] usecase 시점 분기 연결
- [ ] `eval/golden_temporal.json` 재실측 후 expectedStatus 확정(회계사 승인 후)

### 3.2 금지되는 변경

- ❌ 진단 없이 구현 착수(외부 API 지원 여부 불명 — STOP & ASK 원칙)
- ❌ 법령 원문 가공·요약 저장
- ❌ 현행 검색 경로(targetDate 없는 질의) 동작 변경
- ❌ 골든셋 expectedStatus AI 자동 확정(§8.1)

---

## 4. Strategy (구현 힌트)

1. **진단 먼저(필수)**: API가 시행일자별 본문을 주는지 1~2개 조문(법인세법 제55조)으로
   실측. 지원되면 어댑터 확장, 미지원이면 대체안(시점 스냅샷 DB 적재)을 티켓 분할.
2. 지원 시: `searchAsOf(query, date)` → 응답의 시행일자 검증 → T1 매핑.
3. G-3 재실측: `reviewPhase6a.ts temporal` 재실행 → T1 인용율·시점 정확도 측정.
4. 회계사 검수 후 `golden_temporal.json` expectedStatus 일괄 확정 → run_golden 편입.

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] (선) 법령 연혁 API 지원 여부 진단 리포트 제출 → 회계사 방향 승인
2. [ ] targetDate 질의에서 해당 시점 시행본이 T1으로 인용됨(최소 G3-01·02·07·08 검증)
3. [ ] G-3 재실측 시 시점 정확도 측정값 리포트
4. [ ] 현행 질의(현 시점) 회귀 0건, vitest 전체 GREEN

---

## 6. Verification (검증 단계)

1. 진단 스크립트로 법인세법 제55조 2017년/2019년 시행본 조회 → 세율 구간 상이 확인
2. `scripts/golden/reviewPhase6a.ts temporal` 재실행 → T1 인용 건수 증가 확인
3. 회계사: G-3 응답의 시점 라벨·세율값 정확성 육안 검수
4. `npx vitest run` 전체 통과

---

## 7. Risks / Notes

- **API 미지원 가능성**: 국세 OPEN API가 시행일자별 본문을 제공하지 않으면 본 티켓은
  "시점 스냅샷 적재"라는 더 큰 작업으로 전환 → 진단 후 재산정.
- 부칙·경과조치(T2)와의 정합 필요(시점 분기 시 부칙 우선 — CLAUDE.md §6.2).
- G3-09·10 사실 오류는 본 티켓로 T1 확보 시 자연 해소 예상.

---

## 10. Related Tickets

- 선행: `TAX-6A-1`(지방세 API 진단 — 동일 접근), Phase 6A 검수(PHASE6A-REVIEW)
- 연관: `TAX-6A-4`(targetDate 클라이언트 필터 — 본 티켓이 검색 풀 확장으로 보완)
- 후속: G-3 expectedStatus 확정, G-3 합격선(≥95%) 재측정

---

## 11. Report Link

Report: `docs/reports/TAX-6A-9_report.md` (미작성)

---

**작성자**: Claude Code (회계사 승인 발행, 2026-06-11)
**작성일**: 2026-06-11
**최종 수정일**: 2026-06-11
