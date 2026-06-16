# TAX-030-B — 조용한 틀림 회계사 신고 👎 (FR-24)

> 작업 시작 전 이 티켓 + `CLAUDE.md` + `docs/SSOT.md`(v2.6 §2·§7.8·§14.2) + `docs/PRD.md`(v2.5 §5.2 FR-24·§10.1 OpsFeedback)를 읽을 것.
> 회계사 승인 완료(2026-06-16): ①기록 계층 = **얇은 Usecase(`submitFeedback`) 신설** ②신고 UX = **사유 입력 포함**.
> 선행 TAX-030-A(`ops_query_log`·`IOpsLogPort.recordQuery`) 완료 기반.

---

## Metadata

- **Type**: FEAT
- **Severity**: major
- **Layer**: ui + api + usecase + adapter + infra
- **Milestone**: M7 (운영 데이터 환류)
- **Estimated Size**: M (신규 3 / 수정 4)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- V1~V6 law-verifier는 "거짓말 탐지기"다. 인용된 법령이 실제 검색 결과에 존재하고(V1), 발췌가 원문과 문자 단위로 일치하며(V2), 라벨·시점이 적정한지(V3~V6)만 검사한다.
- **법령 인용은 전부 정확한데 결론·해석이 실제로는 틀린 답변**("조용한 틀림", silent failure)은 V1~V6를 **정상 통과**한다. 자동으로는 절대 탐지 불가능하다.
- 현재 이 silent failure를 수집할 통로가 **하나도 없다**. 회계사가 "이거 틀렸는데" 하고 넘어가면 그대로 소실된다.

### 1.2 기대 동작

- 회계사가 PASS 답변을 보고 **실제 오답이라 판단하면 👎 버튼으로 신고**한다.
- 신고 시 (선택) 사유를 입력하고, 다음을 Neon DB(`ops_feedback`)에 적재한다:
  - 질문 해시(`query_hash`), 마스킹된 질문(`query_norm`), 마스킹된 사유(`reason`), 출처 유형(`source_types`)
- 회계사 식별 정보(이메일·이름·IP)는 **일절 저장하지 않는다**(스키마에 컬럼 없음).
- 신고 사유·질문은 저장 직전 `detectPii`(주민·사업자번호 입력 거부) + `maskPhoneEmail`(휴대폰·이메일 마스킹)을 적용한다.

### 1.3 영향·중요도

- silent failure의 **유일한 수집 경로**(PRD FR-24). TAX-6B-9 내용 검증기(방안 A)가 "무엇을 검증해야 하는지" 학습할 실제 오답 사례의 원천.
- TAX-044/045 정확도 개선의 핵심 입력 — "검증은 통과했지만 회계사가 틀렸다고 본" 케이스 목록.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `scripts/migrate.sql` (수정) — `ops_feedback` 테이블 DDL 추가
- `src/ports/opsLogPort.ts` (수정) — `OpsFeedbackEntry` 타입 + `IOpsLogPort.recordFeedback` 추가
- `src/adapters/opsLog.ts` (수정) — `PgOpsLogAdapter.recordFeedback`(INSERT) + `NullOpsLogAdapter` no-op
- `src/usecases/submitFeedback.ts` (신규) — PII 거부·마스킹·해시·Port 호출
- `app/api/feedback/route.ts` (신규) — POST 진입점, 검증·어댑터 주입·에러 매핑
- `app/components/AnswerCard.tsx` (수정) — 👎 버튼 + 사유 입력 UI

### 2.2 외부 API·리소스

- Neon Postgres (기존 `DATABASE_URL`) — **신규 환경변수 없음**
- `src/utils/piiFilter.ts`의 `maskPhoneEmail`·`detectPii` 재사용
- pg `Pool` 패턴 — `src/adapters/opsLog.ts`의 기존 `PgOpsLogAdapter` 확장(같은 Pool 재사용)

### 2.3 아키텍처 힌트 (회계사 결정 = 얇은 Usecase 경유)

