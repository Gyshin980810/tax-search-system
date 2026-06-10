# Phase 3 (M3 / TAX-012) 독립 재평가 리포트 — law-verifier 검증 레이어

> 평가일: 2026-05-18
> 평가 대상: ROADMAP.md Phase 3 = M3 = **TAX-012-A~H** (law-verifier V1~V6 + 골든셋 + Playwright E2E)
> 평가자: Claude (회계사 요청 기반 — 이전 평가 흔적 제거 후 코드 처음부터 독립 재검증)
> 평가 방식: 정적 코드·픽스처·추적 데이터 직접 검토. 이전 평가 리포트를 참고하지 않고
>            PRD·SSOT·CLAUDE.md 사양 문구만을 잣대로 재수행.

---

## 0. 평가 대상 식별 (혼동 주의)

작업 디렉토리에 **이름이 같은 두 개의 Phase 3**가 공존한다.

| 구분 | 정체 | 내용 |
|---|---|---|
| **ROADMAP.md Phase 3 (= M3)** | **TAX-012** | law-verifier V1~V6 + 골든셋 + Playwright E2E ← **본 평가 대상** |
| `AGENT/phase3.md` Phase 3 | TAX-007~009 | MCP 정책 + Memory + Observability (별개 트랙, 평가 대상 아님) |

---

## 1. 평가 잣대

준공 검사 방식 — "설계도(PRD·SSOT·CLAUDE.md)대로 지어졌는가"를 6개 축으로 점검.
모든 발견은 정확성 최우선 원칙(`정확성 > 완전성 > 속도 > 편의성`)으로 등급화.

| 축 | 점검 내용 |
|---|---|
| E1 | 계층 아키텍처 (UI→API→Usecase→Adapter, Port 분리) |
| E2 | RAG 5단계 파이프라인 보존·검증 우회 없음 |
| E3 | 세법 4대 규칙 (인용 무결성·Trust Tier·라벨링·V1~V6) |
| E4 | 알려진 결함(BUG-001·BUG-002) 코드 실재 여부 |
| E5 | 테스트·골든셋 신뢰성 (사각지대 식별) |
| E6 | 회계사 노출 게이트 실효성 |

**등급:** HIGH(정확성 직접 영향) / MED(사양 정합성·검증 실효성 저하) / LOW(개선 권고)

---

## 2. 종합 판정

| 축 | 판정 | 요지 |
|---|---|---|
| E1 계층 아키텍처 | ✅ 양호 | `generateAnswer`는 Port type-only import, `fetch`·DB 직접 호출 0건 |
| E2 파이프라인 | ⚠️ 조건부 | 5단계·[4] 우회 없음(FAIL 시 throw, PASS만 반환). 단 V1 재검색이 동일 쿼리 |
| E3 세법 4대 규칙 | ⚠️ 결함 다수 | "존재 검증"은 되나 "내용·형식 정확성 검증"이 느슨 |
| E4 알려진 결함 | ❌ 둘 다 실재 | BUG-001·BUG-002 코드에 그대로 실재 확정 |
| E5 테스트·골든셋 | ⚠️ 사각지대 | 골든셋 6건 전부 PASS — "틀린 답 거르는 능력" 미검증 |
| E6 노출 게이트 | ⚠️ 조건부 | 차단 동작하나 블랙리스트 방식 |

> **핵심 결론**: law-verifier는 인용·라벨의 **"존재 여부"는 검증하지만 "내용·형식의
> 정확성"은 느슨하게 검증**한다. 골든셋이 전부 PASS 케이스라 **"틀린 답을 FAIL로
> 거르는 능력"이 골든셋으로 한 번도 회귀 검증된 적이 없다**는 점이 가장 큰 구조적
> 리스크다. Phase 3는 "엔지니어링 완료"이나 **정확성 보증은 미완**이다.

---

## 3. 결함 목록 (코드 직접 재검증)

### 🔴 HIGH

#### H-1 (= BUG-001) — V5 면책 고지 "자동 부착" 사양 미구현

