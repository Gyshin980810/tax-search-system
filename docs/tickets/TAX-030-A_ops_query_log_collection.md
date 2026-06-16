# TAX-030-A — 운영 쿼리 로그 자동 수집 훅 (FR-23)

> 작업 시작 전 이 티켓 + `CLAUDE.md` + `docs/SSOT.md`(v2.6 §2·§7.8) + `docs/PRD.md`(v2.5 §5.2 FR-23)를 읽을 것.
> 회계사 승인 완료(2026-06-16): 기록 위치 = **방안 A(Usecase 내부 기록)** 확정.

---

## Metadata

- **Type**: FEAT
- **Severity**: major
- **Layer**: usecase + adapter + infra
- **Milestone**: M7 (운영 데이터 환류)
- **Estimated Size**: M (5파일 — 신규 3 / 수정 2)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- 회계사가 던진 질문이 어떻게 처리됐는지(검색 단계·검증 통과 여부·소요 시간) **운영 데이터가 1건도 수집되지 않음**.
- V1~V6 검증은 "거짓말 탐지기"일 뿐, **어떤 질문 패턴이 많고 어디서 실패하는지** 집계할 근거가 없음.

### 1.2 기대 동작

- 질문 1건이 처리될 때마다, **회계사 식별 정보를 일절 저장하지 않고**, 다음을 Neon DB(`ops_query_log`)에 조용히 적재한다:
  - 마스킹된 질문(`query_norm`), 질문 해시(`query_hash`), 검색 단계(`match_stage`), 출처 유형(`source_types`), 검증 상태(`verify_status`), 실패 항목(`failed_checks`), 소요 시간(`latency_ms`)
- 성공 경로뿐 아니라 **E-VERIFY-FAIL(검증 실패) 경로에서도** 메타데이터를 남긴다.
- **로그 적재가 실패해도 회계사 답변 생성은 정상 동작한다(fail-soft).**

### 1.3 영향·중요도

- Phase 7 임계 경로의 **첫 작업**. 이 수집 인프라가 켜져야 TAX-044(도메인 사전)·TAX-045(정확도 개선)가 1~2주 후 실제 데이터로 시작 가능.
- 회계사 결정(2026-06-16): 저장소 = 기존 Neon Postgres 재사용(파일 아님, Vercel 서버리스 파일 휘발 회피), 수집 범위 = 성공 쿼리까지 전부.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/ports/opsLogPort.ts` (신규) — `IOpsLogPort` 인터페이스
- `src/adapters/opsLog.ts` (신규) — `PgOpsLogAdapter` + `NullOpsLogAdapter`
- `scripts/migrate.sql` (수정) — `ops_query_log` 테이블 DDL 추가
- `src/usecases/generateAnswer.ts` (수정) — 옵셔널 `opsLog` 인자 추가, 양 경로 기록
- `app/api/answer/route.ts` (수정) — `config.databaseUrl` 분기로 어댑터 주입

### 2.2 외부 API·리소스

- Neon Postgres (기존 `DATABASE_URL`, Phase 4에서 이미 연결됨) — **신규 환경변수 없음**
- pg `Pool` 패턴 — `src/adapters/vectorSearch.ts` 참조(동일 SSL 옵션)
- 마스킹 함수 — `src/utils/piiFilter.ts`의 `maskPhoneEmail`, `detectPii`(이미 usecase 진입 시 호출됨)

### 2.3 아키텍처 힌트

```
app/api/answer/route.ts  (databaseUrl 있으면 PgOpsLogAdapter, 없으면 NullOpsLogAdapter 주입)
        ↓
usecases/generateAnswer.ts  (Port만 호출, fetch·DB 직접 호출 금지)
        ↓
ports/opsLogPort.ts (IOpsLogPort)
        ↓
adapters/opsLog.ts  (pg Pool I/O, 비즈니스 판단 없음, fail-soft)
        ↓
