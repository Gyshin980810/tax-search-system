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
  embedding        vector(1024),             -- voyage-4 1024차원 (TAX-6B-15, 이전 text-embedding-3-small 1536에서 전환)
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

-- ─── TAX-6B-31: 인용 연결망 엣지 ────────────────────────────────────────────
-- 판례·심판례 원문에 명시된 상호 인용(예: "(대법원 2003두7392 판결 참조)")을 추출·적재한다.
-- LLM·임베딩 호출 0(과금 0), snippet은 원문 부분 문자열 그대로(§6.1 인용 무결성).
-- 검색 파이프라인은 이 테이블을 아직 읽지 않는다(TAX-6B-32에서 반영). 재실행 안전: IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS citation_edges (
  id          BIGSERIAL PRIMARY KEY,
  from_id     TEXT NOT NULL,      -- 인용하는 문서 사건번호(정규화: 공백 제거)
  from_type   TEXT NOT NULL,      -- '판례' | '심판례'
  to_id       TEXT NOT NULL,      -- 인용된 문서 사건번호(정규화)
  to_type     TEXT NOT NULL,      -- '판례' | '심판례'
  edge_type   TEXT NOT NULL,      -- 'FOLLOWS'(같은 뜻임) | 'REFERS'(참조·무표지) | 'APPEAL'(원심/환송)
  edge_source TEXT NOT NULL,      -- 'field'(참조판례 구조화 필드) | 'body'(본문 정규식) — 신뢰도 구분
  snippet     TEXT NOT NULL,      -- 인용 지점 원문 발췌(±90자, 무변형 — 원문 부분 문자열)
  in_corpus   BOOLEAN NOT NULL,   -- 인용 대상이 보유 코퍼스에 존재하는가(법원명 충돌 14건은 법원명까지 대조)
  cited_date  TEXT,               -- 인용문에 동반된 선고일 ISO(있으면) — 시간방향 검증용
  group_no    INT,                -- 같은 괄호 그룹에서 나온 인용 묶음 번호 — 사슬 추적용
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (from_id, to_id)
);
CREATE INDEX IF NOT EXISTS idx_citation_edges_to ON citation_edges (to_id);     -- 피인용 집계용
CREATE INDEX IF NOT EXISTS idx_citation_edges_from ON citation_edges (from_id); -- 1-hop 확장용
