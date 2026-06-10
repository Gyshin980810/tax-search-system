# TAX-012 구현 리포트 — law-verifier 검증 레이어 통합 (Phase 3 엔지니어링)

> 완료일: 2026-05-17
> Phase: 3 (M3) — law-verifier V1~V6 + 골든셋 인프라 + Playwright E2E
> 관련 티켓: TAX-012-A ~ TAX-012-H (8개 서브태스크)

---

## 1. 파일 변경 목록

| 파일 | 작업 | 서브태스크 |
|---|---|---|
| `src/ports/lawVerifierPort.ts` | 신규 — ILawVerifierPort 인터페이스 | A |
| `src/adapters/lawVerifier.ts` | 신규 — V1~V6 규칙 기반 구현체 | B |
| `src/domain/VerificationResult.ts` | 기존 (PENDING 상태 활용) | — |
| `src/usecases/generateAnswer.ts` | 수정 — verifier 4번째 인자 추가, [4] 검증 단계 통합 | C |
| `app/api/answer/route.ts` | 수정 — LawVerifierAdapter 주입, GeminiAdapter → OpenAIAdapter 버그 수정 | A, C |
| `app/components/AnswerCard.tsx` | 수정 — PENDING 완전 차단, data-testid 추가 | D |
| `app/components/SearchBar.tsx` | 수정 — data-testid 추가 | D |
| `app/page.tsx` | 수정 — errorCode 상태, E-VERIFY-FAIL 전용 주황 박스 | D |
| `.claude/agents/law-verifier.md` | 업데이트 — V1~V6 체크리스트 실제 구현과 정합 | E |
| `eval/golden_direct.json` | 신규 — V1~V6 직접 검증 픽스처 6건 | F |
| `eval/README.md` | 신규 — 골든셋 인프라 가이드 | F |
| `tests/golden/run_golden.test.ts` | 신규 — 골든셋 테스트 러너 | F |
| `playwright.config.ts` | 신규 — Playwright 설정 | G |
| `tests/e2e/g1-basic-deduction.spec.ts` | 신규 — E2E G-1 | G |
| `tests/e2e/g2-verify-fail.spec.ts` | 신규 — E2E G-2 | G |
| `tests/e2e/g3-pending-block.spec.ts` | 신규 — E2E G-3 | G |
| `tests/e2e/g4-loading-state.spec.ts` | 신규 — E2E G-4 | G |
| `tests/e2e/g5-pii-error.spec.ts` | 신규 — E2E G-5 | G |
| `package.json` | 수정 — @playwright/test, test:e2e 스크립트 추가 | G |
| `next.config.ts` | 수정 — GEMINI_API_KEY → OPENAI_API_KEY 버그 수정 | H |
| `.github/workflows/ci.yml` | 수정 — e2e job 추가 (check job 통과 후 실행) | H |

---

## 2. 주요 변경 내용

### 2.1 RAG [4] 검증 단계 통합

`generateAnswer` Usecase에 `verifier: ILawVerifierPort`를 4번째 인자로 추가하고 V1~V6 검증 + 재시도 정책을 구현했습니다.

```
질문 입력
  → [1] 쿼리 변환
  → [2] API 검색
  → [3] 답변 생성
  → [4] V1~V6 검증  ← 신규
       FAIL (V1): 재검색 1회 → 재생성 → 재검증
       FAIL (V2~V6): 재생성 1회 → 재검증
       FAIL (재시도 후): AppError('E-VERIFY-FAIL') throw
  → [5] UI 출력 (PASS만)
```

### 2.2 V1~V6 규칙 기반 검증 (`src/adapters/lawVerifier.ts`)

LLM 호출 없이 순수 TypeScript 로직으로 동작합니다.

| 항목 | 통과 조건 |
|---|---|
| V1 출처 존재 | 인용 조문이 sourceLaws 배열에 존재 |
| V2 인용 무결성 | excerpt가 원문 content에 완전 포함 (String.includes) |
| V3 라벨 적정성 | T1/T2→🟢⚫, T3/T4→🟡⚪⚫ |
| V4 시점 표기 | temporalLabel 비어 있지 않음 |
| V5 면책 고지 | disclaimer 비어 있지 않음 |
| V6 단정 금지 | 🟡유사사례 있을 때 단정 패턴 미검출 |

### 2.3 UI 보호 장치 (CLAUDE.md §0 — 미검증 답변 노출 금지)

- **PENDING 상태**: AnswerCard가 모든 내용을 차단하고 "검증 대기 중" 경고만 표시
- **E-VERIFY-FAIL**: page.tsx에서 주황색 "확인 어려움" 박스 표시, 답변 미노출
- **data-testid** 속성 추가 (`label-badge`, `temporal-label`, `disclaimer`, `pending-warning`, `verify-fail-message`, `question-input`, `submit-btn`)

