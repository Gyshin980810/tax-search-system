# TAX-6B-20-C 국세청 세법해석례 벡터 검색 배선 (참고 목록 합류)

> 작업 시작 전 `CLAUDE.md` + `docs/SSOT.md`(§7) + 부모 티켓 `TAX-6B-20_interpretation_corpus_load.md` +
> 형제 티켓 `TAX-6B-20-B_interpretation_embed_load.md` + 메모리 `project_nonlaw_interp_tracks`,
> `project_tax6b18_tribunal_full_load` 를 읽을 것.
>
> 본 티켓은 **계획서**이며, 회계사 승인 전까지 착수하지 않는다.
> 부모 티켓 §9 분할의 **세 번째 단계**다(20-A 수집 → 20-B 적재 → **20-C 검색 배선** → 20-D 문서 정합).
> **선행 조건: 20-B 적재 완료**(pgvector에 `source_type='해석례'` 행이 실제로 존재해야 검색이 붙는다).

---

## Metadata

- **Type**: FEAT (검색 경로 배선)
- **Severity**: major
- **Layer**: usecase(`generateAnswer.ts`) — 참고 목록 게이트 확장
- **Milestone**: Post-MVP (Phase 6B/7 데이터 인프라)
- **Estimated Size**: S (게이트 배열 1줄 + 타입 유니온 2곳 확장 + vitest + P95 회귀 측정)

---

## 0. 전제 — 심판례(TAX-6B-18)가 이미 깔아둔 레일에 올라타기

이 티켓은 **새 로직을 거의 만들지 않는다.** 심판례(TAX-6B-18)가 판례와 동일한 벡터 참고 목록 배선을
이미 완성해 뒀고, 해석례는 그 배열에 **엔트리 한 줄을 추가**하고 타입 유니온을 넓히는 것이 전부다.

- `generateAnswer.ts:67` `VECTOR_REFERENCE_GATES` — 현재 `판례`·`심판례` 2개 엔트리.
- 세 게이트는 이미 `Promise.all`(167행)로 **병렬 호출**되므로, 해석례를 1개 추가해도
  벡터 DB 왕복이 직렬로 쌓이지 않는다(P95 방어 구조 유지 — 게이트 수만큼 병렬).
- `searchSimilar(vec, topK, '해석례')`는 이미 `sourceType` 필터를 지원(TAX-6B-14). 20-B로 적재된
  **국세청 해석례만** pgvector에 있으므로, 이 필터가 곧 국세청 해석 전용 검색이 된다
  (법제처 expc는 목록만이라 벡터 DB에 없음 — 부모 §2.4 `ℹ️ sourceType 공유` 참조).

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- 20-B로 국세청 해석례 본문이 pgvector에 적재되었으나(`source_type='해석례'`), `generateAnswer.ts`의
  참고 목록 벡터 게이트(`VECTOR_REFERENCE_GATES`)에는 **판례·심판례만** 등록되어 있다.
  → 적재는 됐는데 **검색 결과에 합류하지 않는다**(사용자 답변의 참고 목록에 안 뜸).
- 실시간 어댑터 `searchNtsInterpretations`(nationalTaxLaw.ts:923)는 여전히 **제목 키워드 매칭**만 수행
  (content=''). 표현 변이·동의어에 취약(부모 §1.1).

### 1.2 기대 동작

- 국세청 해석례가 심판례·판례와 **동일한 의미(semantic) 검색 경로**로 참고 목록에 합류.
- 보수적 게이트(minSimilarity·max 상한)로 노이즈를 억제하며, 실패 시 **조용히 폴백**(참고 목록만 비고
  나머지 답변은 정상 — 이미 `fetchVectorReferences`가 try/catch로 방어, generateAnswer.ts:292).

### 1.3 영향·중요도

- 법인세 실무 핵심 쟁점(가지급금·부당행위계산부인 등)이 국세청 해석례에 다수 → 참고 목록 정확도 직결.
- 방안②로 본문이 풍부(사실관계·관련법령 포함)해 의미 검색 재현율에 유리(형제 20-B §1.3).

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일 / 자산

