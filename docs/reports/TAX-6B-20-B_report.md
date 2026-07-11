# TAX-6B-20-B 리포트 — 국세청 세법해석례 전문 임베딩 적재 준비

> 상위 티켓: `docs/tickets/TAX-6B-20_interpretation_corpus_load.md`
> 범위: `scripts/ntsExpc_full.json`의 무비용 품질 점검과, 전문 임베딩을 위한 적재 스크립트 국소 보강.
> 유료 Voyage API 호출 및 DB 쓰기는 비용 게이트 승인 전이므로 수행하지 않았다.

## 변경 사항 요약

**파일 변경 목록:**

- `scripts/embed.ts` — 전문 입력 상한·글자 수 예산 배치·`externalId` metadata 저장
- `scripts/embedQuality.ts` — `externalId` 우선 중복 검사
- `tests/unit/embed.test.ts` — 전문 상한과 배치 예산 단위 테스트
- `tests/unit/embedQuality.test.ts` — `externalId` 우선 검사 단위 테스트

**주요 변경:**

- `MAX_CONTENT_CHARS`를 6,000자에서 30,000자로 상향했다. 현재 최장 해석례 본문 26,886자가 절단되지 않으며, DB에는 기존과 동일하게 전문 원문을 저장한다.
- 배치는 최대 20건을 유지하면서, 다음 문서를 더했을 때 누적 90,000자에 닿으면 먼저 flush한다. 한국어 약 45,000~60,000토큰 규모로 voyage 요청 한도를 보수적으로 방어한다.
- 국세청 해석례의 비고유 `caseNumber` 대신, 존재하면 고유한 `externalId`로 품질 게이트 중복을 판정한다. 적재 행의 JSONB metadata에도 `externalId`를 저장해 사후 실제 중복 검증에 사용한다.
- 스트리밍 입력·`content_hash` dedup·upsert·재시도 로직은 변경하지 않았다.

## 검증 결과

1. `npm.cmd run test -- tests/unit/embed.test.ts tests/unit/embedQuality.test.ts` — PASS, 24/24
2. `npm.cmd run typecheck` — PASS, 0 오류
3. `npm.cmd run embed -- --input scripts/ntsExpc_full.json --dry-run` — PASS
   - 전체 136,345건
   - 본문 보유 136,304건
   - DB 및 Voyage API 호출 없음
4. `npm.cmd run test` — PASS, 813/813 (52개 파일)
5. `git diff --check` — PASS

## 미수행 항목 및 비용 게이트

- 전량 임베딩 및 `taxlaw_embeddings` 적재는 Voyage API 유료 호출(티켓 추정 $10~30)을 수반하므로 수행하지 않았다.
- 비용 승인 후 `npm run embed -- --input scripts/ntsExpc_full.json`을 실행하고, 해석례 행 수·1024차원·`externalId` 기준 중복 0건 및 기존 벡터 게이트 쿼리 기준선을 확인해야 한다.
- 검색 배선은 TAX-6B-20-C, 문서 정합은 TAX-6B-20-D 범위다.

## 잠재 위험

- 30,000자 초과의 향후 문서는 여전히 절단된다. 현재 실측 최장 26,886자에는 영향이 없으며, 더 긴 문서가 생기면 voyage 컨텍스트 한도와 함께 재평가가 필요하다.
- 단일 벡터 방식 특성상 긴 문서의 의미가 다소 희석될 수 있다. 청킹은 티켓 결정대로 후속 TAX-6B-20-E 후보로 분리한다.
