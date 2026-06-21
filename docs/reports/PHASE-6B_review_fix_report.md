# Phase 6B 검토 후 수정 리포트

작성일: 2026-06-21  
목적: Claude 재검토용 — Phase 6B 티켓·리포트 검토에서 발견한 정합성 문제와 실제 수정 전후 변화를 기록한다.

---

## 1. 검토 배경

Phase 6B는 비법령 자료(판례·심판례) 참고 목록의 정확도 개선과 벡터 검색 전환을 다루는 구간이다.  
티켓과 리포트 검토 결과, 문서상 완료 상태와 실제 코드 상태가 일부 어긋나 있었고, 심판례 전량 적재 티켓(`TAX-6B-18`)은 전체 보류 상태인데 일부 구현이 이미 들어간 상태였다.

이번 수정의 원칙:

- 전체 보류 티켓을 완료로 포장하지 않는다.
- 이미 구현된 선행 작업은 별도 부분 구현으로 명확히 표시한다.
- 회계사 업무 정확성에 직접 영향을 주는 경로는 테스트로 잠근다.

---

## 2. 수정 전 문제점

| 구분 | 수정 전 상태 | 위험 |
|---|---|---|
| Phase 6B 범위 | `ROADMAP.md`는 `TAX-6B-1~8` 완료 중심이고, `TAX-6B-10~18`의 현재 상태가 충분히 추적되지 않음 | 실제 진행 상황을 Claude/AI가 잘못 판단할 수 있음 |
| `TAX-6B-18` 상태 | 전체 보류 티켓인데 수집기 코드가 이미 구현되어 있음 | 전량 적재 완료로 오해할 가능성 |
| 심판례 벡터 경로 | `generateAnswer.buildReferences`는 pgvector에서 `sourceType='판례'`만 조회 | DB에 심판례를 적재해도 참고 목록에 합류하지 않음 |
| `caseNumber` 품질 | 전량 적재 완료 조건은 사건번호 unique인데 수집기 finalize 단계 검증이 없었음 | 중복 심판례가 DB/검색 결과에 들어갈 수 있음 |
| 임베딩 문서 | 일부 문서가 여전히 OpenAI embedding 기준으로 설명 | 실제 `voyage-4`/`VOYAGE_API_KEY` 구현과 불일치 |
| NUL 바이트 | `app/api/answer/route.ts` 정규식에 실제 NUL 바이트가 들어가 `rg`가 binary로 인식 | 검색·리뷰·패치 난이도 증가 |

---

## 3. 수정 후 변화

### 3.1 문서 정합성

- `AGENTS.md`, `CLAUDE.md`, `docs/PRD.md`, `docs/SSOT.md`, `ROADMAP.md`의 임베딩 설명을 `voyage-4` / `VOYAGE_API_KEY` 기준으로 정리했다.
- `ROADMAP.md`에 Phase 6B 외 별도 트랙으로 비법령 코퍼스 확장(`TAX-6B-14~16`, `TAX-6B-18A`)을 명시했다.
- `docs/tickets/TAX-6B-18_tribunal_full_load.md`를 전체 보류 티켓으로 유지하면서, 수집기와 검색 경로 선행 배선만 부분 구현으로 구분했다.
- `docs/reports/TAX-6B-18A_report.md`를 추가해 심판례 수집기 선행 구현 상태와 남은 범위를 기록했다.

### 3.2 코드 수정

- `app/api/answer/route.ts`
  - 실제 NUL 바이트가 포함된 제어문자 정규식을 `/[\u0000-\u001F\u007F]/` 형태로 교체했다.
  - 주석의 stale `OPENAI_API_KEY` 설명을 `VOYAGE_API_KEY` 기준으로 정리했다.

- `scripts/collectTribunal.ts`
  - finalize 단계에 `caseNumber` 중복·누락 품질 게이트를 추가했다.
  - 중복·누락 발견 시 `scripts/tribunal/duplicate_case_numbers.json`을 쓰고 기본 중단한다.
  - 예외적으로만 `--allow-duplicate-case`로 강행 가능하게 했다.

