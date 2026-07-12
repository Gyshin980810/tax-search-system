# [TAX-6B-20-C] 품질 판정서 — R1

## 판정: PASS

## 게이트 1 — 기계 검증
- `npm run test`: 53 test files / 829 tests — **829 passed / 0 failed** → 통과
  (리포트 기재값 822/822과 다름 — 형제 20-B 후속 커밋(c3c79d2)이 이 브랜치에 추가로 병합되며 테스트가
  늘어난 것으로, 20-C 자체의 결함이 아님. 전건 통과라는 결론에는 영향 없음.)
- `npm run typecheck`: 오류 0건(출력 없음, exit 0) → 통과
- (참고) `npm run lint`: 5 errors / 2 warnings — 전부 `app/components/BookmarkList.tsx`,
  `app/components/SearchBar.tsx`, `app/page.tsx`, `src/adapters/opsLog.ts`에서 발생. 이번 20-C 범위
  파일(`generateAnswer.ts`/`searchMerge.ts`/`vectorSearch.ts`/`nationalTaxLaw.ts`)이 아닌 사전 존재
  이슈로 확인(TAX-6B-20-B R1 판정서와 동일 목록) — FAIL 사유로 반영하지 않음, 참고용 기록만.

## 게이트 2 — 지시서 항목
지시서(R1_review.md)는 "결함 없음, 수정 항목 없음" 판정이었다. 아래는 그 판정 자체가 타당한지 코드를
직접 열어 재확인한 결과다.

- [1] AC1 `VECTOR_REFERENCE_GATES` 해석례 엔트리 + 타입 유니온 2곳: **[해소, 직접 확인]**.
  `src/usecases/generateAnswer.ts:68` 유니온 `'판례' | '심판례' | '해석례'`, `:71` 엔트리
  `{ sourceType: '해석례', topK: 5, minSimilarity: 0.5, max: 2 }`(티켓 §4 결정 ①과 일치),
  `:284` `fetchVectorReferences` 게이트 파라미터 유니온도 `'해석례'` 포함.
- [2] AC4 `identityKey` 단일 진실 원천 + externalId 우선·caseNumber 폴백: **[해소, 직접 확인]**.
  `src/domain/searchMerge.ts:18-21`가 유일한 `identityKey` 구현이며
  `${sourceType}|${externalId?.trim() || (caseNumber ?? '')}`. `generateAnswer.ts`가 이를 import(자체
  사본 없음, `grep`으로 재확인). 사본 2곳 통합이 실제로 구현돼 있다.
- [3] AC4 `rowToTaxLaw` 순수함수 export + externalId 매핑: **[해소, 직접 확인]**.
  `src/adapters/vectorSearch.ts:32` `export function rowToTaxLaw`, SELECT에
  `metadata->>'externalId' AS external_id`(:71), 매핑 `...(row.external_id ? { externalId: ... } : {})`
  (:47). `tests/unit/vectorSearch.test.ts` 2건이 external_id 존재/NULL 양쪽 케이스를 직접 검증(모킹이
  아닌 순수 함수 단위 테스트로, 티켓이 경고한 "픽스처 함정" 회피 방식과 일치).
- [4] 실시간 어댑터 externalId 채우기: **[해소, 직접 확인]**.
  `src/adapters/nationalTaxLaw.ts:973` `externalId: extractNtsExternalId(e.법령해석상세링크)` — 티켓
  §4 구현순서 3b에 명시된 변경과 정확히 일치.
- [5] citation 승격 금지(참고 목록 V검증 비대상 유지): **[해소, 직접 확인]**.
  `generateAnswer.ts`에서 `buildReferences`(:564) 호출이 `runTwoStage`/`verifier.verify(answer,
  split.citable)`(:522/527) **이후**에 일어남을 코드에서 직접 확인. 벡터 해석례는 `buildReferences`
  내부 `fetchVectorReferences`에서만 생성돼 `references`로만 흘러가고 `verifier.verify`가 받는
  `split.citable`(검색 결과 산출물)에는 절대 섞이지 않는다 — §6.4·SSOT §7.4 준수.
- [6] 범위 준수(§3.1 허용 변경과 실제 diff 일치): **[해소, 직접 확인]**. 코드 커밋 `d8abb85`가 건드린
  파일(`generateAnswer.ts`·`searchMerge.ts`·`vectorSearch.ts`·`nationalTaxLaw.ts` + 4개 테스트 +
  스냅샷)이 티켓 §3.1 허용 목록(게이트 1줄·유니온 2곳·SELECT 컬럼 추가·identityKey 단일화·
  실시간 어댑터 채우기)과 1:1로 일치. §3.2 금지 목록(searchSimilar 시그니처 변경·본문 크롤링 부활·
  citation 승격·판례/심판례 게이트 값 변경·임베딩 적재 코드 혼입) 위반 없음을 직접 확인.
