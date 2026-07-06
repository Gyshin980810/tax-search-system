# [TAX-6B-32] 참고목록 인용 그래프 반영 — 1-hop 확장 + 피인용 랭킹

> **초안** — AI(Claude Fable 5) 작성, 회계사 검토·승인 대기.
> 선행 TAX-6B-31(citation_edges 적재) 완료 후 착수.

---

## Metadata

- **Type**: FEAT
- **Severity**: major
- **Layer**: usecase | adapter | domain | ports
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: M (4~5파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- 참고목록(비법령 references)은 키워드+의미 유사도(TAX-6B-10~12)로만 선별·정렬됨.
- 검색된 심판례가 본문에서 "같은 뜻임"이라고 직접 지목한 선례·판례가
  코퍼스에 있어도 참고목록에 나타나지 않을 수 있음 (인용 사슬 미활용).
- 피인용 횟수(권위 신호)가 정렬에 반영되지 않아, 확립된 법리(예: 대법원 2002두9537,
  심판례로부터 598회 피인용)와 1회 인용 문서가 동급으로 취급됨.

### 1.2 기대 동작

- 참고목록 확정 직전에 `citation_edges`를 1회 배치 조회해:
  1. **1-hop 확장**: 참고목록에 오른 심판례·판례가 지목한 문서 중 코퍼스 보유분(`in_corpus=true`)을
     참고목록 후보에 추가 (원문에 적힌 사건번호를 따라가므로 환각 0).
  2. **랭킹 부스트**: 후보들의 피인용수(in-degree)를 기존 관련도 점수에 가중 합산.
- 확장된 문서는 **참고목록(references)에만** 추가 — 인용 승격 금지(SSOT §7.4), V1~V6 비대상 유지.

### 1.3 영향·중요도

- 실측상 내부 인용 보유 심판례 1건당 평균 판례 1.7건 + 심판례 1.4건을 결정론적으로 추가 확보.
- 회계사가 "이 결정례가 따른 원 선례"를 곧바로 볼 수 있어 검토 시간 단축.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/domain/nonLawRelevance.ts` (기존) — 참고목록 관련도 점수(제목2·본문1). 부스트 합성 지점 후보.
- `src/usecases/generateAnswer.ts` (기존) — 참고목록 조립 경로.
- `src/adapters/vectorSearch.ts` (기존) — pg Pool 연결 패턴 참고.
- `src/ports/` — 신규 포트 배치 위치.
- Neon `citation_edges` (TAX-6B-31 산출물).

### 2.2 아키텍처 힌트 (헥사고날 준수)

```
generateAnswer (usecase)
  → ICitationGraphPort (port, 신규)
      getOutgoing(caseNumbers: string[]): Promise<CitationEdge[]>   -- 1-hop
      getInDegrees(caseNumbers: string[]): Promise<Map<string, number>>
  → CitationGraphAdapter (adapter, 신규, pg 1회 배치 쿼리)
```

- usecase는 Port만 사용 (fetch·DB 직접 호출 금지 — CLAUDE.md §4).
- P95 보호: 그래프 조회는 **SQL 배치 1회**(IN 절), LLM·임베딩 추가 호출 0.
- graceful degrade: 테이블 부재·DB 오류 시 그래프 없이 기존 동작 그대로 (TAX-6B-12 선례).

### 2.3 라벨·검증 관계 (중요)

- 확장 문서는 T3(심판례)/T4(판례) → 참고목록 전용, 🟢 승격 절대 금지.
- 참고목록은 V1~V6 비대상(SSOT §7.4)이므로 검증 파이프라인 무변경.
- `FOLLOWS` 엣지로 추가된 문서는 표시 문구에 "인용 선례" 등 유래를 밝히는 것 권장(UI 범위는 최소).
- **`APPEAL` 엣지는 1-hop 확장에서 제외한다(2026-07-06 그래프 엣지 설계 분석 보강, TAX-6B-31 §2.4).**
  `APPEAL`은 "선례를 지지/참고"가 아니라 "같은 사건의 원심·환송심"이므로, 확장 후보에 섞으면
  회계사가 "관련 다른 사건"으로 오인할 위험이 있다. `getOutgoing`은 `edge_type IN
  ('FOLLOWS','REFERS')`만 조회하도록 Adapter 쿼리에서 필터.

---

## 3. Scope (작업 범위) ⭐

### 3.1 허용되는 변경

- [ ] `src/ports/citationGraphPort.ts` 신규 — `ICitationGraphPort` + `CitationEdge` 타입
- [ ] `src/adapters/citationGraph.ts` 신규 — pg 배치 조회 (엣지·피인용수)
- [ ] `src/domain/nonLawRelevance.ts` — 피인용 부스트 합성 순수함수 추가 (기존 점수 로직 보존)
- [ ] `src/usecases/generateAnswer.ts` — 참고목록 확정 직전 1-hop 확장·부스트 (Port 경유, 선택적 주입)
- [ ] `tests/unit/` — 신규 테스트 (확장·부스트·degrade 각 1건 이상)

### 3.2 금지되는 변경

- ❌ 인용(citations) 경로·라벨 결정론(resolveCitationLabel)·V1~V6 로직 일체
- ❌ 검색 게이트(searchWithFallback THRESHOLD·matchStage) 변경
- ❌ 원문 가공 — 확장 문서 content는 코퍼스 원문 그대로
- ❌ LLM 프롬프트 변경
- ❌ `OVERRULED` 관련 동작 (TAX-6B-33에서)

---

## 4. Strategy (구현 힌트)

1. **Port·Adapter 먼저**: `getOutgoing`은 `WHERE from_id = ANY($1) AND in_corpus` 1쿼리,
   `getInDegrees`는 `GROUP BY to_id` 1쿼리.
2. **확장**: 참고목록 상위 후보의 caseNumber로 1-hop 조회 → 코퍼스에서 해당 문서 조회(기존
   벡터 테이블 metadata 재사용 가능 여부 확인) → 중복 제거(identityKey, searchMerge 기준 공유) 후 후보 합류.
3. **부스트**: `finalScore = relevance + w * log(1 + inDegree)` 형태 권장 (598회짜리가
   전부를 압도하지 않도록 로그 스케일). w는 상수로 두고 테스트로 고정.
4. **주입 선택적**: `ICitationGraphPort` 미주입 시 기존 동작 100% 동일 (무회귀 보장, TAX-6B-26 선례).
5. **개수 상한**: 확장으로 추가되는 문서는 최대 N건(예: 3)으로 제한 — 참고목록 비대화 방지.

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] 인용을 보유한 심판례가 참고목록에 오르면, 그 심판례가 지목한 코퍼스 내 문서가
       참고목록에 추가된다 (단위 테스트)
2. [ ] 피인용수가 높은 문서가 같은 관련도의 낮은 문서보다 앞서 정렬된다 (단위 테스트)
3. [ ] Port 미주입·DB 오류 시 기존 참고목록과 동일 결과 (degrade 테스트)
4. [ ] 확장 문서가 citations(인용)로 승격되지 않는다 — references에만 존재
5. [ ] LLM·임베딩 호출 횟수 불변 (P95 보호)
6. [ ] `npm run test` 전체 GREEN, `tsc` 오류 0, 기존 테스트 무회귀

---

## 6. Verification (검증 단계)

1. `npm run dev` → 심판례가 잡히는 질문(예: "가지급금 인정이자") 검색
2. 참고목록에 인용 선례가 추가되는지, 원문 링크가 정상인지 확인
3. DB 연결 제거 후 같은 질문 → 기존과 동일한 참고목록(오류 없음) 확인
4. 응답 시간이 기존 대비 유의미하게 늘지 않는지 확인 (그래프 쿼리 1회)

---

## 7. Risks / Notes

- 확장 문서의 관련도가 질문과 낮을 수 있음(선례이지만 다른 쟁점) → 상한 N건 + 기존
  관련도 컷오프(TAX-6B-10)와 병행으로 완화.
- 피인용수는 "권위"이지 "정답"이 아님 — 부스트 가중치를 보수적으로.
- 확장 유래(어느 문서가 지목했는지)를 UI에 노출할지는 후속 결정 (이 티켓은 데이터만 준비).

---

## 8. AI Implementation Instructions

- 코딩 전: 근본 원인 분석·영향 파일·구현 계획 제시 → 회계사 승인 후 착수
- 코딩 후: 리포트 `docs/reports/TAX-6B-32_report.md`

---

## 9. 구현 계획 (사전 수립 — 착수 대기)

> **착수 게이트**: ① **심판례 전량 벡터 임베딩(TAX-6B-18 실행) 완료** + ② TAX-6B-31 적재 완료 + ③ 회계사 "구현해줘" 승인 (2026-07-03 회계사 지시).
> ①이 이 티켓에는 **실질 전제조건**: 확장 문서의 본문·메타데이터를 `taxlaw_embeddings`에서 가져오는데,
> 현재 DB의 심판례는 83건뿐이라 임베딩 전량 적재 전에는 심판례 확장이 거의 빈손이 된다.

### 9.1 단계별 계획

**STEP 1 — Port 신규** (`src/ports/citationGraphPort.ts`)

```typescript
interface CitationEdge { fromId: string; toId: string; toType: string; edgeType: string }
interface ICitationGraphPort {
  getOutgoing(caseNumbers: string[]): Promise<CitationEdge[]>          // 1-hop (in_corpus만)
  getInDegrees(caseNumbers: string[]): Promise<Map<string, number>>    // 피인용수
  getDocumentsByCaseNumbers(caseNumbers: string[]): Promise<TaxLaw[]>  // 확장 문서 본문 조회
}
```

- 문서 조회를 이 포트에 포함해 `IVectorSearchPort` 무변경 유지 (기존 포트 확장 대신 신규 포트 완결 — 무회귀).

**STEP 2 — Adapter 신규** (`src/adapters/citationGraph.ts`)

- pg Pool은 `src/adapters/vectorSearch.ts` 연결 패턴 재사용.
- `getOutgoing`: `SELECT ... FROM citation_edges WHERE from_id = ANY($1) AND in_corpus AND edge_type IN ('FOLLOWS','REFERS')` (1쿼리) — `APPEAL`(원심/환송)은 제외(§2.3 보강)
- `getInDegrees`: `SELECT to_id, count(*) FROM citation_edges WHERE to_id = ANY($1) GROUP BY to_id` (1쿼리)
- `getDocumentsByCaseNumbers`: `taxlaw_embeddings`에서 `case_number = ANY($1)` 조회 → TaxLaw 매핑(content 원문 그대로, §6.1) (1쿼리)
- 합계 SQL 3콜(전부 IN 배치) — LLM·임베딩 콜 0. 티켓 §2.2의 "배치 1회"는 "배치 소량(≤3콜)"로 정정해 이해할 것.

**STEP 3 — domain 부스트 순수함수** (`src/domain/nonLawRelevance.ts`)

- `CITATION_BOOST_WEIGHT = 0.5` (상수, 보수적 시작 — 테스트로 고정 후 실측 튜닝)
- `citationBoost(inDegree: number): number = CITATION_BOOST_WEIGHT * Math.log1p(inDegree)` — 598회 허브도 log로 완만(≈3.2점), 기존 `combinedScore` 로직 무변경

**STEP 4 — usecase 통합** (`src/usecases/generateAnswer.ts` `buildReferences`)

- 기존 흐름 `[4] fetchPrecedentReferences` 와 `[5] 병합·정렬` 사이에 삽입:
  - `[4.5]` 1-hop 확장: 현재 후보(externalFiltered + precedentScored)의 caseNumber로 `getOutgoing` → 미노출 대상만 `getDocumentsByCaseNumbers` → 최대 3건, `score = combinedScore(0, 0) + citationBoost(피인용수)` 로 후보 합류(유래 엣지 타입 보존)
  - `[4.6]` 부스트: 전체 후보 caseNumber로 `getInDegrees` 1콜 → 각 score에 `citationBoost` 가산
- `citationGraphPort?: ICitationGraphPort` **선택적 주입** — 미주입 시 [4.5]·[4.6] 전체 스킵(기존 동작 100% 동일, TAX-6B-26 선례)
- 전체 try/catch — DB 오류 시 그래프 없이 기존 참고목록 그대로 (TAX-6B-12 degrade 선례)
- 확장 문서는 `merged` 이후에도 references에만 존재 — citations 경로 접근 지점 자체가 없음(구조적 승격 금지)

**STEP 5 — 테스트** (`tests/unit/` 신규)

- 확장: FOLLOWS 엣지 보유 심판례 → 지목 문서가 references에 추가 / 상한 3건 초과 시 절단
- 부스트: 같은 관련도에서 피인용수 높은 문서가 앞 정렬
- degrade: port 미주입·getOutgoing throw → 기존 결과와 deep-equal
- 승격 금지: 확장 문서가 citations에 부재

### 9.2 검증 순서

§6 그대로 + vitest 무회귀. 실측 P95 비교(그래프 on/off)는 회계사 판단으로 생략 가능(SQL 3콜은 ms 단위).

### 9.3 예상 규모·리스크

- 신규 2파일 + 수정 2파일 + 테스트 1파일 (§3.1과 일치), 약 250줄.
- 가중치 `CITATION_BOOST_WEIGHT`는 첫 구현에서 보수값으로 고정 — 골든셋 회귀로 부작용 확인 후 조정.

---

## 10. Related Tickets

- 선행: `TAX-6B-31_citation_edges_load.md` (필수)
- 후속: `TAX-6B-33_overruled_review_queue.md`
- 참조: `TAX-6B-10`~`12` (참고목록 관련도·재정렬), `TAX-6B-26` (선택적 포트 주입 선례)

## 11. Report Link

Report: `docs/reports/TAX-6B-32_report.md` (미작성)

---

**작성자**: Claude Fable 5 (초안) / 승인: 회계사 (대기)
**작성일**: 2026-07-03
