# TAX-030-B 리포트 — 조용한 틀림 회계사 신고 👎 (FR-24)

- **티켓**: `docs/tickets/TAX-030-B_silent_failure_feedback.md`
- **브랜치**: `feat/tax-030-b-silent-failure-feedback` (TAX-030-A 위에 stacked)
- **작성일**: 2026-06-16
- **상태**: 코드 구현·검증·Neon 마이그레이션 완료

---

## 1. 변경 사항 요약

### 파일 변경 목록 (신규 3 / 수정 4)

| 파일 | 구분 | 내용 |
|---|---|---|
| `src/usecases/submitFeedback.ts` | 신규 | 신고 Usecase — PII 거부·마스킹·해시·Port 호출 |
| `app/api/feedback/route.ts` | 신규 | POST 진입점 — 검증·어댑터 주입·에러 매핑 |
| `tests/unit/submitFeedback.test.ts` | 신규 | Usecase 단위 테스트 6종 |
| `scripts/migrate.sql` | 수정 | `ops_feedback` 테이블 DDL 추가 (`IF NOT EXISTS`) |
| `src/ports/opsLogPort.ts` | 수정 | `OpsFeedbackEntry` 타입 + `IOpsLogPort.recordFeedback` 추가 |
| `src/adapters/opsLog.ts` | 수정 | `PgOpsLogAdapter.recordFeedback`(기존 Pool 재사용) + `NullOpsLogAdapter` no-op |
| `app/components/AnswerCard.tsx` | 수정 | 👎 신고 버튼 + 사유 입력 UI(상태 머신) |
| `tests/unit/opsLog.test.ts` · `generateAnswer.test.ts` · `AnswerCard.test.tsx` | 수정 | 신규 테스트 추가 + Port 확장에 따른 헬퍼 동기화 |

### 주요 변경

- **silent failure 수집 경로 신설**: V1~V6는 통과했으나 회계사가 실제 오답으로 판단한 답변을 👎로 신고 → `ops_feedback` 1행 적재
- **신고 1건당 적재 데이터**: 질문 해시(`query_hash`)·마스킹 질문(`query_norm`)·마스킹 사유(`reason`)·출처 유형(`source_types`)
- **회계사 결정 반영**: ①기록 계층 = 얇은 `submitFeedback` Usecase 경유(§4 정합) ②신고 UX = 사유 입력 포함

### 설계 결정

- **fail-soft 아님(TAX-030-A와 의도적 차이)**: 신고는 회계사의 명시적 액션이라 결과 피드백이 중요. 적재 실패·PII 거부를 `submitFeedback`이 throw하고 route가 적절한 HTTP 상태(PII=400 / 적재 실패=500)로 변환. recordQuery(성공 부수효과 → 조용히 삼킴)와 구분
- **Port 확장 방식**: `IOpsLogPort`에 `recordFeedback` 메서드만 추가. TAX-030-A의 `recordQuery`·`OpsQueryLogEntry`는 무변경. `PgOpsLogAdapter`는 기존 `pool`을 재사용

---

## 2. 검증 결과

| # | 검증 항목 | 결과 |
|---|---|---|
| 1 | `npx tsc --noEmit` 타입 체크 | ✅ PASS (exit 0) |
| 2 | `npm run build` 프로덕션 빌드 | ✅ PASS (`/api/feedback` 라우트 생성) |
| 3 | `npx vitest run` 전체 회귀 | ✅ PASS (36 파일 / **587 테스트**, 576→+11) |
| 4 | `NullOpsLogAdapter.recordFeedback` no-op 안전 종료 | ✅ PASS |
| 5 | `submitFeedback` 정상 입력 시 `recordFeedback` 1회 호출 | ✅ PASS |
| 6 | `submitFeedback` 질문·사유 휴대폰·이메일 마스킹 | ✅ PASS |
| 7 | `submitFeedback` 주민·사업자번호 시 `PiiDetectedError` throw + 미적재 | ✅ PASS |
| 8 | `AnswerCard` 👎 버튼 렌더 + 클릭 시 사유 입력 노출 | ✅ PASS |
| 9 | `AnswerCard` 신고 제출 → `/api/feedback` 전송 + 완료/실패 표시 | ✅ PASS |
| 10 | Neon `ops_feedback` 테이블 실제 생성 (`npm run migrate`) | ✅ PASS |
| 11 | `ops_feedback`에 회계사 식별자(이메일·이름·IP) 컬럼 부재 | ✅ PASS (구조적) |

### Neon 마이그레이션 확인

```
테이블: [ 'ops_feedback', 'ops_query_log', 'taxlaw_embeddings' ]
ops_feedback 컬럼: id, query_hash, query_norm, reason, source_types, created_at
```

---

## 3. 개인정보 보호 (CLAUDE.md §7 / SSOT §7.8·§14.2)

- ✅ 회계사 식별자(이메일·이름·IP·세션 ID) 컬럼을 **구조적으로 두지 않음**
- ✅ `query_norm`·`reason` 모두 `maskPhoneEmail` 적용 후 저장 (휴대폰·이메일 마스킹)
- ✅ 주민·사업자번호는 `submitFeedback` 진입 시 `detectPii`가 질문·사유 양쪽 입력 거부 → 저장 도달 불가

---

## 4. 잠재 위험 / 제한사항

- ⚠️ 신고 남용(같은 답변 연타 제출) 방지·중복 제거는 본 범위 밖 — 후속 검토
- ⚠️ 로컬·`DATABASE_URL` 미설정 환경에서는 `NullOpsLogAdapter`로 신고가 no-op resolve(200) — 화면은 "접수 완료"로 보이나 실제 저장은 없음(query log와 동일 트레이드오프)
- 📌 관리자 신고 조회 콘솔·`ops_feedback` → 골든셋 환류(buildCases)는 **TAX-030-C** 범위
- 📌 신고된 답변의 내용 검증(expectedContent 대조)은 **TAX-6B-9** 범위

---

## 5. 다음 단계

1. (배포 후) 회계사가 실제 답변에서 👎 신고 → `ops_feedback` 축적
2. TAX-030-C(환류 스크립트) — `ops_feedback` → 골든셋 시드 전환(회계사 검수 필수)
3. TAX-6B-9(내용 검증기 방안 A) — 신고 사례 기반 expectedContent 대조
