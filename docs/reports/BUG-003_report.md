# BUG-003 구현 리포트 — V4 시점 라벨 형식 + V5 면책 표준 문구 검증 강화

> 완료일: 2026-05-19
> 관련 티켓: `docs/tickets/BUG-003_v4_v5_format_verification.md`
> 선행: TAX-012 (Phase 3 law-verifier 통합), Phase 3 재평가 M-1·M-2
> 의존: BUG-001 (V5 자동 부착 — 회귀 확인 완료)
> Severity: major (검증 형해화 — "있으면 통과"라 왜곡 라벨/면책이 회계사 노출)

---

## 1. 근본 원인

`src/adapters/lawVerifier.ts`의 V4·V5가 **"필드가 비어있지 않은지"만** 검사했다.

- **M-1 / V4** — `temporalLabel`이 `""`만 아니면 통과. `"옛날 법"` 같은 엉터리
  문자열도 통과 → CLAUDE.md §6.2 시점 라벨 3종 형식 의무 형해화.
- **M-2 / V5** — `disclaimer`가 `""`만 아니면 통과. 축약·왜곡된 면책도 통과
  → SSOT §14.1 "표준 문구 고정" 형해화.

---

## 2. 회계사 결정 — 시점 라벨 표기 정책 (2026-05-19)

구현 중 **시점 라벨 표기 3-way 불일치**를 발견하여 회계사 판단을 요청했다.

| 출처 | `[적용 시점]` 표기 | `~` 공백 |
|---|---|---|
| SSOT.md:251 / PRD.md:387 / CLAUDE.md §6.2 (사양 3종) | `... ~ ...` | **있음** |
| 코드 — `llmAnswerGenerator.ts:34` 프롬프트 | `...~...` | **없음** |
| 코드 — `Citation.ts:30` 주석 / 기존 테스트 / 골든셋 | `...~...` | **없음** |

**회계사 결정: 옵션 A(현행 코드 표기 기준, `~` 공백 없음) + 범위 1(V4·V5 둘 다
이번 PR)**. 근거: 현행 정상 답변을 한 건도 깨지 않으면서(LLM 실제 출력 형식과
일치) 엉터리 형식은 즉시 거른다. 기존 테스트·골든셋 회귀 0건, BUG-003 범위 내
완결(프롬프트·문서 미변경), 1티켓 1PR 준수. **사양↔코드 공백 불일치는 본 PR에서
해소하지 않고 §5에 명시 + 별도 정합 티켓 권고**(SSOT §9.3 문서 정합은 별도 세션).

---

## 3. 파일 변경 목록

| 파일 | 작업 | 내용 |
|---|---|---|
| `src/adapters/lawVerifier.ts` | 수정 | `DISCLAIMER` import 추가 + `TEMPORAL_LABEL_PATTERNS` 상수 추가 + V4 형식 검증 + V5 문구 일치 검증 |
| `tests/unit/lawVerifier.test.ts` | 수정 | V4 형식 위반/trim, V5 문구 왜곡/일치/trim 회귀 테스트 5건 추가 |

> 금지 항목(티켓 §3.2) 전부 미변경: V1·V2·V3·V6 로직, `disclaimer.ts` 상수
> 문구, `generateAnswer.ts` 재시도·`[4-a]` 블록, 퍼지/유사 매칭, LLM 호출,
> UI·API Route, 폴더 구조·의존성, PRD/SSOT/CLAUDE.md 본문, LLM 프롬프트.

---

## 4. 주요 변경 내용

### 4.1 시점 라벨 형식 정규식 (모듈 스코프 상수)

```ts
const TEMPORAL_LABEL_PATTERNS: RegExp[] = [
  /^\[현행\]$/,
  /^\[적용 시점: \d{4}\.\d{2}\.\d{2}~\d{4}\.\d{2}\.\d{2}\]$/,  // ~ 공백 없음 (옵션 A)
  /^\[폐지: \d{4}\.\d{2}\.\d{2}\]$/,
]
```

