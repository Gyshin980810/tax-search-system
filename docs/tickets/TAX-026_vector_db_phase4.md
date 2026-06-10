# TAX-026 Phase 4 벡터 DB + 의미 유사도 검색 — 설계 문서 겸 진입 티켓

> 이 문서는 **Phase 4(M4) 전체의 단일 설계 기준**입니다.
> 산출물은 코드가 아니라 **'계획'**이며, 이후 모든 코딩 서브태스크(TAX-026-B ~ H)의 착수 전제입니다.
>
> ⚠️ **회계사 승인 게이트:** 본 문서의 §0.7 결정점 표를 회계사가 확정·서명하기 전까지
> B~H는 착수 금지입니다. (CLAUDE.md 계명 8 "계획 먼저", §8.1 워크플로우)
>
> 참조 위계: `docs/SSOT.md` > `docs/PRD.md` > `CLAUDE.md` > 본 티켓

---

## 0. 설계 본문 (Design) ⭐ 이 문서의 핵심

### 0.0 한눈에 보는 그림 — 지금 무엇을 만드는가

현재 시스템은 **"검색어와 글자가 정확히 일치하는 자료만 찾아주는 도서관"**입니다(직접 매칭, FR-19 완료).
Phase 4는 여기에 **"뜻이 비슷한 자료까지 찾아주는 사서"**(의미 유사도 검색)를 추가합니다.

비유:
- 지금: "면세"라고 물으면 제목·본문에 "면세"라는 글자가 있는 조문만 나옴.
- Phase 4 이후: "면세"라고 물으면 글자가 달라도 의미가 가까운 "부가가치세 영세율", "비과세 대상" 같은
  자료까지 **빈약할 때 보완**으로 함께 제시.

> 핵심 제약: 의미 유사도로 찾았다고 해서 **단정(🟢)하지 않습니다.** 벡터로 찾은 결과는
> 🟡 유사 사례 / ⚪ 참고 라벨이며, 기존 law-verifier V1~V6 검증을 **그대로** 통과해야
> 회계사에게 노출됩니다. (정확성 > 완전성 — "틀린 답은 없는 답보다 나쁘다")

---

### 0.1 [항목 1] 3단계 fallback 흐름 + 빈약 판정 정량 기준

PRD §9.3을 그대로 구현합니다. 단계를 **압축·생략하지 않습니다**(CLAUDE.md §5).

```
[1차] 직접 매칭 (기존 searchTaxLaw — 국세·지방세 법령 + 비법령 직접검색 FR-19)
        ↓ "결과 충분?"  ← §0.1.1 빈약 판정 기준 적용
        Yes → 답변 (라벨은 Trust Tier를 따름. 직접검색 = 자동 🟢 아님 — PRD §9.3 v2.2)
        No ↓
[2차] 의미 유사도 (벡터 DB) — 본 Phase에서 신규 활성화
        ↓ "결과 충분?"  ← 동일 기준
        Yes → 답변 (🟡 유사 사례 라벨)
        No ↓
[3차] 상위 개념 확장 검색
        ↓
답변 (⚪ 참고 자료 라벨 + "직접 근거를 찾지 못했습니다" 명시)
```

#### 0.1.1 빈약(불충분) 판정 정량 기준 — 회계사 결정점 ①

판정 대상은 **"인용 가능한 본문(content)이 있는 항목 수"**입니다.
본문이 빈 항목(예: 국세청 출처 판례 메타+링크만)은 카운트에서 제외합니다 — 발췌 인용이 불가능하기 때문입니다(TAX-015 §2.2 교훈).

```
isInsufficient(result) :=
  result.items.filter(it => it.content.trim().length > 0).length < THRESHOLD
```

