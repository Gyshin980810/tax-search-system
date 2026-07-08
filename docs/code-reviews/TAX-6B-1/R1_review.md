# [TAX-6B-1] 코드 수정 지시서 — R1

> 이 라운드에는 🔴 Blocker가 없습니다. 아래 항목은 🟡 Major 1건 + 🟢 Minor 3건입니다.
> 🟡 [1]은 세법 정확성(T1 우선 노출) 및 회귀 위험과 직결되므로 우선 반영하세요.

## 이 문서의 사용법 (Codex에게)
아래 "수정 항목"을 순서대로 처리하세요. 각 항목의 파일·위치·기대 결과를 지킵니다.
**아래 "절대 규칙"을 어기는 수정은 하지 마세요.**

## 절대 규칙 (이 프로젝트 불변 제약)
- 법령/판례/예규/부칙 원문 텍스트를 요약·의역·가공하지 말 것. 발췌는 원문과 문자 단위로 일치해야 함(§6.1). `flattenText`의 원문 줄 결합 방식을 바꾸지 말 것.
- 계층 구조 준수: UI → API Route → Usecase → Adapter/Port. Usecase에서 fetch·DB 직접 호출 금지. (이 티켓 변경은 전부 어댑터 `src/adapters/nationalTaxLaw.ts` 안에서 완결되어야 함)
- 이 티켓(TAX-6B-1) 범위 밖 파일은 수정하지 말 것. 특히 Port 시그니처, UI(app/), 답변생성 LLM, `src/usecases/generateAnswer.ts`, law-verifier는 건드리지 말 것(각각 6B-2 이후 티켓 소관).
- API 키(OC)·주민/사업자번호·회계사 식별자를 코드·로그·에러 메시지·URL에 넣지 말 것. 부칙 `sourceUrl`은 지금처럼 OC 없는 퍼블릭 링크(`toSourceUrl`)를 유지할 것.
- 기존 테스트를 깨지 말 것. `npx vitest run` 전량 GREEN·`run_golden` GREEN을 유지할 것. temperature 0·재시도(withRetry) 등 기존 안전장치를 제거하지 말 것.

## 티켓 요약
- 목표: 국세 API 법령 본문 응답에 이미 포함된 `법령.부칙.부칙단위`를 파싱해, 시점 관련 부칙·경과조치를 `trustTier='T2'`로 검색 결과에 병합한다(FR-17). 추가 API 호출 없음.
- 이번 라운드 최우선: R1 = 전체 결함 해소. 그중 🟡 [1](T1/T2 정렬 순서)이 최우선.

## 수정 항목

### [1] 🟡 부칙(T2)이 조문(T1)보다 앞에 정렬되어 T1 직접 근거가 밀릴 수 있음
- **파일**: `src/adapters/nationalTaxLaw.ts` — `fetchArticles` 병합부(현재 대략 L683~L692, `const merged = sortTaxLaws([...filtered, ...addendaItems])`)와 그 위 주석
- **문제**:
  - 병합 시 `sortTaxLaws([...filtered, ...addendaItems])`로 T1 조문과 T2 부칙을 **한꺼번에** 정렬한다.
  - 그런데 `sortTaxLaws`(L419~)는 `revisionDate`(개정일) 내림차순 → `enforcementDate` → `articleNumber` 순으로만 정렬하고 **`trustTier`를 정렬 키로 쓰지 않는다.**
  - 부칙의 `revisionDate`는 부칙공포일자(예: 현행 소득세법 2026.4.21)로 설정되므로, 최신 부칙(T2)이 개정일이 더 이른 다수 조문(T1)보다 **맨 앞으로 올라온다.**
  - 이는 (a) 리포트 §2-5 및 코드 주석의 "sortTaxLaws가 T1 조문 → T2 부칙 순으로 정렬하여 직접 근거를 우선 노출한다"는 **명시적 주장과 실제 동작이 불일치**하고(사양 부합 결함), (b) 다운스트림 컨텍스트 절단(TAX-6B-17, `generateAnswer` → 어댑터 절단)에서 상위 항목이 우선 보존되므로 **T1 조문이 뒤로 밀려 잘려나갈 회귀 위험**이 있다. CLAUDE.md §6.2는 T1을 직접 근거 1순위로 요구한다.
- **기대 결과**: 검색 결과 `items`에서 **T1 조문 블록이 항상 T2 부칙 블록보다 앞**에 오도록 한다. 각 블록 내부 정렬(개정일 내림차순 등)은 기존 `sortTaxLaws` 규칙을 그대로 유지한다. 즉 조문끼리 정렬 → 부칙끼리 정렬 → 조문 블록 다음에 부칙 블록을 이어 붙인다.
  - 예: `const merged = [...sortTaxLaws(filtered), ...sortTaxLaws(addendaItems)]`
  - `totalCount`는 `merged.length` 그대로 둔다.
  - 함께 위쪽 주석의 "sortTaxLaws가 T1 조문 → T2 부칙 순으로 정렬" 문구를 실제 동작(블록 분리 후 조문 우선 이어붙임)에 맞게 정정한다.
  - 리포트 파일은 수정 대상이 아니다(범위 밖). 코드 주석만 실제 동작과 일치시킨다.