| 자산 | 위치 | 이 티켓에서 |
|---|---|---|
| `VECTOR_REFERENCE_GATES` | `src/usecases/generateAnswer.ts:67` | **해석례 엔트리 1줄 추가 + 타입 유니온 확장** |
| `fetchVectorReferences` gate 파라미터 타입 | `generateAnswer.ts:289` | 타입 유니온 `'판례'\|'심판례'` → `+'해석례'` 확장(동일 유니온 2곳) |
| `Promise.all` 병렬 호출 | `generateAnswer.ts:166~168` | **무변경**(배열 순회라 엔트리 추가만으로 병렬 확장) |
| `searchSimilar(vec, topK, sourceType?)` | `src/adapters/vectorSearch.ts:60` / `src/ports/vectorSearchPort.ts:23` | **시그니처 무변경**(이미 `SourceType='해석례'` 지원) — 단, SELECT에 `metadata->>'externalId'` 1컬럼 + `rowToTaxLaw` 매핑 1줄 보강 필요(§4-3a, 2026-07-10 검토에서 발견) |
| `SourceType` 타입 | 공용 타입 | `'해석례'` 이미 포함(어댑터가 사용 중) — 확인만 |

### 2.2 현재 게이트 값 (참고)

```ts
const VECTOR_REFERENCE_GATES: { sourceType: '판례' | '심판례'; topK: number; minSimilarity: number; max: number }[] = [
  { sourceType: '판례',   topK: 5, minSimilarity: 0.5, max: 2 },
  { sourceType: '심판례', topK: 5, minSimilarity: 0.5, max: 2 },
]
```

> 심판례 게이트 값(topK 5 · minSimilarity 0.5 · max 2)이 **보수적 기본값**이다. 해석례도 **같은 값으로
> 시작**하고, §4 결정에 따라 필요 시 조정한다.

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [ ] `VECTOR_REFERENCE_GATES` 배열에 `{ sourceType: '해석례', topK: 5, minSimilarity: 0.5, max: 2 }` **1줄 추가**
- [ ] 게이트 타입 유니온 `'판례' | '심판례'` → `'판례' | '심판례' | '해석례'` 확장(선언부 67행 + `fetchVectorReferences` 289행)
- [ ] **`vectorSearch.ts` 소폭 보강**(2026-07-10 검토) — SELECT에 `metadata->>'externalId' AS external_id`
  컬럼 추가 + `rowToTaxLaw`에 externalId 매핑 1줄(§4-3a). **이것 없이는 벡터 매치가 externalId를 갖지
  못해 AC4의 실시간↔벡터 dedup이 라이브에서 동작하지 않는다**(20-B가 metadata JSONB에 저장한 값을
  여기서 읽어야 TaxLaw까지 전달됨). 판례·심판례 기존 행은 metadata에 externalId가 없음 → NULL →
  caseNumber 폴백으로 하위호환.
- [ ] vitest — 해석례 게이트가 참고 목록에 합류하는지 + minSimilarity 미달 시 제외되는지 + **동일
  caseNumber가 실시간 해석례 결과와 벡터 매치에 동시 존재 시 1건만 노출**(excludeKeys dedup)되는지 단위 테스트
  — ⚠️ **§0.1(20-B) 실증 반영**: caseNumber 자체가 2004년 이전 문서에서 세목명만 공유(예: "재산" 82건)
  하므로, **서로 다른 문서인데 caseNumber가 같다는 이유로 잘못 눈에 dedup되는 과잉 제외 케이스도
  테스트에 포함**(예: 실시간 결과 하나가 caseNumber="재산"이면 벡터 매치의 다른 81건이 전부 부당하게
  제외되지 않는지). 근본 대응은 아래 4-(d)·5 참고.
- [ ] `npm run typecheck` 0에러 + vitest 전건 통과 + **P95 합격선(15s) 미회귀** 실측

### 3.2 금지되는 변경

- ❌ `searchSimilar`·`vectorSearchPort`·`SourceType` **시그니처** 변경(이미 해석례 지원 — 확장 불필요).
  단, §4-3a의 SELECT 컬럼·행 매핑 보강은 시그니처 변경이 아니므로 이 금지에 해당하지 않음(2026-07-10 명확화)
- ❌ 실시간 어댑터(`searchNtsInterpretations`)에 본문 크롤링 부활(P95 보호 — content='' 유지, 부모 §3.2)
- ❌ 발췌 인용·citation 승격(해석례 벡터는 **참고 목록 트랙** — V1~V6 비대상, 부모 §3.2)
- ❌ 판례·심판례 게이트 값 임의 변경(해석례 추가만이 범위)
- ❌ 임베딩 적재(20-B)·문서 정합(20-D) 침범

