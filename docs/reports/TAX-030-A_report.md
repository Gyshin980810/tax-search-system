# TAX-030-A 리포트 — 운영 쿼리 로그 자동 수집 훅 (FR-23)

- **티켓**: `docs/tickets/TAX-030-A_ops_query_log_collection.md`
- **브랜치**: `feat/tax-030-a-ops-query-log`
- **작성일**: 2026-06-16
- **상태**: 코드 구현·검증 완료 / 실제 Neon 마이그레이션·런타임 검증은 회계사 확인 후 진행

---

## 1. 변경 사항 요약

### 파일 변경 목록 (신규 4 / 수정 3)

| 파일 | 구분 | 내용 |
|---|---|---|
| `src/ports/opsLogPort.ts` | 신규 | `OpsQueryLogEntry` 타입 + `IOpsLogPort.recordQuery` 인터페이스 |
| `src/adapters/opsLog.ts` | 신규 | `PgOpsLogAdapter`(Neon INSERT) + `NullOpsLogAdapter`(no-op) |
| `scripts/migrate.sql` | 수정 | `ops_query_log` 테이블 DDL 추가 (`IF NOT EXISTS`) |
| `src/usecases/generateAnswer.ts` | 수정 | 옵셔널 `opsLog?` 인자 + 성공·E-VERIFY-FAIL 양 경로 fail-soft 기록 |
| `app/api/answer/route.ts` | 수정 | `config.databaseUrl` 분기로 어댑터 주입 |
| `tests/unit/opsLog.test.ts` | 신규 | `NullOpsLogAdapter` no-op 테스트 |
| `tests/unit/generateAnswer.test.ts` | 수정 | 운영 로그 수집 5종 테스트 추가 |

### 주요 변경

- **질문 1건당 메타데이터 1행 적재**: 마스킹 질문(`query_norm`)·해시(`query_hash`)·검색단계(`match_stage`)·출처유형(`source_types`)·검증상태(`verify_status`)·실패항목(`failed_checks`)·소요시간(`latency_ms`)
- **양 경로 기록**: 성공(`PASS`)뿐 아니라 E-VERIFY-FAIL(`FAIL`) 경로도 기록 후 throw
- **fail-soft**: 로그 적재 실패가 답변 생성을 막지 않음(`safeRecord` 내부 try/catch)
- **하위 호환**: `opsLog?` 옵셔널 인자 → 기존 6인자 호출부·테스트 전부 무수정 통과

### 설계 결정 (방안 A — Usecase 내부 기록, 회계사 승인 2026-06-16)

- **FAIL 경로 `failed_checks` 확보**: `runTwoStage`는 throw 시 내부 state를 반환하지 않으므로, Usecase 스코프의 `lastVerifyResult` 변수를 `isFailure` 클로저로 갱신해 throw 직전 마지막 검증 결과를 catch에서 읽음. → **`runTwoStage`·검증 판정 로직 무변경**(CLAUDE.md §6.4·§9 7번 준수)

---

## 2. 검증 결과

| # | 검증 항목 | 결과 |
|---|---|---|
| 1 | `npx tsc --noEmit` 타입 체크 | ✅ PASS (exit 0) |
| 2 | `npm run build` 프로덕션 빌드 | ✅ PASS (Compiled successfully) |
| 3 | `npx vitest run` 전체 회귀 | ✅ PASS (35 파일 / **576 테스트**) |
| 4 | `NullOpsLogAdapter.recordQuery` no-op 안전 종료 | ✅ PASS |
| 5 | 성공 경로 `recordQuery` 1회 호출 + `verifyStatus='PASS'` | ✅ PASS |
| 6 | E-VERIFY-FAIL 경로 기록 후 throw + `verifyStatus='FAIL'`·`failed_checks` 포함 | ✅ PASS |
| 7 | fail-soft (`recordQuery` reject 시에도 정상 답변) | ✅ PASS |
| 8 | `query_norm` 휴대폰·이메일 마스킹 | ✅ PASS |
| 9 | `opsLog` 미주입 시 하위 호환 | ✅ PASS |

### 미수행 (회계사 확인/배포 단계)

- ⏳ **실제 Neon 마이그레이션**(`npm run migrate`) — 외부 DB에 DDL 적용이라 회계사 확인 후 실행. `IF NOT EXISTS`로 멱등·비파괴
- ⏳ **런타임 적재 확인**(`SELECT * FROM ops_query_log`) — 마이그레이션 후 dev 서버 1건 검색으로 확인
- ⏳ **fail-soft 런타임**(`DATABASE_URL` 제거 → `NullOpsLogAdapter` 경로) — 배포 환경 검증

---

## 3. 개인정보 보호 (CLAUDE.md §7)

- ✅ 회계사 식별자(이메일·이름·IP) 컬럼을 **구조적으로 두지 않음** — 스키마에 컬럼 자체가 없어 저장 불가능
- ✅ `query_norm`은 `maskPhoneEmail` 적용 후 저장 (휴대폰 `010-****-5678`·이메일 `us***@example.com`)
- ✅ 주민·사업자번호는 `detectPii`가 Usecase 진입 시 입력 거부 → 로그에 도달 불가

---

## 4. 잠재 위험 / 제한사항

- ⚠️ `recordQuery`는 `await`(동기 대기)하므로 Neon 연결 지연이 응답을 느리게 할 수 있음. fail-soft로 실패는 막지만 지연은 남음 → **fire-and-forget 최적화는 본 범위 밖**(후속 검토)
- ⚠️ `query_hash`는 SHA-256 앞 16자 — 충돌 가능성 극히 낮으나 집계 식별용일 뿐 고유키 아님
- 📌 E-VERIFY-FAIL **외의** 에러(검색·LLM 실패 등)는 본 범위에서 기록하지 않음(티켓 §1.2 명세대로 성공·검증실패 2경로만)
- 📌 `ops_feedback`·`recordFeedback`(👎 신고)은 **TAX-030-B**에서 본 포트에 확장

---

## 5. 다음 단계

1. 회계사 확인 후 `npm run migrate` 실행 → `ops_query_log` 생성
2. 배포 후 1~2주 운영 데이터 축적
3. TAX-030-B(👎 신고) → TAX-030-C(환류 스크립트) → TAX-044(도메인 사전)