```
app/components/AnswerCard.tsx  (👎 버튼 → fetch POST /api/feedback)
        ↓
app/api/feedback/route.ts  (검증·매핑·어댑터 주입, DB 직접 호출 금지)
        ↓
src/usecases/submitFeedback.ts  (detectPii·maskPhoneEmail·hashQuery, Port만 호출)
        ↓
ports/opsLogPort.ts (IOpsLogPort.recordFeedback)
        ↓
adapters/opsLog.ts  (pg Pool INSERT, 비즈니스 판단 없음)
        ↓
Neon Postgres (ops_feedback)
```

---

## 3. Scope (작업 범위) ⭐ 가장 중요

### 3.1 허용되는 변경

- [ ] `scripts/migrate.sql` 수정 — `ops_feedback` 테이블 추가 (`IF NOT EXISTS`, 재실행 안전)
- [ ] `src/ports/opsLogPort.ts` 수정 — `OpsFeedbackEntry` + `recordFeedback(entry)` 추가
- [ ] `src/adapters/opsLog.ts` 수정 — `recordFeedback` 구현(Pg/Null)
- [ ] `src/usecases/submitFeedback.ts` 신규 — 마스킹·해시·Port 호출
- [ ] `app/api/feedback/route.ts` 신규 — POST 검증·주입·에러 매핑
- [ ] `app/components/AnswerCard.tsx` 수정 — 👎 버튼 + 사유 입력(선택)

### 3.2 금지되는 변경

- ❌ V1~V6 검증 로직·`TIER_ALLOWED_LABELS`·`lawVerifier` 무변경 (CLAUDE.md §6.4)
- ❌ TAX-030-A의 `recordQuery` 경로·`OpsQueryLogEntry` 변경 금지(메서드만 추가)
- ❌ 정답(summary·expectedStatus·expectedContent) 자동 생성 금지 — 030-B는 **신고 수집만**
- ❌ 신규 환경변수 추가 금지 (기존 `DATABASE_URL` 재사용)
- ❌ 회계사 식별자(이메일·이름·IP·세션 ID) 컬럼 생성·저장 금지 (CLAUDE.md §7)
- ❌ 법령 원문·답변 생성 코드 변경 금지 (§6.1)
- ❌ 기존 폴더 구조 변경·리팩터 금지 (§9 7번)

---

## 4. Strategy (구현 힌트)

1. **Port 확장**: `OpsFeedbackEntry { queryHash, queryNorm, reason, sourceTypes }` + `IOpsLogPort.recordFeedback(entry): Promise<void>`
2. **Adapter**: `PgOpsLogAdapter`는 기존 `pool` 재사용해 `ops_feedback` INSERT. `NullOpsLogAdapter`는 no-op resolve
3. **migrate.sql**: `ops_feedback` DDL (식별자 컬럼 없음)
4. **Usecase `submitFeedback(opsLog, rawQuestion, reason, sourceTypes)`**:
   - `detectPii(rawQuestion)` + `detectPii(reason)` → 주민·사업자번호 시 `PiiDetectedError` throw
   - `queryNorm = maskPhoneEmail(rawQuestion)`, `reasonNorm = maskPhoneEmail(reason ?? '')`
   - `queryHash = SHA-256(rawQuestion) 앞 16자`(node:crypto)
   - `await opsLog.recordFeedback({ queryHash, queryNorm, reason: reasonNorm, sourceTypes })`
   - ⚠️ **fail-soft 아님** — 신고는 회계사 명시 액션이라 결과 피드백이 중요. 적재 실패는 throw해 route가 500 반환(query log와 의도적 차이)
5. **Route**: question·reason·sourceTypes 검증 → 어댑터 분기 주입 → `submitFeedback` 호출 → `AppError instanceof`로 status 매핑(`E-PII-DETECTED`=400, 그 외=500), 성공 200 `{ ok: true }`
6. **UI**: `reportStatus` 상태(`idle`/`open`/`submitting`/`done`/`error`). 👎 클릭 → 사유 textarea 노출 → 제출 → 결과 표시. `sourceTypes`는 `answer.citations`의 `taxLaw.sourceType` 중복 제거

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `npm run build` 타입 통과
2. [ ] `npx vitest` 기존 전건 GREEN 유지(현재 576/576) + 신규 테스트 GREEN
3. [ ] 신규 단위 테스트:
   - [ ] `NullOpsLogAdapter.recordFeedback()`가 no-op로 안전 종료
   - [ ] `submitFeedback`이 정상 입력 시 `recordFeedback` 1회 호출(spy)
   - [ ] `submitFeedback`이 질문·사유의 휴대폰·이메일을 마스킹해 전달
   - [ ] `submitFeedback`이 주민·사업자번호 입력 시 `PiiDetectedError` throw + `recordFeedback` 미호출
   - [ ] `AnswerCard`에 👎 버튼 렌더 + 클릭 시 사유 입력 노출