---

## 4. Strategy + ⚡ 결정 (회계사 택1 — 착수 시)

### 결정 — 해석례 게이트 값(max·minSimilarity)

> 배경: 해석례는 136K건으로 심판례(3,981건 dedup)·판례보다 코퍼스가 크다. 참고 목록에 너무 많이
> 끼면 노이즈, 너무 적으면 재현율 손해. **참고 목록 총량**(판례 max2 + 심판례 max2 + 해석례 max?)의
> 균형을 어떻게 둘지가 유일한 결정이다.

| 방안 | 장점(한 줄) | 단점(한 줄) |
|---|---|---|
| **① 심판례와 동일값(max 2·minSim 0.5) — 추천** | 검증된 보수적 기본값 그대로, 예측 가능·구현 즉시 | 해석례가 실무에서 특히 유용하면 max 2가 다소 인색할 수 있음 |
| ② 해석례만 max 3으로 상향 | 법인세 실무 해석례를 더 넓게 노출 | 참고 목록이 길어져 답변 하단이 번잡·노이즈 위험 |

> 추천: **①로 시작**(심판례와 동일 보수값). 라이브 검증(§6)에서 해석례가 유용한데 max 2로 밀린다고
> 확인되면 그때 ②로 상향(값 1개 변경이라 후속 조정 비용 0). 회계사 착수 시 택1.

### 구현 순서

1. `SourceType`에 `'해석례'`가 있는지 확인(어댑터가 이미 사용 중이라 있을 것 — 없으면 타입만 추가).
2. `VECTOR_REFERENCE_GATES` 배열 + 두 곳의 게이트 타입 유니온에 `'해석례'` 추가.
3. **`identityKey`를 caseNumber 대신 `externalId` 우선으로 보강**(있으면 `sourceType|externalId`, 없으면
   기존 `sourceType|caseNumber` 폴백) — ⚠️ **같은 이름·같은 로직의 사본이 2곳**이므로 둘 다 고친다
   (2026-07-10 검토에서 확인): ⑴ `src/usecases/generateAnswer.ts:88`(벡터 참고목록 dedup·excludeKeys),
   ⑵ `src/domain/searchMerge.ts:18`(**공용** — `searchWithFallback.ts`와 `nationalTaxLaw.ts:626`의
   실시간 검색 결과 병합이 사용. 2004년 이전 해석례 2건이 같은 caseNumber로 실시간 결과에 동시에
   잡히면 **지금도 1건이 과잉 dedup되어 사라질 수 있는 라이브 경로**).
   - **3a. `vectorSearch.ts` 보강(dedup의 전제)**: SELECT에 `metadata->>'externalId' AS external_id`
     컬럼 추가 + `rowToTaxLaw`에 `...(row.external_id ? { externalId: row.external_id } : {})` 매핑
     1줄. 20-B가 metadata(JSONB)에 저장한 externalId를 여기서 안 읽으면 벡터 매치의 externalId가
     항상 undefined → 실시간(externalId 보유) 쪽과 키가 달라져 externalId 기반 dedup이 **라이브에서
     무력화**된다(판례·심판례 기존 행은 NULL → caseNumber 폴백, 하위호환).
   - **3b. 실시간 어댑터 채우기**: `src/adapters/nationalTaxLaw.ts`의 `toNtsInterpretationTaxLaw`(946행)에
     `externalId: extractNtstDcmId(e.법령해석상세링크)` 1줄 추가(로직은 `collectNtsInterpretations.ts`의
     기존 추출 함수와 동일 패턴 — 신규 로직 아님).

   **근거**: caseNumber 자체가 2004년 이전 문서에서 세목명만 공유하므로(예: "재산" 82건, §0.1)
   caseNumber만으로 dedup하면 서로 다른 문서 81건이 부당 제외될 수 있다 — externalId(문서마다 항상
   고유)로 판단해야 진짜 동일 문서만 걸러진다.