- [7] AC5(P95) 서술의 정확성 — "완료"와 "합격" 혼동 여부: **[해소, 오도 없음]**. 티켓 §5 AC5·
  리포트 §3가 "미달 확인(❌ FAIL, 25.37s ≥ 15.00s)"을 명시하고 회계사 결정("기록만 하고 종료")을
  함께 기재. `[x]` 표기는 "측정·기록 완료"를 뜻하는 것으로 문맥상 명확하며, 근처에 "미달"이라는
  단어와 실측치가 병기돼 있어 "합격"으로 오독될 여지가 없다. 은폐·과장 서술 없음.

**🔴 Blocker·🟡 Major 없음**(지시서 자체가 명시). 위 재확인 결과 "결함 없음" 판정은 타당하다.

## 게이트 3 — 범위·안전
- **범위 이탈**: 없음. 이번 판정 대상 최신 커밋 `99ec231`("docs(TAX-6B-20-C): 실적재 후 잔여 라이브
  검증 3종 완료 반영")의 `git show --stat` 결과, 변경 파일은 `ROADMAP.md`, `docs/reports/TAX-6B-20-B_report.md`,
  `docs/reports/TAX-6B-20-C_report.md`, `docs/reports/TAX-029_p95_baseline_2026-07-12.json`,
  `docs/tickets/TAX-6B-20-C_interpretation_search_wiring.md` 5개로 **전부 문서/산출물 파일**이며 소스
  코드 변경이 전혀 없다. 이 브랜치가 20-B/20-C를 함께 담은 스택 브랜치라는 전제(작업 지시)에 따라 앞선
  코드 커밋(`d8abb85` = 20-C, `c3c79d2` = 20-B)이 섞여 있는 것은 정상이며, 각각 자기 티켓 범위(§3.1)와
  1:1로 일치함을 위 게이트 2에서 직접 확인했다.
- **세법 정확성 회귀**: 없음. `identityKey` 변경(externalId 우선·caseNumber 폴백)은 원문 인용·라벨링
  로직을 건드리지 않고, 오히려 2004년 이전 caseNumber 공유 문서의 과잉 제외를 막는 방향(정확성 개선).
  V1~V6 검증·`temperature 0`·`withRetry`·병렬 게이트(`Promise.all`)·try/catch graceful degrade 모두
  diff에서 손상 흔적 없음.
- **시크릿 노출**: 없음. 최신 커밋 `git show HEAD | grep`으로 API 키·`DATABASE_URL` 값·시크릿 패턴
  검색 결과 매치 없음. 신규 추가된 `TAX-029_p95_baseline_2026-07-12.json`(2,916줄)도 스팟체크 결과
  측정 통계치만 포함, 시크릿·회계사 식별자 없음.

## FAIL 사유
(해당 없음 — PASS)

## 잔여 (PASS여도 남은 🟢 Minor)
- (관찰 1) `externalId` 추출 로직이 `scripts/collectNtsInterpretations.ts`(정규식)와
  `src/adapters/nationalTaxLaw.ts`(`URLSearchParams`) 두 곳에 별도 구현됨. 현재는 `ntstDcmId`가
  18자리 숫자 고정 형식이라 두 방식이 동치 산출을 내지만, `scripts/`→`src/` import 불가라는 구조적
  제약으로 물리적 공유가 어렵다. 향후 ID 형식 변경 시 드리프트 가능성 — 지금 당장 수정 불필요, 후속
  관찰로만 기록.
- (관찰 2) 대용량 P95 측정 산출물(`docs/reports/TAX-029_p95_baseline_2026-07-12.json`, 2,916줄)을
  git에 커밋하는 관행이 계속될지는 회계사 판단 사항(리포지토리 용량 증가) — 코드 결함 아님.
- (관찰 3) AC5 벡터 3게이트 기여분(P95 4.52s)이 §7 리스크가 예고한 "1.5s 초과 시 ANN 인덱스 재검토"
  트리거를 충족했다. 자동 도입 대상은 아니나(회계사 재확인 필요 항목으로 명시), 다음 관련 티켓 착수
  시 HNSW/IVFFlat 재검토 여부를 회계사와 재확인할 필요가 있음을 상기.