| 옵션 | THRESHOLD | 효과 | 위험 |
|---|---|---|---|
| 보수적 | 1 | 본문 1건만 있어도 벡터 단계 생략 | 빈약한데도 직접 결과로 끝나 누락 ↑ |
| **권장** | **3** | 본문 3건 미만이면 벡터 보완 진입 | 균형 (PRD KPI: 1차 해결 ≥ 70% 가정과 정합) |
| 적극적 | 5 | 자주 벡터 단계 진입 | 임베딩 호출·비용 ↑, 노이즈 ↑ |

> 권장값은 **3**. 회계사가 골든셋 30건 분포를 보고 1~5에서 확정합니다.

---

### 0.2 [항목 2] 포트(Port) 구조 — ISearchPort 유지 + 2종 신설

헥사고날 원칙(SSOT §4.2: Port 먼저 정의 → Adapter 구현)을 따릅니다.
**기존 `ISearchPort`는 손대지 않습니다**(회귀 위험 0).

```
src/ports/
  taxLawSearchPort.ts      ISearchPort          [기존 유지] 직접 매칭 (국세·지방세·비법령)
  vectorSearchPort.ts      IVectorSearchPort    [신설]      벡터 유사도 검색
  embeddingPort.ts         IEmbeddingPort       [신설]      텍스트 → 임베딩 벡터
```

```ts
// IEmbeddingPort — 텍스트를 벡터로 변환 (어떤 임베딩 모델이든 교체 가능)
export interface IEmbeddingPort {
  embed(text: string): Promise<number[]>          // 단건 (질의용)
  embedBatch(texts: string[]): Promise<number[][]> // 배치 (적재용)
}

// IVectorSearchPort — 질의 벡터와 가까운 자료를 cosine 유사도로 검색
export interface IVectorSearchPort {
  searchSimilar(queryVector: number[], topK: number): Promise<VectorMatch[]>
}

// VectorMatch — 검색된 TaxLaw + 유사도 점수(0~1)
export interface VectorMatch {
  item: TaxLaw          // 기존 도메인 타입 재사용 (원문 보존 §6.1)
  similarity: number    // cosine similarity, 1에 가까울수록 유사
}
```

> 어댑터 교체 가능성 보장(PRD §8: "벡터 DB 교체 가능 pgvector → Pinecone").
> 임베딩 모델도 포트 뒤에 숨겨 OpenAI ↔ Voyage 교체가 usecase에 영향 없게 합니다.

---

### 0.3 [항목 3] 직접/벡터 결과 병합 위치 — 결정점 ②

3단계 fallback을 **어디서 조율(orchestration)할지** 두 안이 있습니다.

| 안 | 방식 | 장점 | 단점 |
|---|---|---|---|
| (a) 점진 도입 | 기존 `searchTaxLaw`에 옵셔널 `vectorPort?`·`embeddingPort?` 주입, 내부에서 빈약 시 fallback | 진입점 1개 유지, 호출부 변경 최소 | 검증된 usecase 복잡도 ↑, 시그니처 비대, 회귀 위험 |
| **(b) 신규 usecase (권장)** | `searchWithFallback(searchPort, vectorPort, embeddingPort, keyword)` 신규 작성. 내부에서 `searchTaxLaw` 호출 → 빈약 시 벡터 → 확장 | **기존 `searchTaxLaw` 무변경**(회귀 0), 3단계 조율이라는 새 관심사 분리, 단계별 테스트 용이 | 진입점 추가, API Route에서 호출 usecase 전환 필요 |

> 권장 **(b)**. CLAUDE.md 계명 7("최소 변경") + 정확성 원칙과 정합 — 이미 골든셋을 통과 중인
> `searchTaxLaw`를 건드리지 않는 것이 가장 안전합니다.
>
> **결과 병합 규칙(공통):** 직접 매칭 결과를 **항상 우선** 배치(Tier↑ → 날짜↓ 결정론 정렬, TAX-015 정책 계승),
> 그 뒤에 벡터/확장 결과를 중복 제거(아래 §0.4 식별자 기준) 후 append. 직접 결과를 벡터 결과로 **대체하지 않습니다**(FR-19 보존, PRD §9.3 v2.2).

---