4. vitest: 해석례 매치가 (a) minSimilarity 이상이면 참고 목록에 합류, (b) 미만이면 제외, (c) 벡터 포트
   미주입/오류 시 조용히 폴백(빈 배열), (d) **동일 externalId(=ntstDcmId)가 실시간 해석례 결과(목록
   검색)와 벡터 매치에 동시 존재하면 1건만 노출**, (e) **caseNumber는 같지만 externalId가 다른 두 문서는
   둘 다 노출**(과잉 제외 회귀 방지 — §0.1 "재산" 케이스) — 심판례 기존 테스트를 미러링하되 (e)는
   이 코퍼스 고유 케이스로 신규 추가.
   ⚠️ **픽스처 함정(2026-07-10 검토)**: 벡터 매치 픽스처(TaxLaw 객체)에 externalId를 손으로 넣으면
   어댑터(3a)가 실제로는 매핑하지 않아도 (d) 테스트가 통과한다 — "테스트 PASS·라이브 고장". (d)는
   `rowToTaxLaw`(DB 행 → TaxLaw) 단위 테스트를 별도로 두어(metadata에 externalId 있는 행 → 매핑됨 /
   없는 행 → undefined) 어댑터 매핑 자체를 검증할 것.
5. `npm run typecheck` + vitest 전건.
6. P95 실측(§6) — 게이트 3개 병렬이라 직렬 증가는 없으나, 벡터 DB 왕복 1개 추가의 tail 영향 확인.

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `VECTOR_REFERENCE_GATES`에 `해석례` 엔트리 추가, 게이트 타입 유니온 2곳 확장
2. [ ] 국세청 해석례 의미 검색 결과가 참고 목록에 합류(라이브 `npm run dev`에서 해석례 키워드 검색 시 확인)
3. [ ] 보수적 게이트(minSimilarity·max) 적용, 벡터 포트 오류 시 조용히 폴백(나머지 답변 정상)
4. [ ] `npm run typecheck` 0에러, vitest 전건 통과(해석례 게이트 합류·제외·폴백·**실시간↔벡터 중복
   노출 방지**(externalId 기준) · **caseNumber만 같은 별개 문서는 과잉 제외되지 않음**(§0.1 "재산"
   케이스) · **`rowToTaxLaw` externalId 매핑 단위 테스트**(§4-4 픽스처 함정 방지) 포함 —
   `identityKey` **2곳**(generateAnswer.ts:88 + searchMerge.ts:18) 모두 externalId 우선으로 보강 확인)
5. [ ] **P95 합격선(15s) 미회귀** 실측(게이트 병렬 유지 확인, 20-B가 남긴 벡터 쿼리 단독 기준선과 대조)
6. [ ] 발췌 인용·citation 승격이 발생하지 않음(참고 목록 트랙 유지 — V검증 비대상)
7. [ ] **긴 해석례(6,000자+) 뒷부분 쟁점 프로브 10건 재현율 실측·기록**(후속 20-E 청킹의 정량 승격
   트리거 기준선 — §6)

---

## 6. Verification (회계사 확인 순서)

1. 20-B 적재 완료 확인(`SELECT count(*) FROM taxlaw_embeddings WHERE source_type='해석례'` > 0).
2. `npm run dev` → 법인세 실무 질의(가지급금·부당행위계산부인 등)에서 참고 목록에 **국세청 해석례**가
   제목+링크로 뜨는지, 라벨이 🟡(T3)인지 확인.
3. 유사도 낮은 무관 질의에선 해석례가 과다 노출되지 않는지(minSimilarity 게이트 동작) 확인.
4. **긴 해석례 프로브 셋 구축(20-E 트리거 데이터)**: 6,000자+ 해석례(전체의 4.2%)의 **뒷부분 쟁점**으로
   질의하는 프로브 10건을 만들어 재현율(참고 목록 합류 비율)을 실측·기록 — 이 수치가 후속 20-E(청킹)의
   정량 승격 트리거 기준선이 된다(라이브 검증하는 김에 데이터가 공짜로 생김).
5. `npm run perf:p95`(또는 기존 P95 측정 경로)로 합격선 미회귀 확인(20-B 기준선과 대조).

---

## 7. Risks / Notes

- ⚠️ **P95 tail**: 게이트 3개 병렬이라 직렬 증가는 없으나 벡터 DB 왕복 1개 추가. 심판례 추가 때도
  병렬 유지로 회귀 없었던 선례(TAX-6B-18). 측정으로 확인.
