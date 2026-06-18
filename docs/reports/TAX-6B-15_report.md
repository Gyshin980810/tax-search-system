# TAX-6B-15 리포트 — 임베딩 모델 voyage-4 전환 (OpenAI → Voyage)

- **티켓**: `docs/tickets/TAX-6B-15_voyage_embedding.md`
- **브랜치**: `feat/tax-6b-15-voyage-embedding`
- **작업일**: 2026-06-18
- **선행**: TAX-026-C(OpenAI 임베딩 어댑터), TAX-6B-13/14(판례 코퍼스 PoC·라이브 배선)
- **회계사 결정**: 임베딩 차원 = **1024** (비용 동일($0)·정확도 차이 1~2%p로 미미·P95 여유가 얇아 2048은 부담)

---

## 1. 변경 사항 요약

### 파일 변경 목록
- `src/adapters/embedding.ts` (수정) — `VoyageEmbeddingAdapter` 신규(voyage-4, 1024차원), `OpenAIEmbeddingAdapter`는 롤백용 보존
- `src/config.ts` (수정) — `voyageApiKey: requireEnv('VOYAGE_API_KEY')` 추가(fail-fast)
- `scripts/migrate.sql` (수정) — `embedding vector(1536)` → `vector(1024)`
- `scripts/embed.ts` (수정) — 적재 어댑터·키 검증 voyage 교체 + 차원 경고 주석
- `app/api/answer/route.ts` (수정) — 임베딩 주입 voyage 교체(답변 생성 LLM은 GPT-4o-mini 유지)
- `scripts/perf/measureP95.ts` (수정) — 임베딩 어댑터 voyage 교체
- `scripts/smokeVector.ts` (수정) — 어댑터·`VOYAGE_API_KEY` 검증 교체
- `scripts/golden/reviewPhase6a.ts` (수정) — 어댑터 voyage 교체
- `tests/setup.ts` (수정) — `VOYAGE_API_KEY` 더미 키(config requireEnv 통과용)
- `.env.example` (수정) — `VOYAGE_API_KEY` 추가 + 실제 자격증명 제거(보안, 별도 커밋)
- `package.json` / `package-lock.json` (수정) — `@ai-sdk/voyage@^1.0.7` 의존성 추가
- `docs/tickets/TAX-6B-15_voyage_embedding.md` (신규)

### 주요 변경 (동작)
1. **어댑터만 교체**: `IEmbeddingPort`(embed/embedBatch)는 무변경 → Usecase·검색 코드 전혀 손대지 않음(포트-어댑터 패턴 이점).
2. **voyage-4 / 1024차원**: `providerOptions.voyage.outputDimension=1024`. 마트료시카(MRL) 구조라 2048 정확도의 98%+ 유지하면서 저장·속도 효율 우수.
3. **DB 스키마 정합**: `migrate.sql`을 `vector(1024)`로 변경. 어댑터·스키마·적재 데이터 차원 3자 일치 필수.
4. **롤백 경로 보존**: `OpenAIEmbeddingAdapter` 유지 → 정확도 회귀 시 주입만 되돌리고 1536으로 재적재하면 즉시 복귀.
5. **답변 생성 LLM 무변경**: 임베딩(검색용 숫자 벡터)과 답변 생성(GPT-4o-mini, 글 출력)은 별개 모델. 이번 전환은 임베딩만.

### 정확성·보안 안전장치 (CLAUDE.md 정합)
- 임베딩 전환은 검색 후보 발굴 단계만 영향 — 라벨링·인용 무결성(§6.1)·검증(V1~V6) 로직 무변경.
- `.env.example`에 노출돼 있던 실제 운영 자격증명(Neon DB 비밀번호·세션 시크릿·베타 패스코드 등) 전량 플레이스홀더로 치환(§7) — 별도 보안 커밋.

---

## 2. 검증 결과

| 단계 | 결과 |
|---|---|
| `npm run typecheck` | ✅ 0 에러 |
| 전체 회귀(`npm run test`) | ✅ **639/639 PASS** |
| `@ai-sdk/voyage` 호환 | ✅ `@ai-sdk/provider@3.0.10`(우리와 동일), AI SDK v6 호환 |
| `tests/setup.ts` 더미 키 | ✅ `VOYAGE_API_KEY` 미설정 환경에서도 config 통과 |

> 라이브 정확도·P95 실측은 `VOYAGE_API_KEY` 발급 + 전량 재적재 이후(아래 §4).

---

## 3. 잠재 위험 / 후속

- **배포 순서 의존성 (중요)**: 코드 머지 → Vercel `VOYAGE_API_KEY` 등록 → 재배포. 미등록 상태로 배포하면 `config.ts` fail-fast로 **앱 기동 실패**. 반드시 키 등록 후 재배포.
- **차원 정합**: 어댑터(1024)·DB 스키마(1024)·적재 데이터가 모두 같아야 cosine 검색 동작. 하나라도 어긋나면 검색이 깨짐.
- **재적재 필수**: 기존 1536 벡터(303건)는 무효 → `TRUNCATE` 후 전량 재적재.
- **diagnostics 스크립트 제외**: `scripts/diagnostics/*.mjs`(7개)는 과거 일회성 디버그용으로 범위 밖 — `OpenAIEmbeddingAdapter` 유지. 1024 DB로 재실행 시 차원 불일치로 깨지나 현재 미사용이라 무방.

---

## 4. 다음 단계 (회계사 / 키 필요)

1. **VOYAGE_API_KEY 발급** → `.env.local`(로컬) + Vercel 환경변수(운영) 등록
2. **DB 마이그레이션**: `migrate.sql` 적용(`vector(1024)`) + 기존 303건 `TRUNCATE`
3. **전량 재적재**: `npm run embed` (전량 판례 10,083건 — voyage 첫 2억 토큰 무료라 비용 $0)
4. **검증**: `npm run smoke:vector` + 골든셋 회귀 + `npm run perf:p95` + 정확도 회귀 확인
5. **롤백 기준**: 정확도가 OpenAI 대비 떨어지면 `route.ts` 주입을 `OpenAIEmbeddingAdapter`로 되돌리고 1536으로 재적재
6. (병행) **`.env.example` 노출 시크릿 재발급(rotation)** — Neon DB 비밀번호·SESSION_SECRET·BETA_ACCESS_CODE·GEMINI/국세 키
