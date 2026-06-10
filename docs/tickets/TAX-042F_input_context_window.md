# TAX-042F — 입력 컨텍스트 윈도우 초과 처리 (G-S-법인-06 결정적 결함 직접 해결)

> 작성자: AI(Claude Opus 4.7) / 작성일: 2026-06-07
> 배경: TAX-042B 단건 실측에서 G-S-법인-06(법인세법 시행령 제19조, ~4000자/24호)의 진짜 실패 원인이 **입력 컨텍스트 윈도우 초과**임이 진단됨. Stage 2(`citations.max(5)`)·Stage 3(`maxTokens·retry`)는 출력 측면 처방으로 입력 측면 결함 해결 불가.
> 진단 근거: `cause=AI_APICallError: Your input exceeds the context window of this model.` (TAX-042B 리포트 §3.1)

---

## Metadata

- **Type**: TASK (답변 품질 결정적 결함 직접 해결)
- **Severity**: major (100% 재현되는 실패 케이스, 회계사 신뢰도 직접 영향)
- **Layer**: adapter (llmAnswerGenerator) + 필요시 usecase 보조
- **Milestone**: Post-MVP (TAX-042 처방 묶음, **Stage 2 이후 최우선**)
- **Estimated Size**: M (2~4파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

`generateAnswer` usecase가 검색 결과(`TaxLaw[]`)를 그대로 `buildLawsContext`로 직렬화해 LLM 프롬프트에 삽입. 거대 콘텐츠 케이스(법인세법 시행령 제19조 등)에서:

| 측정 | 결과 |
|---|---|
| G-S-법인-06 단건 3회 (TAX-042B) | 3/3 FAIL, `cause=AI_APICallError: Your input exceeds the context window of this model.` |
| 7차 100회 회귀 (TAX-029) | G-S-법인-06 발생 3건 모두 E-LLM-UNAVAILABLE |
| GPT-4o-mini 컨텍스트 윈도우 | 128K 토큰 input / 16K 토큰 output |

### 1.2 기대 동작

- 검색 결과 콘텐츠 사이즈를 사전 추정해 임계 초과 시 자동 축약 또는 분할 처리
- LLM 호출 진입 전에 입력 토큰을 안전 한도 내로 보장
- 회계사가 G-S-법인-06 패턴(거대 시행령 조문) 질의 시 정상 답변 수신

### 1.3 영향·중요도

- **회계사 신뢰도 직격**: G-S-법인-06 같은 시행령류 거대 조문은 실무에서 빈번. 100% 재현 실패가 노출되면 시스템 신뢰 큰 타격.
- **확장 위험**: 법인세법·소득세법 시행령 내 거대 조문 다수 존재. 골든셋 확장 시 동일 패턴 케이스가 추가될 가능성 매우 큼.
- **TAX-042 전체 효과 좌우**: 본 결함이 해결되지 않으면 Stage 3·4·5의 효과 측정도 G-S-법인-06이 노이즈로 작용.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/adapters/llmAnswerGenerator.ts:90-118` — `buildLawsContext` (조문 직렬화)
- `src/adapters/llmAnswerGenerator.ts:241-261` — `generate` 정상 경로 (LLM 호출 진입점)
- `src/adapters/llmAnswerGenerator.ts:121-138` — `extractExcerpt` (어댑터 측 발췌 — 옵션 A 패턴, 본 티켓에서 재활용 가능성)
- `src/usecases/generateAnswer.ts:169-` — 검색 결과 전달부 (입력 사이즈 사전 추정 추가 위치 후보)
- `eval/golden_direct.json:764+` — G-S-법인-06 케이스 (참조)

### 2.2 외부 제약

- GPT-4o-mini: input 128K / output 16K 토큰. tiktoken 한국어 추정 비율 약 1.5~2 토큰/한글자
- 4000자 한글 콘텐츠 ≈ 6000~8000 토큰 (단일 조문은 윈도우 내 충분)
- 따라서 G-S-법인-06 실패 원인은 **단일 조문이 아니라 검색 결과 다수 조문 누적**일 가능성 매우 큼 — TAX-042F §3에서 즉시 확인 필요

### 2.3 아키텍처 힌트

```
[2] searchPort → TaxLaw[] (개수·content 합산 크기 불확정)
       ↓
[입력 사이즈 추정 — 신규]
       ├─ 안전 한도 내 → 기존 buildLawsContext 그대로
       └─ 초과 → 축약 전략 적용:
             (a) Trust Tier 우선순위로 일부 제외 (T1·T2만 유지)
             (b) 조문별 content 발췌 (현 extractExcerpt 사전 적용)
             (c) 또는 분할 호출 + 결과 통합 (M2.5 복잡도)
       ↓
[3] LLM 답변 생성
```

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [ ] `src/adapters/llmAnswerGenerator.ts` — 입력 사이즈 추정·축약 로직 추가 (정상 경로 try 블록 내부 또는 직전)
- [ ] **또는** `src/usecases/generateAnswer.ts` — 검색 결과 전달 직전 사전 축약 (계층 분리 관점에서 더 깔끔할 수도)
- [ ] 입력 토큰 추정 유틸리티 모듈 신규 (`src/adapters/tokenEstimate.ts` 또는 유사)
- [ ] tiktoken 또는 경량 한국어 추정 함수 (외부 의존성 추가 시 신중)
- [ ] 단위 테스트: 임계 미만/초과 케이스, 축약 후 사이즈 검증
- [ ] 단건 실측: G-S-법인-06 × 3회 + 정상 케이스 회귀

### 3.2 금지되는 변경

- ❌ `citationItemSchema`·`answerSchema` 변경 (TAX-042B 결과 보존)
- ❌ SYSTEM_PROMPT 임의 변형 (TAX-042B 우선순위 가이드 보존)
- ❌ `extractExcerpt` 동작 변형 (옵션 A 패턴 보존 — 단, **호출 시점**만 추가 활용 가능)
- ❌ law-verifier V1~V6 우회·완화
- ❌ Stage 3·4·5 처방을 본 티켓에 함께 적용
- ❌ TaxLaw `content` 원문 보존 위반 (저장된 원문 변형 금지, **프롬프트 전달용 임시 변환**만 허용)

### 3.3 도메인 무결성 보호

- 축약·발췌는 **프롬프트 전달 임시본**에만 적용. `TaxLaw[]` 원본은 무변경 (downstream V1·V2 검증이 원문과 대조)
- 축약된 콘텐츠로 답변이 생성되어도 V2(인용 무결성)는 원본 `TaxLaw.content`로 검증 → focusHint 기반 extractExcerpt가 원문에서 정확 substring 추출
- CLAUDE.md §6.1 인용 무결성 보호

---

## 4. Strategy (구현 힌트 — 인간 승인 후 확정)

### 4.1 사전 진단 (반드시 코딩 전)

1. **실측**: G-S-법인-06 검색 결과의 `TaxLaw[]` 길이·각 content 크기·총 직렬화 사이즈 출력 (디버그 로깅 1회 또는 별도 스크립트)
2. 단일 조문이 윈도우 초과인지, 다수 조문 누적이 초과인지 가르기
3. 결과에 따라 전략 선택:
   - 다수 누적 → **Trust Tier 우선순위로 일부 제외** (가장 단순)
   - 단일 초과 → **조문 단위 발췌** (focusHint 사전 적용 또는 키워드 매칭)

### 4.2 후보 전략 (사전 진단 후 선택)

| 전략 | 복잡도 | 적용 시 |
|---|---|---|
| A. Trust Tier 우선순위 컷오프 | 낮음 | 다수 조문 누적 초과 |
| B. 사전 발췌 (질문 키워드 기반 substring 추출) | 중간 | 단일 거대 조문 초과 |
| C. 다단계 호출 (분할 + 통합) | 높음 | A·B로 부족할 때 마지막 카드 |

### 4.3 입력 토큰 추정 방법

- tiktoken JS 포트(예: `js-tiktoken`) 도입 검토 — 정확하지만 의존성 추가
- 또는 **간이 추정**: 한글 1자당 ~2 토큰, 영문 1자당 ~0.3 토큰 가정 → 직렬화 후 char 길이 × 평균 비율
- 안전 마진 30% (시스템 프롬프트 + 질문 + 답변 출력 16K 포함 후 70K 한도 기준 등)

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] G-S-법인-06 단건 측정 3회 시행 시 **3/3 정상 응답 + V1~V6 통과**
2. [ ] 정상 케이스(G-1, G-2, G-N1, G-S-법인-01 각 1회) 단건 측정 시 정상 응답 + 회귀 없음
3. [ ] 단위 테스트: 입력 사이즈 추정·축약 로직 분리 검증
4. [ ] `npm run lint`·`typecheck`·`test`·`build` 모두 PASS
5. [ ] V2 인용 무결성 무변경 — 축약은 프롬프트 임시본에만 적용, 원본 `TaxLaw.content`와 대조 정상
6. [ ] 리포트 작성: `docs/reports/TAX-042F_report.md`

---

## 6. Verification (검증 단계)

1. **사전 진단 산출물**: G-S-법인-06 검색 결과의 조문 개수·content 크기·직렬화 사이즈 측정 결과 (리포트 §1에 포함)
2. `scripts/perf/single.ts` G-S-법인-06 × 3회 PASS
3. 회귀 4종(G-1·G-2·G-N1·G-S-법인-01) 각 1회 PASS
4. V1~V6 통과 (인용 무결성·시점 라벨·라벨 적정성·면책)

---

## 7. Risks / Notes (위험·주의사항)

- **위험 1**: 축약이 회계사에게 노출되는 답변의 정보량을 줄일 수 있음. V1(출처 존재) 자체는 OK이나 summary가 누락된 조문을 참조할 위험
  - 완화책: Trust Tier T1·T2 우선 보존, T3·T4부터 컷오프. summary는 보존된 조문만 참조하도록 SYSTEM_PROMPT 보강 검토
- **위험 2**: 입력 토큰 추정 부정확 시 안전 마진을 너무 보수적으로 잡으면 정상 케이스에도 영향
  - 완화책: 안전 마진 30%부터 시작, Stage 5 100회 회귀에서 정상 케이스 영향 모니터링 후 조정
- **위험 3**: tiktoken 의존성 추가 시 번들 사이즈·빌드 영향
  - 완화책: 간이 추정으로 시작, 정확도 부족 시 도입
- **위험 4**: 검색 단계 자체에서 결과를 너무 많이 반환할 가능성 (search 어댑터의 결과 개수 제한 검토)
  - 별도 티켓 후보: 검색 결과 개수 제한 (예: top-K)
- **주의**: TAX-042B에서 1차 시도에 E-API-UNAVAILABLE 1건 발생. 본 티켓 무관이나 외부 검색 API 안정성은 Stage 5 회귀에서 별도 모니터링 필요
- **주의**: V2 인용 무결성을 절대 위반하지 말 것 — 축약본으로 답변 생성하더라도 인용 원문 대조는 `TaxLaw.content` 원본으로 수행

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] **사전 진단**: G-S-법인-06 검색 결과의 실제 `TaxLaw[]` 크기 측정 결과 → 인간에게 보고
- [ ] 진단 결과 기반 **전략 선택**(A/B/C) + 의사 코드 제시 → 인간 승인
- [ ] 입력 토큰 추정 방법 결정 (간이 vs tiktoken) → 인간 승인

→ **인간 승인 후** 코딩 시작

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록
- [ ] G-S-법인-06 × 3회 단건 측정 결과 (3/3 PASS 기대)
- [ ] 회귀 4건 단건 측정 결과
- [ ] V2 인용 무결성 유지 확인 (원본 대조 정상)
- [ ] 리포트 파일 경로: `docs/reports/TAX-042F_report.md`

---

## 9. Ticket Size Rule

- 변경 파일: 2~4개 (`llmAnswerGenerator.ts`, 신규 유틸 또는 `generateAnswer.ts`, 단위 테스트, 가능 시 검색 어댑터)
- 논리적 변경: 1개 (입력 사이즈 추정 + 축약 전략 적용)
- 예상 소요: 2~4시간

---

## 10. Related Tickets

- **선행**: TAX-042A (Stage 1 catch 분기 — 진단 인프라), TAX-042B (Stage 2 출력 측면 + cause 진단으로 본 결함 발견)
- **후속**: TAX-042C (Stage 3), TAX-042D (Stage 4), TAX-042E (Stage 5)
- **참조**:
  - TAX-042B 리포트 §3.1 진단 결과 (`AI_APICallError: Your input exceeds the context window`)
  - TAX-041 옵션 A `extractExcerpt` 패턴 (재활용 가능성)
  - SSOT §7.6 Trust Tier 정의 (T1·T2 우선 보존 근거)
  - CLAUDE.md §6.1 인용 무결성

---

## 11. Report Link

Report: `docs/reports/TAX-042F_report.md` (미작성)

---

**작성자**: AI (Claude Opus 4.7)
**작성일**: 2026-06-07
**최종 수정일**: 2026-06-07