### 2.4 부수 버그 수정

Phase 2 마이그레이션 미완성 버그 2건 수정:
- `app/api/answer/route.ts`: `GeminiQueryRewriterAdapter` → `OpenAIQueryRewriterAdapter`
- `app/api/answer/route.ts`: `GeminiAnswerGeneratorAdapter` → `OpenAIAnswerGeneratorAdapter`
- `next.config.ts`: `GEMINI_API_KEY` → `OPENAI_API_KEY` 환경변수 체크

---

## 3. 검증 결과

### 3.1 단위·통합·골든셋 테스트 (Vitest)

```
Test Files  7 passed (7)
Tests       75 passed (75)   ← Phase 2 대비 +35 증가
```

| 파일 | 테스트 수 | 내용 |
|---|---|---|
| `tests/unit/lawVerifier.test.ts` | 29 | V1~V6 각 PASS/FAIL 케이스 |
| `tests/unit/generateAnswer.test.ts` | 11 | 5단계 파이프라인 + 재시도 정책 + E-VERIFY-FAIL |
| `tests/golden/run_golden.test.ts` | 6 | 골든셋 G-1~G-5 (G-4A/4B 포함) V1~V6 직접 검증 |
| 기존 테스트 (Phase 1·2) | 29 | 회귀 유지 |

### 3.2 Playwright E2E (신규)

```
5 passed (28.8s)
```

| 시나리오 | 검증 포인트 |
|---|---|
| G-1 PASS 답변 | 🟢라벨·[현행]·면책고지 렌더링, PENDING 미표시 |
| G-2 E-VERIFY-FAIL | "확인 어려움" 박스 표시, 답변 미노출 |
| G-3 PENDING 차단 | "검증 대기 중" 경고 표시, 인용·요약 미노출 |
| G-4 로딩 상태 | 검색 중 버튼·입력 비활성화, 완료 후 답변 표시 |
| G-5 PII 오류 | 빨간 오류 박스 표시, 답변 미노출 |

### 3.3 TypeScript 타입 체크

```
npx tsc --noEmit → 오류 없음
```

---

## 4. 회계사 노출 가능 여부

**✅ 엔지니어링 관점: 회계사 노출 가능 조건 충족**

- V1~V6 검증 로직 구현 완료
- 검증 실패 답변 노출 차단 구현 완료
- PENDING 상태 차단 구현 완료
- E-VERIFY-FAIL UI 안내 구현 완료

---

## 5. 잔여 작업 (회계사 액션 필요)

다음 항목은 엔지니어링 범위 밖으로, 회계사가 직접 수행해야 합니다.

| 항목 | 내용 | 우선순위 |
|---|---|---|
| 골든셋 30건 작성 | `eval/golden_direct.json`에 실제 세법 질문·조문·발췌 30건 추가 (현재 6건 픽스처) | 높음 |
| P95 응답시간 재측정 | 검증 단계 추가 후 100회 측정, 목표 < 15초 확인 | 중간 |
| 실제 API 환각률 측정 | 실 API 연동 후 골든셋 30건으로 환각률 0% 확인 | 중간 |

---

## 6. 잠재 위험

| 위험 | 설명 | 대응 |
|---|---|---|
| V2 엄격 일치 | excerpt가 원문과 1자라도 다르면 V2 FAIL → 재생성 | LLM 시스템 프롬프트에 "원문 그대로 발췌" 강제 주입 (Phase 2에서 기구현) |
| V6 단정 패턴 미검출 | 한국어 신조어·다양한 단정 표현이 패턴에 없을 수 있음 | 골든셋 30건 작성 후 패턴 추가 보완 |
| P95 > 15초 우려 | 검증 단계 추가로 응답시간 소폭 증가 가능 | V1~V6는 LLM 없는 동기 연산이므로 영향 미미 예상; 재측정 확인 필요 |
| 클립보드 복사 E2E 미작성 | 인용 복사 기능은 CitationCopy 컴포넌트에 구현되어 있으나 E2E 시나리오 미포함 | 골든셋 작성 후 E2E 시나리오 보완 권장 |

---

## 7. CI 파이프라인 (갱신 후)

```
PR push
  ↓
check job: lint → typecheck → vitest (75 tests)
  ↓ (check 통과 후)
e2e job: playwright (5 tests)
```

실패한 E2E 결과는 `playwright-report/` 아티팩트로 7일 보관.

---

**Phase 3 엔지니어링 완료 확인:** TAX-012-A~H 8개 서브태스크 전체 완료.
골든셋 30건 작성 및 P95 재측정은 회계사 액션 항목으로 분리.
