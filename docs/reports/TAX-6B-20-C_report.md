# TAX-6B-20-C 리포트 — 국세청 세법해석례 벡터 검색 배선

> 상태: **코드 구현·자동 검증 완료 / 실제 적재 의존 라이브 검증 대기**
>
> 실제 Voyage 임베딩과 `taxlaw_embeddings` 적재는 비용 게이트 승인 전이므로 이 작업에서 수행하지 않았다.

## 변경 사항 요약

**파일 변경 목록:**

- `src/usecases/generateAnswer.ts` — 해석례 벡터 참고 목록 게이트 추가
- `src/domain/searchMerge.ts` — 비법령 `externalId` 우선 식별키
- `src/adapters/vectorSearch.ts` — JSONB metadata의 `externalId` 조회·매핑
- `src/adapters/nationalTaxLaw.ts` — 실시간 국세청 해석례의 `ntstDcmId`를 `externalId`로 전달
- `tests/unit/tribunalReferences.test.ts` — 해석례 게이트·중복 제거·폴백 테스트
- `tests/unit/searchMerge.test.ts` — `externalId` 우선 식별·병합 테스트
- `tests/unit/vectorSearch.test.ts` — DB 행의 `externalId` 매핑 테스트
- `tests/integration/nationalTaxLaw.test.ts` 및 스냅샷 — 실시간 해석례 `externalId` 검증

**주요 변경:**

- 판례·심판례와 동일한 조건(`topK=5`, `minSimilarity=0.5`, `max=2`)으로 해석례 벡터 검색을 참고 목록에 병렬 합류시켰다.
- 비법령 식별키를 `sourceType|externalId` 우선, `sourceType|caseNumber` 폴백으로 통일했다. 따라서 옛 국세청 해석례처럼 같은 안건번호를 공유하는 별도 문서는 과잉 제거되지 않는다.
- 벡터 DB와 실시간 API 양쪽에서 `externalId`를 채워, 동일 문서의 실시간·벡터 중복만 제거한다.
- 해석례는 기존 정책대로 references 전용이며, 발췌 인용·V1~V6 검증 경로에는 추가하지 않았다.

## 검증 결과

1. 대상 테스트 — PASS, 61/61
2. `npm.cmd run typecheck` — PASS, 0 오류
3. 전체 회귀 `npm.cmd run test` — PASS, 53개 파일 / 822개 테스트
4. `git diff --check` — PASS

## 적재 후 수행할 검증

다음 항목은 실제 해석례 임베딩·DB 적재 후에만 검증할 수 있다.

1. `source_type='해석례'` 행 수·1024차원·`externalId` 중복 0건 확인
2. 실제 법인세 질의에서 국세청 해석례가 references에 노출되는지 확인
3. 벡터 쿼리 단독 시간 측정 및 20-B 기준선 비교
4. 비용 승인 후 종단 P95 15초 합격선 확인
5. 긴 해석례 뒷부분 쟁점 프로브의 초기 재현율 측정

## 범위 밖

- Voyage API 유료 호출과 전량 임베딩 적재
- HNSW/IVFFlat 인덱스 도입
- 해석례 청킹(TAX-6B-20-E)
- SSOT/PRD/CLAUDE.md 문서 정합(TAX-6B-20-D)