- **위치**: `src/usecases/generateAnswer.ts:49-66` (특히 `:50`)
- **사양**: PRD §6.5 / SSOT §7.4 / CLAUDE.md §6.4 — "V5 실패 → 자동 부착(재생성 불필요)"
- **실제**: FAIL 분기가 `if (!verifyResult.checks.v1)` 단일 조건. V5만 실패 시
  `checks.v1 === true`이므로 **else(LLM 재생성) 경로**로 진입.
  `generateAnswer.ts` 라인 1-8에 `DISCLAIMER` import 부재 → 자동 부착 코드 자체가 없음.
- **영향**: 고정 상수 한 줄이면 채울 것을 LLM 재생성에 의존 → 재생성이 또 면책을
  누락하면 `E-VERIFY-FAIL`로 정답 폐기. PRD §0 "틀린 답 < 없는 답" 위반 +
  불필요한 LLM 비용·지연.
- **상태**: `docs/tickets/BUG-001_v5_disclaimer_auto_attach.md` 작성 완료, **미구현**.

#### H-2 (= BUG-002) — V2 인용 무결성이 summary 큰따옴표 인용 미검사

- **위치**: `src/adapters/lawVerifier.ts:59-70` (특히 `:60`)
- **사양**: PRD §6.3.2 / SSOT §7.1 — "답변에 포함된 **모든** 큰따옴표 발췌를 원문 대조"
- **실제**: V2가 `for (const citation of answer.citations)`만 순회.
  `citation.excerpt`만 검사하고 `answer.summary`(LLM 자유 생성 칸)는 대조 제외.
- **영향**: LLM이 요약에 `소득세법 제99조는 "전액 비과세"라고 규정합니다`처럼
  따옴표 친 환각 인용을 넣어도 V2 통과 → 회계사 노출. PRD §18 1·2순위 위험(환각·의역)
  및 §7.2 "인용 무결성 위반율 0%" 목표가 막으려던 바로 그 경로.
- **상태**: `docs/tickets/BUG-002_v2_summary_citation_integrity.md` 작성 완료, **미구현**.

### 🟡 MED

| ID | 위치 | 내용 |
|---|---|---|
| M-1 | `lawVerifier.ts:84-88` | V4가 `temporalLabel` 비어있지 않으면 무조건 PASS. `[현행]`/`[적용 시점: YYYY.MM.DD ~ YYYY.MM.DD]`/`[폐지: YYYY.MM.DD]` 3종 **형식 검증 없음**. CLAUDE.md §6.2 형식 의무 형해화 |
| M-2 | `lawVerifier.ts:90-94` | V5가 `disclaimer` 비어있지 않으면 PASS. `src/domain/disclaimer.ts`의 `DISCLAIMER` 상수와 **문구 일치 미검증**. SSOT §14.1 "표준 문구 고정" 괴리 — 축약·왜곡 면책 통과 |
| M-3 | `lawVerifier.ts:44-57` | V1이 `articleNumber`+`lawName`만 매칭. 같은 조문번호의 **다른 시점 버전·다른 content**도 "존재함"으로 통과. M-1과 결합 시 시점 오류 무검출 통과 위험 |
| M-4 | `generateAnswer.ts:52` | V1 실패 후 재검색이 `searchPort.search(queries[0])` — **첫 검증과 동일 쿼리**. `queries[1]` 등 대체 쿼리 미활용 → 재검색 회복력 미미, 정답 보유 케이스가 `E-VERIFY-FAIL`로 폐기될 위험 |
| M-5 | `eval/golden_direct.json` | G-1·G-2·G-3·G-4A·G-4B·G-5 **6건 전부 `expectedStatus:"PASS"`**. 환각/의역/잘못된 라벨을 FAIL로 거르는 네거티브 케이스 **0건**. 정확성 시스템 본질("틀린 답 차단")이 골든셋으로 한 번도 회귀 검증된 적 없음 — BUG-002가 회귀로 안 잡힌 근본 원인 |
| M-6 | `tests/unit/generateAnswer.test.ts` | "V5 단독 실패 → 자동 부착(재생성 0회)" 케이스 부재. 테스트가 사양이 아닌 (결함 있는) 현재 구현을 추종 → BUG-001이 테스트 그린 상태로 잠복 |
| M-7 | `app/components/AnswerCard.tsx:25-41` | `if (isPending)`로 PENDING만 차단하는 **블랙리스트**. `status === 'PASS'`만 통과시키는 화이트리스트가 아님. 현재 경로상 PASS만 도달하므로 즉시 위험은 아니나, 신규 status 유입 시 그대로 노출. 정확성 게이트는 "PASS만 통과"가 안전 |
| N-2 | `lawVerifier.ts:63` | V2가 `excerpt.length > 0`일 때만 검사. **빈 발췌**로 인용 무결성 검사를 우회하는 미세 사각지대 (이번 재평가 신규 발견) |

