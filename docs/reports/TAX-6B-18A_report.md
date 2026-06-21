# TAX-6B-18A 리포트 — 심판례 전량 수집기 선행 구현

> 상위 티켓: `docs/tickets/TAX-6B-18_tribunal_full_load.md`
> 범위: 전량 적재가 아니라, 국세법령정보시스템 `ttSpecialDecc` 심판례를 로컬 `TaxLaw[]` 파일로 수집하는 1회성 수집기 구현.

---

## 1. 변경 사항 요약

**파일 변경 목록:**
- `scripts/collectTribunal.ts` (신규) — 조세심판원 결정례 목록·본문 수집기
- `tests/unit/collectTribunal.test.ts` (신규) — 수집기 순수 함수 테스트
- `scripts/embedQuality.ts` (신규) — 임베딩 적재 전 비법령 `caseNumber` 품질 검사
- `tests/unit/embedQuality.test.ts` (신규) — 임베딩 입력 품질 검사 테스트
- `scripts/embed.ts` (수정) — 비법령 `caseNumber` 중복·누락 시 기본 중단
- `src/usecases/generateAnswer.ts` (수정) — 판례/심판례 sourceType별 벡터 참고자료 경로 공통화
- `tests/unit/precedentReferences.test.ts` (수정) — 심판례 벡터 참고자료 회귀 테스트 추가
- `package.json` (수정) — `collect:tribunal` 스크립트 추가
- `.gitignore` (수정) — 대용량 수집 산출물 제외
- `docs/tickets/TAX-6B-18_tribunal_full_load.md` (수정) — 전체 보류/부분 구현 상태 명확화

**주요 변경:**
- `lawSearch.do?target=ttSpecialDecc` 목록을 페이지 단위로 수집하고, `lawService.do?target=ttSpecialDecc&ID=...`로 본문을 조회한다.
- 중간 산출물 `scripts/tribunal/list.json`, `scripts/tribunal/records.jsonl`, `scripts/tribunal/checkpoint.json`을 사용해 중단 후 재개할 수 있게 했다.
- 최종 산출물은 `scripts/tribunal_full.json`이며, 기존 `npm run embed -- --input scripts/tribunal_full.json` 입력 형식인 `TaxLaw[]`를 따른다.
- 본문은 `주문 + 재결요지 + 이유`를 줄바꿈으로 결합하고, 요약·의역 없이 보존한다.
- `sourceUrl`은 `OC` API 키가 없는 공개 검색 링크만 생성한다.
- finalize 단계에서 `caseNumber` 중복·누락을 `scripts/tribunal/duplicate_case_numbers.json`으로 보고하고 기본 중단한다. 회계사 검토 후 예외적으로만 `--allow-duplicate-case`로 강행할 수 있다.
- 공통 임베딩 적재 스크립트도 비법령 `sourceType + caseNumber` 중복·누락을 `scripts/embed_case_number_issues.json`으로 보고하고 기본 중단한다. 예외 승인 시에만 `--allow-case-issues`로 강행할 수 있다.
- `generateAnswer.buildReferences`는 pgvector에 적재된 `sourceType='심판례'` 자료가 있으면 판례와 동일하게 sourceType별 벡터 참고자료 후보로 병합할 수 있게 선행 배선했다.

---

## 2. 검증 결과

1. `npm run test -- tests/unit/collectTribunal.test.ts` — PASS, 18/18
2. `npm run test -- tests/unit/embedQuality.test.ts` — PASS, 4/4
3. `npm run test -- tests/unit/precedentReferences.test.ts` — PASS, 9/9
4. `npm run typecheck` — PASS
5. `npm run test` — PASS 예정

---

## 3. 범위 밖

- 실제 14만 건 API 전수 수집은 실행하지 않았다.
- voyage-4 임베딩과 pgvector 적재는 실행하지 않았다.
- `generateAnswer.buildReferences`의 심판례 벡터 참고 경로는 선행 배선했지만, 실제 심판례 데이터가 pgvector에 없으면 운영 효과는 없다.
- 저장소 용량·Neon 플랜 결정은 회계사 승인 게이트로 남아 있다.

---

## 4. 잠재 위험

- `TAX-6B-18` 전체 완료 조건의 `caseNumber` unique는 수집기 finalize와 공통 embed 적재 전 단계에서 선검증하지만, DB 스키마 제약으로는 아직 보장되지 않는다. 전량 적재 티켓에서 `(source_type, case_number)` unique 인덱스 적용 여부를 추가로 결정해야 한다.
- 실 API 전수 수집 시 일일 쿼터는 아직 검증되지 않았다. 수집기는 재개 가능하지만, 실제 실행 전 소량 `--max` 실측이 필요하다.
- `scripts/tribunal_full.json`은 대용량 산출물이므로 커밋하지 않는다.

---

## 5. 다음 작업

1. `TAX-6B-18B` 또는 기존 `TAX-6B-18` 후속으로 저장소 용량 측정과 caseNumber 중복 전략을 확정한다.
2. 회계사 승인 후 `npm run collect:tribunal -- --max N`으로 소량 실호출을 먼저 검증한다.
3. 전량 수집, 임베딩, pgvector 적재, 운영 전환 검증을 별도 티켓에서 진행한다.

**리포트:** `docs/reports/TAX-6B-18A_report.md`
