-- pgvector 스키마 — TAX-026-B
-- 실행 전 pgvector 확장이 지원되는 Postgres 인스턴스(Neon · Supabase · Vercel Postgres) 필요.
-- 재실행 안전: IF NOT EXISTS · UNIQUE(content_hash) 중복 방지.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS taxlaw_embeddings (
  id               BIGSERIAL PRIMARY KEY,
  source_type      TEXT NOT NULL,            -- '법령'|'판례'|'해석례'|'심판례'
  law_name         TEXT NOT NULL,
  article_number   TEXT,                     -- 법령 식별자 (비법령은 NULL)
  case_number      TEXT,                     -- 비법령 식별자 (판례 사건번호 등)
  article_title    TEXT,
  content          TEXT NOT NULL,            -- 원문 보존 (§6.1 변형 금지)
  embedding        vector(1536),             -- text-embedding-3-small 1536차원
  revision_date    DATE,
  enforcement_date DATE,
  source_url       TEXT NOT NULL,            -- OC 키 미포함 (CLAUDE.md §7)
  trust_tier       TEXT NOT NULL,            -- 'T1'|'T2'|'T3'|'T4'
  issuing_body     TEXT,
  decision_date    DATE,
  content_hash     TEXT UNIQUE,              -- 중복 적재 방지 (SHA-256)
  metadata         JSONB,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- cosine 유사도 인덱스 — 데이터 적재 후 생성 (적재 전 생성 시 성능 저하)
-- CREATE INDEX ON taxlaw_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ─────────────────────────────────────────────────────────────────────────────
-- 운영 쿼리 로그 — TAX-030-A (FR-23)
-- 질문 처리 1건마다 메타데이터를 적재해 운영 환류(TAX-044/045)의 근거로 삼는다.
-- ❗ 회계사 식별자(이메일·이름·IP) 컬럼을 구조적으로 두지 않는다 (CLAUDE.md §7).
--   query_norm은 maskPhoneEmail 적용 후 저장, 주민·사업자번호는 detectPii가 이미 입력 거부.
-- 재실행 안전: IF NOT EXISTS.

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 조용한 틀림 신고 로그 — TAX-030-B (FR-24)
-- 검증(V1~V6)은 통과했으나 회계사가 "실제 오답"으로 판단한 답변(silent failure)을 적재한다.
-- 자동으로는 절대 탐지 불가한 silent failure의 유일한 수집 경로.
-- ❗ 회계사 식별자(이메일·이름·IP·세션 ID) 컬럼을 구조적으로 두지 않는다 (CLAUDE.md §7).
--   query_norm·reason은 maskPhoneEmail 적용 후 저장, 주민·사업자번호는 detectPii가 입력 거부.
-- 재실행 안전: IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS ops_feedback (
  id           BIGSERIAL PRIMARY KEY,
  query_hash   TEXT NOT NULL,   -- SHA-256(원본질문) 앞 16자 — ops_query_log와 조인 키(고유키 아님)
  query_norm   TEXT NOT NULL,   -- maskPhoneEmail 적용 후 질문
  reason       TEXT,            -- maskPhoneEmail 적용 후 신고 사유 (선택 입력 — 빈 값 가능)
  source_types TEXT[],          -- ['법령','심판례'] 등 답변에 사용된 출처 유형
  created_at   TIMESTAMPTZ DEFAULT now()
  -- ❌ 회계사 식별자·IP·이메일·세션 ID 컬럼 일절 없음
);