- **검증 방법**:
  - `npx vitest run` 전량 GREEN, `npx tsc --noEmit` 0 에러.
  - `node --env-file=.env.local --import tsx scripts/diagnostics/probe_addenda_integration.mjs` 실행 시 반환 `items`에서 마지막 T1 조문 인덱스 < 첫 T2 부칙 인덱스(부칙이 조문보다 뒤)임을 확인. (필요 시 프로브에 순서 출력 한 줄 추가는 허용 — 프로브는 진단 스크립트라 범위 내)

### [2] 🟢 동일 공포일자 부칙 선별이 비결정적
- **파일**: `src/adapters/nationalTaxLaw.ts` — `selectRelevantAddenda`(L334~), 정렬부 `.sort((a, b) => (b.부칙공포일자 ?? '').localeCompare(a.부칙공포일자 ?? ''))`
- **문제**: 공포일자가 같은 부칙이 둘 이상이면 `localeCompare`가 0을 반환하고 보조 정렬 키가 없어, `slice(0,2)`가 고르는 2건이 입력 순서에 따라 달라질 수 있다(결정론성 약화 — 이 프로젝트는 검색 결과 결정론을 SSOT §7.7로 요구).
- **기대 결과**: 공포일자 동률일 때 `부칙공포번호`(또는 없으면 `부칙키`) 같은 안정적 보조 키로 tie-break 하여 동일 입력에 항상 동일 2건을 반환한다. 정렬 방향(내림차순)·선별 정책(직전1+직후1 / 최신2)은 그대로 유지한다.
- **검증 방법**: 동일 공포일자 2건 이상 포함된 부칙 배열로 `selectRelevantAddenda`를 두 번(입력 순서 뒤집어) 호출해 결과가 동일함을 단위 테스트로 확인([4] 참조).

### [3] 🟢 부칙 식별자 fallback이 공란 시 무의미/충돌 가능
- **파일**: `src/adapters/nationalTaxLaw.ts` — `buchikToTaxLaw`(L357~), `articleNumber` fallback `` `부칙 <제${buchik.부칙공포번호 ?? ''}호>` ``
- **문제**: 첫 줄이 "부칙"으로 시작하지 않고 `부칙공포번호`도 비면 `articleNumber`가 `"부칙 <제호>"`가 되어, 서로 다른 부칙이 동일 식별자를 갖게 될 수 있다(가독성·중복 식별 위험). 이 값은 원문 발췌가 아닌 라벨이므로 §6.1 위반은 아니나, 식별자 유일성이 약하다.
- **기대 결과**: 공포번호가 비면 공포일자 등 사용 가능한 보조 값을 식별자에 포함해 서로 구분되게 한다(예: `` `부칙 <제${번호}호, ${공포일자}>` `` 형태, 값이 있는 것만 조합). 원문 `content`는 절대 변경하지 말 것(라벨만 조정).
- **검증 방법**: `npx tsc --noEmit` 0 에러 + [4] 단위 테스트에서 공포번호 공란 케이스가 유일 식별자를 갖는지 확인.

### [4] 🟢 신규 선별·매핑 로직에 단위 테스트 부재
- **파일**: `tests/unit/` 하위에 신규 테스트 파일(예: `tests/unit/addendaSelection.test.ts`)
- **문제**: `selectRelevantAddenda`·`buchikToTaxLaw`는 결정론적 순수 로직인데 자동 테스트가 없다. `run_golden`은 라이브 검색을 경유하지 않아 부칙 경로를 전혀 커버하지 않는다(리포트 §3에도 "정적 골든셋 무영향" 명시). 회귀 방어가 프로브(수동 라이브 실행)에만 의존한다.
- **기대 결과**: 두 함수를 테스트 가능하게 노출(필요 시 `export`)하고, 최소 다음을 커버하는 단위 테스트를 추가한다.
  - targetDate 미지정 → 최신 공포 2개 선별
  - targetDate 지정 → 직전 1 + 직후 1 경계 선별(리포트의 2020-01-01 → 2019.12.31 + 2020.6.9 시나리오를 모사한 고정 입력)
  - `buchikToTaxLaw`가 `trustTier='T2'`, `sourceType='법령'`, `sourceUrl`에 `OC=` 미포함, `content`가 `flattenText` 원문 결합 그대로임을 확인
  - [2] 결정론·[3] 식별자 유일성 케이스
  - 기존 `export` 시그니처·동작은 바꾸지 말 것(테스트용 export 추가만 허용, 범위 내 어댑터 파일).
- **검증 방법**: `npx vitest run tests/unit/addendaSelection.test.ts` GREEN + `npx vitest run` 전량 GREEN.

## 완료 확인 체크리스트 (Codex는 수정 후 스스로 점검)
- [ ] 위 🟡 [1] 반영 — T1 조문 블록이 T2 부칙 블록보다 항상 앞, 주석도 실제 동작과 일치
- [ ] 🟢 [2][3][4] 반영(여유 시) — 결정론 tie-break·식별자 유일성·단위 테스트
- [ ] `npx vitest run` 전체 통과 (기존 + 신규)
- [ ] `npx vitest run tests/golden/run_golden.test.ts` GREEN 유지
- [ ] `npx tsc --noEmit` 오류 0
- [ ] 부칙 `content`·`flattenText` 원문 결합 로직 무변경(§6.1)
- [ ] `sourceUrl`에 OC 키 미포함 유지(§7)
- [ ] 티켓 범위 밖 파일(Port·UI·generateAnswer·law-verifier) 미변경
