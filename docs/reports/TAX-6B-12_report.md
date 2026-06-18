# TAX-6B-12 구현 리포트 — 심판례 참고 목록 의미(벡터) 재정렬 (방향 C)

- **티켓**: `docs/tickets/TAX-6B-12_reference_semantic_rerank.md`
- **작업일**: 2026-06-17
- **작업자**: AI (회계사 승인)
- **선행**: TAX-6B-10(방향 A — 점수·컷오프), TAX-6B-11(방향 B — 후보 확대), TAX-026-*(벡터 인프라)

---

## 1. 배경

방향 A·B로 참고 목록 정렬·후보는 개선됐으나, 둘 다 **부분 문자열(글자 겹침) 매칭**이라
표기 변이·동의어를 놓쳤다.

- 질문: "**양도소득세** 1세대 1주택" / 심판례 사건명: "**양도세** 비과세 해당 여부"
- 글자가 안 겹쳐 0점 → 컷오프 탈락. 사람 눈엔 같은 주제인데 놓침.

방향 C는 이 한계를 **의미(벡터) 유사도**로 보강한다.

---

## 2. 변경 사항 요약

**파일 변경 목록:**
- `src/domain/nonLawRelevance.ts` (수정) — `cosineSimilarity`, `combinedScore`, `SEMANTIC_WEIGHT` 추가
- `src/usecases/generateAnswer.ts` (수정) — `buildReferences` async화 + 의미 점수 결합, `generateAnswer` 옵셔널 `embeddingPort`
- `app/api/answer/route.ts` (수정) — 임베딩 어댑터 주입(1줄)
- `tests/unit/nonLawRelevance.test.ts` (수정) — cosine·결합 점수 8건
- `tests/unit/generateAnswer.test.ts` (수정) — 의미 재정렬 3건

**주요 변경:**

1. **의미 점수 순수함수(domain)** — `cosineSimilarity(a,b)`(영벡터·길이불일치 0 안전), `combinedScore(textScore, cosine) = textScore + SEMANTIC_WEIGHT(3) × max(0, cosine)`. 음수 cosine은 0 클램프(글자 신호 보존).

2. **컷오프 순서 이동** — 기존엔 글자 점수 → 컷오프였으나, **글자 0점이어도 의미가 가까운 자료(표기변이)를 살리기 위해** 의미 점수 가중합 *후* 컷오프(`MIN_RELEVANCE_SCORE=1`)를 적용. `SEMANTIC_WEIGHT=3`이라 cosine≈0.33 이상이면 글자 0이어도 통과.
   - **회귀 없음**: 글자 점수 1+ 자료는 cosine과 무관하게 통과(기존 동작 보존).

3. **Graceful degrade** — `embeddingPort` 미주입(로컬·테스트·DB 미설정) 또는 임베딩 호출 실패(try-catch) 시 글자 점수 경로로 자동 복귀. 참고 목록이 빈손이 되지 않는다.

4. **P95 보호** — 임베딩 대상 `SEMANTIC_RERANK_LIMIT(20)`건 상한, `[질의, 후보…]` 배치 1콜. 본문은 이미 메모리 보유분 재사용(추가 조회 없음).

5. **결정론성(SSOT §7.7)** — 임베딩은 결정론적. 동점 시 기존 보조키(선고일↓·사건번호↑) 유지.

---

## 3. 검증 결과

| 단계 | 결과 |
|---|---|
| `npx vitest run` (전체) | ✅ 631/631 PASS (기존 620 + 신규 11) |
| `npx tsc --noEmit` | ✅ 타입 에러 0 |

**신규 테스트:**
- (domain) `cosineSimilarity`: 동일=1·직교=0·반대=-1·스케일불변·영벡터/길이불일치 안전.
- (domain) `combinedScore`: 가중합·표기변이 구제 임계·음수 클램프.
- (usecase) 글자 0이지만 의미 가까운 자료 구제 + 무관 자료 탈락 / 미주입 폴백 / 임베딩 실패 graceful degrade.

---

## 4. 잠재 위험·제한사항

- **P95 측정 권장(최대 리스크)** — 검색당 임베딩 1콜 추가(예상 +0.3~0.5s). 운영 P95(현행 9.67s) 합격선 초과 시 `SEMANTIC_WEIGHT`↓·`SEMANTIC_RERANK_LIMIT`↓ 또는 방향 C 보류가 종료 조건. **단위 테스트는 통과했으나 실측은 미수행.**
- **의미 임계 튜닝** — `SEMANTIC_WEIGHT(3)`·컷오프(1) 조합상 cosine≈0.33이 글자 0 구제 임계. 실데이터에서 과/소 구제 발생 시 조정.
- **임베딩 비용** — text-embedding-3-small 저렴하나 누적 모니터링 필요.
- **범위 B(사전 적재 풀 확대) 미포함** — 회계사 결정(범위 A)에 따라 별도. 외부 API가 후보를 안 주면 의미검색도 한계.

---

**리포트 상태**: 완료 (P95 실측은 운영 측정 권장 사항으로 잔여)