### ⚪ LOW

- **L-1** — V6 단정 패턴이 7종 정규식으로 제한(`lawVerifier.ts:23-31`). 한국어 단정 표현
  사각지대 존재. V6는 `answer.summary`만 검사하며 `🟡유사사례` citation이 있을 때만
  동작 — 골든셋 네거티브 확충 후 패턴 보완 권장.
- **L-2** — `generateAnswer.ts:41`이 `queries[0]`만 사용(다중 쿼리 미활용).
  주석에 "Phase 4 확장 예정" 명시 — 현재 사양 범위 내.
- **N-1** (이번 재평가 신규) — `src/domain/VerificationResult.ts:4-5` 주석이
  *"M2에서는 항상 PENDING — M3에서 활성화"*로 남아 있음. 이미 M3 통합됐는데 주석은
  옛 상태 → 문서·코드 불일치 잔재. `pendingVerification()` 헬퍼도 "M2에서 사용" 주석
  잔존(실제로는 골든셋 픽스처가 PENDING 초기값으로 사용 중).

---

## 4. 양호 항목 (회귀 시 보존할 것)

- 계층 아키텍처: `generateAnswer`는 Port type-only import만(`:3-8`), `fetch`·DB
  직접 호출 0건. `ILawVerifierPort` 인터페이스로 어댑터 교체 가능. (E1 PASS)
- RAG 5단계 보존, [4] 검증 우회 경로 없음 — FAIL 시 `AppError('E-VERIFY-FAIL')`
  throw, **PASS만 `return`**(`generateAnswer.ts:60-69`). (E2)
- V2 발췌 검증은 `content.includes(excerpt)` + `.trim()`만 — 퍼지 매칭 없음,
  SSOT §7.1 "문자 단위 일치" 정합 (citation 한정이지만 정책 자체는 정확).
- V3 Trust Tier→라벨 매핑(T1/T2→🟢⚫, T3/T4→🟡⚪⚫) 사양 정합
  (`lawVerifier.ts:12-17`). (E3 부분)
- PENDING 차단(`AnswerCard.tsx:28-41`), E-VERIFY-FAIL 안내 동작. (E6 부분)
- Gemini→OpenAI 마이그레이션 버그 수정이 TAX-012에서 실제 반영됨(TAX-012 리포트 §2.4).
- 단위·통합·골든셋 75 tests + E2E 5 tests 그린(TAX-012 리포트 §3).

---

## 5. 추적 무결성 결함 (코드 결함 아님 — 발견 X)

`C:/Users/sfami/WorkSpace/shrimp_data/tasks.json` 2026-05-18 직접 확인:

| 서브태스크 | tasks.json 상태 | 실제 산출물 | TAX-012 리포트·ROADMAP |
|---|---|---|---|
| TAX-012-A 인터페이스 | completed ✅ | `src/ports/lawVerifierPort.ts` 존재 | 완료 선언 |
| TAX-012-B 어댑터 | completed ✅ | `src/adapters/lawVerifier.ts` 존재 | 완료 선언 |
| TAX-012-C Usecase | completed ✅ | `generateAnswer.ts` 통합 | 완료 선언 |
| TAX-012-D UI | completed ✅ | `AnswerCard.tsx`/`page.tsx` | 완료 선언 |
| **TAX-012-E 서브에이전트** | **in_progress** ⚠️ | `.claude/agents/law-verifier.md` 존재 | **완료 선언** |
| **TAX-012-F 골든셋** | **pending** ❌ | `eval/golden_direct.json` 등 존재 | **완료 선언** |
| **TAX-012-G E2E** | **pending** ❌ | `playwright.config.ts`·`tests/e2e/` 존재 | **완료 선언** |
| **TAX-012-H CI/P95** | **pending** ❌ | CI e2e job 존재 / P95 재측정 미실시 | 엔지니어링 완료, P95 잔여 |

