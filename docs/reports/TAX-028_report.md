# TAX-028 구현 리포트 — 골든셋 30건 작성 보조 인프라

- **티켓:** `docs/tickets/TAX-028_golden_set_authoring_support.md`
- **작업일:** 2026-05-23
- **유형:** TASK (평가 인프라) — 프로덕션 런타임 코드 무변경
- **상태:** 구현 완료 (회계사 수동 검증 대기)

---

## 1. 변경 사항 요약

### 파일 변경 목록

| 파일 | 종류 | 내용 |
|---|---|---|
| `eval/golden_seeds.json` | 신규 | 회계사 시드 입력 양식 + 30건 분배(PASS24+네거티브6) + 예시 시드 2건 |
| `scripts/golden/buildCases.ts` | 신규 | 시드 → 실제 원문 fetch → V1·V2 통과 케이스 골격을 draft로 생성 |
| `scripts/golden/status.ts` | 신규 | 30건 진행률·세목분포·summary 작성대기·V1~V6 사전점검 리포트 |
| `eval/GOLDEN_SET_GUIDE.md` | 수정 | §6 시드 워크플로우 + 부록 스키마 정합 노트 추가 |
| `package.json` | 수정 | `golden:build`·`golden:status` 스크립트, `tsx` devDependency 추가 |
| `.gitignore` | 수정 | `eval/golden_direct.draft.json`(생성 초안) 제외 |

> 재사용(수정 없음): `src/adapters/nationalTaxLaw.ts`(원문 조회), `src/adapters/lawVerifier.ts`(사전 점검), `src/domain/disclaimer.ts`(표준 면책).

### 핵심 동작
회계사가 `golden_seeds.json`에 **질문+법령명+조문번호+기대라벨/상태**만 입력 →
`npm run golden:build` → `NationalTaxLawAdapter`로 실제 원문을 가져와
`sourceLaws`==`citations.taxLaw`의 `content`를 동일 주입(V1·V2 기계 보장)한 케이스 골격을
`golden_direct.draft.json`으로 생성. **`summary`(정답 답변)는 `__TODO_회계사_작성__` 마커로
비워** 회계사 작성을 강제(자기참조 채점 방지, CLAUDE.md §2). 회계사는 검수 후 `golden_direct.json`에 머지.

---

## 2. 검증 결과

| # | 검증 | 결과 |
|---|---|---|
| 1 | `npx tsc --noEmit` 타입 체크 | ✅ PASS (exit=0) |
| 2 | `npx vitest run tests/golden/run_golden.test.ts` 기존 10건 회귀 | ✅ 10 passed (변경 없음) |
| 3 | `npm run golden:build` 실증 (실제 API) | ✅ 시드 2건 → 골격 2건 생성, 스킵 0 |
| 4 | 생성 골격의 `summary` = `__TODO__` (정답 미생성 증명) | ✅ 확인 (draft 육안) |
| 5 | `content`==`excerpt`, `sourceLaws`==`citations.taxLaw` (V1·V2) | ✅ 확인 |
| 6 | `npm run golden:status` 출력 | ✅ 10/30·세목분포·V1~V6 사전점검·불일치 0 |
| 7 | 생성 `content`가 어댑터 원문 그대로(가공 없음, §6.1) | ✅ 변형 코드 없음 — 주입만 |

### golden:status 출력 (요약)
```
확정(golden_direct.json): 10 / 30
초안(draft, 검수 대기):   2건
회계사 summary 작성 대기(__TODO__): 2
사전 점검 불일치(기대≠실제): 0건
```
네거티브 4건도 의도대로 G-N1·N2=V2, G-N3=V3, G-N4=V4에서 ✘(FAIL) 검출.

---

## 3. 구현 중 발견·결정

### 3.1 `server-only` 모듈 차단 → `--conditions=react-server`
- **증상:** `tsx scripts/golden/buildCases.ts` 실행 시 `server-only/index.js`가
  "This module cannot be imported from a Client Component" 에러로 차단.
- **원인:** `config.ts`가 `import 'server-only'` 하는데, 이 패키지는 일반 Node에서 import되면
  무조건 throw하고 `react-server` 조건일 때만 빈 모듈(`empty.js`)로 통과한다.
