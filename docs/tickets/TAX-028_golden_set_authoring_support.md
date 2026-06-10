# TAX-028 골든셋 30건 작성 보조 인프라 — 회계사 작성 부담 경감

> Phase 4(TAX-026) 진입 **선행조건**인 "골든셋 30건"을 회계사가 효율적으로 채울 수 있도록
> **기계적 보조 도구·가이드·진행 추적**을 정비한다.
>
> ⚠️ **대원칙:** AI/스크립트는 **세법 정답을 판정하지 않는다.** 원문 fetch·형식 채움·문자 일치
> 보장·현황 집계 같은 **기계적 잡일만** 대신하고, 정답성(summary·라벨·expectedStatus)은
> **회계사가 검수·확정**한다 (CLAUDE.md §2 책임 분리, SSOT §13.2).

---

## Metadata

- **Type**: TASK (평가 인프라)
- **Severity**: major (Phase 4 게이트의 선행조건)
- **Layer**: infra | docs (프로덕션 런타임 코드 무변경 — 스크립트·픽스처·문서만)
- **Milestone**: Post-MVP (M4 진입 선행)
- **Estimated Size**: M (3~5파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작
- 골든셋은 `eval/golden_direct.json`에 **10건** 존재: PASS 6건(G-1·G-2·G-3·G-4A·G-4B·G-5) + 네거티브 4건(G-N1~N4, 전부 `[초안 → 회계사 검수 대기]`).
- 작성은 전적으로 **수기**: 회계사가 law.go.kr에서 원문을 복사 → JSON을 직접 편집 → `npx vitest run tests/golden/run_golden.test.ts`로 확인.
- 가장 자주 깨지는 지점은 **V1(sourceLaws ↔ citations.taxLaw 불일치)·V2(excerpt가 content에 없음)** — 사람이 손으로 맞추다 보니 한 글자 차이로 실패(GOLDEN_SET_GUIDE.md "자주 하는 실수" 참조).
- 30건 목표 대비 **진행률·세목 분포를 한눈에 볼 도구가 없음**.

### 1.2 기대 동작
- 회계사가 **최소 정보(시드: 질문 + 법령명 + 조문번호 + 기대 라벨/상태)**만 입력하면, 스크립트가 **실제 `NationalTaxLawAdapter`로 원문을 조회**해 `sourceLaws`·`citations.taxLaw`를 **동일한 content로 채워** V1·V2를 기계적으로 보장한 **케이스 골격**을 생성한다.
- 회계사는 생성된 골격에서 **`summary`(정답 답변)·발췌 범위(`excerpt`)·`expectedStatus`만 검수·확정**하면 된다 — 손으로 JSON을 짤 필요가 없다.
- `npm run golden:status`로 **30건 목표 대비 현황**(총건수·PASS/FAIL·세목 분포·초안/확정·V1~V6 사전 점검)을 한 번에 확인한다.

### 1.3 영향·중요도
- ROADMAP §3에 따라 Phase 4 코딩(TAX-026-B~H) 착수의 **선행조건**이 "골든셋 30건 + P95 재측정". 본 티켓은 그 중 **골든셋 30건 작성을 가속**한다.
- 회계사 1인이 본업과 병행하는 부담(PRD v2.1이 50→30건으로 하향한 그 부담)을 도구로 추가 경감.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일
- `eval/golden_direct.json` (대상 — 케이스 추가. 본 티켓은 **스키마·도구**만, 30건 채움은 회계사 몫)
- `eval/golden_seeds.json` (신규 — 회계사 시드 입력 양식 + 30건 주제 분배 빈 템플릿)
- `scripts/golden/buildCases.ts` (신규 — 시드 → 원문 fetch → 케이스 골격 생성)
- `scripts/golden/status.ts` (신규 — 30건 현황·세목분포·V1~V6 사전 점검 리포트)
- `eval/GOLDEN_SET_GUIDE.md` (수정 — 시드 기반 워크플로우 추가 + 스키마 정합 노트)
- `package.json` (수정 — `golden:build`·`golden:status` 스크립트 추가)
- `src/adapters/nationalTaxLaw.ts` (재사용 — 원문 조회. **수정 금지**)
- `src/adapters/lawVerifier.ts` (재사용 — 사전 점검. **수정 금지**)

### 2.2 외부 리소스
- 국세법령정보시스템 OpenAPI (기존 `NATIONAL_TAX_API_KEY` 재사용 — **신규 키 0**)
- 작성 가이드 원본: `eval/GOLDEN_SET_GUIDE.md`, PRD §15.1 골든셋 구성·§15.1.2 스키마

### 2.3 아키텍처 힌트
```
[회계사] eval/golden_seeds.json 작성 (질문+법령명+조문번호+기대라벨/상태)
   ↓  npm run golden:build
scripts/golden/buildCases.ts
   ├─ NationalTaxLawAdapter.search(조문) → 실제 원문 content 조회   [기존 어댑터 재사용]
   ├─ sourceLaws[].content == citations.taxLaw[].content 동일 주입 (V1·V2 기계 보장)
   ├─ excerpt 기본값 = content 전체(회계사가 좁히도록 안내)
   └─ description에 "[초안 → 회계사 검수 대기]" 부착 → 케이스 골격 출력
   ↓  [회계사] summary·excerpt 범위·expectedStatus 검수·확정
   ↓  npm run golden:status  → 30건 진행률·V1~V6 사전 점검
   ↓  npx vitest run tests/golden/run_golden.test.ts  → 최종 그린 확인
```

> 스크립트는 `scripts/`에 격리된 **오프라인 보조 도구**로, 런타임 RAG 파이프라인(app/·src/usecases)을 건드리지 않는다.

---

## 3. Scope (작업 범위) ⭐

### 3.1 허용되는 변경
- [ ] `scripts/golden/buildCases.ts` 신규 — 시드 → 원문 fetch → 케이스 골격 생성 (정답 미생성)
- [ ] `scripts/golden/status.ts` 신규 — 현황·세목분포·초안/확정·V1~V6 사전 점검 리포트
- [ ] `eval/golden_seeds.json` 신규 — 시드 입력 양식 + 30건 주제 분배(빈 템플릿)
- [ ] `eval/GOLDEN_SET_GUIDE.md` 수정 — 시드 워크플로우 + 스키마 정합 노트 추가
- [ ] `package.json` 수정 — `golden:build`·`golden:status` npm 스크립트 추가

### 3.2 금지되는 변경
- ❌ **AI/스크립트가 `summary`·`expectedStatus`·라벨 정답을 자동 결정** (세법 판단=회계사, CLAUDE.md §2)
- ❌ 법령 원문 가공·요약·의역 (스크립트는 API 원문을 **문자 그대로** 주입, §6.1)
- ❌ `src/adapters/nationalTaxLaw.ts`·`lawVerifier.ts`·런타임 usecase·UI 수정
- ❌ `golden_direct.json` 기존 10건의 내용 변경 (도구 검증용 read만)
- ❌ P95 재측정 구현 (별도 후속 티켓 — §10)
- ❌ 폴더 구조 변경, 불필요한 의존성 추가

---

## 4. Strategy (구현 힌트)

1. **시드 스키마 먼저 확정** (`golden_seeds.json`):
   ```jsonc
   {
     "targetCount": 30,
     "seeds": [
       {
         "id": "G-NEW-001",
         "category": "소득세",                    // 세목 분포 집계용
         "question": "회계사가 실제로 물을 자연어 질문",
         "lawName": "소득세법",
         "articleNumber": "제52조 제1항",          // 원문 조회 키
         "expectedLabel": "🟢직접근거",            // 회계사 기대값
         "expectedStatus": "PASS",                // 회계사 기대값
         "note": "특별공제 — 검수 시 summary 작성"
       }
     ]
   }
   ```
2. **buildCases.ts**: 시드별로 `NationalTaxLawAdapter.search`로 원문을 가져와 `golden_direct.json` 케이스 골격을 만든다.
   - `sourceLaws[].content`와 `citations[].taxLaw.content`를 **같은 문자열**로 주입 → V1·V2 기계 보장.
   - `excerpt`는 기본값으로 content 전체를 넣고, "회계사가 좁히세요" 주석/필드 표기.
   - `summary`는 **빈 문자열 + `__TODO_회계사_작성__` 마커** (스크립트가 정답을 만들지 않음).
   - `disclaimer`는 표준 문구 자동 부착(V5), `temporalLabel`은 시드의 기대값 또는 `[현행]` 기본.
   - `description`에 `[초안 → 회계사 검수 대기]` 부착.
   - 출력은 별도 파일(`eval/golden_direct.draft.json`)로 내보내 회계사가 검수 후 본 파일에 머지(기존 10건 안전).
3. **status.ts**: `golden_direct.json`(+draft)을 읽어 리포트.
   - 총 N/30, PASS·FAIL 수, 세목별 분포, 초안(`[초안...]`)/확정 수.
   - 각 케이스에 `LawVerifierAdapter.verify`를 돌려 **V1~V6 사전 점검**(빨강/초록)으로 손 안 댄 실수 즉시 노출.
   - `summary`에 `__TODO__` 마커가 남은 케이스를 "회계사 작성 대기"로 표시.
4. **가이드 보강**: GOLDEN_SET_GUIDE.md에 "시드 기반 빠른 작성"절 + golden_direct.json(검증기 직접 주입) vs PRD §15.1.2(`expected_citations` E2E) **스키마 정합 노트** 추가.
5. **package.json**: `"golden:build": "tsx scripts/golden/buildCases.ts"`, `"golden:status": "tsx scripts/golden/status.ts"` (실행기는 기존 환경에 맞춰 `tsx`/`vitest`/`node --loader` 중 택1 — §7 확인).

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `eval/golden_seeds.json` 템플릿이 존재하고 30건 주제 분배(세목별 칸)가 채워진 **빈 양식**을 제공.
2. [ ] `npm run golden:build` 실행 시, 시드 1건 이상에 대해 실제 원문이 조회되어 `golden_direct.draft.json`에 **V1·V2를 통과하는 케이스 골격**이 생성된다.
3. [ ] 생성된 골격의 `summary`는 `__TODO__` 마커로 비어 있다(스크립트가 정답 미작성 — §3.2 준수 증명).
4. [ ] `npm run golden:status` 실행 시 총건수/30, 세목 분포, 초안·확정 수, V1~V6 사전 점검 결과가 출력된다.
5. [ ] `golden_direct.json` 기존 10건이 **변경 없이** 그대로 통과(`npx vitest run tests/golden/run_golden.test.ts` 그린).
6. [ ] GOLDEN_SET_GUIDE.md에 시드 워크플로우 + 스키마 정합 노트가 추가된다.
7. [ ] 스크립트가 법령 원문을 **문자 단위 그대로** 주입함을 1건으로 확인(원문 vs 생성 content diff=0).

---

## 6. Verification (검증 단계 — 회계사)

1. `eval/golden_seeds.json`에 시드 2~3건 시범 입력(질문+법령명+조문번호+기대 라벨/상태).
2. `npm run golden:build` 실행 → `golden_direct.draft.json` 생성 확인. content가 law.go.kr 원문과 일치하는지 1건 육안 대조.
3. 생성 골격의 `summary`가 `__TODO__`로 비어 있는지(=정답을 AI가 안 만들었는지) 확인.
4. `summary` 작성·`excerpt` 범위 좁히기·`expectedStatus` 확정 후 본 파일에 머지.
5. `npm run golden:status` → 진행률·V1~V6 사전 점검 확인.
6. `npx vitest run tests/golden/run_golden.test.ts` → 전체 그린 확인.

---

## 7. Risks / Notes

- **실행기(runtime) 확인:** 현재 `devDependencies`에 `tsx`가 없다. 스크립트 실행 방식(① `tsx` 추가 / ② 기존 `vitest` 러너로 스크립트화 / ③ `node --import`)을 **구현 전 확정**해야 함 → 회계사/개발 결정점 ②.
- **API 호출 비용·레이트:** `golden:build`는 시드 수만큼 외부 API 호출. 30건이면 소량이나, 429 대비 순차 호출·간격 둘 것. 비용은 무료(국세 OpenAPI).
- **스키마 이원화:** `golden_direct.json`(검증기 직접 주입, 현 러너 사용)과 PRD §15.1.2(`expected_citations` E2E)는 **목적이 다른 별도 셋**. 본 티켓은 현 러너가 쓰는 `golden_direct.json` 형식으로 30건을 확장하고, PRD 형식과의 통합은 후속 과제로 노트만 남긴다(임의 통합 금지 — STOP&ASK).
- **정답 오염 위험(가장 중요):** 스크립트가 편의를 위해 `summary`를 자동 생성하면 "AI가 만든 정답을 AI가 채점"하는 자기참조 오류가 됨. 반드시 `__TODO__`로 비워 **회계사 작성**을 강제 (§3.2).
- **draft 분리:** 생성물은 `golden_direct.draft.json`으로 분리해, 검수 전 초안이 본 골든셋(회귀 게이트)에 섞이지 않게 한다.

---

## 8. AI Implementation Instructions
### 8.1 코딩 전: 근본 동기 / 영향 파일 / 3~5단계 계획 + §7 실행기 결정 → 회계사 승인 후 코딩.
### 8.2 코딩 후: 변경 파일 / 요약 / 검증 PASS·FAIL / 위험 / `docs/reports/TAX-028_report.md`.

---

## 9. 회계사 결정점 (구현 전 확정)

| # | 결정 항목 | 선택지 | 권장 |
|---|---|---|---|
| ① | 시드→골격 생성 스크립트 채택 | **채택** / 수기 작성 유지 | **채택** (V1·V2 실수 원천 차단) |
| ② | 스크립트 실행기 | **`tsx` 추가** / 기존 vitest 러너화 / `node --import` | **`tsx`** (간결) — 의존성 1개 추가 승인 필요 |
| ③ | 30건 구성 비율 | **PASS 24 + 네거티브 6** / 기타 | **PASS 24 + 네거티브 6** (현 네거티브 4 확정 포함) |
| ④ | P95 재측정 | **별도 후속 티켓(TAX-029)** / 본 티켓 포함 | **별도 분리** (성격 다름·티켓 비대 방지) |

> 회계사 회신란 (✅ 확정 — 2026-05-23):
> - ① 스크립트 채택 = **채택** (시드→원문 fetch→골격 생성, V1·V2 기계 보장 — 권장안)
> - ② 실행기 = **`tsx` devDependency 추가** (의존성 1개 추가 승인 — 권장안)
> - ③ 구성 비율 = **PASS 24 + 네거티브 6** (현 네거티브 4 확정 포함 — 권장안)
> - ④ P95 분리 = **별도 후속 티켓 TAX-029로 분리** (성격 상이 — 권장안)
> - 승인일/서명: **2026-05-23 / 회계사(gyuhosin165) 결정 회신**

---

## 10. Related Tickets
- 선행조건 충족 대상: `TAX-026_vector_db_phase4.md` (§3 게이트 — 골든셋 30건 + P95 재측정).
- 참조: `eval/GOLDEN_SET_GUIDE.md`(작성 가이드), `TAX-024`(eval/README 정합 갱신), PRD §15.1·§15.2.
- 후속(분리): **TAX-029 P95 응답시간 재측정**(RAG 5단계 누적, 부하 100회, PRD §15.2) — 본 티켓 범위 밖.

---

## 11. Report Link
Report: `docs/reports/TAX-028_report.md` (완료 — 2026-05-23, 회계사 수동 검증 대기)

---

**작성자**: AI 초안 (회계사 검토·승인 대기)
**작성일**: 2026-05-23
**최종 수정일**: 2026-05-23
