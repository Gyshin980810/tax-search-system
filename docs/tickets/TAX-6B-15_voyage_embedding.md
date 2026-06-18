# TAX-6B-15 임베딩 모델 voyage-4 전환 (OpenAI → Voyage)

> 전량 판례 적재(10,083건, TAX-6B-13 후속) **이전에** 임베딩 모델을 확정하기 위한 전환.
> 적재 후 모델을 바꾸면 전량 재적재가 필요하므로, 적재 직전에 모델을 정한다.

---

## Metadata

- **Type**: FEAT (인프라/모델 교체)
- **Severity**: minor
- **Layer**: adapter / config / scripts
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: M (8~10파일, 어댑터 1개 신규 + 주입 지점 교체)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작
- 의미 검색·판례 임베딩이 **OpenAI text-embedding-3-small(1536차원)**을 사용한다.
- 한국어 법률 도메인에서 OpenAI 임베딩의 검색 정확도가 최상은 아니며, 전량 판례(10,083건) 적재를 앞두고 더 나은 모델을 검토.

### 1.2 기대 동작
- 임베딩을 **voyage-4(1024차원)**로 전환한다.
- 포트(`IEmbeddingPort`)는 그대로 두고 **어댑터만 교체** → Usecase·검색 코드 무변경.
- DB 스키마를 `vector(1024)`로 맞추고, 모델 전환 시 전량 재적재한다.

### 1.3 영향·중요도
- voyage-4는 다국어·법률 도메인에서 한국어 검색 정확도가 OpenAI 대비 우수(공개 벤치 기준 1~2%p+).
- 적재 직전 전환이라 **재적재 비용 0건 추가**(어차피 첫 전량 적재 예정), voyage 첫 2억 토큰 무료라 금전 비용 $0.
- 차원 1536→1024로 저장·검색 효율 향상(P95 여유 확보).

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일
- `src/adapters/embedding.ts` (수정) — `VoyageEmbeddingAdapter` 신규, `OpenAIEmbeddingAdapter`는 롤백용 유지
- `src/config.ts` (수정) — `voyageApiKey: requireEnv('VOYAGE_API_KEY')` 추가
- `scripts/migrate.sql` (수정) — `embedding vector(1536)` → `vector(1024)`
- `scripts/embed.ts` (수정) — 적재 어댑터·키 검증 voyage로 교체, 차원 경고 주석
- `app/api/answer/route.ts` (수정) — 임베딩 어댑터 주입 voyage로 교체
- `scripts/perf/measureP95.ts`·`scripts/smokeVector.ts`·`scripts/golden/reviewPhase6a.ts` (수정) — 어댑터·키 교체
- `tests/setup.ts` (수정) — `VOYAGE_API_KEY` 더미(config requireEnv 통과용)
- `.env.example` (수정) — `VOYAGE_API_KEY` 추가

### 2.2 외부 API·리소스
- Voyage AI — voyage-4 모델, `@ai-sdk/voyage@^1.0.7`(deps: `@ai-sdk/provider@3.0.10` 우리와 동일, AI SDK v6 호환)
- API: `createVoyage({apiKey})` → `.textEmbeddingModel('voyage-4')`, `providerOptions: { voyage: { outputDimension: 1024 } }`
- pgvector(`taxlaw_embeddings`) — `vector(N)`은 고정 차원 → 모델 차원 변경 시 스키마 변경 + 전량 재적재 필수

### 2.3 아키텍처 힌트
```
IEmbeddingPort (포트, 무변경)
  ├ OpenAIEmbeddingAdapter (1536, 롤백 경로로 보존)
  └ VoyageEmbeddingAdapter (1024, 신규·운영 주입)   ← 주입 지점만 교체
```

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경
- [ ] `embedding.ts`: `VoyageEmbeddingAdapter` 신규
- [ ] `config.ts`: `voyageApiKey` 추가
- [ ] `migrate.sql`: 차원 1024
- [ ] `embed.ts`·`route.ts`·`measureP95.ts`·`smokeVector.ts`·`reviewPhase6a.ts`: 어댑터·키 교체
- [ ] `tests/setup.ts`: 더미 키
- [ ] `.env.example`: `VOYAGE_API_KEY`
- [ ] `package.json`: `@ai-sdk/voyage` 의존성 추가

