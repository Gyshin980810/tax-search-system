# [TAX-6B-20-D] 품질 판정서 — R1

## 판정: PASS

## 게이트 1 — 기계 검증
- `npm run test`: 53 test files / 829 tests — **829 passed / 0 failed** → 통과
  (리포트 기재값 829/829과 일치. 코드 로직 무변경 티켓이므로 이번 세션 초반 baseline 829/829과도
  동일 건수임을 직접 재확인함.)
- `npm run typecheck`: 오류 0건(출력 없음, exit 성공) → 통과
- (참고) `npm run lint`: 5 errors / 2 warnings — 전부 `app/components/BookmarkList.tsx`,
  `app/components/SearchBar.tsx`, `app/page.tsx`, `src/adapters/opsLog.ts`에서 발생. 이번 20-D 범위
  (docs + `nationalTaxLaw.ts` 주석)와 무관한 사전 존재 이슈로 확인(TAX-6B-20-B/C R1 판정서와 동일
  목록) — FAIL 사유로 반영하지 않음, 참고용 기록만.

## 게이트 2 — 지시서 항목
지시서(R1_review.md)는 "결함 없음, 수정 항목 없음" 판정(🔴 0건·🟡 0건·🟢 관찰 3건)이었다. 아래는 그
판정 자체가 타당한지 코드·문서를 직접 열어 재확인한 결과다.

- [1] [핵심] `nationalTaxLaw.ts` 주석만 변경, 실행 로직·타입·시그니처 무변경: **[해소, 직접 확인]**.
  `git diff src/adapters/nationalTaxLaw.ts` 결과 변경분 전체가 `searchNtsInterpretations` 함수 위
  JSDoc 블록(925~934행) 내부 텍스트뿐이다. diff 직후 코드(`private async searchNtsInterpretations
  (keyword: string): Promise<TaxLaw[]>` 및 함수 본문)를 직접 열어 확인한 결과 토큰 변경 0건 — 함수
  시그니처·정규화 로직·import 전부 그대로. 주석 내용도 "본문을 아예 못 구한다"는 오해만 "실시간 경로는
  P95 보호를 위해 의도적으로 목록만 유지, 본문은 오프라인 코퍼스(TAX-6B-20-A~C)"로 정정해 §3.2 "코드
  로직 무변경"을 준수한다.
- [2] 과거 오기록 정정 — 원문 보존 + 날짜 있는 정정 주석 방식: **[해소, 직접 확인]**.
  `git diff` 3개 파일(TAX-6B-19 티켓, TAX-6B-19 리포트, 부모 TAX-6B-20 §2.1)을 각각 열람. 셋 다
  헤더/해당 단락 직후에 `> ⚠️ 정정 주석 (2026-07-13, TAX-6B-20-D)` 블록쿼트만 **추가**됐고, 원문
  ("ntsCgmExpc 본문 API 자체가 없다", "OC=data 테스트키로도 응답이 비어 있음", "해석례 본문은
  수십~수백자 수준")은 삭제·수정 없이 그대로 보존됨. "역사 다시 쓰기 금지" 원칙 준수.
- [3] SSOT→PRD→CLAUDE.md 문서 위계 순서·상호 정합: **[해소, 직접 확인]**.
  SSOT §7.2-a 신설(공식 API 존재·운영키 권한 봉쇄·크롤링 확보 경위·135,907건 적재·
  `VECTOR_REFERENCE_GATES` 병렬 편입·references 전용·V1~V6 비대상 명문화), §7.2 매핑 표 각주 보강,
  §7.4 V1에 caseNumber 충돌 잔여 리스크 각주 신설. PRD FR-10 티켓 목록에 `20-A~C` 추가 + "FR-10 상태
  보충 2" 블록쿼트 신설(SSOT와 동일 결론: 참고 목록 전용·V검증 비대상·citation 승격 금지, 실시간
  어댑터 무변경). CLAUDE.md §7.1 `VOYAGE_API_KEY` 용도에 해석례 벡터 적재 한 줄 추가. 세 문서 diff를
  직접 읽어 결론 불일치·모순 없음을 확인.
- [4] SSOT 비법령 식별자 서술 3곳에 `externalId` 반영: **[해소, 직접 확인]**.
  TaxLaw 필드 표(비고 칼럼, 241행 부근)에 2004년 이전 caseNumber 세목명 공유 사례("재산" 82건) +
  "dedup·동일성은 externalId 우선·caseNumber 폴백" 명시. §7.2 매핑 표 content 각주(268행 부근)에
  "실시간은 의도적 유지, 오프라인 코퍼스 별도 존재" 보강. V1 규칙 직후(306행 부근)에 caseNumber 충돌
  시 오매칭 잔여 리스크 각주 신설. AC7 목표("caseNumber 단독 식별 단정 잔재 0건") 충족을 직접 확인.
- [5] 헤더 버전·changelog 함께 갱신: **[해소, 직접 확인]**.
  SSOT 헤더 `2.7 → 2.9`(v2.8 누락분 소급 보정 포함), changelog에 2026-07-13 v2.9 행 신설. PRD 헤더
  `2.8 → 2.9`, changelog v2.9 행 신설. 두 changelog 모두 "코드 로직 변경 없음(주석 정정만)"을 명시.