### 0.4 [항목 4] 벡터 결과의 라벨(🟡/⚪) · 검증(V1~V6) 정합

이 항목이 **정확성의 핵심**입니다. 벡터 도입이 검증을 약화시키면 안 됩니다.

#### (1) 라벨 자동 결정 — `matchStage` 메타 신설
`SearchResult`에 출처 단계 메타를 추가하여 라벨을 결정론적으로 부여합니다.

```ts
// src/domain/SearchResult.ts 확장 (하위호환 — 옵셔널)
export type MatchStage = 'direct' | 'vector' | 'expanded'
export interface SearchResult {
  items: TaxLaw[]
  totalCount: number
  matchStage?: MatchStage   // 신설: 어느 단계에서 채워졌는지
}
```

| matchStage | 라벨 규칙 | 근거 |
|---|---|---|
| `direct` | **Trust Tier를 따름** (법령 T1/T2=🟢, 비법령 T3/T4=🟡/⚪) | PRD §9.3 v2.2 — 직접검색 ≠ 자동 🟢 |
| `vector` | **🟡 유사 사례** 강제 | PRD §9.3 [2차] |
| `expanded` | **⚪ 참고 자료** 강제 + "직접 근거 부재" 명시 | PRD §9.3 [3차] |

#### (2) V1~V6 우회 금지 — 벡터 결과도 동일 파이프라인 통과
- 벡터로 찾은 `TaxLaw[]`는 **새로운 검증 경로를 만들지 않고**, 기존 답변 생성기(`llmAnswerGenerator`)의
  `sourceLaws` 입력에 **합류**시킵니다. → V1(출처 존재)이 `caseNumber`/`articleNumber`로 정상 대조됩니다.
- 벡터는 **"검색 소스를 늘리는 것"**일 뿐, RAG [3]답변생성 → [4]검증 단계는 그대로입니다(CLAUDE.md §5 단계 보존).
- V2(인용 무결성): 벡터 결과의 `content`도 원문 보존(§6.1)이므로 `content.includes(excerpt)` 그대로 동작.
- V3(라벨 적정성): 위 (1) matchStage 기반 라벨과 Trust Tier 정합 검사.
- V6(단정 금지): 🟡 결과에 "이 케이스도 X입니다" 검출 — 기존 로직 그대로 적용.

> ✅ 결론: 벡터 도입으로 **검증 코드 변경 최소**. matchStage→라벨 매핑과 V3 호환 확인만 추가(TAX-026-G).

---

### 0.5 [항목 5] 환경변수 4곳 동시 갱신 계획 (SSOT §4.1)

신규 환경변수는 **`DATABASE_URL` 1개**입니다. 임베딩은 권장안(OpenAI) 채택 시 기존 `OPENAI_API_KEY` 재사용 → **추가 키 0**.

| # | 갱신 위치 | 추가 내용 | 담당 서브태스크 |
|---|---|---|---|
| 1 | `.env.example` | `DATABASE_URL=` (값 없는 템플릿) | TAX-026-B |
| 2 | `src/config.ts` | `databaseUrl: requireEnv('DATABASE_URL')` (Fail-fast) | TAX-026-B |
| 3 | `CLAUDE.md` §7.1 환경변수 표 | `DATABASE_URL` 행 추가 (용도: 벡터 DB) | TAX-026-B |
| 4 | `PRD.md` §12 외부 의존성 표 | line 653 `DATABASE_URL` 행을 "TAX-026 활성화"로 갱신 | TAX-026-B |

> ⚠️ 4곳 중 한 곳이라도 누락 시 PR 머지 차단(SSOT §4.1). Vercel 프로덕션 환경변수 등록은 배포 단계 별도.
> ⚠️ **Voyage 채택 시(결정점 ③):** `VOYAGE_API_KEY`가 추가되어 위 4곳 갱신이 **2개 변수 × 4곳**으로 늘어납니다.
> ⚠️ `.env.example`은 권한 설정상 회계사가 직접 확인·갱신해야 할 수 있습니다(읽기 거부 사례 확인됨) — TAX-026-B에서 명시.