- **성격**: 코드 결함이 아닌 **추적 무결성 결함**. 작업은 실제 수행됐으나 shrimp
  상태 갱신이 누락돼 E/F/G/H가 미완료로 잠김 → 추적 데이터를 완료 판단 근거로
  신뢰 불가.
- **단, P95 재측정(TAX-012-H)은 실제로도 미실시 잔여** — 이 부분만은 추적이 옳다.
- **권고**: shrimp tasks.json의 E/F/G/H를 실제 완료 상태에 동기화하거나, 추적을
  ROADMAP.md 단일 소스로 일원화. P95 재측정은 실제 잔여이므로 별도 유지.

---

## 6. 수정방안 (우선순위)

| 순위 | 조치 | 연결 티켓 |
|---|---|---|
| 1 | **BUG-001 구현** — V5 자동 부착을 재시도 분기보다 *앞에* 배치, `DISCLAIMER` 상수 주입 후 재검증(재생성 0회) | `BUG-001` (작성됨, 미구현) |
| 2 | **BUG-002 구현** — V2에 `answer.summary` 큰따옴표 스팬 추출 + `sourceLaws[].content` 대조 추가 | `BUG-002` (작성됨, 미구현) |
| 3 | **M-5 해소** — 골든셋 네거티브(`expectedStatus:"FAIL"`) 픽스처 추가: 환각 인용·의역·잘못된 Tier 라벨·시점 오류 각 1건 이상 | 신규 확충 티켓 권장(BUG-002가 부분 착수) |
| 4 | **M-1·M-2** — V4 시점 라벨 3종 정규식 형식 검증, V5 `DISCLAIMER` 문구 일치 검증 | 신규 티켓(BUG-003 후보) |
| 5 | **M-3·M-4** — V1 시점·content 일치 검증, 재검색 시 `queries[1]` 대체 쿼리 활용 | Phase 4 연계 검토 |
| 6 | **M-6·M-7·N-1·N-2** — V5 자동부착 회귀 테스트(BUG-001과 함께), 게이트 화이트리스트화, 낡은 주석 정리, V2 빈 발췌 사각지대 보강 | BUG-001/소규모 별도 |

> **회계사 노출 게이트 권고**: H-1·H-2 미해소인 현재 M3 "회계사 노출 시작" 게이트는
> **최소 BUG-001 + BUG-002 구현 + 골든셋 네거티브 케이스 확보(M-5)** 후 통과로
> 판단할 것을 권고한다. 골든셋 정답값은 SSOT §13.2에 따라 **회계사 검수 필수**.

---

## 7. 이전 평가와의 비교

이전 `PHASE3-REEVALUATION_2026-05-18_report.md`(삭제됨)를 **참고하지 않고 코드를
처음부터 독립 검증**한 결과, 이전 평가의 결함 식별(H-1/H-2/M-1~M-7)은 모두
**정확했고 위치도 일치**했다. 본 재평가의 차이점:

- **신규 추가**: N-1(낡은 PENDING 주석), N-2(V2 빈 발췌 사각지대).
- **추적 데이터**: 2026-05-18 시점 tasks.json 재확인 — E=in_progress, F/G/H=pending
  잠금 상태 동일하게 재현됨.
- **BUG-001/002 티켓**: 보존(회계사 선택). 결함 추적 수단으로 계속 유효.

---

## 8. 평가 한계

본 평가는 정적 코드·픽스처·추적 데이터 검토 기반이다. 다음은 별도 측정 필요(TAX-012
리포트 §5 잔여와 동일):

- 실 API 연동 환경에서의 환각률 (골든셋 30건 + 네거티브 확보 후)
- 검증 단계 추가 후 P95 응답시간 재측정 (목표 < 15초, 100회)
- 골든셋 정답값 회계사 검수 (SSOT §13.2 — AI 임의 수정 금지)

BUG 티켓 구현은 회계사 승인·지시 후 진행한다 (CLAUDE.md 행동 9계명 #8).

---

**작성자**: Claude (이전 평가 흔적 제거 후 독립 재평가)
**작성일**: 2026-05-18
