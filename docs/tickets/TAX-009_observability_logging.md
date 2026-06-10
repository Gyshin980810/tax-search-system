# [TAX-009] Observability — 회계사 신뢰성을 위한 로깅

> 참조: `docs/reports/HARNESS-ENGINEERING-ADOPTION_report.md` 방안 9
> Phase 3 — 운영 안정화

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

- RAG 5단계 각 단계에서 무슨 일이 일어났는지 사후 추적 불가
- V1~V6 검증 결과가 저장되지 않아 실패 패턴 분석 불가
- 회계사가 "이 답변이 어떤 과정으로 나왔는지" 물었을 때 답할 수 없음

### 1.2 기대 동작

- 각 RAG 단계별 로그가 구조화된 JSON으로 기록
- V1~V6 검증 결과(PASS/FAIL/재시도)가 영속 저장
- 개인정보(회계사 식별자, 검색 키워드)는 마스킹 후 저장
- 실패 패턴이 골든셋 케이스(TAX-005)에 자동 추가 가능한 형태

### 1.3 영향·중요도

- "보지 못하면 보안할 수 없다" — ECC Security Guide §Observability
- 회계사가 답변 근거를 요청할 때 투명하게 제공 가능
- 실패 케이스 누적 → 골든셋 개선 → 품질 향상 선순환

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/utils/logger.ts` (신규 생성 — 구조화 로거)
- `src/types/logEvent.ts` (신규 생성 — 로그 스키마 타입)
- `docs/logging-schema.md` (신규 생성 — 로그 스키마 문서)

### 2.2 로그 스키마

```typescript
interface TaxSearchLogEvent {
  timestamp: string;         // ISO 8601, KST
  session_id: string;        // UUID
  phase: 'plan' | 'search' | 'generate' | 'verify' | 'output';
  input_query_hash: string;  // SHA-256 해시 (원본 저장 금지)
  model_used: string;        // 사용된 모델 ID
  verification?: {
    V1: 'PASS' | 'FAIL';
    V2: 'PASS' | 'FAIL';
    V3: 'PASS' | 'FAIL';
    V4: 'PASS' | 'FAIL';
    V5: 'PASS' | 'FAIL';
    V6: 'PASS' | 'FAIL';
    retry_count: number;
    final_status: 'PASS' | 'PASS_AFTER_RETRY' | 'FAIL';
  };
  trust_tier_distribution?: Record<string, number>; // {"T1": 2, "T3": 1}
  labels_applied?: string[];  // ["[현행]"]
  error?: string;             // 에러 메시지 (PII 제외)
}
```

### 2.3 개인정보 마스킹 규칙 (CLAUDE.md §7)

- 검색어 원문 저장 금지 → SHA-256 해시로 대체
- 회계사 식별자 저장 금지 → session_id로 추적
- 에러 메시지에 API 키·자격증명 포함 금지

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [ ] `src/utils/logger.ts` 신규 생성
- [ ] `src/types/logEvent.ts` 신규 생성
- [ ] `docs/logging-schema.md` 신규 생성

### 3.2 금지되는 변경

- ❌ 기존 API Route 수정 (로거 통합은 별도 티켓에서)
- ❌ 검색어 원문을 로그에 저장하는 코드 작성
- ❌ 회계사 이름·이메일·IP 저장
- ❌ `CLAUDE.md` 수정

---

## 4. Strategy (구현 힌트)

1. **logEvent.ts**: `TaxSearchLogEvent` 인터페이스 정의
2. **logger.ts**: winston 또는 pino 기반 구조화 로거 (CLAUDE.md §코딩 스타일 — `console.log` 금지)
   - 로그 레벨: `error`, `warn`, `info`, `debug`
   - 출력: 개발환경 콘솔 + 프로덕션 파일/외부 서비스
3. **logging-schema.md**: 스키마 문서화 + 개인정보 마스킹 규칙

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `src/types/logEvent.ts`에 `TaxSearchLogEvent` 인터페이스 정의
2. [ ] `src/utils/logger.ts`에 `console.log` 없음 (winston 또는 pino 사용)
3. [ ] 로거가 검색어 원문 대신 해시를 저장하는 로직 포함
4. [ ] `docs/logging-schema.md`에 스키마 및 마스킹 규칙 문서화
5. [ ] TypeScript 타입 오류 없음 (`npx tsc --noEmit` 통과)

---

## 6. Verification (검증 단계)

1. `src/types/logEvent.ts` 타입 정의 확인
2. `src/utils/logger.ts`에 `console.log` 없음 확인 (`grep -r "console.log" src/utils/logger.ts` → 0건)
3. 로거 호출 시 output에 `input_query_hash` 필드 존재, `input_query` 원문 없음 확인
4. `npx tsc --noEmit` 통과 확인

---

## 7. Risks / Notes

- 로거 자체는 유틸리티 — 기존 Route·Usecase에 통합은 별도 티켓에서 처리
- 프로덕션 로그 저장소(파일 vs Supabase vs 외부 서비스)는 TAX-007(MCP 정책) 이후 결정
- pino 권장 (성능 우수, Next.js와 호환) — winston도 가능

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] 로그 스키마 초안 (회계사 확인 필요 — 저장 항목 동의)
- [ ] 로거 라이브러리 선택 (pino vs winston)

→ **인간 승인 후** 코딩 시작

### 8.2 코딩 후 제출할 것

- [ ] 생성된 파일 목록
- [ ] 타입 검사 결과 (`tsc --noEmit`)
- [ ] 마스킹 동작 검증 결과
- [ ] 리포트: `docs/reports/TAX-009_report.md`

---

## 10. Related Tickets

- 선행: TAX-005 (Eval Harness — 실패 케이스를 골든셋에 추가하는 연계)
- 후속: 로거 통합 티켓 (API Route·Usecase에 logger 적용)
- 참조: `docs/reports/HARNESS-ENGINEERING-ADOPTION_report.md` 방안 9

---

## 11. Report Link

Report: `docs/reports/TAX-009_report.md` (미작성)

---

**작성자**: AI (하네스 엔지니어링 보고서 기반)
**작성일**: 2026-05-11
**최종 수정일**: 2026-05-11