- [6] ROADMAP §3 반영(누락분 보정, 이중 반영 없음): **[해소, 직접 확인]**.
  해석례 트랙 행이 `🟡 20-C 라이브 검증 완료` → `🟢 20-A~D 완료`로 갱신, 잔여 목록에서 20-D를 제거하고
  20-E(조건부, 트리거 미충족)만 남김. 상호 참조 행 번호(§692→§697)도 함께 갱신.
- [7] 메모리 갱신: **[해소, 직접 확인]**.
  `project_nonlaw_interp_tracks.md` description·본문에 "TAX-6B-20-A~D 전체 완료(2026-07-13)" 요약이
  append됐고, `MEMORY.md` 인덱스 라인도 최신 상태로 갱신됨을 직접 grep으로 확인.
- [8] 범위 준수(§3.1 허용 목록과 실제 diff 일치, 시크릿 미노출): **[해소, 직접 확인]**.
  `git status` 변경 파일 9개(`CLAUDE.md`·`ROADMAP.md`·`docs/PRD.md`·`docs/SSOT.md`·
  `docs/reports/TAX-6B-19_report.md`·`docs/tickets/TAX-6B-19_interpretation_list_only.md`·
  `docs/tickets/TAX-6B-20-D_interpretation_docs_sync.md`·
  `docs/tickets/TAX-6B-20_interpretation_corpus_load.md`·`src/adapters/nationalTaxLaw.ts`) 전부 티켓
  §3.1 허용 목록과 1:1 대응. 신규 파일은 `docs/reports/TAX-6B-20-D_report.md`(리포트, 허용)와
  `docs/code-reviews/TAX-6B-20-D/`(하네스 산출물)뿐. `git diff` 전체에서 API 키·`DATABASE_URL` 값·
  회계사 식별자 패턴 검색 결과 매치 없음(환경변수 "이름" 표기만 등장).

**🔴 Blocker·🟡 Major 없음**(지시서 자체가 명시). 위 8개 항목을 독립적으로 재확인한 결과
"결함 없음" 판정은 타당하다.

## 게이트 3 — 범위·안전
- **범위 이탈**: 없음. `git status` 전체 변경 파일이 위 [8]에서 확인한 9개 문서/주석 파일 +
  신규 리포트 1개로, 티켓 §3.1 허용 범위와 정확히 일치한다. 유일하게 소스 코드로 분류되는
  `src/adapters/nationalTaxLaw.ts`도 주석 블록만 변경돼 §3.2 금지 목록("코드 로직 변경")을
  위반하지 않는다.
  - **스냅샷 노이즈 확인**: `tests/integration/__snapshots__/nationalTaxLaw.test.ts.snap`이
    `git status`에 `M`(수정)으로 표시되나, `git diff`(및 `--ignore-space-at-eol`)를 직접 실행한 결과
    **실질 콘텐츠 변경은 0건**이고 "LF will be replaced by CRLF" 경고만 출력됨 — 순수 줄바꿈(CRLF/LF)
    노이즈이며 코드 결함이 아니다. 다른 문서 3개(`docs/reports/TAX-6B-19_report.md` 등)도 동일한 경고가
    함께 뜨는데, 그쪽은 실제 콘텐츠 diff(정정 주석 추가)가 있으므로 혼동하지 않도록 구분해 확인했다.
- **세법 정확성 회귀**: 없음. 법령 원문 상수·발췌 텍스트 변형 없음(이 티켓은 문서·주석만 다룸).
  V1~V6 검증 로직·`temperature 0`·재시도 로직·라벨 정책 어느 것도 diff에 등장하지 않는다(코드
  파일이 `nationalTaxLaw.ts` 주석 1건뿐이므로 구조적으로 회귀 가능성이 없다).
- **시크릿 노출**: 없음. `git diff` 전체에서 API 키 값·`DATABASE_URL` 값·`postgres://` 패턴·회계사
  식별자 검색 결과 매치 없음. `OC=data`는 부모 티켓에 이미 기록된 공개 데모키로만 언급됨.

## FAIL 사유
(해당 없음 — PASS)

## 잔여 (PASS여도 남은 🟢 Minor, 지시서의 관찰 3건 재확인)
- (관찰 1, 지시서 원문 재확인) 20-D 티켓 자체 §0/§2.1 계획 표는 계획 작성 시점(2026-07-09) 수치인
  "최대 26,886자"를 인용하나, 실제 납품된 정정 주석(부모 20 §2.1)은 최신 실측값 "최장 32,991자"를
  쓴다(SSOT/ROADMAP과 일치). 계획 문서 자체의 잔존값일 뿐 정정 주석은 정확함 — 수정 불필요.
- (관찰 2, 지시서 원문 재확인) TAX-016B/C·TAX-018·TAX-6B-21 등 범위 밖 과거 티켓엔 여전히
  "본문 없음/목록만" 서술이 남아 있으나, 이 티켓의 정정 대상(TAX-6B-19·부모 20 §2.1)이 아니므로
  손대지 않은 것이 올바른 선택(범위 엄수). 향후 `/sync-docs` 일괄 정합 시 참고.
- (관찰 3, 지시서 원문 재확인) SSOT 정규화 매핑 표(268행 부근) caseNumber 행에는 externalId 각주가
  직접 붙지 않는다 — 순수 필드 매핑 규칙이라 식별자·dedup을 단정하지 않으므로 각주 대상이 아니다.
  실질 목표("caseNumber 단독 식별 단정 잔재 0건")는 244행·306행 각주로 이미 충족.