- **해결:** `golden:build`를 `node --conditions=react-server --import tsx`로 실행.
  서버 사이드 실행이므로 의미상으로도 정합. (config 등 런타임 코드는 **수정하지 않음**.)
- **참고:** `golden:status`는 `lawVerifier`(config 비의존, 순수 규칙)만 import하므로 `tsx` 단독 실행.

### 3.2 `content`가 조문 제목만 반환되는 경우 (어댑터 특성)
- 항·호가 많은 일부 조문(예: 부가가치세법 제26조)은 API/어댑터가 본문을 합치지 않고
  **제목 줄만** 반환(부가 25자·소득 14자 관측).
- 어댑터 수정은 본 티켓 범위 밖이므로, 도구가 **정직하게 신호**하도록 처리:
  - `content` < 40자면 빌드 로그에 `⚠content 짧음` 경고 + draft `description`에 `⚠content 보강 필요` 부착.
  - `GOLDEN_SET_GUIDE.md §6.3`에 "law.go.kr 전체 원문으로 `content`·`excerpt` 보강" 명시.
- 도구의 보장 범위: 식별자(법령명·조문번호)·라벨·면책·구조(V1·V2 골격). 본문 길이는 비보장.

### 3.3 tsx 최초 도입
- 기존 `scripts/`는 `.js`/`.mjs`뿐 → TypeScript 스크립트 첫 도입(회계사 승인 §9-②).
- `npm install`로 `tsx` 3개 패키지 추가. `package.json` devDependencies 반영.

---

## 4. 잠재 위험

- **API 호출 비용·레이트:** `golden:build`는 시드 수만큼 외부 호출(순차). 무료 OpenAPI지만 429 시 SKIP 처리됨.
- **content 보강 누락:** 회계사가 제목만 있는 draft를 보강 없이 머지하면 summary 근거가 빈약.
  status의 "summary 작성 대기"와 `⚠content 보강 필요`로 신호하나, 최종 책임은 회계사 검수.
- **`--conditions=react-server` 부작용:** 현재 어댑터 경로(config·domain·ports·fetch)에 react 의존이 없어 영향 없음.
  향후 스크립트가 react 의존 모듈을 끌어오면 RSC 빌드가 선택될 수 있으니 주의.
- **draft 자동 생성:** `.gitignore`로 제외했으나, 회계사가 머지 전 실수로 본 파일을 테스트에 포함하지 않도록 주의(러너는 `golden_direct.json`만 읽음 — 안전).

---

## 5. Acceptance Criteria 대조

| AC | 결과 |
|---|---|
| 1. 시드 템플릿(30건 분배) 존재 | ✅ `golden_seeds.json` |
| 2. build로 V1·V2 통과 골격 생성, summary `__TODO__` | ✅ 실증 2건 |
| 3. summary 정답 미생성 | ✅ |
| 4. status가 N/30·세목·V1~V6 출력 | ✅ |
| 5. 기존 10건 무변경 그린 | ✅ |
| 6. 가이드 시드 워크플로우+스키마 노트 | ✅ |
| 7. content 원문 문자 단위 일치 | ✅ (주입만, 가공 없음) |

---

## 6. 회계사 다음 단계

1. `eval/golden_seeds.json`에 PASS 케이스 시드 입력(목표 PASS 18건 추가, 세목 분배 참고).
2. `npm run golden:build` → draft 생성.
3. draft에서 **summary 작성·excerpt 좁히기·content 보강(짧은 경우)·expectedStatus 확정**.
4. 확정분을 `golden_direct.json`에 머지 → `npm run golden:status`로 30/30 확인.
5. 네거티브 2건은 `GOLDEN_SET_GUIDE.md §5-1` 보고 수기 작성.
6. 30건 달성 + (별도) **TAX-029 P95 재측정** 완료 시 → Phase 4(TAX-026-B~) 코딩 게이트 해제.

---

**작성자:** AI (회계사 검토 대기)
**관련:** `docs/tickets/TAX-028_*.md`, 후속 `TAX-029`(P95), Phase 4 `TAX-026`
