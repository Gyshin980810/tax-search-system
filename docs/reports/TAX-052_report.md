# TAX-052 구현 리포트 — 비법령 대량 수집·정규화 파이프라인

**작성일**: 2026-06-10
**대상**: TAX-052 (Phase 5 — 심판례·해석례·판례 대량 수집 → 임베딩 입력 생성)
**선행 게이트**: 회계사 결정 확정(2026-06-10) — 키워드 셋·target 우선순위·규모 상한

---

## 배경

Phase 4(TAX-026-B~H)에서 벡터 검색 엔진(`FallbackSearchPort`·`embed.ts`·`PgVectorSearchAdapter`·`downgradeVectorLabels`)이 완성됐으나, 적재된 데이터는 골든셋 기반 38건(법령 위주)뿐이었다. TAX-052는 이 엔진에 **실제 비법령 데이터(판례·예규)를 공급**하는 첫 단계로, 외부 API에서 비법령을 대량 수집해 임베딩 입력(`laws_for_embed_nonlaw.json`)을 생성한다.

> "엔진은 이미 완성, 연료만 주입" — 신규 비즈니스 로직은 수집 스크립트 1개뿐, `src/`는 무변경.

---

## 회계사 확정 정책 (착수 게이트)

| 결정 | 값 | 코드 반영 |
|---|---|---|
| ① 키워드 셋 | 5세목 18개 키워드 | `eval/collect_keywords_nonlaw.json` (코드와 분리) |
| ② target 우선순위 | 심판례·해석례 → 판례 | `TARGET_PRIORITY = ['심판례','해석례','판례']` |
| ③ 규모 상한 | 키워드당 30건 | `MAX_PER_KEYWORD = 30` |
| (부수) 본문 최소 길이 | 200자 | `CONTENT_MIN_LENGTH = 200` |

---

## 변경 사항 요약

### 파일 변경 목록

| 파일 | 작업 | 비고 |
|---|---|---|
| `scripts/collectNonlaw.ts` | 🆕 신규 | 수집·정규화 본체(순수 함수 export + 동적 import 어댑터) |
| `eval/collect_keywords_nonlaw.json` | 🆕 신규 | 회계사 확정 키워드 셋(5세목 18개) |
| `tests/unit/collectNonlaw.test.ts` | 🆕 신규 | 정규화 순수 함수 단위 테스트(12건) |
| `package.json` | ✏️ 수정 | `collect:nonlaw` 스크립트 1줄 추가 |
| `scripts/laws_for_embed_nonlaw.json` | 📦 (실행 시 생성) | 수집 결과 — 아직 미생성(외부 API 실행 대기) |

> ⚠️ `src/`(도메인·어댑터·usecase) **무변경**. CLAUDE.md §9(범위 엄수·최소 변경) 준수.

### 주요 설계

1. **`extractLaws.ts`(법령용)와 대칭 구조** — 법령은 골든셋 추출, 비법령은 외부 API 키워드 검색.
2. **어댑터는 `main()` 안에서 동적 import** — vitest가 server-only 어댑터를 건드리지 않게 하여, 순수 함수만 import해 테스트 가능.
3. **직접 실행 가드** — `import.meta.url === pathToFileURL(process.argv[1]).href`로, 테스트 import 시 `main()` 미실행.
4. **순차 호출(레이트 보호)** — `buildNonlawCases.ts` 패턴 그대로, 한 키워드 실패가 전체를 멈추지 않음(try/catch 스킵).
5. **3중 필터**: ① sourceType ≠ 법령 ② caseNumber 보유 ③ content ≥ 200자 — 본문 없는 국세청해석(ntsCgmExpc)은 자동 탈락.
6. **caseNumber 중복 제거** — 키워드 간 겹침 제거, 먼저 등장 항목 보존.

### 원문 보존 (CLAUDE.md §6.1)

- 어댑터가 반환한 `content`를 가공·요약 없이 그대로 출력에 직렬화.
- 단위 테스트에 **"파이프라인 통과 후 content 문자 단위 불변"** 단언 포함(가장 중요한 회귀 방지).

---

## 검증 결과

| 검증 | 결과 |
|---|---|
| 신규 단위 테스트 (`collectNonlaw.test.ts`) | ✅ 12/12 PASS |
| 전체 vitest 회귀 | ✅ 399/399 PASS (기존 387 + 신규 12) |
| `tsc --noEmit` | ✅ 0건 |
| ESLint(테스트 파일) | ✅ 에러 0 (scripts/는 ignore 대상 — 기존 관례 동일) |
| import 시 `main()` 미실행 | ✅ 가드 정상(테스트 통과로 확인) |

### 미실행 — 외부 API dry-run

`npm run collect:nonlaw -- --dry-run`은 18개 키워드 × 비법령 4종 = 약 72회 외부 API 호출을 수반한다. 실제 수집량(키워드별 채택 건수)은 회계사 확인 하에 실행 예정. **dry-run은 파일을 생성하지 않으므로 안전**하며, 규모 결정(③)의 실측 확인 용도다.

---

## 잠재 위험

- **수집량 편차**: 인기 쟁점은 30건 상한에 닿고 희소 쟁점은 적게 잡힐 수 있음 → dry-run으로 사전 확인 권장.
- **외부 API 응답 변동**: 검색 API 랭킹·본문 제공 여부가 시점에 따라 달라질 수 있어, 실제 채택 건수는 실행 시점에 확정.
- **caseNumber 누락 자료**: 식별자 없는 비법령은 V1 검증·중복 제거 불가로 의도적으로 제외 — 일부 자료 누락 가능(설계상 허용).

---

## 다음 단계

1. (선택) `npm run collect:nonlaw -- --dry-run` — 실제 수집량 미리보기(회계사 확인 후).
2. `npm run collect:nonlaw` — `scripts/laws_for_embed_nonlaw.json` 생성.
3. **TAX-053** — `npm run embed -- --input scripts/laws_for_embed_nonlaw.json`로 벡터 DB 적재 + 스모크 테스트.

---

## 결론

비법령 대량 수집·정규화 파이프라인(`collectNonlaw.ts`)을 신규 작성하고, 정규화 규칙(필터·중복 제거·상한·정렬·원문 보존)을 순수 함수로 분리해 단위 테스트 12건으로 검증했다. 전체 회귀 399/399·타입 0건으로 기존 기능 무영향을 확인했다. 실제 외부 API 수집 실행은 회계사 확인 하에 진행하며, 그 출력이 TAX-053(임베딩 적재)의 입력이 된다.
