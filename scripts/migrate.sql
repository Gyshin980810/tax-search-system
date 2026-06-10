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
