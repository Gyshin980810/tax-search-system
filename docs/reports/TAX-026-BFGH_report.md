# TAX-026-B~G 구현 리포트

**작성일**: 2026-06-10  
**대상**: TAX-026-B (인프라) · TAX-026-C (임베딩) · TAX-026-D (벡터 검색) · TAX-026-E (배치) · TAX-026-F (fallback usecase) · TAX-026-G (검증 정합)

---

## 변경 사항 요약

### 파일 변경 목록

| 파일 | 작업 | 서브태스크 |
|---|---|---|
| `src/config.ts` | `requireUrlEnv` 추가, `databaseUrl` 옵셔널 설정 | B |
| `CLAUDE.md §7.1` | `DATABASE_URL` 행 추가 | B |
| `docs/PRD.md §12` | `DATABASE_URL` 행 갱신 (TAX-004 → TAX-026-B 활성화) | B |
| `scripts/migrate.sql` | pgvector DDL 스키마 (신규) | B |
| `package.json` | `pg`, `@types/pg` 의존성 추가 | B |
| `src/ports/embeddingPort.ts` | IEmbeddingPort 인터페이스 (신규) | C |
| `src/adapters/embedding.ts` | OpenAIEmbeddingAdapter — text-embedding-3-small (신규) | C |
| `src/ports/vectorSearchPort.ts` | IVectorSearchPort + VectorMatch (신규) | D |
| `src/adapters/vectorSearch.ts` | PgVectorSearchAdapter — cosine 유사도 쿼리 (신규) | D |
| `scripts/embed.ts` | 오프라인 임베딩 적재 배치, content_hash 중복방지 (신규) | E |
| `src/domain/SearchResult.ts` | `MatchStage` 타입 + `matchStage?` 옵셔널 필드 추가 | F |
| `src/usecases/searchWithFallback.ts` | `FallbackSearchPort` class — 3단계 fallback ISearchPort (신규) | F |
| `src/ports/llmAnswerGeneratorPort.ts` | `matchStage?` 옵셔널 파라미터 추가 | G |
| `src/adapters/llmAnswerGenerator.ts` | `downgradeVectorLabels` 후처리 + `generate` 시그니처 확장 | G |
| `src/usecases/generateAnswer.ts` | `callGenerate` 헬퍼 + 3곳 matchStage 전달 | G |
| `app/api/answer/route.ts` | `FallbackSearchPort` 조건부 주입 (DATABASE_URL 있을 때만) | B·F |

---

## 주요 변경

### B — 벡터 인프라

- `DATABASE_URL`이 없으면 기존 직접 매칭이 그대로 동작 (점진적 활성화)
- `DATABASE_URL`이 있으면 `requireUrlEnv`가 `postgres://` 형식 검증 후 Fail-fast
- `scripts/migrate.sql`: `CREATE EXTENSION IF NOT EXISTS vector` + `taxlaw_embeddings` 테이블
- `.env.example` — 권한 제한으로 수동 업데이트 필요: `DATABASE_URL=` 주석 해제

### C — 임베딩 어댑터

- `OpenAIEmbeddingAdapter`: `OPENAI_API_KEY` 재사용 (신규 키 0)
- `embed()` → 단건 질의 벡터 / `embedBatch()` → 배치 적재용

### D — 벡터 검색 어댑터

- `PgVectorSearchAdapter`: cosine 유사도(`<=>`) 상위 K 반환
- `ssl: { rejectUnauthorized: false }` — Neon·Supabase 호환

### E — 임베딩 적재 배치

- `npx tsx scripts/embed.ts --input laws.json [--dry-run]`
- `content_hash` (SHA-256) UNIQUE로 재실행 시 중복 적재 방지

### F — 3단계 Fallback usecase

- `FallbackSearchPort` (ISearchPort 구현체): API Route에서 `NationalTaxLawAdapter` 대신 주입
- THRESHOLD = 3, TOP_K = 10 (회계사 결정 2026-05-23)
- 흐름: direct → vector → expanded, 직접 결과 항상 앞에 배치 (FR-19 보존)
- `generateAnswer.ts` **무변경** — searchPort 자리에 교체만

### G — matchStage 라벨 정합

- `downgradeVectorLabels()`: vector → 🟡 천장, expanded → ⚪ 천장 강제
- `callGenerate()` 헬퍼: matchStage=undefined 시 4번째 인수 생략 → 기존 테스트 하위호환

---

## 검증 결과

1. `npx tsc --noEmit` — 타입 에러 0건 ✅
2. `npx vitest run` — 387/387 PASS ✅
3. `FallbackSearchPort` 단건 타입 검사 — ISearchPort 구현 정합 ✅
4. V3 라벨 안전망 (`downgradeT3T4DirectCitations`) 무변경 — 기존 안전망 유지 ✅
5. law-verifier V1~V6 무변경 — 벡터 결과도 동일 파이프라인 통과 ✅

---

## 잠재 위험

- **DATABASE_URL 미설정**: 현재 `.env.local`에 없으면 벡터 기능 비활성화, 기존 동작 유지. DB 연결 설정 후 활성화 필요.
- **임베딩 적재 미완료**: `scripts/embed.ts`를 실행해 법령 데이터를 pgvector에 적재하기 전에는 벡터 검색이 빈 결과를 반환. 적재 전까지는 직접 매칭만 동작.
- **ssl 옵션**: `rejectUnauthorized: false`는 개발 환경용. 프로덕션에서는 적절한 인증서 설정 필요.
- **TAX-026-H**: 골든셋 회귀 + Playwright E2E는 실제 DB 연결 후 별도 실행 필요.

---

## 다음 단계 (TAX-026-H)

1. Neon/Supabase/Vercel Postgres 인스턴스 생성
2. `scripts/migrate.sql` 실행 (`CREATE EXTENSION`, 테이블 생성)
3. `.env.local`에 `DATABASE_URL=postgres://...` 추가
4. `.env.example`에서 `DATABASE_URL=` 주석 해제 (수동)
5. `npx tsx scripts/embed.ts --input <법령데이터.json>` 실행 (임베딩 적재)
6. 골든셋 회귀 재실행: `npm run perf:p95`