표기 기준·사양 불일치·결정 근거를 상수 JSDoc에 명시(후속 개발자가 "왜 사양과
1자 다른가"를 코드만 보고 알 수 있게).

### 4.2 V4 강화 (빈 값 검사 유지 + 형식 검증 추가)

```ts
if (!answer.temporalLabel || answer.temporalLabel.trim() === '') {
  checks.v4 = false
  failReasons.push('V4: 시점 라벨 미부착 — temporalLabel이 비어 있음')
} else if (!TEMPORAL_LABEL_PATTERNS.some((p) => p.test(answer.temporalLabel.trim()))) {
  checks.v4 = false
  failReasons.push(`V4: 시점 라벨 형식 불일치 — "${answer.temporalLabel.trim().slice(0, 30)}"`)
}
```

### 4.3 V5 강화 (빈 값 검사 유지 + DISCLAIMER 일치 검증)

```ts
if (!answer.disclaimer || answer.disclaimer.trim() === '') {
  checks.v5 = false
  failReasons.push('V5: 면책 고지 미부착 — disclaimer가 비어 있음')
} else if (answer.disclaimer.trim() !== DISCLAIMER) {
  checks.v5 = false
  failReasons.push('V5: 면책 고지가 표준 문구(DISCLAIMER)와 불일치')
}
```

`.trim()` 외 정규화 없음(SSOT §7.1 "문자 단위 일치" 정합). 퍼지 매칭 없음.

---

## 5. BUG-001 자동 부착 회귀 — 안전 확인

코드 추적으로 V5 강화가 BUG-001 경로를 깨지 않음을 확인:

- `llmAnswerGenerator.ts:103` → `disclaimer: DISCLAIMER` (LLM 미생성, 상수 주입)
- `generateAnswer.ts:54` BUG-001 `[4-a]` → `answer = { ...answer, disclaimer: DISCLAIMER }`

정상 경로의 `disclaimer`는 **항상 `DISCLAIMER` 상수 그 자체**이며
`DISCLAIMER.trim() === DISCLAIMER`(상수에 앞뒤 공백 없음)이므로 강화된 V5를
항상 통과한다. 자동 부착 후 재검증 시 V5 PASS → `E-VERIFY-FAIL` 오작동 없음.
전체 테스트(generateAnswer·통합 포함) 88건 그린으로 실측 재확인.

---

## 6. 검증 결과

| 단계 | 명령 | 결과 |
|---|---|---|
| 타입 체크 | `npm run typecheck` | ✅ 오류 없음 |
| 린트 | `npm run lint` | ✅ 오류 없음 |
| 테스트 | `npm run test` | ✅ **88 passed (88)** — 기존 83 + 신규 5 |
| 회귀 | (vitest 7 파일 전체) | ✅ 기존 V1~V6·골든셋·BUG-001/002 테스트 그린 유지 |

### Acceptance Criteria 대응 (티켓 §5)

- [x] AC1 — `temporalLabel` 3종 형식 불일치(`"옛날 법"` 등) 시 `checks.v4 === false`
- [x] AC2 — `[현행]`/`[적용 시점: 2024.01.01~2024.12.31]`/`[폐지: 2023.06.30]` V4 통과
- [x] AC3 — `disclaimer`가 `DISCLAIMER`와 1자라도 다르면 `checks.v5 === false`
- [x] AC4 — `disclaimer`가 `DISCLAIMER`와 정확히 일치하면 V5 통과
- [x] AC5 — 기존 V1·V2·V3·V6 단위 테스트 전부 그린(회귀 0건)
- [x] AC6 — BUG-001 V5 자동 부착 경로 회귀 그린(§5, 실측 88건 통과)
- [x] AC7 — `npm run test` 기존 83 + 신규 전부 그린(88)
- [x] AC8 — lint·typecheck 무오류
- [x] AC9 — 코드 동작이 CLAUDE.md §6.2(3종)·SSOT §14.1(면책 고정)과 일치
        (단 §6.2 `~` 공백 표기는 회계사 결정으로 코드 표기 기준 채택 — §7)

### 회귀 사전 점검 (티켓 §7)

- 기존 V4 테스트(`:272-278`)는 `[적용 시점: 2023.01.01~2023.12.31]`(공백 없음)
  사용 → 옵션 A 정규식과 일치, 그린 유지.
- 골든셋: G-1~G-4·지방세 = `[현행]`, G-5 = `[폐지: 2015.12.15]` → 전부
  정규식 통과, 골든 러너 회귀 0.

---

## 7. 잔여·위험·회계사 결정 사항

### 7.1 사양↔코드 시점 라벨 표기 불일치 (별도 정합 티켓 권고 — 본 PR 범위 밖)

사양 3종(SSOT §7.5 / PRD §6.4.1 / CLAUDE.md §6.2)은 `[적용 시점: YYYY.MM.DD ~
YYYY.MM.DD]`(물결표 양옆 공백)인데, 코드(LLM 프롬프트·Citation 주석·테스트·
골든셋)는 공백 없음이다. 본 PR은 회계사 결정(옵션 A)대로 **현행 코드 표기**를
검증 기준으로 채택했고, 불일치 자체는 해소하지 않았다.

→ **권고**: 별도 정합 티켓에서 회계사가 방향 결정 — (a) 사양을 코드에 맞춰
공백 제거, 또는 (b) 프롬프트·테스트·골든셋·V4 정규식을 사양에 맞춰 공백 추가.
SSOT §9.3(문서 정합은 별도 세션)에 따라 본 PR과 분리. 코드 상수 JSDoc과 본
리포트에 추적 가능하게 명시함(방치 아님).

### 7.2 범위 밖 (별도 처리)

- BUG-005(M-7·N-1·N-2), BUG-006(M-5 골든셋 네거티브)는 별도 PR(작성 완료, 미구현).
- BUG-004(M-3·M-4)는 회계사 결정으로 Phase 4까지 작성 보류.

---

## 8. 결론

V4가 시점 라벨 3종 형식을, V5가 면책 표준 문구(`DISCLAIMER`) 일치를 검증하도록
강화 완료. "비어있지만 않으면 통과"하던 형해화 사각지대(M-1·M-2)를 차단했다.
회계사 결정(옵션 A)으로 현행 정상 답변을 한 건도 깨지 않으면서 엉터리 형식·
왜곡 면책을 거른다. BUG-001 자동 부착 경로는 코드 추적·실측으로 안전 확인.

> **남은 일**: 사양↔코드 시점 라벨 표기 정합(별도 티켓), BUG-005/006 구현,
> 골든셋 30건·P95 재측정·G-N1 정답값 회계사 검수(M3 노출 게이트 잔여).

---

**작성자**: Claude (BUG-003 구현)
**작성일**: 2026-05-19
