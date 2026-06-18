# TAX-6B-14 리포트 — 판례 코퍼스 라이브 배선 (pgvector → 참고 목록)

- **티켓**: `docs/tickets/TAX-6B-14_precedent_live_wiring.md`
- **브랜치**: `feat/tax-6b-14-precedent-live-wiring` (브랜치 A `feat/tax-6b-10-11-12-nonlaw-relevance`에서 분기)
- **작업일**: 2026-06-18
- **선행**: TAX-6B-13(판례 코퍼스 적재·프로브), TAX-6B-12(의미 재정렬 구조)

---

## 1. 변경 사항 요약

### 파일 변경 목록
- `src/ports/vectorSearchPort.ts` (수정) — `searchSimilar`에 선택 `sourceType` 파라미터 추가
- `src/adapters/vectorSearch.ts` (수정) — `sourceType` 지정 시 `AND source_type = $3` 필터(파라미터 바인딩, SQL 인젝션 방지)
- `src/usecases/generateAnswer.ts` (수정) — 판례 의미검색·보수적 게이트·병합, 질문 임베딩 1회 공유
- `app/api/answer/route.ts` (수정) — `vectorSearchPort` 주입 + 공유 어댑터 정리(Pool·임베딩 중복 생성 제거)
- `tests/unit/precedentReferences.test.ts` (신규) — 회귀 8건
- `scripts/perf/measureP95.ts` (수정) — 운영 경로와 동일하게 `embeddingPort`·`vectorSearchPort` 주입(옵션 A), `embedding`·`precedent` 단계 시간 분리 관측
- `docs/tickets/TAX-6B-14_precedent_live_wiring.md` (신규)

### 주요 변경 (동작)
1. **판례 라이브 검색**: 질의가 들어오면 동일 질문 벡터로 pgvector의 `sourceType='판례'`만 의미검색(`PRECEDENT_TOP_K=5`).
2. **보수적 2단 게이트**: `similarity ≥ PRECEDENT_MIN_SIMILARITY(0.5)` 통과분만 → 상위 `PRECEDENT_MAX(2)`건.
3. **병합·중복 제거**: 이미 인용됐거나 외부 후보에 있는 사건번호(`identityKey`)는 제외 → 기존 정렬(점수↓·선고일↓·사건번호↑) → `MAX_REFERENCES(10)` 상한.
4. **임베딩 1회 공유(P95)**: `applySemanticScores`가 질문 벡터(`queryVec`)를 함께 반환하고, 판례 검색이 이를 재사용 → 추가 임베딩 콜 0, DB 1콜만 추가.
5. **graceful degrade**: `vectorSearchPort`/`embeddingPort` 미주입 또는 검색 실패 시 판례 경로만 조용히 건너뛴다(기존 동작 회귀 없음).

### 정확성 안전장치 (CLAUDE.md 정합)
- 판례는 **`references`(참고 목록)로만** 노출 — V1~V6 비대상, 발췌(excerpt) 인용 승격 금지 (§6.4, 회계사 결정 2026-06-17).
- 판례 `content`는 어댑터가 DB 원문을 그대로 매핑 — 가공·요약 없음 (§6.1).
- T4 ⚪ 참고자료 — 직접 근거 아님.

---

## 2. 검증 결과

| 단계 | 결과 |
|---|---|
| `npm run typecheck` | ✅ 0 에러 |
| 신규 테스트(`precedentReferences.test.ts`) | ✅ 8/8 PASS |
| 전체 회귀(`npm run test`) | ✅ **639/639 PASS** (기존 631 + 신규 8) |
| 변경 파일 린트(`eslint`) | ✅ 0 (기존 무관 에러 5건은 app/page.tsx 등 별개 파일) |

### 신규 테스트 8건 (커버리지)
1. 유사도 바닥(0.5) 이상 판례를 ⚪T4로 노출 + `searchSimilar(_, 5, '판례')` 한정 호출
2. 유사도 바닥 미만 판례 제외
3. 게이트 통과가 많아도 `PRECEDENT_MAX(2)`건 제한
4. `vectorSearchPort` 미주입 시 판례 경로 없음(기존 동작 보존)
5. `embeddingPort` 미주입(질문 벡터 없음) 시 판례 검색 미호출
6. 판례 검색 실패 시 graceful degrade(파이프라인 정상 완료)
7. 외부 후보와 중복 사건번호 제거
8. 질문 임베딩 1회만 호출(P95 보호)

---

## 3. 잠재 위험 / 후속

- **유사도 바닥(0.5)은 PoC 표본 추정치.** 노이즈(0.42)·진짜이득(0.38) 역전 사례가 있어 바닥만으로 완전 분리는 불가 → `PRECEDENT_MAX` 소수 제한 + ⚪라벨로 위험을 가둔 설계. 라이브 표본으로 임계값 튜닝 필요.
- **라이브 P95 실측 필요.** 단위 테스트는 임베딩·DB를 스텁으로 흉내. 판례 경로는 임베딩 콜 0·DB 1콜 추가라 누적 P95(현행 13.46s < 15s)에 미치는 영향은 작을 것으로 예상하나, 회계사 환경(`DATABASE_URL`·`OPENAI_API_KEY`)에서 `npm run perf:p95` 재확인 권장.
- **상수 노출**: `PRECEDENT_TOP_K`·`PRECEDENT_MIN_SIMILARITY`·`PRECEDENT_MAX`는 `generateAnswer.ts` 상단 상수로 두어 추후 조정 용이.

---

## 4. 다음 단계 제안

1. (회계사) 라이브 표본 질의로 판례 노출/노이즈 차단 체감 → 임계값 튜닝
   - 튜닝 손잡이: `generateAnswer.ts` 63~65줄 `PRECEDENT_TOP_K`/`PRECEDENT_MIN_SIMILARITY`/`PRECEDENT_MAX`
2. `npm run perf:p95` 라이브 재측정 — 이제 측정 스크립트가 판례 경로를 포함(옵션 A: 검색은 직접 매칭 유지, 판례 참고목록 경로만 추가).
   - 결과 표의 `embedding`·`precedent` 행으로 의미 재정렬·판례 검색의 마진 비용을 분리 확인.
   - **주의**: 기존 13.46s 베이스라인은 `embeddingPort` 미주입(의미 재정렬 OFF) 상태였음 → 신규 측정은 의미 재정렬+판례 두 비용이 함께 켜진 값. 둘의 분리는 단계별 행으로 확인.
   - `DATABASE_URL` 없으면 헤더에 "판례 라이브 검색: 비활성"으로 표시되고 판례 경로는 우회.
3. 전량 10,083건 적재 여부 결정(현재 대법원 300건 PoC 적재 상태)