Neon Postgres (ops_query_log)
```

---

## 3. Scope (작업 범위) ⭐ 가장 중요

### 3.1 허용되는 변경

- [ ] `src/ports/opsLogPort.ts` 신규 생성 — `IOpsLogPort.recordQuery(entry)` 정의
- [ ] `src/adapters/opsLog.ts` 신규 생성 — `PgOpsLogAdapter`(pg Pool) + `NullOpsLogAdapter`(no-op)
- [ ] `scripts/migrate.sql` 수정 — `ops_query_log` 테이블 추가 (`IF NOT EXISTS`, 재실행 안전)
- [ ] `src/usecases/generateAnswer.ts` 수정 — 옵셔널 `opsLog?: IOpsLogPort` 인자 + 성공·실패 양 경로 기록(try/catch fail-soft)
- [ ] `app/api/answer/route.ts` 수정 — `config.databaseUrl` 분기 어댑터 주입

### 3.2 금지되는 변경

- ❌ V1~V6 검증 로직·`TIER_ALLOWED_LABELS`·`lawVerifier` 무변경 (CLAUDE.md §6.4)
- ❌ `TaxLaw[]` 원문 변형·요약 저장 금지 (§6.1)
- ❌ 정답(summary·expectedStatus·expectedContent) 자동 생성 금지 — 030-A는 **수집만**, 채점 아님
- ❌ 신규 환경변수 추가 금지 (기존 `DATABASE_URL` 재사용, SSOT §4.1 4곳 갱신 비대상)
- ❌ `ops_feedback` 테이블·`recordFeedback` 구현 금지 — **TAX-030-B 범위**
- ❌ 회계사 식별자(이메일·이름·IP) 컬럼 생성·저장 금지 (CLAUDE.md §7)
- ❌ 기존 폴더 구조 변경·리팩터 금지 (§9 7번)

---

## 4. Strategy (구현 힌트)

1. **Domain/Port 먼저**: `OpsQueryLogEntry` 타입(도메인) + `IOpsLogPort` 인터페이스 정의
   ```ts
   interface OpsQueryLogEntry {
     queryNorm: string         // maskPhoneEmail 적용 후
     queryHash: string         // SHA-256(원본질문) 앞 16자
     matchStage?: MatchStage   // 'direct'|'vector'|'expanded'
     sourceTypes: string[]
     verifyStatus: 'PASS' | 'FAIL'
     failedChecks: string[]
     latencyMs: number
   }
   interface IOpsLogPort { recordQuery(entry: OpsQueryLogEntry): Promise<void> }
   ```
2. **Adapter 구현**:
   - `PgOpsLogAdapter` — `vectorSearch.ts`의 pg Pool 패턴 재사용(SSL `rejectUnauthorized:false`), INSERT 1건
   - `NullOpsLogAdapter` — `recordQuery`가 즉시 resolve(no-op). DATABASE_URL 없는 로컬·테스트용
3. **migrate.sql**: `ops_query_log` DDL 추가 (§6 스키마, 식별자 컬럼 없음)
4. **Usecase 수정**(방안 A):
   - `generateAnswer(...args, opsLog?: IOpsLogPort)` 옵셔널 인자 추가(하위 호환, 기존 `matchStage` 옵셔널 패턴과 동일)
   - 진입 시 `const startedAt = Date.now()`
   - 성공 반환 직전: `await safeRecord(opsLog, { ...PASS 메타, latencyMs })`
   - E-VERIFY-FAIL throw 직전(`runTwoStage`가 throw하는 지점을 try/catch로 감싸): `await safeRecord(opsLog, { ...FAIL 메타 })` 후 rethrow
   - `safeRecord`는 내부 try/catch로 **로그 실패를 삼킴**(fail-soft, 답변 throw 금지). opsLog 미주입(undefined) 시 무동작
   - `query_norm` = `maskPhoneEmail(question)`, `query_hash` = SHA-256(question) 앞 16자(node:crypto)
5. **Route 주입**: `config.databaseUrl ? new PgOpsLogAdapter(config.databaseUrl) : new NullOpsLogAdapter()`를 `generateAnswer` 마지막 인자로 전달

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `npm run build` 타입 통과
2. [ ] `npx vitest` 기존 전건 GREEN 유지(현재 560/560), 신규 테스트 포함 GREEN
3. [ ] 신규 단위 테스트:
   - [ ] `NullOpsLogAdapter.recordQuery()`가 no-op로 안전 종료
   - [ ] `generateAnswer`가 **성공 경로**에서 `recordQuery` 1회 호출(spy) — `verifyStatus='PASS'`
   - [ ] `generateAnswer`가 **E-VERIFY-FAIL 경로**에서도 `recordQuery` 호출 후 throw(spy) — `verifyStatus='FAIL'`
   - [ ] **fail-soft**: `recordQuery`가 reject해도 `generateAnswer`는 정상 답변 반환
   - [ ] `query_norm`에 휴대폰·이메일이 마스킹되어 저장됨
4. [ ] `scripts/migrate.ts`로 Neon에 `ops_query_log` 테이블 실제 생성 확인(1회)
5. [ ] 저장 레코드에 회계사 식별자(이메일·이름·IP) 컬럼이 **구조적으로 존재하지 않음**
6. [ ] 기존 기능(검색·답변·벡터 fallback)이 깨지지 않음

---

## 6. 저장 스키마 (식별 정보 0건 — CLAUDE.md §7)

```sql
CREATE TABLE IF NOT EXISTS ops_query_log (
  id            BIGSERIAL PRIMARY KEY,
  query_norm    TEXT NOT NULL,   -- maskPhoneEmail 적용 후 (휴대폰·이메일 마스킹)
  query_hash    TEXT NOT NULL,   -- SHA-256(원본질문) 앞 16자 — 중복 패턴 집계용
  match_stage   TEXT,            -- 'direct'|'vector'|'expanded'
  source_types  TEXT[],          -- ['법령','심판례'] 등
  verify_status TEXT,            -- 'PASS'|'FAIL'
  failed_checks TEXT[],          -- ['v2','v3'] 등 실패 항목
  latency_ms    INTEGER,         -- 처리 소요 시간(ms)
  created_at    TIMESTAMPTZ DEFAULT now()
  -- ❌ 회계사 식별자·IP·이메일 컬럼 일절 없음
);
```

- ✅ `query_norm`은 `maskPhoneEmail` 적용 후 저장
- ✅ 주민·사업자번호는 `detectPii`가 usecase 진입 시 이미 입력 거부 → 여기 도달 안 함
- ❌ 식별자 컬럼 자체를 만들지 않아 구조적으로 저장 불가능

---

## 7. Verification (검증 단계)

1. 저장소 루트에서 `npx vitest` 실행 → 전건 GREEN 확인
2. `npm run build` → 타입 통과 확인
3. `npx tsx scripts/migrate.ts`(또는 기존 마이그레이션 명령) → `ops_query_log` 생성 확인
4. `npm run dev` → 브라우저에서 질문 1건 검색 → 정상 답변 확인
5. Neon 콘솔/psql에서 `SELECT * FROM ops_query_log ORDER BY created_at DESC LIMIT 5;` → 레코드 적재 확인, **식별자 컬럼 없음** 확인
6. (fail-soft 확인) `DATABASE_URL` 제거 후 재시작 → `NullOpsLogAdapter`로 답변 정상 동작 확인

---

## 8. Risks / Notes (위험·주의사항)

- ⚠️ usecase 인자가 1개 늘어 기존 호출부(테스트 포함)가 깨질 수 있음 → **옵셔널 인자**(`opsLog?`)로 하위 호환 유지
- ⚠️ Neon 연결 지연이 답변을 느리게 할 수 있음 → `recordQuery`는 await하되 try/catch fail-soft. fire-and-forget 최적화는 **이번 범위 밖**(후속 검토)
- ⚠️ `query_hash`는 SHA-256 앞 16자 — 충돌 가능성 극히 낮으나 집계 식별용일 뿐 고유키 아님
- 📌 `ops_feedback`·`recordFeedback`은 **TAX-030-B**에서 추가. 포트는 030-A에서 `recordQuery`만 정의하고 030-B에서 확장

---

## 9. AI Implementation Instructions

### 9.1 코딩 전 제출할 것 — ✅ 완료(2026-06-16)

- [x] 근본 배경 분석 (§1, §2)
- [x] 영향받는 파일 목록 (§2.1, §3.1)
- [x] 구현 계획 (§4) + 기록 위치 방안 A/B 트레이드오프 → **방안 A 회계사 승인 완료**

### 9.2 코딩 후 제출할 것

- [ ] 변경 파일 목록
- [ ] 변경 요약
- [ ] 검증 단계별 결과 (PASS/FAIL)
- [ ] 발견된 위험·제한사항
- [ ] 리포트 파일 경로: `docs/reports/TAX-030-A_report.md`

---

## 10. Related Tickets (관련 티켓)

- 선행: TAX-026-B~H (Phase 4 Neon 연결·pg Pool 패턴), TAX-028 (buildCases 재사용 예정)
- 후속: TAX-030-B (👎 신고 버튼/`ops_feedback`/`recordFeedback`), TAX-030-C (환류 스크립트)
- 참조: `docs/SSOT.md` v2.6 §2·§7.8, `docs/PRD.md` v2.5 §5.2 FR-23, `ROADMAP.md` v2.5 Phase 7

---

## 11. Report Link (리포트 연결)

Report: `docs/reports/TAX-030-A_report.md` (미작성)

---

**작성자**: Claude (Opus 4.8) + 회계사 승인
**작성일**: 2026-06-16
**최종 수정일**: 2026-06-16