---

### 0.6 [항목 6] 신규 의존성 · 비용 상한 · pgvector 스키마 초안

#### (1) 신규 의존성 (package.json)
| 패키지 | 용도 | 비고 |
|---|---|---|
| `pg` (또는 `postgres`) | Postgres 클라이언트 (pgvector 쿼리) | 신규. Adapter에서만 사용 |
| `@ai-sdk/openai` | 임베딩(OpenAI 채택 시) | **이미 설치됨** — 추가 0 |

> Pinecone 채택 시(결정점 ④) `@pinecone-database/pinecone`로 대체.
> 의존성 추가는 티켓 명시 사항이므로 회계사 승인 후 진행(CLAUDE.md, 템플릿 §3.2).

#### (2) 비용 상한 (PRD §17.3.1 M4)
| 항목 | 상한 |
|---|---|
| LLM | $30~50 |
| 인프라(벡터 DB·임베딩 초기 적재) | $0~30 |
| **총합 상한** | **$80** |

> 초기 임베딩 적재는 **일회성** 비용. text-embedding-3-small은 100만 토큰당 약 $0.02로 매우 저렴.
> 상한 초과 시 인간 승인 없이 사용량 확대 금지(PRD §17.3.1, SSOT §6 Fail-fast).

#### (3) pgvector 스키마 초안 (DDL pseudocode)
```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE taxlaw_embeddings (
  id               BIGSERIAL PRIMARY KEY,
  source_type      TEXT NOT NULL,            -- '법령'|'판례'|'해석례'|'심판례'
  law_name         TEXT NOT NULL,
  article_number   TEXT,                     -- 법령 식별자 (비법령은 NULL 가능)
  case_number      TEXT,                     -- 비법령 식별자 (판례 사건번호 등)
  article_title    TEXT,
  content          TEXT NOT NULL,            -- 원문 보존 (§6.1, 변형 금지)
  embedding        vector(1536),             -- text-embedding-3-small 차원 (Voyage 채택 시 차원 변경)
  revision_date    DATE,
  enforcement_date DATE,
  source_url       TEXT NOT NULL,            -- OC 키 미포함 (§7)
  trust_tier       TEXT NOT NULL,            -- 'T1'~'T4'
  issuing_body     TEXT,                     -- 생산기관
  decision_date    DATE,
  content_hash     TEXT UNIQUE,              -- 중복 적재 방지 (재실행 안전)
  metadata         JSONB,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- 코사인 유사도 인덱스 (데이터 적재 후 생성)
CREATE INDEX ON taxlaw_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

> `content_hash UNIQUE`로 배치 재실행 시 중복 적재를 막아 비용·정합성을 보호합니다.

---

### 0.7 회계사 결정점 요약 (승인 게이트) ⭐⭐

> **B~H 착수 전, 회계사가 아래 4개 항목을 확정해야 합니다.** 권장안을 그대로 채택해도 됩니다.

| # | 결정 항목 | 선택지 | 권장 | 영향 |
|---|---|---|---|---|
| ① | 빈약 임계값 THRESHOLD | 1 / **3** / 5 | **3** | 벡터 단계 진입 빈도·비용 |
| ② | 병합 위치 | (a)점진 도입 / **(b)신규 usecase** | **(b)** | 회귀 위험·코드 구조 |
| ③ | 임베딩 모델 | **OpenAI text-embedding-3-small** / Voyage-2 | **OpenAI** | 신규 키 0(OpenAI) vs 한국어 성능(Voyage) |
| ④ | 벡터 DB | **pgvector** / Pinecone | **pgvector** | 단일 인프라·SQL(pg) vs 관리형(Pinecone) |

**결정점 ③ 상세 (임베딩 모델 유불리):**
- **OpenAI text-embedding-3-small** (권장): 기존 `OPENAI_API_KEY` 재사용 → 신규 키·신규 벤더 0, 비용 최저, 1536차원. 한국어 성능은 "양호" 수준.
- **Voyage-2**: 한국어·검색 특화 성능이 더 나을 수 있으나 `VOYAGE_API_KEY` 신규 발급·관리, 환경변수 갱신 2배, 별도 벤더 의존.

**결정점 ④ 상세 (벡터 DB 유불리):**
- **pgvector** (권장): Postgres 확장. Vercel Postgres/Neon/Supabase에서 지원. SQL 친숙, 단일 DB로 운영 단순, SSOT §1.2 "(향후) 벡터 DB" 자리. `DATABASE_URL` 하나면 됨.
- **Pinecone**: 관리형 전용 벡터 DB. 대규모에 유리하나 별도 서비스·키·콘솔 관리, 벤더 종속, 현재 데이터 규모(법령·판례)에는 과함.

> 회계사 회신란 (✅ 확정 — 2026-05-23):
> - ① THRESHOLD = **3** (본문 3건 미만이면 벡터 보완 진입 — 권장안 채택)
> - ② 병합 위치 = **(b) `searchWithFallback` 신규 usecase** (기존 `searchTaxLaw` 무변경 — 권장안 채택)
> - ③ 임베딩 모델 = **OpenAI text-embedding-3-small** (`OPENAI_API_KEY` 재사용, 1536차원 — 권장안 채택)
> - ④ 벡터 DB = **pgvector** (`DATABASE_URL` 단일 인프라 — 권장안 채택)
> - 승인일/서명: **2026-05-23 / 회계사(gyuhosin165) 결정 회신**
>
> ⚠️ **단, 코딩(B~H) 실착수는 ROADMAP §3 선행조건(골든셋 30건 + P95 재측정) 충족 후.**
> 설계 게이트(§0.7)는 통과했으나, Phase 4 진입 선행조건은 별개로 충족되어야 함.

---

## Metadata

- **Type**: FEAT (설계 단계는 docs)
- **Severity**: major
- **Layer**: docs (본 티켓) → 이후 domain | port | adapter | usecase | infra
- **Milestone**: Post-MVP (M4)
- **Estimated Size**: 본 문서 단독 = S (코드 0줄) / Phase 4 전체 = XL (B~H로 분할 완료)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작
- 검색은 **직접 매칭(키워드 일치)**만 수행(FR-19 완료, TAX-015~016). 글자가 일치하지 않으면 누락.
- 직접 매칭이 빈약할 때 PRD §9.3 [2차] 의미 유사도가 **미도입** → 회계사에게 "유사도 검색 미도입"을 솔직히 노출 중(현행).
- `IVectorSearchPort`·`IEmbeddingPort`·벡터 DB·임베딩 적재 경로가 전무.

### 1.2 기대 동작
- 직접 매칭이 빈약하면 **의미 유사도(벡터)** → **상위 개념 확장** 순으로 보완.
- 벡터/확장 결과는 🟡/⚪ 라벨로만 제시(단정 금지), law-verifier V1~V6를 그대로 통과.
- 직접 매칭(FR-19)은 **대체되지 않고 보존**된다.

### 1.3 영향·중요도
- 실무에서 조문이 불분명할 때 회계사는 의미가 가까운 자료를 탐색한다. 본 기능은 그 탐색을 시스템화한다.
- PRD KPI(1차 해결률, 재현율 ≥ 80%)의 빈약 케이스 보완 경로.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일 (Phase 4 전체)
- `src/domain/SearchResult.ts` (수정 — `matchStage?` 추가)
- `src/ports/vectorSearchPort.ts`, `src/ports/embeddingPort.ts` (신규)
- `src/adapters/vectorSearch.ts`, `src/adapters/embedding.ts` (신규)
- `src/usecases/searchWithFallback.ts` (신규 — 병합안 (b) 채택 시)
- `scripts/embed.ts` (신규 — 오프라인 임베딩 적재 배치)
- `src/config.ts`, `.env.example`, `CLAUDE.md` §7.1, `PRD.md` §12 (환경변수 4곳)
- `src/adapters/lawVerifier.ts` (확인 — V3 matchStage 라벨 호환)
- `package.json` (의존성 `pg` 추가)

### 2.2 외부 리소스
- pgvector: https://github.com/pgvector/pgvector
- OpenAI Embeddings(text-embedding-3-small, 1536차원): 기존 `OPENAI_API_KEY`
- PRD §8 기술스택 / §9.3 fallback / §12 의존성 / §17.3.1 비용 상한 / SSOT §4.1 환경변수

### 2.3 아키텍처 힌트 (병합안 (b) 기준)
```
UI → /api/answer → searchWithFallback (usecase, 신규)
                     ├─ [1차] searchTaxLaw(ISearchPort)              [기존 무변경]
                     │         ↓ 빈약 판정(THRESHOLD)
                     ├─ [2차] embeddingPort.embed → vectorSearchPort.searchSimilar
                     │         → matchStage='vector' (🟡)
                     └─ [3차] 상위 개념 확장 → matchStage='expanded' (⚪)
                  → 병합(직접 우선) → generateAnswer.sourceLaws 합류 → [4] 검증 V1~V6 → [5] 출력
