# TAX-6B-9 구현 리포트 — 내용(도메인 정확도) 검증기

> 작성일: 2026-06-16
> 방안: **방안 A (규칙 기반, 결정론적)** — Phase 7 계획 회계사 결정(2026-06-16) 반영

---

## 변경 사항 요약

### 배경

law-verifier V1~V6는 **"인용 정직성"** 검사기입니다. 검색 결과에 있는 조문을 정확히
인용했는지만 봅니다. 그래서 **"인용은 정직하지만 도메인상 틀린"**(조용한 틀림) 유형은
잡지 못합니다.

| 케이스 | 문제 유형 | V1~V6 결과 |
|---|---|---|
| G5-06 | 사실 오류 — "대체 조항도 존재하지 않습니다"(실제론 통합세액공제로 흡수) | PASS |
| G5-10 | 검색 누락 — 현행 직접 근거(조특법 제121조의17)를 놓쳐 "직접 근거 없음" 응답 | PASS |

이 빈틈을 메우는 **V1~V6와 완전 분리된 별도 레이어**가 본 티켓의 결과물입니다.

### 파일 변경 목록

**신규:**
- `src/domain/contentVerify.ts` — 순수 함수 `checkContent()` (LLM·외부 API 미사용)
- `tests/unit/contentVerify.test.ts` — 유닛 테스트 9건

**수정:**
- `tests/golden/run_golden.test.ts` — 내용 검증 describe 블록 추가(V1~V6 블록과 분리)
- `eval/golden_repealed.json` — G5-06·G5-10에 `expectedContent` 추가 **(AI 제안값, 회계사 검수 대기)**

**무변경(보호):**
- `src/adapters/lawVerifier.ts`, `TIER_ALLOWED_LABELS`, `src/usecases/generateAnswer.ts` (CLAUDE.md §6.4)

### 주요 변경

#### 1. `checkContent(summary, spec)` 순수 함수

```typescript
interface ContentSpec {
  mustInclude?: string[]  // summary에 반드시 포함 (없으면 FAIL)
  mustExclude?: string[]  // summary에 있으면 안 됨 (있으면 FAIL)
}
interface ContentCheckResult {
  status: 'CONTENT_PASS' | 'CONTENT_FAIL'
  failedMustInclude: string[]
  failedMustExclude: string[]
}
```

- 연속 공백 정규화 후 단순 문자열 포함(`includes`) 비교 — **항상 같은 결과(결정론적)**
- 비결정성·API 키 불필요 → 골든 CI에 그대로 편입 (TAX-6A-11 교훈 반영)

#### 2. AI 제안 키워드 (⚠️ 회계사 검수 대기)

| 케이스 | `mustInclude` | `mustExclude` |
|---|---|---|
| G5-06 | `["통합"]` | `["대체 조항도 존재하지 않습니다", "대체 규정이 없습니다", "대체 조항이 없습니다"]` |
| G5-10 | `["제121조의17"]` | `["직접 근거(법령 본문)를 찾지 못했습니다"]` |

> 각 케이스에 `_expectedContentProposedBy: "TAX-6B-9 (AI 제안 — 회계사 검수 대기)"` 메타
> 필드를 부착했습니다. 회계사가 검수·확정하면 이 필드를 제거합니다. (SSOT §7.8·§13.2
> 정답 자동 생성 금지 — AI는 제안만, 회계사가 최종 검수)
>
> **검수 포인트:**
> - G5-06 `mustInclude:["통합"]`은 느슨한 기준입니다. `["통합투자세액공제","통합고용세액공제"]`로
>   강화할지 회계사 판단이 필요합니다.
> - G5-10 정답 직접 근거 조문이 `제121조의17`이 맞는지 확인이 필요합니다.

---

## 검증 결과

1. **`npx tsc --noEmit`** — 타입 에러 0건
2. **`npm run build`** — PASS (`/api/*` 라우트 정상 생성)
3. **`npx vitest run`** — **607/607 PASS** (기존 595 + 신규 12)
   - `contentVerify.test.ts` 9건: mustInclude/mustExclude/결합/경계조건
   - `run_golden.test.ts` 내용검증 3건: 대상 존재 1 + G5-06·G5-10이 CONTENT_FAIL로 탐지됨
4. **law-verifier V1~V6 무변경 확인** — 기존 골든 회귀 그대로 PASS (별도 트랙 분리 검증)

### 합격 기준 달성

- ✅ G5-06(사실 오류)·G5-10(검색 누락)을 내용 검증기가 **CONTENT_FAIL로 탐지**
- ✅ 내용 검증 결과는 V1~V6 PASS/FAIL과 **별도 트랙**으로 보고
- ✅ API 키 불필요·결정론적 → 골든 CI 편입 완료

---

## 잠재 위험

- **표현 다양성 취약** (방안 A 본질적 한계): 답변 문구가 바뀌면 키워드 매칭이 빗나갈 수
  있습니다. 완화책으로 `mustExclude`에 동의어 표현을 배열로 복수 등록했습니다.
- **expectedContent는 현재 AI 제안값**입니다. 회계사 검수 전까지 키워드의 도메인 정확성은
  미확정 상태입니다. (특히 G5-10의 정답 조문 번호 `제121조의17`)
- 향후 회계사가 검수하며 G5-06 `mustInclude`를 강화하면 테스트 기대값(CONTENT_FAIL) 유지
  여부 재확인이 필요합니다.

---

## 후속 (회계사 작업)

1. G5-06·G5-10 `expectedContent` 키워드 검수·확정 → `_expectedContentProposedBy` 메타 제거
2. (선택) 다른 골든 케이스에도 `expectedContent` 확대 적용 — 도메인 정확도 회귀 강화