4. [ ] `scripts/migrate.ts`로 Neon에 `ops_feedback` 테이블 실제 생성 확인(1회)
5. [ ] 저장 레코드에 회계사 식별자(이메일·이름·IP) 컬럼이 **구조적으로 존재하지 않음**

---

## 6. 저장 스키마 (식별 정보 0건 — CLAUDE.md §7)

```sql
CREATE TABLE IF NOT EXISTS ops_feedback (
  id           BIGSERIAL PRIMARY KEY,
  query_hash   TEXT NOT NULL,   -- SHA-256(원본질문) 앞 16자 — ops_query_log와 조인 키
  query_norm   TEXT NOT NULL,   -- maskPhoneEmail 적용 후 질문
  reason       TEXT,            -- maskPhoneEmail 적용 후 사유 (선택 입력 — 빈 값 가능)
  source_types TEXT[],          -- ['법령','심판례'] 등 답변에 사용된 출처 유형
  created_at   TIMESTAMPTZ DEFAULT now()
  -- ❌ 회계사 식별자·IP·이메일·세션 ID 컬럼 일절 없음
);
```

- ✅ `query_norm`·`reason`은 `maskPhoneEmail` 적용 후 저장
- ✅ 주민·사업자번호는 `submitFeedback` 진입 시 `detectPii`가 입력 거부 → 저장 도달 안 함
- ✅ `query_hash`로 `ops_query_log`와 동일 질문 패턴 조인 가능(고유키 아님)

---

## 7. Verification (검증 단계)

1. `npx vitest` 전건 GREEN
2. `npm run build` 타입 통과
3. `npm run migrate` → `ops_feedback` 생성 확인(information_schema 조회)
4. (마이그레이션 후) Neon에서 `\d ops_feedback` → 식별자 컬럼 없음 확인

---

## 8. Risks / Notes (위험·주의사항)

- ⚠️ `reason`은 자유 텍스트라 PII 유입 위험 → `detectPii`(거부) + `maskPhoneEmail`(마스킹) 이중 적용
- ⚠️ 신고는 fail-soft가 **아님**(query log와 차이) — 적재 실패 시 회계사가 알아야 하므로 500 반환·UI 에러 표시
- 📌 신고 남용(같은 답변 연타) 방지·관리 콘솔은 본 범위 밖 — 후속 검토
- 📌 `ops_feedback` → 골든셋 환류(buildCases)는 TAX-030-C 범위

---

## 9. AI Implementation Instructions

### 9.1 코딩 전 제출할 것 — ✅ 완료(2026-06-16)

- [x] 근본 배경 분석 (§1, §2)
- [x] 영향 파일 목록 (§2.1, §3.1)
- [x] 구현 계획 (§4) + 결정 2건(계층=Usecase, UX=사유입력) → **회계사 승인 완료**

### 9.2 코딩 후 제출할 것

- [ ] 변경 파일 목록 / 변경 요약 / 검증 결과 / 위험
- [ ] 리포트: `docs/reports/TAX-030-B_report.md`

---

## 10. Related Tickets (관련 티켓)

- 선행: TAX-030-A (`ops_query_log`·`IOpsLogPort.recordQuery`)
- 후속: TAX-030-C (환류 스크립트 — `ops_feedback` → 골든셋 시드), TAX-6B-9 (내용 검증기 방안 A)
- 참조: `docs/SSOT.md` v2.6 §2·§7.8·§14.2, `docs/PRD.md` v2.5 §5.2 FR-24·§10.1, `ROADMAP.md` v2.5 Phase 7

---

## 11. Report Link (리포트 연결)

Report: `docs/reports/TAX-030-B_report.md` (미작성)

---

**작성자**: Claude (Opus 4.8) + 회계사 승인
**작성일**: 2026-06-16
**최종 수정일**: 2026-06-16
