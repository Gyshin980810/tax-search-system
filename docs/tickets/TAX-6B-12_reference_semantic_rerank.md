# TAX-6B-12 심판례 참고 목록 의미(벡터) 재정렬 — 방향 C

---

## Metadata

- **Type**: FEAT
- **Severity**: major
- **Layer**: domain + usecase (+ API Route 배선 1줄)
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: M (4~5파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

TAX-6B-10(참고 목록 점수·컷오프)·TAX-6B-11(검색 후보 확대)로 관련도 정렬은 개선됐으나,
두 작업 모두 **부분 문자열(글자 겹침) 매칭**이라 의미는 같지만 표기가 다른 자료를 놓친다.

- 질문: "**양도소득세** 1세대 1주택"
- 심판례 사건명: "**양도세** 비과세 해당 여부" → 글자가 안 겹쳐 **0점 → 컷오프 탈락**

회계사 피드백("유사사례 심판례 관련성 낮아 업무에 못 씀")의 잔여 원인이 이 표기 변이·동의어 한계다.

### 1.2 기대 동작

- 참고 목록 관련도를 **글자 점수 + 의미(벡터) 유사도의 가중합**으로 산정한다.
- 글자가 안 겹쳐도 의미가 충분히 가까우면 참고 목록에 살린다(표기변이 구제).
- 기존 글자 매칭 동작은 **회귀 없이 보존**한다(글자 점수 1+ 자료는 그대로 통과).

### 1.3 영향·중요도

방향 A(TAX-6B-10)·B(TAX-6B-11)에 이은 **방향 C(의미검색)**. 부분문자열의 본질적 한계 해소.

---

## 2. Context (기술적 맥락)

### 2.1 회계사 결정(2026-06-17)

- **적용 범위 = A. 참고 목록 의미 재정렬**(런타임). 사전 적재 풀 확대(B)는 별도.
- **점수 결합 = 가중합**(글자 점수 + 가중치 × 의미 유사도).

### 2.2 재활용 자산 (Phase 4)

- `src/adapters/embedding.ts` — `OpenAIEmbeddingAdapter`(text-embedding-3-small), `embedBatch` 보유.
- `src/ports/embeddingPort.ts` — `IEmbeddingPort`.
- `app/api/answer/route.ts` — `OpenAIEmbeddingAdapter` 이미 import(FallbackSearchPort용).

### 2.3 관련 파일

- `src/domain/nonLawRelevance.ts` — `cosineSimilarity`·`combinedScore` 신규(순수함수, 단일 진실 원천).
- `src/usecases/generateAnswer.ts` — `buildReferences` async화 + 의미 점수 결합, `generateAnswer` 시그니처에 옵셔널 `embeddingPort?`.
- `app/api/answer/route.ts` — `generateAnswer(...)` 호출에 임베딩 어댑터 전달(1줄).
- `tests/unit/nonLawRelevance.test.ts`, `tests/unit/generateAnswer.test.ts` — 테스트 추가.

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [x] `nonLawRelevance.ts` — `cosineSimilarity(a,b)`, `combinedScore(textScore, cosine)`, `SEMANTIC_WEIGHT`.
- [x] `generateAnswer.ts` — 의미 점수 결합(컷오프를 **의미 점수 산정 후**로 이동), 옵셔널 `embeddingPort`.
- [x] `route.ts` — 임베딩 어댑터 주입(1줄).
- [x] 테스트 추가.

### 3.2 금지되는 변경

- ❌ law-verifier V1~V6 변경(참고 목록은 V검증 비대상 — SSOT §7.4).
- ❌ 법령 원문 가공·요약(임베딩은 텍스트 **읽기만** — §6.1).
- ❌ 사전 적재(collectNonlaw)·벡터 DB 스키마 변경(범위 B, 별도).
- ❌ 답변 본문(citable)·발췌 인용 로직 변경(참고 목록만).

---

## 4. Strategy (구현 힌트)

1. `cosineSimilarity`: 영벡터·길이 불일치 시 0. 순수 수치 연산.
2. `combinedScore = textScore + SEMANTIC_WEIGHT × max(0, cosine)`. 음수 cosine은 0 클램프(점수 차감 안 함 → 글자 신호 보존).
3. `buildReferences`:
   - 글자 점수 1회 계산 → **의미 점수 가중합** → 컷오프(`MIN_RELEVANCE_SCORE`) → 정렬·상한.
   - 컷오프를 의미 산정 *후*로 옮겨야 표기변이(글자 0) 구제 가능. 글자 1+는 cosine 무관 통과(회귀 없음).
4. **Graceful degrade**: `embeddingPort` 미주입 또는 임베딩 실패(try-catch) 시 글자 점수만 사용(빈손 방지).
5. **P95 보호**: 임베딩 대상 `SEMANTIC_RERANK_LIMIT`(20)건 상한, `[질의, 후보…]` 배치 1콜. 본문은 이미 메모리 보유분 재사용.
6. **결정론성(SSOT §7.7)**: 임베딩은 결정론적. 동점 시 기존 보조키(선고일↓·사건번호↑) 유지.

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] 글자 0점이지만 의미가 가까운 자료가 참고 목록에 포함된다(표기변이 구제).
2. [ ] 글자 점수 1+ 자료는 기존과 동일하게 통과한다(회귀 없음).
3. [ ] `embeddingPort` 미주입/실패 시 글자 점수 경로로 자동 복귀한다.
4. [ ] 동일 질의 재호출 시 동일 순서(결정론성).
5. [ ] `npm run test` 전체 통과, `tsc --noEmit` 통과.
6. [ ] P95 실측 — 합격선 초과 시 가중치↓ 또는 보류(종료 조건).

---

## 7. Risks / Notes

- **P95 초과 가능성**(최대 리스크) — 검색당 임베딩 1콜 추가(예상 +0.3~0.5s). 실측이 게이트.
- **임베딩 비용** — text-embedding-3-small 저렴하나 누적 모니터링.
- **의미 임계 튜닝** — `SEMANTIC_WEIGHT`(3)·컷오프(1) 조합상 cosine≈0.33이 글자 0 구제 임계. 실측 후 조정 여지.

---

## 10. Related Tickets

- 선행: `TAX-6B-10`(방향 A — 점수·컷오프), `TAX-6B-11`(방향 B — 후보 확대), `TAX-026-*`(벡터 인프라).
- 후속: (방향 B 잔여) 사전 적재 심판례 풀 확대 — 별도 검토.

---

## 11. Report Link

Report: `docs/reports/TAX-6B-12_report.md` (작성 예정)

---

**작성자**: AI (회계사 승인)
**작성일**: 2026-06-17
