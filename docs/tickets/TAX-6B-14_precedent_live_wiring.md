# TAX-6B-14 판례 코퍼스 라이브 배선 (pgvector → 참고 목록)

> 선행 PoC: TAX-6B-13(판례 코퍼스 적재 + 오프라인 프로브). 본 티켓은 그 코퍼스를
> 실서비스 응답의 참고 목록(references)에 의미검색으로 연결한다.

---

## Metadata

- **Type**: FEAT
- **Severity**: minor
- **Layer**: usecase / adapter / port
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: M (3~5파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작
- 참고 목록(`references`) 후보는 **외부 API가 그때그때 검색한 결과**(`searchResult.items`)에서만 나온다.
- TAX-6B-13에서 pgvector(`taxlaw_embeddings`)에 적재한 **대법원 판례(T4) 코퍼스**는 적재만 돼 있고, 실응답에서 전혀 노출되지 않는다.
- PoC 프로브 결과: 판례 사건명이 "○○세부과처분취소"로 천편일률이라 글자검색은 거의 놓치고, 의미검색이 본문으로 구제(★구제 5건)됨을 확인. 단 **노이즈 동반**(무관 판례가 유사도 42%로 진짜 이득 38%보다 높게 뜨는 사례).

### 1.2 기대 동작
- 질의가 들어오면 동일 질문 임베딩으로 pgvector의 **판례(`sourceType='판례'`)만** 의미검색해 상위 후보를 가져온다.
- **보수적 2단 게이트**(유사도 바닥 + 상위 N건)를 통과한 판례만 참고 목록 후보에 합류시킨다.
- 합류한 판례는 **⚪참고자료(T4)**로만 노출되며, 발췌(excerpt) 인용으로 승격되지 않는다.

### 1.3 영향·중요도
- PoC가 입증한 "글자검색이 놓치는 판례를 의미검색이 구제" 이득을 실제 회계사 화면에 전달.
- T4·참고 목록 한정이라 정확성 위험은 ⚪ 라벨 범위 내(V검증 비대상)로 제한.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일
- `src/usecases/generateAnswer.ts` (수정) — `buildReferences`에 판례 의미검색·게이트·병합 추가, `generateAnswer` 시그니처에 `vectorSearchPort?` 추가
- `src/adapters/vectorSearch.ts` (수정 소) — `searchSimilar`에 `sourceType` 필터 추가
- `src/ports/vectorSearchPort.ts` (수정 소) — `searchSimilar` 시그니처에 선택 `sourceType` 파라미터 추가
- `tests/unit/generateAnswer.test.ts` 또는 신규 `tests/unit/precedentReferences.test.ts` (신규/수정) — 회귀 테스트

### 2.2 외부 API·리소스
- pgvector(`taxlaw_embeddings`) — TAX-026 자산, 판례 300건 적재 완료(TAX-6B-13, 2026-06-18)
- OpenAI text-embedding-3-small — 질문 임베딩(`IEmbeddingPort`)

### 2.3 아키텍처 힌트
```
generateAnswer(usecase)
  └ buildReferences
       ├ (기존) 외부 API 후보 글자+의미 점수 → 컷오프
       └ (신규) vectorSearchPort.searchSimilar(queryVec, K, '판례')
                 → 유사도 바닥 게이트 → 상위 N건 → 병합(중복 제거)
```

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경
- [ ] `src/usecases/generateAnswer.ts`: 판례 검색·게이트·병합, 질문 임베딩 1회 공유
- [ ] `src/adapters/vectorSearch.ts`: `sourceType` 필터 SQL
- [ ] `src/ports/vectorSearchPort.ts`: 선택 파라미터 추가
- [ ] 테스트 신규/수정

### 3.2 금지되는 변경
- ❌ 판례를 발췌(excerpt) 인용·citation으로 승격 (V1~V6 비대상 유지)
- ❌ 판례 `content` 원문 가공·요약 (§6.1 문자 단위 보존)
- ❌ 기존 6B-10/11/12 글자+의미 점수 로직 회귀 (동작 보존)
- ❌ RAG 5단계 구조 변경, 폴더 구조 변경
- ❌ `package.json` 의존성 추가

---

## 4. Strategy (구현 힌트)

1. **Port·Adapter**: `searchSimilar(queryVector, topK, sourceType?)` — `sourceType` 전달 시 `WHERE source_type = $3` 추가. 기존 호출(2인수)은 무변경.
2. **질문 임베딩 1회**: `buildReferences` 진입 시 질문 벡터를 1회 산출해 (a)판례 검색 (b)6B-12 의미 재정렬이 공유 → 추가 임베딩 콜 0.
3. **판례 게이트**: `searchSimilar(queryVec, PRECEDENT_TOP_K, '판례')` → `similarity >= PRECEDENT_MIN_SIMILARITY` 필터 → 상위 `PRECEDENT_MAX`건.
4. **병합**: 기존 컷오프 통과 후보 + 게이트 통과 판례 → `identityKey` 중복 제거 → 기존 정렬(점수↓·선고일↓·사건번호↑) → `MAX_REFERENCES` 상한.
5. **graceful degrade**: `vectorSearchPort`/`embeddingPort` 미주입 또는 실패 시 판례 경로를 조용히 건너뛴다(기존 동작 회귀 없음).

상수 초기값(PoC 실측 기준, 추후 회계사 튜닝 가능):
- `PRECEDENT_TOP_K = 5`
- `PRECEDENT_MIN_SIMILARITY = 0.5`
- `PRECEDENT_MAX = 2`

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `vectorSearchPort` 주입 시, 질문과 의미가 가까운 판례(유사도≥바닥)가 참고 목록에 ⚪T4로 노출된다.
2. [ ] 유사도 바닥 미만 판례는 노출되지 않는다.
3. [ ] 게이트 통과 판례가 많아도 `PRECEDENT_MAX`건으로 제한된다.
4. [ ] `vectorSearchPort` 미주입 시 기존 동작과 동일(판례 경로 없음).
5. [ ] `vectorSearchPort`/`embeddingPort` 실패 시 빈손 없이 외부 API 참고 목록은 정상 구성(graceful degrade).
6. [ ] 판례 `content`는 원문 그대로(§6.1), 발췌 인용으로 승격되지 않는다.
7. [ ] 질문 임베딩은 판례 검색·의미 재정렬 통틀어 1회만 호출된다(P95 보호).
8. [ ] 기존 vitest 전건 + 신규 회귀 PASS.

---

## 6. Verification (검증 단계)

1. `npm run test` — 신규 포함 전건 PASS
2. `npm run typecheck` — 0 에러
3. (회계사 라이브) `DATABASE_URL`·`OPENAI_API_KEY` 설정 후 판례가 잘 잡히는/노이즈가 걸러지는 질의 표본 확인
4. P95 회귀: `npm run perf:p95` — 누적 P95 < 15s 유지 확인(판례 경로는 임베딩 콜 0·DB 1콜 추가)

---

## 7. Risks / Notes (위험·주의사항)

- 유사도 바닥(0.5)은 PoC 표본 기준 추정치. 노이즈(0.42)와 진짜이득(0.38)이 역전된 사례가 있어 **바닥만으로 완전 분리는 불가** — `PRECEDENT_MAX` 소수 제한 + ⚪라벨로 위험을 가둔다.
- 라이브 P95는 회계사 실측 필요(스텁 테스트는 임베딩·DB를 흉내).
- 판례는 T4 ⚪ 참고자료 — 회계사 판단 보조용이며 직접 근거 아님.

---

## 8. Related Tickets (관련 티켓)

- 선행: `TAX-6B-13_precedent_corpus_poc.md`(코퍼스 적재·프로브), `TAX-6B-12`(의미 재정렬 구조)
- 참조: `TAX-026-D`(벡터 검색 포트·어댑터), `TAX-6B-10`(엄격 컷오프)

---

## 11. Report Link

Report: `docs/reports/TAX-6B-14_report.md` (작성중)

---

**작성자**: AI (Claude Code) + 회계사 승인
**작성일**: 2026-06-18
**최종 수정일**: 2026-06-18