### 3.2 금지되는 변경
- ❌ `IEmbeddingPort` 인터페이스 변경 (어댑터만 교체)
- ❌ 답변 생성 LLM 변경 (GPT-4o-mini 유지 — 임베딩과 별개)
- ❌ 검색·라벨링·검증 로직 변경
- ❌ `OpenAIEmbeddingAdapter` 삭제 (롤백 경로 보존)
- ❌ RAG 5단계 구조·폴더 구조 변경

---

## 4. Strategy (구현 힌트)

1. **어댑터 신규**: `VoyageEmbeddingAdapter`가 `IEmbeddingPort`(embed/embedBatch) 구현, `providerOptions.voyage.outputDimension=1024`.
2. **상수 단일화**: `VOYAGE_EMBEDDING_MODEL='voyage-4'`, `VOYAGE_OUTPUT_DIMENSION=1024`를 어댑터 상단 상수로.
3. **DB 스키마 정합**: `migrate.sql`의 `vector(1536)`→`vector(1024)`. 적재 전 `TRUNCATE` 후 전량 재적재(차원 불일치 시 검색 깨짐).
4. **주입 지점 교체**: 운영(route.ts)·스크립트(embed/measureP95/smokeVector/reviewPhase6a)의 `new OpenAIEmbeddingAdapter(config.openaiApiKey)` → `new VoyageEmbeddingAdapter(config.voyageApiKey)`.
5. **롤백 안전성**: `OpenAIEmbeddingAdapter` 보존 → 정확도 회귀 시 주입만 되돌리고 OpenAI 차원으로 재적재하면 복귀.

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `VoyageEmbeddingAdapter`가 `IEmbeddingPort`를 구현하고 1024차원 벡터를 반환한다.
2. [ ] 운영·스크립트의 임베딩 주입이 voyage로 교체된다(답변 생성 LLM은 OpenAI 유지).
3. [ ] DB 스키마가 `vector(1024)`로 정합된다.
4. [ ] `config.voyageApiKey`가 fail-fast 검증된다(미설정 시 기동 실패).
5. [ ] `OpenAIEmbeddingAdapter`가 롤백 경로로 보존된다.
6. [ ] `npm run typecheck` 0 에러, `npm run test` 전건 PASS.

---

## 6. Verification (검증 단계)

1. `npm run typecheck` — 0 에러
2. `npm run test` — 전건 PASS(`tests/setup.ts` 더미 키로 config 통과)
3. `@ai-sdk/voyage` 의존성 호환 확인(`@ai-sdk/provider` 버전 정합)
4. (회계사 라이브, 키 필요) `VOYAGE_API_KEY` 발급 → `.env.local`·Vercel 등록 → `migrate.sql`(vector 1024) → 기존 적재 `TRUNCATE` → 전량 재적재(`npm run embed`) → `smokeVector` + 골든셋 회귀 + P95 재측정 + 정확도 회귀 확인(떨어지면 OpenAI 롤백)

---

## 7. Risks / Notes (위험·주의사항)

- **배포 순서 의존성**: 코드 머지 → Vercel `VOYAGE_API_KEY` 등록 → 재배포. 미등록 상태로 배포 시 `config.ts` fail-fast로 앱 기동 실패. **반드시 키 등록 후 재배포.**
- **차원 정합**: 어댑터(1024)·DB 스키마(1024)·적재 데이터가 모두 같아야 검색이 동작. 하나라도 어긋나면 cosine 검색이 깨진다.
- **재적재 필수**: 모델 전환 시 기존 1536 벡터는 무효 → `TRUNCATE` 후 전량 재적재.
- **diagnostics 스크립트 제외**: `scripts/diagnostics/*.mjs`(7개)는 과거 일회성 디버그용으로 본 티켓 범위 밖. `OpenAIEmbeddingAdapter` 사용 유지 — 1024 DB로 재실행 시 차원 불일치로 깨짐(현재 미사용이라 무방).
- **라이브 검증은 키 발급 후**: 정확도·P95 실측은 `VOYAGE_API_KEY` 발급·재적재 이후 회계사 환경에서 수행.

---

## 8. Related Tickets (관련 티켓)

- 선행: `TAX-026-C`(OpenAI 임베딩 어댑터), `TAX-6B-13`(판례 코퍼스 PoC), `TAX-6B-14`(판례 라이브 배선)
- 후속: 전량 판례 10,083건 적재(voyage 전환 완료 후)

---

## 11. Report Link

Report: `docs/reports/TAX-6B-15_report.md`

---

**작성자**: AI (Claude Code) + 회계사 승인
**작성일**: 2026-06-18
**최종 수정일**: 2026-06-18