- ⚠️ **전수 스캔 2배 성장(더 큰 요인)**: 20-B 적재로 테이블이 ~146K→~282K행이 되어 **기존 판례·심판례
  게이트의 쿼리도 함께 느려진다**(HNSW 미도입 — TAX-6B-18 회계사 결정). 20-B가 남긴 벡터 쿼리 단독
  기준선과 대조해 측정하고, **벡터 쿼리 단독 p95가 임계(예: 1.5s — 착수 시 확정)를 넘으면 ANN 인덱스
  (HNSW/IVFFlat) 도입 여부를 회계사와 재확인**한다(자동 도입 아님 — 기존 "도입 안 함" 결정의 재확인
  트리거일 뿐).
- ⚠️ **sourceType 공유**: `'해석례'`는 법제처 expc와 국세청이 공유하나, **벡터 DB엔 국세청만** 적재됨
  → `searchSimilar('해석례')`는 사실상 국세청 전용(혼선 없음). 부모 §2.4 정합.
- ⚠️ **참고 목록 총량**: 판례·심판례·해석례가 각 max건씩 붙으면 하단이 길어질 수 있음 → §4 결정 ①(보수값)
  로 시작해 균형 관찰.
- ℹ️ **단정 금지·라벨**: 해석례는 T3(🟡 유사 사례). 기존 라벨·V6 단정 금지 로직이 그대로 적용됨(무변경).
- ℹ️ **관련사례 인용 그래프**: 해석례 본문의 관련사례를 명시적 엣지(citation_edges)로 잇는 것은 범위 밖
  → 후속 티켓(TAX-6B-31/32 패턴 + 청킹 TAX-6B-20-E와 시너지).

---

## 8. Related Tickets / References

- 부모: `TAX-6B-20_interpretation_corpus_load.md`(§9 분할) — 선행 20-A·20-B, 후속 20-D
- 형제: `TAX-6B-20-B`(임베딩 적재 — 이 티켓의 직접 선행), **TAX-6B-18**(심판례 배선 — 미러링 대상)
- 참조 메모리: `project_nonlaw_interp_tracks`, `project_tax6b18_tribunal_full_load`

---

## 9. Report Link

Report: `docs/reports/TAX-6B-20-C_report.md` (미작성 — 구현 후 작성 + ROADMAP §3 갱신)

---

**작성자**: AI (회계사 의뢰 — 주간 한도 초기화 전 선계획)
**작성일**: 2026-07-09
**최종 수정일**: 2026-07-10 — 계획 검토 반영(회계사 "전부 반영" 승인): ① 전수 스캔 2배 성장 위험 +
ANN 재확인 트리거 명시, ④ 실시간↔벡터 중복 노출 방지 vitest 추가(identityKey 원문 비교 근거),
⑤ 긴 해석례 프로브 10건 재현율 실측(20-E 정량 트리거 기준선) 추가.
**최종 수정일 2**: 2026-07-10 — 20-B(§0.1) 안건번호 신뢰성 실증 반영: caseNumber가 2004년 이전 문서에서
세목명만 공유(예: "재산" 82건)함을 확인 → `identityKey`를 caseNumber 대신 신설 필드 `externalId`
우선으로 보강(§4 구현순서 3), 실시간 어댑터(`toNtsInterpretationTaxLaw`)에도 externalId 채우기 추가,
과잉 제외 회귀 방지 vitest(§4-4-(e)·§5 AC4) 신설.
**최종 수정일 3**: 2026-07-10 — externalId 변경 영향 재검토(회계사 의뢰)에서 발견한 계획 내부 모순 해소:
① `vectorSearch.ts` "무변경" 서술과 AC4(externalId dedup)가 모순 — SELECT `metadata->>'externalId'` +
`rowToTaxLaw` 매핑 보강을 §2.1·§3.1·§4-3a에 명시(이것 없이는 벡터 매치에 externalId가 없어 dedup
라이브 무력화), ② `identityKey` 사본이 2곳(generateAnswer.ts:88 + **searchMerge.ts:18 공용** — 실시간
병합 경로도 과잉 dedup 위험)임을 §4-3에 명시, ③ 픽스처 함정 경고 + `rowToTaxLaw` 단위 테스트 요구(§4-4·AC4).