- `scripts/embed.ts` / `scripts/embedQuality.ts`
  - 공통 임베딩 적재 전 비법령 `sourceType + caseNumber` 중복·누락을 검사한다.
  - 문제 발견 시 `scripts/embed_case_number_issues.json`을 쓰고 기본 중단한다.
  - 예외 승인 시에만 `--allow-case-issues`로 강행할 수 있다.

- `src/usecases/generateAnswer.ts`
  - 기존 판례 전용 `fetchPrecedentReferences`를 비법령 벡터 참고자료용 `fetchVectorReferences`로 일반화했다.
  - pgvector 검색 대상 sourceType을 `['판례', '심판례']`로 확대했다.
  - sourceType별 `topK=5`, 최소 유사도 `0.5`, 노출 상한 `2건`을 적용한다.
  - 벡터 검색 실패 시 해당 sourceType만 건너뛰고 기존 외부 API 참고 목록은 유지한다.
  - 발췌 인용으로 승격하지 않고 `references`에만 병합하므로 law-verifier V1~V6 범위를 침범하지 않는다.

### 3.3 테스트 수정

- `tests/unit/collectTribunal.test.ts`
  - `findDuplicateCaseNumbers` 테스트를 추가해 사건번호 중복·누락 검출을 검증했다.

- `tests/unit/embedQuality.test.ts`
  - 법령은 검사 대상에서 제외하고, 판례·해석례·심판례의 `sourceType + caseNumber` 중복·누락을 검증했다.

- `tests/unit/precedentReferences.test.ts`
  - 벡터 검색 스텁이 실제 포트처럼 sourceType별 결과만 반환하도록 수정했다.
  - 심판례(`sourceType='심판례'`, `trustTier='T3'`)가 유사도 바닥 이상이면 참고 목록에 노출되는 회귀 테스트를 추가했다.
  - 기존 판례(T4) 노출, 유사도 바닥, 상한, graceful degrade, 중복 제거 테스트는 유지했다.

---

## 4. 검증 결과

| 명령어 | 결과 |
|---|---|
| `npm run test -- tests/unit/collectTribunal.test.ts` | PASS, 18/18 |
| `npm run test -- tests/unit/embedQuality.test.ts` | PASS, 4/4 |
| `npm run test -- tests/unit/precedentReferences.test.ts` | PASS, 9/9 |
| `npm run embed -- --input scripts/laws_for_embed_nonlaw.json --dry-run` | PASS, 더미 env로 DB/Voyage 호출 없이 실행 |
| `npm run typecheck` | PASS |
| `npm run test` | PASS, 613/613 |
| `npm run lint` | FAIL, 기존 UI 파일의 React lint 오류 |

추가 확인:

- `app/api/answer/route.ts`의 NUL 바이트 제거 확인.
- 새 심판례 벡터 참고 경로는 테스트로 검증했지만, 실제 pgvector 심판례 적재는 아직 수행하지 않았다.
- lint 실패 위치는 이번 수정 범위 밖의 `app/components/AnswerCard.tsx`, `app/components/BookmarkList.tsx`, `app/components/SearchBar.tsx`, `app/page.tsx`, `src/adapters/opsLog.ts`다.

---

## 5. 수정 전후 핵심 차이

| 항목 | 수정 전 | 수정 후 |
|---|---|---|
| 심판례 전량 적재 티켓 | 보류 상태와 부분 구현 상태가 섞여 보임 | `TAX-6B-18`은 전체 보류, `TAX-6B-18A`는 선행 부분 구현으로 분리 |
| DB 심판례 검색 | pgvector에 심판례가 있어도 `generateAnswer`가 조회하지 않음 | `sourceType='심판례'`를 판례와 동일한 벡터 참고자료 경로로 조회 |
| 사건번호 중복 | 수집 결과 finalize 단계와 공통 적재 단계에서 중복 검증 없음 | 수집기와 embed 적재 전 단계 모두 중복·누락 보고서 생성 후 기본 중단 |
| 임베딩 모델 문서 | OpenAI embedding 설명 잔존 | voyage-4 / VOYAGE_API_KEY 기준으로 통일 |
| 코드 검색성 | NUL 바이트로 일부 파일이 binary처럼 보임 | NUL 제거로 일반 텍스트 검색 가능 |