```

---

## 3. Scope (작업 범위) ⭐

### 3.1 허용 (본 티켓 TAX-026-A 한정)
- [ ] `docs/tickets/TAX-026_vector_db_phase4.md` 작성(본 문서) — **코드 0줄**

### 3.2 금지
- ❌ 본 티켓 단계에서 프로덕션 코드·스키마·의존성 변경 (B~H 소관, 회계사 승인 후)
- ❌ 회계사 결정점(§0.7) 미확정 상태에서 B~H 착수
- ❌ RAG 5단계 압축·생략, 검증[4] 우회 (CLAUDE.md §5)
- ❌ 법령/비법령 원문 임의 가공·요약·의역 (CLAUDE.md §6.1)
- ❌ FR-19 직접검색 재구현·대체 (PRD §9.3 v2.2)

---

## 4. Strategy (본 문서 작성 절차 — 완료)
1. 템플릿·기존 티켓(TAX-015) 형식 로드 ✅
2. PRD §9.3·§8·§12·§17.3.1, SSOT §4.1, ROADMAP §2 인용해 6개 항목 작성 ✅
3. 회계사 결정점 4개 표로 명시(유불리·권장안) ✅
4. pgvector 스키마 초안·비용 상한 명시 ✅
5. B~H 서브태스크 매핑(§9) ✅

---

## 5. Acceptance Criteria (본 티켓 완료 조건)
1. [ ] 설계 문서가 6개 항목(fallback·포트·병합위치·라벨/검증정합·환경변수·의존성/비용/스키마)을 모두 포함.
2. [ ] 회계사 결정점이 표(§0.7)로 명시되고 유불리·권장안 표기.
3. [ ] B~H 서브태스크 매핑(§9)이 존재.
4. [ ] 인용한 수치·환경변수가 PRD/SSOT 원문과 일치(§6.1 인용 무결성).
5. [ ] **회계사 승인 서명(또는 결정 회신) 확보** → 게이트 통과 → B~H 착수 가능.

---

## 6. Verification (검증 단계 — 회계사)
1. 본 문서 §0.7 결정점 4개를 검토하고 회신란을 채운다.
2. §0.1 빈약 임계값·§0.3 병합 방식이 실무 직관과 맞는지 확인.
3. ROADMAP §3 Phase 4 진입 선행조건(골든셋 30건 + P95 재측정) 충족 여부 확인.
4. 승인 시 서명/일자 기재 → AI에게 "TAX-026-B 착수" 지시.

---

## 7. Risks / Notes
- **선행조건 미충족 위험:** ROADMAP §3은 Phase 4 진입 전 "골든셋 30건 + P95 재측정"을 권장. 이는 AI 단독 불가 → 회계사 게이트.
- **임베딩 차원 종속:** OpenAI(1536) ↔ Voyage(차원 상이) 변경 시 스키마 `vector(N)`·재적재 필요 → 결정점 ③을 **적재 전** 확정.
- **검증 약화 위험:** 벡터 결과가 별도 경로로 새면 V1 우회 가능 → 반드시 `sourceLaws` 합류(§0.4 (2)).
- **비용 폭증 위험:** 임계값↑ 또는 topK↑ 시 임베딩 호출 증가 → $80 상한 모니터링(PRD §17.3.1).
- **`.env.example` 권한:** 읽기 거부 사례 확인됨 → 회계사 직접 갱신 가능성(TAX-026-B notes).

---

## 8. AI Implementation Instructions
### 8.1 코딩 전: 본 문서가 곧 계획. 회계사 §0.7 승인 = 코딩 전 게이트.
### 8.2 코딩 후(B~H 각각): 변경 파일 / 요약 / 검증 PASS·FAIL / 위험 / `docs/reports/TAX-026X_report.md`

---

## 9. Phase 4 서브태스크 매핑 (B ~ H) — shrimp 등록 완료

| 서브태스크 | 내용 | 의존 | 신규 산출물 |
|---|---|---|---|
| **TAX-026-A** | 본 설계 문서 + 회계사 승인 게이트 (코드 0줄) | — | `docs/tickets/TAX-026_*.md` |
| **TAX-026-B** | 벡터 인프라: pgvector 스키마 + `DATABASE_URL` 환경변수 4곳 갱신 | A | 마이그레이션, `config.ts` |
| **TAX-026-C** | 임베딩 어댑터: `IEmbeddingPort` + `embedding.ts` (OpenAI 재사용) | A | `ports/embeddingPort.ts`, `adapters/embedding.ts` |
| **TAX-026-D** | 벡터 검색 어댑터: `IVectorSearchPort` + `vectorSearch.ts` | B, C | `ports/vectorSearchPort.ts`, `adapters/vectorSearch.ts` |
| **TAX-026-E** | 임베딩 적재 배치: `scripts/embed.ts` (오프라인, content_hash 중복 방지) | B, C | `scripts/embed.ts` |
| **TAX-026-F** | 3단계 fallback 통합: `searchWithFallback` usecase + `matchStage` 메타 | D | `usecases/searchWithFallback.ts`, `domain/SearchResult.ts` |
| **TAX-026-G** | 라벨·검증 정합: 🟡/⚪ 자동화 + V1~V6 호환 확인 | F | `lawVerifier.ts` V3 호환 |
| **TAX-026-H** | 골든셋 회귀 + Playwright E2E + 리포트 | G | `eval/`, `docs/reports/` |

```
A ──┬── B ──┬── D ── F ── G ── H
    └── C ──┘        (D는 B·C 둘 다 필요)
        └── E         (E도 B·C 필요, D와 병렬)
```

> 크리티컬 패스: A → (B,C) → D → F → G → H. 병렬 기회: B∥C, D∥E.

---

## 10. Related Tickets
- 선행(트랙 의존): 리팩터 트랙 TAX-018~022(완료) — 안전망·공통 빌더 정비로 fallback 통합 위험 완화.
- 후속: TAX-026-B ~ H (본 문서 §9).
- 참조: PRD §9.3·§8·§12·§17.3.1, SSOT §4.1, ROADMAP §2 Phase 4.
- PRD/SSOT 옛 가칭(M4=TAX-013, 임베딩/DB=TAX-004)은 **실제 트랙 TAX-026**으로 수렴(번호 불일치 주의).

---

## 11. Report Link
Report: `docs/reports/TAX-026-A_report.md` (미작성 — 회계사 승인 후 갱신)

---

**작성자**: AI 초안 (회계사 검토·승인 대기)
**작성일**: 2026-05-23
**최종 수정일**: 2026-05-23