---

## 6. 남은 작업과 리스크

아직 완료하지 않은 것:

- 조세심판원 결정례 약 14만 건 실제 API 전수 수집
- voyage-4 임베딩 실행
- pgvector/Neon 적재
- DB 스키마 수준 `(source_type, case_number)` unique 보장
- 저장소 용량·Neon 플랜 결정
- 운영 질의에서 심판례 벡터 참고자료가 실제로 개선되는지 전후 비교
- P95 회귀 측정
- 기존 UI lint 오류 정리

현재 상태의 의미:

- 코드 경로는 준비됐다.
- 데이터가 아직 없으므로 운영 효과는 아직 없다.
- `TAX-6B-18` 전체 완료로 판단하면 안 된다.

---

## 7. Claude 재검토 요청 포인트

Claude에게 다음을 중점 평가 요청하면 된다.

1. `TAX-6B-18`을 전체 보류로 두고 `TAX-6B-18A` 부분 구현으로 분리한 문서 판단이 적절한가?
2. `fetchVectorReferences`가 판례·심판례를 sourceType별로 조회하고 실패를 격리하는 설계가 적절한가?
3. 심판례를 `references`에만 병합하고 발췌 인용으로 승격하지 않는 방식이 SSOT §6.4와 충돌하지 않는가?
4. `caseNumber` 중복·누락을 수집기 finalize + embed 적재 전 단계에서 막는 것으로 충분한가, 아니면 DB unique 인덱스를 즉시 추가해야 하는가?
5. 전량 적재 착수 전 추가로 필요한 승인 게이트(저장소 플랜, 비용, P95 기준)가 빠졌는가?

---

## 8. 결론

이번 수정은 Phase 6B를 “완료 처리”하기 위한 작업이 아니라, 티켓·문서·코드의 상태를 실제 구현 수준에 맞게 정렬한 작업이다.  
심판례 전량 적재는 여전히 보류 상태이며, 현재 완료된 것은 수집기 선행 구현, 중복 품질 게이트, 그리고 pgvector에 심판례가 적재되었을 때 답변 참고 목록에서 활용할 수 있는 검색 경로 선행 배선이다.

추가 진행 중 도구 사용 한도에 걸려 여기서 멈췄습니다. 우회 실행은 하지 않았습니다.
                                                                                                                                                   
  추가로 반영한 내용:                                                                                                                              
                                                                                                                                                   
  - PgVectorSearchAdapter와 scripts/migrate.sql 확인: source_type 필터는 심판례도 처리 가능한 구조입니다.                                          
  - scripts/embedQuality.ts 추가: 임베딩 적재 전 비법령 sourceType + caseNumber 중복·누락 검사.                                                    
  - scripts/embed.ts 수정: 품질 오류 발견 시 scripts/embed_case_number_issues.json 작성 후 기본 중단.                                              

  - 관련 테스트 3개 파일: PASS, 31/31
  - npm run typecheck: PASS
  - npm run embed -- --input scripts/laws_for_embed_nonlaw.json --dry-run: PASS
  - npm run test 전체 재실행은 도구 사용 한도로 거부됨
  주의: 도구 한도 때문에 마지막 문서 정정 패치를 못 했습니다. 현재 리포트의 전체 테스트 표기는 “추가 수정 전 613/613 PASS” 기준이므로, Claude에게  
  평가시키기 전에 “전체 테스트는 embedQuality 추가 후 재실행 못 함, 관련 테스트 31/31 + typecheck PASS”라고 같이 전달하는 게 정확합니다.

**리포트:** `docs/reports/PHASE-6B_review_fix_report.md`
